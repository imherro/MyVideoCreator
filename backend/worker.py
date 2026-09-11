"""A serial GPU queue with immutable job inputs and durable provider handles."""
import base64
import json
import mimetypes
import shutil
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import quote
import httpx
from . import store as s, runtime
from .prompts import TEMPLATES, SHOT_SCHEMA, validate_shots
from .media import ffmpeg_executable,probe
from .process_lock import ProcessLock
from .editor_renderer import EditorRenderCompiler
from .providers.common import RecoverableProviderError,assets_for,checked,download_result,register

class Worker:
    def __init__(self):
        self.halt=threading.Event()
        self.thread=None
        self.busy=False
        self.process_lock=ProcessLock(s.DATA/'worker.lock')
    def start(self):
        self.process_lock.acquire()
        try:
            with s.db() as c:
                # Reconcile only after proving this process owns the queue.
                c.execute("UPDATE jobs SET status='interrupted',phase='服务已重启，可凭上游任务编号恢复查询',updated=? WHERE status='running'",(time.time(),))
            self.halt.clear()
            self.thread=threading.Thread(target=self.run_owned,daemon=True,name='studio-worker')
            self.thread.start()
        except BaseException:
            self.process_lock.release()
            raise
    def run_owned(self):
        try:self.loop()
        finally:self.process_lock.release()
    def stop(self):
        self.halt.set()
        if self.thread: self.thread.join(timeout=3)
    def loop(self):
        while not self.halt.is_set():
            failed=[]
            row=None
            with s.db() as c:
                c.execute('BEGIN IMMEDIATE')
                candidates=c.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 500").fetchall()
                for candidate in candidates:
                    dependencies=json.loads(candidate['input']).get('upstream_job_ids',[])
                    states=[c.execute('SELECT status FROM jobs WHERE id=?',(dep,)).fetchone() for dep in dependencies]
                    if any(not state or state['status'] in ('failed','cancelled') for state in states):
                        c.execute("UPDATE jobs SET status='failed',phase='上游任务未完成',error='上游任务失败或取消，请修复上游后重新执行此分支',finished=?,updated=? WHERE id=?",(time.time(),time.time(),candidate['id']))
                        failed.append(candidate)
                        continue
                    if any(state['status']!='succeeded' for state in states): continue
                    row=candidate;break
                if row: c.execute("UPDATE jobs SET status='running',started=COALESCE(started,?),updated=? WHERE id=?",(time.time(),time.time(),row['id']))
            for item in failed:s.event(item['project_id'],{'type':'job','id':item['id']})
            if not row:
                self.halt.wait(1)
                continue
            job=s.unpack(row); self.busy=True
            try:
                result=self.execute(job)
                if not self.cancelled(job): s.job_update(job['id'],status='succeeded',result=result,progress=100,phase='已完成')
            except InterruptedError:
                if self.halt.is_set():
                    s.job_update(job['id'],status='interrupted',phase='服务停止，保留上游任务编号供恢复核对')
                else:
                    s.job_update(job['id'],status='cancelled',phase='已取消')
            except RecoverableProviderError as exc:
                s.job_update(job['id'],status='interrupted',error=str(exc)[:1200],phase='供应商暂时不可用，保留上游任务编号；可恢复查询')
            except Exception as exc:
                message=str(exc)
                if isinstance(exc,(httpx.ConnectError,httpx.ConnectTimeout)):
                    message='无法连接模型服务，请确认服务已启动、地址正确。'
                if 'out of memory' in message.lower(): message='显存不足。请降低分辨率、时长或换用更小模型。'
                if self.halt.is_set() or isinstance(exc,httpx.TransportError):
                    s.job_update(job['id'],status='interrupted',error=message[:1200],phase='连接中断，保留输入与上游任务编号；可恢复查询')
                else:
                    s.job_update(job['id'],status='failed',error=message[:1200],phase='生成失败')
            finally:
                self.busy=False
    def cancelled(self,job):
        with s.db() as c:
            row=c.execute('SELECT status FROM jobs WHERE id=?',(job['id'],)).fetchone()
        return self.halt.is_set() or not row or row['status']=='cancelled'
    def progress(self,job,phase,percent=None):
        if self.cancelled(job): raise InterruptedError()
        s.job_update(job['id'],phase=phase,progress=percent)
    def execute(self,job):
        inp=dict(job['input']); kind=job['kind']
        if kind=='video':
            from .state_review import require_video_source_reviews
            with s.db() as c:
                saved=c.execute('SELECT document FROM projects WHERE id=?',(job['project_id'],)).fetchone()
            if saved:
                # A queued batch may have produced its still before the browser
                # can persist a review acknowledgement. Do not let that race
                # send an unchecked opening frame to a video model.
                require_video_source_reviews(json.loads(saved['document']),job['node_id'],include_pending=True)
        upstream_text=[];asset_ids=list(inp.get('asset_ids',[]));upstream_results={}
        for dependency in inp.get('upstream_job_ids',[]):
            with s.db() as c: previous=c.execute('SELECT * FROM jobs WHERE id=? AND project_id=?',(dependency,job['project_id'])).fetchone()
            if not previous or previous['status']!='succeeded': raise ValueError('上游任务尚未完成')
            result=json.loads(previous['result'] or '{}')
            upstream_results[dependency]=result
            if result.get('text'): upstream_text.append(result['text'])
            if 'image_reference_sources' not in inp:
                asset_ids.extend(a['id'] for a in result.get('assets',[]) if a.get('kind')=='image')
        if 'image_reference_sources' in inp:
            asset_ids=[]
            for source in inp['image_reference_sources']:
                if source.get('type')=='asset' and source.get('asset_id'):
                    asset_ids.append(source['asset_id'])
                elif source.get('type')=='upstream_job' and source.get('job_id') in upstream_results:
                    asset_ids.extend(
                        a['id'] for a in upstream_results[source['job_id']].get('assets',[])
                        if a.get('kind')=='image' and a.get('id')
                    )
                else:
                    raise ValueError('批次图像参考来源已损坏，请重新运行画布')
        if upstream_text: inp['prompt']=inp['prompt']+'\n\n上游创作内容：\n'+'\n\n'.join(upstream_text)
        inp['asset_ids']=list(dict.fromkeys(asset_ids))
        job={**job,'input':inp}
        self.progress(job,'准备任务')
        if kind=='export':
            runtime.unload()
            return self.export(job)
        provider_id=inp.get('provider','local')
        with s.db() as c:
            snapshot=c.execute('SELECT provider FROM job_private WHERE job_id=?',(job['id'],)).fetchone()
        if provider_id=='local':
            if kind not in ('text','storyboard'):
                raise ValueError('本地图像/视频服务尚未选择。请配置 ComfyUI 或连接本机 Maestro，然后选择对应模型。')
            model=inp.get('model') or next(iter(runtime.discover()),{}).get('id')
            url=runtime.load(model,lambda phase,pct:self.progress(job,phase,pct),lambda:self.cancelled(job))
            provider={'url':url,'type':'openai','local':True,'model':model,'api_key':runtime.credentials()}
        else:
            provider=json.loads(snapshot['provider']) if snapshot else None
            if not provider: raise ValueError('模型服务配置不存在')
            if not provider.get('local') and not inp.get('allow_cloud'): raise ValueError('未允许使用云端模型')
        if provider['type']=='replicate':
            from .replicate_api import execute
            return execute(self,job,provider)
        if kind in ('text','storyboard'):
            if provider['type']=='volcengine_ark':
                from .providers.volcengine_ark import model_for
                provider={**provider,'model':model_for(provider,'text')}
            try: return self.text(job,provider)
            finally:
                if provider_id=='local': runtime.schedule_idle()
        runtime.unload()
        if provider['type']=='maestro': return self.maestro(job,provider)
        if provider['type']=='comfy': return self.comfy(job,provider)
        if kind=='image' and provider['type']=='openai': return self.image(job,provider)
        if kind=='video' and provider['type']=='minimax':
            from .minimax_video import execute
            return execute(self,job,provider)
        if kind=='video' and provider['type']=='video_api': return self.video_api(job,provider)
        if provider['type']=='volcengine_ark':
            from .providers.volcengine_ark import execute
            return execute(self,job,provider)
        raise ValueError('所选服务不支持此任务类型，请更换模型服务。')

    def _chat_text(self,job,p,system_prompt,user_prompt,schema=None,phase='生成文本'):
        inp=job['input']
        headers={'Authorization':'Bearer '+p['api_key']} if p.get('api_key') else {}
        body={'model':inp.get('model') or p.get('model','local'),'messages':[{'role':'system','content':system_prompt},{'role':'user','content':user_prompt}], 'temperature':0.6,'max_tokens':min(int(inp.get('max_tokens',4096)),12000),'stream':True}
        if inp.get('provider','local')=='local':
            body['chat_template_kwargs']={'enable_thinking':False}
        if schema and (inp.get('provider','local')=='local' or p.get('structured')):
            body['response_format']={'type':'json_schema','json_schema':{'name':'structured_result','strict':True,'schema':schema}}
        self.progress(job,phase)
        chunks=[]; last=0
        with httpx.Client(timeout=httpx.Timeout(3600,connect=10),trust_env=not p.get('local',False)) as client:
            with client.stream('POST',p['url'].rstrip('/')+'/chat/completions',headers=headers,json=body) as response:
                if not response.is_success:
                    response.read(); checked(response)
                for line in response.iter_lines():
                    if self.cancelled(job):
                        if inp.get('provider','local')=='local': runtime.unload()
                        raise InterruptedError()
                    if not line.startswith('data:'): continue
                    data=line[5:].strip()
                    if data=='[DONE]': break
                    try:
                        part=json.loads(data).get('choices',[{}])[0].get('delta',{}).get('content')
                        if part: chunks.append(part)
                    except (ValueError,IndexError,AttributeError): continue
                    if time.time()-last>1:
                        s.job_update(job['id'],result={'text':''.join(chunks)})
                        last=time.time()
        text=''.join(chunks).strip()
        if not text: raise ValueError('文本模型没有返回正文，请检查模型聊天模板或切换模型。')
        return text

    def text(self,job,p):
        inp=job['input']; kind=job['kind']
        if kind=='storyboard' and inp.get('film_bible'):
            from .film_bible import extract_storyboard
            return extract_storyboard(
                inp['prompt'],inp.get('target_duration'),inp.get('provider','local'),
                inp.get('model') or p.get('model','local'),
                lambda system,user,schema,phase:self._chat_text(job,p,system,user,schema,phase),
            )
        prompt=inp['prompt']
        if kind=='storyboard' and inp.get('target_duration'):
            prompt+=f'\n镜头总时长必须为 {inp["target_duration"]} 秒，误差不超过 0.5 秒。'
        text=self._chat_text(
            job,p,inp.get('system_prompt') or TEMPLATES[kind],prompt,
            SHOT_SCHEMA if kind=='storyboard' else None,
            '生成剧本' if kind=='text' else '拆解分镜',
        )
        if kind=='storyboard':
            start=text.find('{'); end=text.rfind('}')
            try: result=validate_shots(json.loads(text[start:end+1]),inp.get('target_duration'))
            except (ValueError,TypeError) as exc:
                if inp.get('_repair_attempt'):raise ValueError('分镜修正后仍不符合要求：'+str(exc)) from exc
                self.progress(job,'校验分镜并修正一次')
                repaired={**inp,'_repair_attempt':True,'prompt':inp['prompt']+'\n\n上次结果未通过校验：'+str(exc)+'\n请保持故事内容，修正后重新输出完整 JSON。上次结果：\n'+text[:24000]}
                return self.text({**job,'input':repaired},p)
            return {'text':s.dumps(result),**result,'repair_count':int(bool(inp.get('_repair_attempt')))}
        return {'text':text}

    def image(self,job,p):
        if assets_for(job): raise ValueError('此图像服务当前为文生图接口，图生图请选择 ComfyUI 或 Maestro。')
        inp=job['input']; headers={'Authorization':'Bearer '+p['api_key']} if p.get('api_key') else {}
        self.progress(job,'云端生成图像')
        with httpx.Client(timeout=600,trust_env=not p.get('local',False)) as client:
            result=checked(client.post(p['url'].rstrip('/')+'/images/generations',headers=headers,json={'model':inp.get('model') or p.get('model'),'prompt':inp['prompt'],'n':1,'size':inp.get('size','1024x1024')}))
        outputs=[]
        for item in result.get('data',[]):
            if self.cancelled(job): raise InterruptedError()
            if item.get('b64_json'):
                path=s.DATA/(s.uid()+'.png')
                try:
                    path.write_bytes(base64.b64decode(item['b64_json']))
                    outputs.append(register(job,path,'分镜图.png'))
                finally: path.unlink(missing_ok=True)
            elif item.get('url'): outputs.append(download_result(job,item['url'],'.png'))
        if not outputs: raise ValueError('服务未返回图像')
        return {'assets':outputs}

    def maestro(self,job,p):
        inp=job['input']; url=p['url'].rstrip('/')
        if p.get('auto_start') and url=='http://127.0.0.1:7870':
            self.progress(job,'启动本地媒体引擎')
            runtime.start_maestro()
            with httpx.Client(timeout=3,trust_env=False) as probe:
                ready=False
                for _ in range(120):
                    if self.cancelled(job): raise InterruptedError()
                    try:
                        if probe.get(url+'/api/v1/system-stats').is_success:
                            ready=True;break
                    except httpx.HTTPError: pass
                    time.sleep(1)
                if not ready: raise ValueError('本地媒体引擎未能启动，请查看 data/logs/inference-engine.log')
        with httpx.Client(timeout=httpx.Timeout(3600,connect=10),trust_env=not p.get('local',False)) as client:
            remote=job.get('provider_job_id')
            if not remote:
                model=inp.get('model') or p.get('model')
                if not model: raise ValueError('请先选择 Maestro 模型')
                from .capabilities import maestro_model,validate_media
                catalogue=checked(client.get(url+'/api/v1/models')).get('models',[])
                entry=next((m for m in catalogue if m['model_type']==model),None)
                if not entry:raise ValueError('所选模型不在本地引擎目录中，请刷新模型列表')
                validate_media(maestro_model(entry),job['kind'],inp)
                defaults=checked(client.get(url+'/api/v1/defaults/'+quote(model,safe='')))
                if 'defaults' in defaults: defaults=defaults['defaults']
                body={**defaults,**p.get('parameters',{}),**inp.get('parameters',{}),'model_type':model,'prompt':inp['prompt'],'_client_submission_id':job['submission_id']}
                body['image_mode']=1 if job['kind']=='image' else 0
                body['video_prompt_type']=''
                body['image_prompt_type']=''
                body.pop('image_refs',None)
                body.pop('image_start',None)
                body.pop('image_end',None)
                body['resolution']=inp.get('resolution','832x480')
                if job['kind']=='video': body['video_length']=int(inp.get('frames',121))
                else: body['video_length']=1
                body['seed']=int(inp.get('seed',-1))
                refs=assets_for(job)
                if refs:
                    paths=[]
                    for ref in refs:
                        with (s.ASSETS/ref['path']).open('rb') as file:
                            uploaded=checked(client.post(url+'/api/v1/upload',files={'file':(ref['name'],file,ref['mime'])}))
                        paths.append(uploaded['path'])
                    if job['kind']=='image':
                        body['image_refs']=paths
                        body['video_prompt_type']='KI'
                    else:
                        # MiniMax H3 treats a still as an I2V start frame.
                        # ``video_prompt_type=I`` is for image_refs and gets
                        # stripped by the native engine when only image_start
                        # is present, silently turning this into T2V.
                        body['image_start']=paths[0]
                        body['image_prompt_type']='S'
                if inp.get('end_asset_id'):
                    tail=assets_for({**job,'input':{'asset_ids':[inp['end_asset_id']]}})[0]
                    if tail['kind']!='image':raise ValueError('尾帧必须是图像素材')
                    with (s.ASSETS/tail['path']).open('rb') as file:
                        uploaded=checked(client.post(url+'/api/v1/upload',files={'file':(tail['name'],file,tail['mime'])}))
                    body['image_end']=uploaded['path']
                    body['image_prompt_type']+='E'
                self.progress(job,'提交本地生成任务')
                result=checked(client.post(url+'/api/v1/generate',json=body))
                remote=result.get('job_id') or result.get('id')
                if not remote: raise ValueError('Maestro 未返回任务编号')
                s.job_update(job['id'],provider_job_id=remote)
            while not self.halt.wait(2):
                if self.cancelled(job):
                    client.post(url+'/api/v1/cancel/'+remote)
                    raise InterruptedError()
                status=checked(client.get(url+'/api/v1/status/'+remote))
                s.job_update(job['id'],telemetry={key:status.get(key) for key in ('step','total_steps','generation_eta_seconds','eta_confidence','current_clip','total_clips','current_window','total_windows')})
                self.progress(job,status.get('message') or status.get('phase') or '本地生成中',status.get('progress'))
                if status['status'] in ('failed','cancelled'): raise ValueError(status.get('error') or status.get('message') or ('本地生成失败，请查看引擎日志' if status['status']=='failed' else '本地任务已取消'))
                if status['status']=='completed':
                    outputs=[]
                    for output in status.get('output_files',[]):
                        name=output if isinstance(output,str) else output.get('name') or output.get('filename')
                        if not name: continue
                        output_kind=(mimetypes.guess_type(name)[0] or '').split('/')[0]
                        if output_kind!=job['kind']: continue
                        # Existing local bridge is restricted to its own output tree.
                        base=(runtime.MAESTRO/'outputs').resolve()
                        candidate=Path(name)
                        if not candidate.is_absolute(): candidate=base/candidate
                        candidate=candidate.resolve()
                        if candidate.is_relative_to(base) and candidate.is_file(): outputs.append(register(job,candidate))
                        else:
                            downloaded=client.get(url+'/api/v1/uploads/'+quote(Path(name).name,safe=''))
                            downloaded.raise_for_status()
                            temp=s.DATA/(s.uid()+Path(name).suffix)
                            try:
                                temp.write_bytes(downloaded.content); outputs.append(register(job,temp,Path(name).name))
                            finally: temp.unlink(missing_ok=True)
                    if not outputs: raise ValueError('本地任务完成，但没有可读取的输出文件')
                    return {'assets':outputs}
        raise InterruptedError()

    def comfy(self,job,p):
        inp=job['input']; template=p.get('workflow')
        if inp.get('end_asset_id'):raise ValueError('当前 ComfyUI 适配器未配置尾帧输入，请清除尾帧或使用内置引擎')
        if not isinstance(template,dict): raise ValueError('请在模型服务中配置 ComfyUI API 工作流 JSON')
        refs=assets_for(job); url=p['url'].rstrip('/')
        width,height=(int(v) for v in inp.get('resolution','832x480').split('x'))
        values={'prompt':inp['prompt'],'seed':int(inp.get('seed',0)),'width':width,'height':height,'frames':int(inp.get('frames',121)),'image':''}
        with httpx.Client(timeout=120,trust_env=not p.get('local',False)) as client:
            remote=job.get('provider_job_id')
            if not remote:
                if refs:
                    ref=refs[0]
                    with (s.ASSETS/ref['path']).open('rb') as file:
                        upload=checked(client.post(url+'/upload/image',files={'image':(ref['name'],file,ref['mime'])}))
                        values['image']=upload['name']
                def replace(value):
                    if isinstance(value,dict): return {k:replace(v) for k,v in value.items()}
                    if isinstance(value,list): return [replace(v) for v in value]
                    if isinstance(value,str):
                        for key,replacement in values.items():
                            if value=='{{'+key+'}}': return replacement
                            value=value.replace('{{'+key+'}}',str(replacement))
                    return value
                remote=checked(client.post(url+'/prompt',json={'prompt':replace(template),'client_id':job['id']})).get('prompt_id')
                if not remote: raise ValueError('ComfyUI 没有返回任务编号')
                s.job_update(job['id'],provider_job_id=remote)
            self.progress(job,'ComfyUI 排队或生成中')
            while not self.halt.wait(2):
                if self.cancelled(job):
                    # /interrupt affects all users of a ComfyUI instance, so don't call it blindly.
                    client.post(url+'/queue',json={'delete':[remote]})
                    raise InterruptedError('已取消本工作室任务；正在运行的共享引擎任务可能继续完成')
                history=checked(client.get(url+'/history/'+remote)).get(remote)
                if not history: continue
                if history.get('status',{}).get('status_str')=='error': raise ValueError('ComfyUI 执行失败，请检查引擎日志和工作流节点')
                outputs=[]
                for output in history.get('outputs',{}).values():
                    for key in ('images','gifs','videos','audio'):
                        for file in output.get(key,[]):
                            response=client.get(url+'/view',params={k:file[k] for k in ('filename','subfolder','type') if k in file})
                            response.raise_for_status()
                            temp=s.DATA/(s.uid()+Path(file['filename']).suffix)
                            try: temp.write_bytes(response.content); outputs.append(register(job,temp,file['filename']))
                            finally: temp.unlink(missing_ok=True)
                if not outputs: raise ValueError('工作流未保存媒体输出，请添加保存图像或视频节点')
                return {'assets':outputs}
        raise InterruptedError()

    def video_api(self,job,p):
        """Configurable async JSON video gateway. Explicit routes avoid false universal compatibility."""
        inp=job['input']; url=p['url'].rstrip('/')
        if inp.get('end_asset_id'):raise ValueError('当前视频网关未配置尾帧协议，请清除尾帧或使用内置引擎')
        headers={'Authorization':'Bearer '+p['api_key']} if p.get('api_key') else {}
        body={**p.get('request_defaults',{}),**inp.get('parameters',{}),'model':inp.get('model') or p.get('model'),'prompt':inp['prompt']}
        if assets_for(job): raise ValueError('此视频网关尚未配置媒体上传协议，请使用文生视频或本地参考图适配器')
        with httpx.Client(timeout=120,headers=headers,trust_env=not p.get('local',False)) as client:
            remote=job.get('provider_job_id')
            if not remote:
                result=checked(client.post(url+p.get('submit_path','/videos'),json=body))
                remote=result.get('id') or result.get('task_id')
                if not remote: raise ValueError('视频网关必须返回 id 或 task_id')
                s.job_update(job['id'],provider_job_id=remote)
            while not self.halt.wait(3):
                if self.cancelled(job): raise InterruptedError()
                status=checked(client.get(url+p.get('status_path','/videos/{id}').replace('{id}',quote(str(remote),safe=''))))
                self.progress(job,status.get('status','云端生成中'),status.get('progress'))
                if status.get('status') in ('failed','error','cancelled'): raise ValueError(str(status.get('error','视频生成失败')))
                if status.get('status') in ('completed','succeeded','success'):
                    target=status.get('url') or status.get('video_url') or (status.get('output') or {}).get('url')
                    if not target: raise ValueError('视频网关未返回 url/video_url/output.url')
                    return {'assets':[download_result(job,target,'.mp4')]}
        raise InterruptedError()

    def export(self,job):
        inp=job['input']
        if inp.get('editor_timeline') is not None:
            return self.export_editor(job)
        items=inp.get('timeline',[])
        if not items: raise ValueError('时间线没有镜头')
        executable=ffmpeg_executable()
        work=s.DATA/job['id']; work.mkdir(exist_ok=True)
        try:
            files=[]
            width,height=(int(x) for x in inp.get('resolution','1280x720').split('x'))
            if width<64 or height<64 or width>4096 or height>4096: raise ValueError('导出分辨率无效')
            for i,item in enumerate(items):
                with s.db() as c: row=c.execute('SELECT * FROM assets WHERE id=? AND project_id=?',(item['asset_id'],job['project_id'])).fetchone()
                if not row or row['kind'] not in ('image','video'): raise ValueError('时间线引用了无效的图像或视频')
                duration=max(0.1,min(float(item.get('duration',5)),600)); start=max(0,float(item.get('start',0)))
                info=probe(s.ASSETS/row['path']) if row['kind']=='video' else {'has_audio':False}
                if row['kind']=='video' and start+duration>info['duration']+.08:
                    raise ValueError(f'第 {i+1} 个片段超出素材时长 {info["duration"]:.2f} 秒，请缩短裁剪范围')
                target=work/f'{i:04d}.mp4'
                args=[executable,'-y']
                if row['kind']=='image': args+=['-loop','1']
                else: args+=['-ss',str(start)]
                args+=['-i',str(s.ASSETS/row['path'])]
                if not info['has_audio']:args+=['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']
                volume=max(0,min(float(item.get('volume',1)),2))
                fade=min(.3,duration/4)
                video_filter=f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS'
                if inp.get('transition')=='fade':video_filter+=f',fade=t=in:st=0:d={fade},fade=t=out:st={duration-fade}:d={fade}'
                args+=['-map','0:v:0','-map','0:a:0' if info['has_audio'] else '1:a:0','-t',str(duration),'-vf',video_filter,'-af',f'aresample=48000,apad,atrim=duration={duration},asetpts=PTS-STARTPTS,volume={volume}','-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-ar','48000',str(target)]
                self.run_process(job,args,work/f'{i}.log',f'合成镜头 {i+1}/{len(items)}')
                files.append(target)
            listing=work/'concat.txt'; listing.write_text('\n'.join(f"file '{p.name}'" for p in files),encoding='utf-8')
            output=work/'成片.mp4'
            args=[executable,'-y','-f','concat','-safe','0','-i',str(listing)]
            audio_id=inp.get('audio_id')
            subtitle_id=inp.get('subtitle_id')
            if audio_id:
                with s.db() as c: audio=c.execute('SELECT * FROM assets WHERE id=? AND project_id=?',(audio_id,job['project_id'])).fetchone()
                if not audio or audio['kind']!='audio': raise ValueError('配乐素材无效')
                music_volume=max(0,min(float(inp.get('music_volume',.3)),2))
                args+=['-stream_loop','-1','-i',str(s.ASSETS/audio['path']),'-filter_complex',f'[1:a]volume={music_volume}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0[mix]','-map','0:v:0','-map','[mix]']
            else:args+=['-map','0:v:0','-map','0:a:0']
            if subtitle_id:
                with s.db() as c: subtitle=c.execute('SELECT * FROM assets WHERE id=? AND project_id=?',(subtitle_id,job['project_id'])).fetchone()
                if not subtitle or subtitle['kind']!='subtitle':raise ValueError('字幕素材无效')
                shutil.copyfile(s.ASSETS/subtitle['path'],work/'subtitles.srt')
                args+=['-vf',"subtitles=filename=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=24,Outline=2,MarginV=24'",'-c:v','libx264','-preset','fast']
            else:args+=['-c:v','copy']
            args+=['-c:a','aac','-movflags','+faststart',str(output)]
            self.run_process(job,args,work/'export.log','输出 MP4')
            return {'assets':[register(job,output,'成片.mp4')]}
        finally:
            # All paths are rooted in this job's private work directory.
            if work.parent==s.DATA and work.name==job['id']: shutil.rmtree(work,ignore_errors=True)

    def export_editor(self,job):
        inp=job['input']; executable=ffmpeg_executable()
        work=s.DATA/job['id']; work.mkdir(exist_ok=True)
        try:
            width,height=(int(x) for x in inp.get('resolution','1280x720').split('x'))
            def lookup(asset_id):
                with s.db() as c:
                    row=c.execute('SELECT * FROM assets WHERE id=?',(asset_id,)).fetchone()
                if not row:return None
                result=dict(row);result['absolute_path']=str(s.ASSETS/result['path'])
                return result
            output=work/'成片.mp4'
            compiler=EditorRenderCompiler(
                job['project_id'],inp['editor_timeline'],(width,height),work,lookup,probe
            )
            plan=compiler.compile(executable,output)
            self.run_process(
                job,plan.args,work/'editor-export.log',
                f'合成高级时间线：{plan.visual_count} 个画面，{plan.audio_count} 路声音，{plan.text_count} 条文字'
            )
            return {'assets':[register(job,output,'成片.mp4')], 'render':{
                'mode':'editor','duration':plan.duration,'visual_count':plan.visual_count,
                'audio_count':plan.audio_count,'text_count':plan.text_count,
            }}
        finally:
            if work.parent==s.DATA and work.name==job['id']:shutil.rmtree(work,ignore_errors=True)
    def run_process(self,job,args,log_path,phase):
        self.progress(job,phase)
        with log_path.open('w',encoding='utf-8') as log:
            proc=subprocess.Popen(args,cwd=log_path.parent,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            while proc.poll() is None:
                if self.cancelled(job):
                    proc.terminate(); proc.wait(timeout=10); raise InterruptedError()
                time.sleep(0.3)
        if proc.returncode: raise ValueError('导出失败：'+log_path.read_text(encoding='utf-8',errors='replace')[-600:])
