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
from .generation_policy import default_ark_policy, validate_generation_policy
from .project_schema import migrate_document, new_document

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

app = FastAPI(title='安影 AI 视频工作室',lifespan=lifespan,docs_url=None,redoc_url=None)
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
    return {'status':'ok','app':'安影','version':'0.1.0'}

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
        row = c.execute("SELECT * FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_items WHERE kind='project' AND item_id=projects.id)",(pid,)).fetchone()
    if not row:
        raise HTTPException(404,'项目不存在')
    value=s.unpack(row)
    value['document']=migrate_document(value['document'])
    from .generation_staleness import reconcile_generation_staleness
    value['document']=reconcile_generation_staleness(
        value['document'],s.get_setting('providers',[]),
    )
    return value

@app.get('/api/projects')
def projects():
    with s.db() as c:
        return [dict(r) for r in c.execute("SELECT id,name,revision,created,updated FROM projects WHERE NOT EXISTS(SELECT 1 FROM deleted_items WHERE kind='project' AND item_id=projects.id) ORDER BY updated DESC")]

class ProjectCreate(BaseModel):
    name:str=Field(default='未命名短片',max_length=100)

def normalized_project_name(name:str)->str:
    return name.strip() or '未命名短片'

@app.post('/api/projects')
def create_project(body:ProjectCreate):
    pid = s.uid('project-')
    document = new_document(default_ark_policy(s.get_setting('providers',[])))
    with s.db() as c:
        c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,normalized_project_name(body.name),s.dumps(document),time.time(),time.time()))
    return project(pid)

@app.get('/api/projects/{pid}')
def read_project(pid:str):
    return project(pid)

@app.delete('/api/projects/{pid}')
def delete_project(pid:str):
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute("SELECT * FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_items WHERE kind='project' AND item_id=projects.id)",(pid,)).fetchone()
        if not row: raise HTTPException(404,'项目不存在')
        active=c.execute("SELECT COUNT(*) count FROM jobs WHERE project_id=? AND status IN ('queued','running')",(pid,)).fetchone()['count']
        if active: raise HTTPException(409,f'项目仍有 {active} 个运行中任务，请先取消后再移入回收站。')
        c.execute("INSERT INTO deleted_items(kind,item_id,project_id,deleted_at) VALUES('project',?,?,?)",(pid,pid,time.time()))
    return {'deleted':pid,'soft':True}

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
    document=migrate_document(body.document)
    # Preserve deleted provider ids so ordinary project edits remain savable;
    # the resolver reports the invalid target before any generation starts.
    document['generationPolicy']=validate_generation_policy(document['generationPolicy'],s.get_setting('providers',[]),allow_missing=True)
    encoded = s.dumps(document)
    if len(encoded)>8_000_000:
        raise HTTPException(413,'项目数据过大，请将素材上传到素材库。')
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        old=c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()
        if not old: raise HTTPException(404,'项目不存在')
        if old['revision']!=body.revision: raise HTTPException(409,'项目已在其他页面更新，请重新加载后编辑。')
        from .film_bible.versioning import validate_film_bible_transition
        validate_film_bible_transition(migrate_document(s.unpack(old)['document']),document)
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
    value=s.unpack(row)
    value['document']=migrate_document(value['document'])
    return value

def asset_row(aid):
    with s.db() as c:
        row=c.execute("SELECT * FROM assets WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_items WHERE kind='asset' AND item_id=assets.id)",(aid,)).fetchone()
    if not row: raise HTTPException(404,'素材不存在')
    return s.unpack(row)

def asset_public(row):
    return {**{k:v for k,v in row.items() if k!='path'},'url':f'/api/assets/{row["id"]}/file'}

ASSET_CATEGORIES={'character','scene','prop','shot','music','sfx','voice','reference','other'}
ASSET_KINDS={'image','video','audio','subtitle'}

def asset_category(value):
    if value not in ASSET_CATEGORIES:raise ValueError('素材分类无效')
    return value

@app.get('/api/projects/{pid}/assets')
def assets(pid:str,category:str|None=None,kind:str|None=None):
    project(pid)
    if category is not None:asset_category(category)
    if kind is not None and kind not in ASSET_KINDS:raise ValueError('媒体类型无效')
    clauses=['project_id=?',"NOT EXISTS(SELECT 1 FROM deleted_items WHERE kind='asset' AND item_id=assets.id)"];params=[pid]
    if category is not None:clauses.append('category=?');params.append(category)
    if kind is not None:clauses.append('kind=?');params.append(kind)
    with s.db() as c:
        return [asset_public(s.unpack(r)) for r in c.execute('SELECT * FROM assets WHERE '+' AND '.join(clauses)+' ORDER BY created DESC',params)]

