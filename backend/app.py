import asyncio
import hashlib
import hmac
import json
import mimetypes
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, Request, Response, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from . import store as s, runtime
from .prompts import TEMPLATES

@asynccontextmanager
async def lifespan(app):
    s.init()
    runtime.bootstrap()
    from .worker import Worker
    worker = Worker()
    app.state.worker = worker
    worker.start()
    yield
    worker.stop()
    runtime.unload()

app = FastAPI(title='映序 AI 视频工作室',lifespan=lifespan,docs_url=None,redoc_url=None)
PUBLIC = {'/api/health','/api/auth/status','/api/auth/setup','/api/auth/login'}

def local(request):
    return request.client and request.client.host in ('127.0.0.1','::1','testclient')

@app.middleware('http')
async def auth(request: Request, call_next):
    if request.url.path.startswith('/api/'):
        # Cookie-authenticated mutations must originate from this deployment.
        origin = request.headers.get('origin')
        if request.method not in ('GET','HEAD','OPTIONS') and origin and urlparse(origin).netloc != request.headers.get('host'):
            return Response('跨站请求已拒绝',status_code=403)
        if request.url.path not in PUBLIC:
            token = request.cookies.get('mvc_session','')
            with s.db() as c:
                row = c.execute('SELECT expires FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            if not row or row['expires'] < time.time():
                return Response(s.dumps({'detail':'请登录工作室'}),401,media_type='application/json')
    result = await call_next(request)
    result.headers['X-Content-Type-Options'] = 'nosniff'
    result.headers['Referrer-Policy'] = 'same-origin'
    if request.url.path.startswith('/api/'):
        result.headers['Cache-Control'] = 'no-store'
    return result

@app.exception_handler(ValueError)
async def value_error(request, exc):
    return Response(s.dumps({'detail':str(exc)}),400,media_type='application/json')

@app.get('/api/health')
def health():
    return {'status':'ok','app':'映序','version':'0.1.0'}

@app.get('/api/auth/status')
def auth_status(request: Request):
    token = hashlib.sha256(request.cookies.get('mvc_session','').encode()).hexdigest()
    with s.db() as c:
        row = c.execute('SELECT expires FROM sessions WHERE token=?',(token,)).fetchone()
    return {'configured':bool(s.get_setting('password')),'authenticated':bool(row and row['expires']>time.time()),'can_setup':bool(local(request))}

class Password(BaseModel):
    password: str = Field(min_length=8,max_length=128)

def password_hash(password,salt):
    return hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()

def session(response, request):
    token = secrets.token_urlsafe(48)
    with s.db() as c:
        c.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
        c.execute('INSERT INTO sessions VALUES(?,?)',(hashlib.sha256(token.encode()).hexdigest(),time.time()+7*86400))
    response.set_cookie('mvc_session',token,max_age=7*86400,httponly=True,samesite='strict',secure=request.url.scheme=='https')

@app.post('/api/auth/setup')
def setup(body:Password,request:Request,response:Response):
    if not local(request):
        raise HTTPException(403,'请先在 GPU 主机上创建工作室密码。')
    salt = secrets.token_hex(16)
    encoded = s.dumps({'salt':salt,'hash':password_hash(body.password,salt)})
    with s.db() as c:
        if c.execute('SELECT 1 FROM settings WHERE key=?',('password',)).fetchone():
            raise HTTPException(409,'工作室已经设置密码，请登录。')
        c.execute('INSERT INTO settings VALUES(?,?)',('password',encoded))
    session(response,request)
    return {'ok':True}

_attempts = {}
@app.post('/api/auth/login')
def login(body:Password,request:Request,response:Response):
    ip = request.client.host
    attempts = [t for t in _attempts.get(ip,[]) if t > time.time()-300]
    if len(attempts)>=10:
        raise HTTPException(429,'尝试次数过多，请五分钟后重试。')
    saved = s.get_setting('password')
    if not saved or not hmac.compare_digest(password_hash(body.password,saved['salt']),saved['hash']):
        _attempts[ip] = attempts+[time.time()]
        raise HTTPException(401,'密码不正确')
    _attempts.pop(ip,None)
    session(response,request)
    return {'ok':True}

@app.post('/api/auth/logout')
def logout(request:Request,response:Response):
    with s.db() as c:
        c.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(request.cookies.get('mvc_session','').encode()).hexdigest(),))
    response.delete_cookie('mvc_session')
    return {'ok':True}

def project(pid):
    with s.db() as c:
        row = c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()
    if not row:
        raise HTTPException(404,'项目不存在')
    return s.unpack(row)

@app.get('/api/projects')
def projects():
    with s.db() as c:
        return [dict(r) for r in c.execute('SELECT id,name,revision,created,updated FROM projects ORDER BY updated DESC')]

class ProjectCreate(BaseModel):
    name:str=Field(default='未命名短片',max_length=100)

def normalized_project_name(name:str)->str:
    return name.strip() or '未命名短片'

@app.post('/api/projects')
def create_project(body:ProjectCreate):
    pid = s.uid('project-')
    document = {'nodes':[],'edges':[],'shots':[],'timeline':[],'characters':[],'brief':'','style':'电影写实','ratio':'16:9','duration':15}
    with s.db() as c:
        c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,normalized_project_name(body.name),s.dumps(document),time.time(),time.time()))
    return project(pid)

@app.get('/api/projects/{pid}')
def read_project(pid:str):
    return project(pid)

@app.delete('/api/projects/{pid}')
def delete_empty_project(pid:str):
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()
        if not row: raise HTTPException(404,'项目不存在')
        document=s.unpack(row)['document']
        has_content=bool(str(document.get('brief','')).strip()) or any(document.get(key) for key in ('nodes','edges','shots','timeline','characters'))
        has_assets=c.execute('SELECT 1 FROM assets WHERE project_id=? LIMIT 1',(pid,)).fetchone()
        has_jobs=c.execute('SELECT 1 FROM jobs WHERE project_id=? LIMIT 1',(pid,)).fetchone()
        if has_content or has_assets or has_jobs:
            raise HTTPException(400,'只能删除没有内容、素材和任务的空项目。')
        c.execute('DELETE FROM revisions WHERE project_id=?',(pid,))
        c.execute('DELETE FROM projects WHERE id=?',(pid,))
    return {'deleted':pid}

@app.get('/api/projects/{pid}/storyboard-sheet')
def storyboard_sheet(pid:str,columns:int=3,page:int=1):
    from .contact_sheet import render_sheet
    return Response(render_sheet(project(pid),columns,page),media_type='image/png',headers={'Content-Disposition':f'attachment; filename="storyboard-{page}.png"'})

class ProjectSave(BaseModel):
    name:str=Field(max_length=100)
    revision:int
    document:dict

@app.put('/api/projects/{pid}')
def save_project(pid:str,body:ProjectSave):
    encoded = s.dumps(body.document)
    if len(encoded)>8_000_000:
        raise HTTPException(413,'项目数据过大，请将素材上传到素材库。')
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        old=c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()
        if not old: raise HTTPException(404,'项目不存在')
        if old['revision']!=body.revision: raise HTTPException(409,'项目已在其他页面更新，请重新加载后编辑。')
        c.execute('INSERT INTO revisions VALUES(?,?,?,?,?)',(s.uid(),pid,old['revision'],old['document'],time.time()))
        c.execute('UPDATE projects SET name=?,revision=revision+1,document=?,updated=? WHERE id=?',(normalized_project_name(body.name),encoded,time.time(),pid))
    s.event(pid,{'type':'project','revision':body.revision+1})
    return {'revision':body.revision+1,'updated':time.time()}

@app.get('/api/projects/{pid}/revisions')
def revisions(pid:str):
    project(pid)
    with s.db() as c:
        return [dict(r) for r in c.execute('SELECT id,revision,created FROM revisions WHERE project_id=? ORDER BY revision DESC LIMIT 100',(pid,))]

@app.get('/api/projects/{pid}/revisions/{rid}')
def revision(pid:str,rid:str):
    with s.db() as c:
        row=c.execute('SELECT * FROM revisions WHERE project_id=? AND id=?',(pid,rid)).fetchone()
    if not row: raise HTTPException(404,'历史版本不存在')
    return s.unpack(row)