@app.post('/api/projects/{pid}/assets')
async def upload(pid:str,file:UploadFile=File(...),category:str='other'):
    project(pid)
    category=asset_category(category)
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
            c.execute('INSERT INTO assets(id,project_id,name,kind,path,mime,metadata,created,category,source) VALUES(?,?,?,?,?,?,?,?,?,?)',(aid,pid,name,allowed[ext],path.name,mimetypes.guess_type(name)[0] or 'application/octet-stream',s.dumps(metadata),time.time(),category,'uploaded'))
        return asset_public(asset_row(aid))
    except Exception:
        path.unlink(missing_ok=True)
        raise

class AssetUpdate(BaseModel):
    category:str

@app.patch('/api/projects/{pid}/assets/{aid}')
def update_asset(pid:str,aid:str,body:AssetUpdate):
    category=asset_category(body.category)
    with s.db() as c:
        row=c.execute("SELECT * FROM assets WHERE id=? AND project_id=? AND NOT EXISTS(SELECT 1 FROM deleted_items WHERE kind='asset' AND item_id=assets.id)",(aid,pid)).fetchone()
        if not row:raise HTTPException(404,'素材不存在')
        c.execute('UPDATE assets SET category=? WHERE id=?',(category,aid))
    return asset_public(asset_row(aid))

@app.delete('/api/projects/{pid}/assets/{aid}')
def delete_asset(pid:str,aid:str):
    project(pid)
    with s.db() as c:
        row=c.execute("SELECT id FROM assets WHERE id=? AND project_id=? AND NOT EXISTS(SELECT 1 FROM deleted_items WHERE kind='asset' AND item_id=assets.id)",(aid,pid)).fetchone()
        if not row:raise HTTPException(404,'素材不存在')
        c.execute("INSERT INTO deleted_items(kind,item_id,project_id,deleted_at) VALUES('asset',?,?,?)",(aid,pid,time.time()))
    s.event(pid,{'type':'asset_deleted','id':aid})
    return {'deleted':aid,'soft':True}

@app.get('/api/trash')
def trash():
    with s.db() as c:
        deleted_projects=[dict(row) for row in c.execute("SELECT p.id,p.name,d.deleted_at FROM deleted_items d JOIN projects p ON p.id=d.item_id WHERE d.kind='project' ORDER BY d.deleted_at DESC")]
        deleted_assets=[dict(row) for row in c.execute("SELECT a.id,a.name,a.kind,a.category,a.project_id,p.name project_name,d.deleted_at FROM deleted_items d JOIN assets a ON a.id=d.item_id JOIN projects p ON p.id=a.project_id WHERE d.kind='asset' ORDER BY d.deleted_at DESC")]
    return {'projects':deleted_projects,'assets':deleted_assets}

@app.post('/api/trash/{kind}/{item_id}/restore')
def restore_deleted_item(kind:str,item_id:str):
    if kind not in ('project','asset'):raise HTTPException(400,'回收站类型无效')
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT * FROM deleted_items WHERE kind=? AND item_id=?',(kind,item_id)).fetchone()
        if not row:raise HTTPException(404,'回收站中没有该项目')
        if kind=='asset':
            hidden_project=c.execute("SELECT 1 FROM deleted_items WHERE kind='project' AND item_id=?",(row['project_id'],)).fetchone()
            if hidden_project:raise HTTPException(409,'请先恢复素材所属项目。')
        c.execute('DELETE FROM deleted_items WHERE kind=? AND item_id=?',(kind,item_id))
    if row['project_id']:s.event(row['project_id'],{'type':'restored','kind':kind,'id':item_id})
    return {'restored':item_id,'kind':kind}

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
        from .providers.volcengine_ark import list_models
        models=list_models(provider)
        if kind in ('text','image','video'):
            models=[model for model in models if model['kind']==kind]
        return {'models':models,'status':'ready'}
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

@app.post('/api/providers/{provider_id}/verify')
def verify_provider(provider_id:str):
    provider=next((p for p in s.get_setting('providers',[]) if p['id']==provider_id),None)
    if not provider or provider.get('type')!='volcengine_ark':raise ValueError('火山方舟服务配置不存在')
    from .providers.volcengine_ark import list_models
    models=list_models(provider)
    counts={kind:sum(model['kind']==kind for model in models) for kind in ('text','image','video')}
    return {'status':'ready','message':f'ARK API Key 鉴权通过，读取到 {len(models)} 个适用模型','models':models,'counts':counts}