def asset_row(aid):
    with s.db() as c:
        row=c.execute('SELECT * FROM assets WHERE id=?',(aid,)).fetchone()
    if not row: raise HTTPException(404,'素材不存在')
    return s.unpack(row)

def asset_public(row):
    return {**{k:v for k,v in row.items() if k!='path'},'url':f'/api/assets/{row["id"]}/file'}

@app.get('/api/projects/{pid}/assets')
def assets(pid:str):
    project(pid)
    with s.db() as c:
        return [asset_public(s.unpack(r)) for r in c.execute('SELECT * FROM assets WHERE project_id=? ORDER BY created DESC',(pid,))]

@app.post('/api/projects/{pid}/assets')
async def upload(pid:str,file:UploadFile=File(...)):
    project(pid)
    name=Path(file.filename or 'asset').name
    ext=Path(name).suffix.lower()
    allowed={'.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.mp4':'video','.webm':'video','.mov':'video','.wav':'audio','.mp3':'audio','.m4a':'audio','.srt':'subtitle'}
    if ext not in allowed: raise HTTPException(400,'支持 PNG/JPG/WebP、MP4/WebM/MOV、WAV/MP3/M4A、SRT')
    aid=s.uid('asset-'); path=s.ASSETS/(aid+ext); total=0
    try:
        with path.open('wb') as out:
            while chunk:=await file.read(1024*1024):
                total+=len(chunk)
                if total>2*1024**3: raise HTTPException(413,'单个素材不能超过 2GB')
                out.write(chunk)
        metadata={'bytes':total}
        if allowed[ext]=='image':
            from PIL import Image
            with Image.open(path) as img:
                img.verify()
            with Image.open(path) as img:
                metadata.update(width=img.width,height=img.height)
        elif allowed[ext] in ('video','audio'):
            from .media import probe
            metadata.update(await asyncio.to_thread(probe,path))
        with s.db() as c:
            c.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',(aid,pid,name,allowed[ext],path.name,mimetypes.guess_type(name)[0] or 'application/octet-stream',s.dumps(metadata),time.time()))
        return asset_public(asset_row(aid))
    except Exception:
        path.unlink(missing_ok=True)
        raise

@app.get('/api/assets/{aid}/file')
def asset_file(aid:str):
    row=asset_row(aid)
    path=(s.ASSETS/row['path']).resolve()
    if not path.is_relative_to(s.ASSETS) or not path.is_file(): raise HTTPException(404,'素材文件丢失')
    return FileResponse(path,media_type=row['mime'],filename=row['name'],content_disposition_type='inline')

@app.get('/api/system')
def system():
    return {'hardware':runtime.hardware(),'runtime':runtime.status(),'models':runtime.discover(),'templates':TEMPLATES,'inventory':runtime.inventory()}

@app.get('/api/settings')
def settings():
    value=s.get_setting('providers',[])
    return {'providers':[{**{k:v for k,v in p.items() if k!='api_key'},'api_key_set':bool(p.get('api_key'))} for p in value], 'model_directories':s.get_setting('model_directories',[]),'llama_context':s.get_setting('llama_context',8192),'llama_gpu_layers':s.get_setting('llama_gpu_layers',-1),'ffmpeg':s.get_setting('ffmpeg','ffmpeg')}

@app.put('/api/settings')
async def update_settings(request:Request):
    body=await request.json()
    if 'providers' in body:
        old={p['id']:p for p in s.get_setting('providers',[])}
        for p in body['providers']:
            masked_key_set=bool(p.pop('api_key_set',False))
            if not p.get('id') or p.get('type') not in ('openai','comfy','maestro','video_api','minimax','replicate','volcengine_ark'): raise ValueError('模型服务配置无效')
            if p.get('type')=='volcengine_ark':
                from .providers.volcengine_ark import DEFAULT_BASE_URL
                p['url']=p.get('url') or DEFAULT_BASE_URL
                # Ark is always a paid remote provider.  Do not trust a client
                # supplied `local` flag to bypass the cloud confirmation gate.
                p['local']=False
                p.pop('kind',None)
                if not isinstance(p.get('models'),dict):raise ValueError('火山方舟模型配置无效')
            url=p.get('url','')
            if urlparse(url).scheme not in ('http','https') or urlparse(url).username: raise ValueError('请输入 HTTP(S) 服务地址')
            # A masked settings round-trip may omit the key or send an empty
            # field with api_key_set=true.  Both mean "keep the saved key".
            if 'api_key' not in p or (not p.get('api_key') and masked_key_set):
                p['api_key']=old.get(p['id'],{}).get('api_key','')
        s.set_setting('providers',body['providers'])
    for key in ('model_directories','llama_context','llama_gpu_layers','ffmpeg'):
        if key in body: s.set_setting(key,body[key])
    return settings()

@app.post('/api/runtime/unload')
def unload(request:Request):
    if request.app.state.worker.busy: raise HTTPException(409,'任务运行中，不能卸载模型')
    runtime.unload()
    return runtime.status()

@app.post('/api/runtime/maestro/start')
def start_maestro():
    return runtime.start_maestro()

@app.get('/api/providers/{provider_id}/models')
def provider_models(provider_id:str,kind:str|None=None):
    import httpx
    provider=next((p for p in s.get_setting('providers',[]) if p['id']==provider_id),None)
    if not provider: raise ValueError('模型服务不存在')
    headers={'Authorization':'Bearer '+provider['api_key']} if provider.get('api_key') else {}
    url=provider['url'].rstrip('/')
    if provider['type']=='volcengine_ark':
        from .providers.volcengine_ark import model_for
        kinds=[kind] if kind in ('text','image','video') else ['text','image','video']
        models=[{'id':model_for(provider,item),'name':model_for(provider,item)} for item in kinds if model_for(provider,item)]
        return {'models':models,'status':'configured'}
    if provider['type']=='maestro' and provider.get('local') and provider.get('auto_start') and url=='http://127.0.0.1:7870':
        state=runtime.start_maestro()
        if state['status']=='starting':
            return {'models':[],'status':'starting'}
    try:
        with httpx.Client(timeout=20,trust_env=not provider.get('local'),headers=headers) as client:
            if provider['type']=='maestro':
                response=client.get(url+'/api/v1/models'); response.raise_for_status()
                value=response.json()
                from .capabilities import maestro_model
                models=[maestro_model(m) for m in value.get('models',[])]
                return {'models':[m for m in models if provider.get('kind') in m['kinds'] or not provider.get('kind')]}
            if provider['type']=='openai':
                response=client.get(url+'/models'); response.raise_for_status()
                return {'models':[{'id':m['id'],'name':m.get('name',m['id'])} for m in response.json().get('data',[])]}
            if provider['type']=='comfy':
                response=client.get(url+'/system_stats'); response.raise_for_status()
                return {'models':[{'id':provider.get('model') or 'workflow','name':provider.get('name','ComfyUI 工作流')}],'status':'ready'}
            return {'models':[{'id':provider.get('model',''),'name':provider.get('model','配置的视频模型')}]}
    except httpx.HTTPError as exc:
        raise HTTPException(502,'模型服务连接失败，请确认服务地址、启动状态和密钥') from exc

@app.post('/api/providers/{provider_id}/test')
def test_provider(provider_id:str):
    import httpx
    from .worker import checked
    provider=next((p for p in s.get_setting('providers',[]) if p['id']==provider_id),None)
    if not provider or provider.get('type')!='volcengine_ark':raise ValueError('火山方舟服务配置不存在')
    from .providers.volcengine_ark import model_for
    model=model_for(provider,'text')
    if not model:raise ValueError('请填写火山方舟文本模型 ID')
    key=str(provider.get('api_key') or '').strip()
    if not key:raise ValueError('请先保存 ARK API Key')
    body={'model':model,'messages':[{'role':'user','content':'只回复 OK'}],'max_tokens':1,'stream':False}
    with httpx.Client(timeout=30,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},trust_env=True) as client:
        checked(client.post(provider['url'].rstrip('/')+'/chat/completions',json=body))
    return {'status':'ready','message':'火山方舟连接成功','model':model}

class JobCreate(BaseModel):
    node_id:str
    kind:str
    submission_id:str=Field(min_length=8,max_length=200)
    input:dict

class PromptTemplateSave(BaseModel):
    revision:int=Field(ge=0)
    name:str=Field(min_length=1,max_length=100)
    kind:str
    content:str=Field(min_length=1,max_length=24000)
    deleted:bool=False