@app.post('/api/providers/{provider_id}/test')
def test_provider(provider_id:str,kind:str='text'):
    provider=next((p for p in s.get_setting('providers',[]) if p['id']==provider_id),None)
    if not provider or provider.get('type')!='volcengine_ark':raise ValueError('火山方舟服务配置不存在')
    from .providers.volcengine_ark import check_configured_model
    return check_configured_model(provider,kind)

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
    if body.kind in ('text','storyboard') and body.input.get('target_duration') is not None:
        if not 1<=float(body.input['target_duration'])<=3000:raise ValueError('剧本或分镜目标时长应为 1–3000 秒')
    if body.input.get('visual_reference') is not None:
        from .visual_references import validate_visual_reference_job
        saved=c.execute('SELECT document FROM projects WHERE id=?',(pid,)).fetchone()
        validate_visual_reference_job(
            json.loads(saved['document']) if saved else {},body.node_id,body.kind,
            body.input,s.get_setting('providers',[]),
        )
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
    if selected and selected.get('type')=='volcengine_ark':
        from .providers.volcengine_ark import max_image_references
        ark_video_reference_count=(
            len(body.input['image_reference_sources'])
            if 'image_reference_sources' in body.input
            else len(body.input.get('asset_ids',[]))
        )
        if body.kind=='video' and ark_video_reference_count>1:
            raise ValueError('当前火山方舟视频最多接受一张首帧，请移除多余引用')
        if body.kind=='video' and body.input.get('end_asset_id') and ark_video_reference_count!=1:
            raise ValueError('使用火山方舟尾帧时必须同时指定一张首帧')
        if body.kind=='image' and len(references)>max_image_references(selected):
            raise ValueError(f'当前火山方舟图片模型最多支持 {max_image_references(selected)} 张参考图，请移除多余引用')
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
    saved_project=project(pid)
    from .reference_compiler import compile_shot_image_input
    prepared_input=compile_shot_image_input(
        saved_project['document'],body.node_id,body.kind,body.input,
        s.get_setting('providers',[]),
    )
    if body.kind in ('text','storyboard') and prepared_input.get('target_duration') is None:
        prepared_input={**prepared_input,'target_duration':saved_project['document'].get('duration',15)}
    body=body.model_copy(update={'input':prepared_input})
    tracking = None
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        if body.input.get('reference_compiler'):
            current_revision=c.execute('SELECT revision FROM projects WHERE id=?',(pid,)).fetchone()
            if not current_revision or current_revision['revision']!=saved_project['revision']:
                raise HTTPException(409,'视觉绑定在任务准备期间已更新，请重试生成')
        result=create_job_record(c,pid,body)
        if body.input.get('visual_reference') is not None:
            from .visual_references import record_visual_reference_submission
            tracking=record_visual_reference_submission(c,pid,body,result)
    if tracking:
        result={
            **result,
            'project_revision':tracking['revision'],
            'project_document':tracking['document'],
        }
        s.event(pid,{'type':'project','revision':tracking['revision']})
    s.event(pid,{'type':'job','id':result['id']})
    return result