@app.get('/api/prompt-library')
def prompt_library():
    return s.get_setting('prompt_library',{'revision':0,'templates':[]})

@app.put('/api/prompt-library/{tid}')
def save_prompt_template(tid:str,body:PromptTemplateSave):
    if len(tid)>100 or body.kind not in ('text','storyboard','image','video'):raise ValueError('模板类型或编号无效')
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute("SELECT value FROM settings WHERE key='prompt_library'").fetchone()
        library=json.loads(row['value']) if row else {'revision':0,'templates':[]}
        if library['revision']!=body.revision:raise HTTPException(409,'模板库已在另一页面更新，请刷新后保存；当前草稿仍保留')
        old=next((t for t in library['templates'] if t['id']==tid),None)
        history=old.get('history',[]) if old else []
        if old:history=[{k:v for k,v in old.items() if k!='history'},*history][:20]
        template={'id':tid,'name':body.name,'kind':body.kind,'content':body.content,'deleted':body.deleted,'version':old['version']+1 if old else 1,'updated':time.time(),'history':history}
        library['templates']=[template,*[t for t in library['templates'] if t['id']!=tid]]
        if len(library['templates'])>500:raise ValueError('模板库最多保存 500 个模板')
        library['revision']+=1
        c.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('prompt_library',s.dumps(library)))
    return library

def create_job_record(c,pid,body):
    if body.kind not in ('text','storyboard','image','video','export'): raise ValueError('不支持的任务类型')
    old=c.execute('SELECT * FROM jobs WHERE submission_id=?',(body.submission_id,)).fetchone()
    if old:
        if old['project_id']!=pid: raise HTTPException(409,'提交标识冲突')
        if old['node_id']!=body.node_id or old['kind']!=body.kind or json.loads(old['input'])!=body.input:
            raise HTTPException(409,'同一提交标识不能对应不同输入')
        return s.unpack(old)
    if body.kind!='export' and not body.input.get('prompt','').strip(): raise ValueError('请输入生成描述')
    if body.kind=='video':
        from .state_review import require_video_source_reviews
        saved=c.execute('SELECT document FROM projects WHERE id=?',(pid,)).fetchone()
        if saved: require_video_source_reviews(json.loads(saved['document']),body.node_id)
    if body.kind=='storyboard' and body.input.get('target_duration') is not None:
        if not 1<=float(body.input['target_duration'])<=3000:raise ValueError('分镜目标时长应为 1–3000 秒')
    if body.kind in ('image','video') and body.input.get('provider','local')=='local':raise ValueError('请为图像或视频节点选择对应的本地媒体服务')
    selected = None
    if body.input.get('provider','local')!='local' and body.kind!='export':
        configured={p['id']:p for p in s.get_setting('providers',[])}
        selected=configured.get(body.input['provider'])
        if not selected: raise ValueError('模型服务未配置')
        if selected.get('type')=='volcengine_ark':
            # Defend jobs created from settings saved by an older build.
            selected={**selected,'local':False}
        if selected.get('kind') and selected['kind']!=('text' if body.kind=='storyboard' else body.kind):raise ValueError('模型服务用途与节点不匹配，请选择适用服务')
        if selected.get('type')=='volcengine_ark':
            from .providers.volcengine_ark import model_for
            if not model_for(selected,body.kind):raise ValueError('请先配置火山方舟对应类型的模型 ID')
        if not selected.get('local',False) and body.input.get('allow_cloud') is not True: raise ValueError('请选择允许使用此云端服务后再提交')
    if selected and selected['type']=='minimax':
        from .minimax_video import payload
        if body.kind!='video':raise ValueError('MiniMax 原生服务仅支持视频节点')
        payload(body.input,selected)
    references=list(body.input.get('asset_ids',[]))
    if body.input.get('end_asset_id'):references.append(body.input['end_asset_id'])
    if selected and selected.get('type')=='volcengine_ark' and references:
        raise ValueError('本轮火山方舟仅支持纯文生图和纯文生视频，请移除参考素材')
    for aid in references:
        asset=asset_row(aid)
        if asset['project_id']!=pid: raise ValueError('不能引用其他项目的素材')
        if body.kind in ('image','video') and asset['kind']!='image':raise ValueError('当前图像和视频适配器只接受图像参考素材')
        if selected and selected['type']=='minimax':
            from .minimax_video import first_frame
            first_frame(asset)
    jid=s.uid('job-'); now=time.time()
    c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,body.submission_id,pid,body.node_id,body.kind,'queued',s.dumps(body.input),now,now))
    if selected:
        c.execute('INSERT INTO job_private VALUES(?,?)',(jid,s.dumps(selected)))
    return s.unpack(c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())

@app.post('/api/projects/{pid}/jobs')
def submit(pid:str,body:JobCreate):
    project(pid)
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        result=create_job_record(c,pid,body)
    s.event(pid,{'type':'job','id':result['id']})
    return result

@app.post('/api/projects/{pid}/run')
async def run_workflow(pid:str,request:Request):
    from .workflows import execution_plan
    body=await request.json();p=project(pid)
    group=body.get('submission_id')
    if not isinstance(group,str) or len(group)<8 or len(group)>80: raise ValueError('批次提交标识无效')
    plan=execution_plan(p['document'],body.get('node_ids'),body.get('include_descendants') is True)
    providers={x['id']:x for x in s.get_setting('providers',[])}
    # Validate the entire batch before submitting its first runnable node.
    for node,_ in plan:
        data=node.get('data',{})
        if data.get('kind') not in ('text','storyboard','image','video'): continue
        provider=providers.get(data.get('provider','local'))
        if data.get('provider','local')!='local' and not provider: raise ValueError('部分节点的模型服务未配置')
        if provider and not provider.get('local') and not body.get('allow_cloud'): raise ValueError('批次包含云端模型，请明确允许云端调用或更换为本地模型')
    for node,parents in plan:
        data=node.get('data',{})
        if data.get('kind') not in ('text','storyboard','image','video'): continue
        if not data.get('prompt','').strip() and not parents: raise ValueError('起始节点缺少创作描述')
        for aid in data.get('asset_ids',[]):
            if asset_row(aid)['project_id']!=pid: raise ValueError('批次不能引用其他项目素材')
    # A reference node is a static asset rather than a runnable job.  Preserve
    # that asset in the downstream job snapshot, just as the canvas's
    # single-node submit path does.  Runnable image parents are deliberately
    # left to the worker: it substitutes their freshly generated result when
    # the downstream job becomes runnable.
    mapping={node['id']:node for node,_ in plan}
    runnable={'text','storyboard','image','video'}
    prepared=[]
    for node,parents in plan:
        data=dict(node.get('data',{}));kind=data.get('kind')
        if kind not in runnable: continue
        static_assets=[]
        generated_image_parents=0
        for parent_id in parents:
            parent_data=mapping[parent_id].get('data',{})
            if parent_data.get('kind')=='image': generated_image_parents+=1
            if parent_data.get('kind') not in runnable and parent_data.get('assetId'):
                static_assets.append(parent_data['assetId'])
        data['asset_ids']=list(dict.fromkeys([*data.get('asset_ids',[]),*static_assets]))
        provider=providers.get(data.get('provider','local'))
        if provider and provider.get('type')=='volcengine_ark' and (data['asset_ids'] or generated_image_parents):
            raise ValueError('本轮火山方舟不接收参考素材，请断开图像输入后再运行')
        if provider and provider.get('type')=='minimax':
            # Hailuo accepts exactly one initial image.  Detect multiple
            # upstream image branches before any expensive parent job starts.
            if len(data['asset_ids'])+generated_image_parents>1:
                raise ValueError('MiniMax 图生视频仅接受一张首帧；请保留一条图像连线或在节点中选择一张素材')
        if not data.get('prompt','').strip():
            if not parents: raise ValueError(f'节点 {data.get("label",node["id"])} 缺少输入')
            data['prompt']={'text':'根据上游信息编写剧本','storyboard':'将上游剧本拆解为结构化分镜','image':'生成上游描述的电影画面','video':'根据上游画面与描述生成动态镜头'}[kind]
        data['allow_cloud']=bool(body.get('allow_cloud'))
        data['project_style']=p['document'].get('style','')
        data['ratio']=p['document'].get('ratio','16:9')
        if kind=='storyboard':data['target_duration']=data.get('target_duration') or p['document'].get('duration',15)
        prepared.append((node,parents,data))
    jobs_by_node={};created=[]
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        for node,parents,data in prepared:
            kind=data.get('kind')
            data['upstream_job_ids']=[jobs_by_node[n] for n in parents if n in jobs_by_node]
            result=create_job_record(c,pid,JobCreate(node_id=node['id'],kind=kind,submission_id=f'{group}:{node["id"]}',input=data))
            jobs_by_node[node['id']]=result['id'];created.append(result['id'])
    for jid in created:s.event(pid,{'type':'job','id':jid})
    return {'job_ids':created,'count':len(created)}