@app.post('/api/projects/{pid}/run')
async def run_workflow(pid:str,request:Request):
    from .workflows import execution_plan
    body=await request.json();p=project(pid)
    group=body.get('submission_id')
    if not isinstance(group,str) or len(group)<8 or len(group)>80: raise ValueError('批次提交标识无效')
    exact=body.get('exact') is True
    plan=execution_plan(
        p['document'],body.get('node_ids'),body.get('include_descendants') is True,exact,
    )
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
    # A reference node is a static asset rather than a runnable job.  Preserve
    # that asset in the downstream job snapshot, just as the canvas's
    # single-node submit path does.  Runnable image parents are deliberately
    # left to the worker: it substitutes their freshly generated result when
    # the downstream job becomes runnable.
    mapping={
        node['id']:node for node in p['document'].get('nodes',[])
        if not (
            node.get('data',{}).get('managed') is True
            and node.get('data',{}).get('kind')=='visual_asset'
        )
    }
    planned_ids={node['id'] for node,_ in plan}
    runnable={'text','storyboard','image','video'}
    prepared=[]
    from .reference_compiler import compile_shot_image_input
    from .visual_references import resolve_image_model_capabilities
    capability_cache={}
    def cached_image_capabilities(provider,model_id):
        key=(provider.get('id'),model_id)
        if key not in capability_cache:
            capability_cache[key]=resolve_image_model_capabilities(provider,model_id)
        return capability_cache[key]
    for node,parents in plan:
        data=dict(node.get('data',{}));kind=data.get('kind')
        if kind not in runnable: continue
        data=compile_shot_image_input(
            p['document'],node['id'],kind,data,list(providers.values()),cached_image_capabilities,
        )
        film_bible_compiled=bool(data.get('reference_compiler'))
        manual_assets=list(data.get('asset_ids',[]))
        static_assets=[]
        generated_image_parents=0
        reference_sources=[]
        seen_reference_sources=set()
        for parent_id in ([] if film_bible_compiled else parents):
            parent_data=mapping[parent_id].get('data',{})
            if parent_data.get('kind')=='image':
                dynamic_parent=parent_id in planned_ids
                parent_asset_id=parent_data.get('assetId')
                if dynamic_parent:
                    generated_image_parents+=1
                elif parent_asset_id:
                    static_assets.append(parent_asset_id)
                key=(
                    ('upstream_node',parent_id)
                    if dynamic_parent
                    else ('asset',parent_asset_id)
                )
                if key not in seen_reference_sources:
                    if dynamic_parent:
                        reference_sources.append({'type':'upstream_node','node_id':parent_id})
                    elif parent_asset_id:
                        reference_sources.append({'type':'asset','asset_id':parent_asset_id})
                    seen_reference_sources.add(key)
            if parent_data.get('kind') not in runnable and parent_data.get('assetId'):
                asset_id=parent_data['assetId'];static_assets.append(asset_id)
                key=('asset',asset_id)
                if key not in seen_reference_sources:
                    reference_sources.append({'type':'asset','asset_id':asset_id})
                    seen_reference_sources.add(key)
        for asset_id in manual_assets:
            key=('asset',asset_id)
            if key not in seen_reference_sources:
                reference_sources.append({'type':'asset','asset_id':asset_id})
                seen_reference_sources.add(key)
        data['asset_ids']=(
            manual_assets
            if film_bible_compiled
            else list(dict.fromkeys([*manual_assets,*static_assets]))
        )
        if film_bible_compiled:
            reference_sources=list(data['image_reference_sources'])
            generated_image_parents=0
        for aid in data['asset_ids']:
            if asset_row(aid)['project_id']!=pid: raise ValueError('批次不能引用其他项目素材')
        provider=providers.get(data.get('provider','local'))
        if provider and provider.get('type')=='volcengine_ark':
            from .providers.volcengine_ark import max_image_references
            reference_count=len(data['asset_ids'])+generated_image_parents
            if kind=='video' and reference_count>1:
                raise ValueError('当前火山方舟视频最多接受一张首帧，请只保留一条图像连线或一张素材')
            if kind=='video' and data.get('end_asset_id') and reference_count!=1:
                raise ValueError('使用火山方舟尾帧时必须同时保留一张首帧')
            if kind=='image' and reference_count>max_image_references(provider):
                raise ValueError(f'当前火山方舟图片模型最多支持 {max_image_references(provider)} 张参考图，请移除多余引用')
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
        if kind in ('text','storyboard'):
            data['target_duration']=data.get('target_duration') or p['document'].get('duration',15)
        if kind=='storyboard':
            data['film_bible']=data.get('film_bible') is not False
        prepared.append((node,parents,data,reference_sources))
    jobs_by_node={};created=[]
    with s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        if any(data.get('reference_compiler') for _,_,data,_ in prepared):
            current_revision=c.execute('SELECT revision FROM projects WHERE id=?',(pid,)).fetchone()
            if not current_revision or current_revision['revision']!=p['revision']:
                raise HTTPException(409,'视觉绑定在批量任务准备期间已更新，请重试运行')
        for node,parents,data,reference_sources in prepared:
            kind=data.get('kind')
            data['upstream_job_ids']=[jobs_by_node[n] for n in parents if n in jobs_by_node]
            # Film Bible shots already carry compiler-owned asset sources in
            # character/scene/prop order. Other nodes retain canvas-edge order.
            # Dynamic parents are stored by durable job id for the worker.
            data['image_reference_sources']=[
                ({'type':'upstream_job','job_id':jobs_by_node[item['node_id']]}
                 if item['type']=='upstream_node' else item)
                for item in reference_sources
            ]
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
        # Re-read after cancellation so a provider handle attached between the
        # initial read and this state change is visible to remote cancellation.
        job=read_job(jid)
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