@app.get('/api/projects/{pid}/jobs')
def jobs(pid:str):
    project(pid)
    with s.db() as c:
        return [s.unpack(r) for r in c.execute('SELECT * FROM jobs WHERE project_id=? ORDER BY created DESC LIMIT 200',(pid,))]

@app.get('/api/jobs/{jid}')
def read_job(jid:str):
    with s.db() as c:
        row=c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone()
    if not row: raise HTTPException(404,'任务不存在')
    return s.unpack(row)

@app.post('/api/jobs/{jid}/cancel')
def cancel(jid:str):
    job=read_job(jid)
    if job['status'] in ('queued','running','interrupted'):
        s.job_update(jid,status='cancelled',phase='已请求取消，等待运行引擎释放')
        with s.db() as c:
            snapshot=c.execute('SELECT provider FROM job_private WHERE job_id=?',(jid,)).fetchone()
        if snapshot:
            provider=json.loads(snapshot['provider'])
            if provider.get('type')=='replicate':
                from .replicate_api import cancel as cancel_replicate
                cancel_replicate(job,provider)
            elif provider.get('type')=='volcengine_ark':
                from .providers.volcengine_ark import cancel as cancel_ark
                remote_cancelled=cancel_ark(job,provider)
                if remote_cancelled is True:
                    s.cancelled_phase(jid,'已取消本地等待，并已请求供应商取消远端任务')
                elif remote_cancelled is False:
                    s.cancelled_phase(jid,'本地已取消；供应商可能继续生成并产生费用')
    return read_job(jid)

@app.post('/api/jobs/{jid}/resume')
def resume(jid:str):
    # Reconcile the same upstream job using its original credentials and input.
    # Never infer that a missing handle means the original submission failed.
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        job=c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone()
        if not job: raise HTTPException(404,'任务不存在')
        if job['status'] in ('queued','running','succeeded'): return s.unpack(job)
        if job['status']!='interrupted': raise HTTPException(409,'只有中断任务可以恢复查询')
        snapshot=c.execute('SELECT provider FROM job_private WHERE job_id=?',(jid,)).fetchone()
        provider=json.loads(snapshot['provider']) if snapshot else {}
        if not job['provider_job_id'] or provider.get('type') not in ('maestro','comfy','video_api','minimax','replicate','volcengine_ark'):
            raise HTTPException(409,'此任务没有可恢复的上游编号或查询接口，请核对服务后从节点重新生成')
        c.execute("UPDATE jobs SET status='queued',error=NULL,phase='恢复查询已有上游任务',updated=? WHERE id=?",(time.time(),jid))
    s.event(job['project_id'],{'type':'job','id':jid})
    return read_job(jid)

@app.get('/api/events')
async def events(request:Request,after:int=0):
    async def stream():
        cursor=after
        try: cursor=max(cursor,int(request.headers.get('last-event-id','0')))
        except ValueError: pass
        while not await request.is_disconnected():
            with s.db() as c:
                rows=c.execute('SELECT * FROM events WHERE id>? ORDER BY id LIMIT 100',(cursor,)).fetchall()
            for row in rows:
                cursor=row['id']
                yield f'id: {cursor}\ndata: {s.dumps({"project_id":row["project_id"],**json.loads(row["payload"])})}\n\n'
            if not rows: yield ': heartbeat\n\n'
            await asyncio.sleep(2)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'X-Accel-Buffering':'no'})

if (s.ROOT/'dist').is_dir():
    app.mount('/',StaticFiles(directory=s.ROOT/'dist',html=True),name='web')
