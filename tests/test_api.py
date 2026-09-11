import os
import tempfile
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import store as s
from backend.worker import Worker

@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        # Keep queue tests deterministic; runtime integration is a separate test.
        app.state.worker.stop()
        yield c

@pytest.fixture(scope='module')
def authenticated(client):
    assert client.get('/api/projects').status_code==401
    assert client.post('/api/auth/setup',json={'password':'integration-test-only'}).status_code==200
    return client

def project(c):
    response=c.post('/api/projects',json={'name':'测试短片'})
    assert response.status_code==200,response.text
    return response.json()

def test_project_schema_revision_migration_and_generation_policy_roundtrip(authenticated):
    c=authenticated
    old_providers=s.get_setting('providers',[])
    ark={'id':'phase0-ark','name':'Phase 0 Ark','type':'volcengine_ark','local':False,
         'url':'https://ark.cn-beijing.volces.com/api/v3','api_key':'test-only',
         'models':{'text':'doubao','image':'seedream','video':'seedance'}}
    s.set_setting('providers',[*old_providers,ark])
    try:
        created=project(c)
        assert created['document']['schemaVersion']==1
        assert created['document']['generationPolicy']['image']=={'providerId':'phase0-ark','modelId':'seedream'}
        document=created['document'];document['generationPolicy']['video']={'providerId':'phase0-ark','modelId':'seedance-custom'}
        saved=c.put('/api/projects/'+created['id'],json={'name':created['name'],'revision':created['revision'],'document':document})
        assert saved.status_code==200,saved.text
        assert c.get('/api/projects/'+created['id']).json()['document']['generationPolicy']['video']['modelId']=='seedance-custom'

        pid=s.uid('legacy-');rid=s.uid('revision-');now=time.time()
        legacy={'nodes':[{'id':'old-node'}],'edges':[],'shots':[],'timeline':[],'editor':{'timeline':{'tracks':[]}}}
        encoded=s.dumps(legacy)
        with s.db() as db:
            db.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'旧项目',encoded,now,now))
            db.execute('INSERT INTO revisions VALUES(?,?,?,?,?)',(rid,pid,1,encoded,now))
        current=c.get('/api/projects/'+pid).json()['document']
        historical=c.get(f'/api/projects/{pid}/revisions/{rid}').json()['document']
        assert current['schemaVersion']==1 and historical['schemaVersion']==1
        assert current['nodes']==legacy['nodes'] and historical['editor']==legacy['editor']
        with s.db() as db:
            assert db.execute('SELECT document FROM revisions WHERE id=?',(rid,)).fetchone()['document']==encoded
            assert db.execute('SELECT document FROM projects WHERE id=?',(pid,)).fetchone()['document']==encoded
    finally:
        s.set_setting('providers',old_providers)

def test_cross_origin_and_secret_masking(authenticated):
    c=authenticated
    assert c.post('/api/projects',json={'name':'bad'},headers={'Origin':'https://other.example'}).status_code==403
    settings={'providers':[{'id':'cloud','name':'测试服务','type':'openai','url':'https://example.com/v1','api_key':'do-not-expose','local':False,'kind':'text'}]}
    assert c.put('/api/settings',json=settings).status_code==200
    assert 'do-not-expose' not in c.get('/api/settings').text
    assert c.get('/api/settings').json()['providers'][0]['api_key_set'] is True

def test_volcengine_ark_unified_settings_and_connection(authenticated,monkeypatch):
    import httpx
    c=authenticated
    provider={
        'id':'ark','name':'火山方舟','type':'volcengine_ark','local':False,
        'url':'https://ark.cn-beijing.volces.com/api/v3','api_key':'ark-secret',
        'models':{'text':'doubao-text','image':'seedream-image','video':'seedance-video'},
    }
    assert c.put('/api/settings',json={'providers':[ *s.get_setting('providers',[]), provider]}).status_code==200
    public=c.get('/api/settings')
    assert 'ark-secret' not in public.text
    public_body=public.json()
    public_ark=next(item for item in public_body['providers'] if item['id']=='ark')
    assert public_ark['api_key_set'] is True
    # A second save of the masked public object must preserve the server key.
    public_ark['local']=True
    public_ark['kind']='image'
    public_ark['api_key']=''
    assert c.put('/api/settings',json={'providers':public_body['providers']}).status_code==200
    saved_ark=next(item for item in s.get_setting('providers',[]) if item['id']=='ark')
    assert saved_ark['api_key']=='ark-secret'
    assert saved_ark['local'] is False and 'kind' not in saved_ark
    calls=[]
    original=httpx.Client
    def handle(request):
        calls.append((request.method,str(request.url),request.headers.get('authorization')))
        assert request.method=='GET' and request.url.path=='/api/v3/models'
        return httpx.Response(200,json={'data':[
            {'id':'doubao-text','name':'Doubao Text'},
            {'id':'seedream-image','name':'Seedream'},
            {'id':'seedance-video','name':'Seedance'},
            {'id':'doubao-embedding','name':'Embedding'},
        ]})
    monkeypatch.setattr(httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    ark_image_model=c.get('/api/providers/ark/models?kind=image').json()['models'][0]
    assert ark_image_model['id']=='seedream-image'
    assert ark_image_model['capabilities']['image_reference'] is True
    assert ark_image_model['capabilities']['max_references']==10
    ark_video_model=c.get('/api/providers/ark/models?kind=video').json()['models'][0]
    assert ark_video_model['capabilities']['image_reference'] is True
    assert ark_video_model['capabilities']['max_references']==1
    assert ark_video_model['capabilities']['end_frame'] is True
    p=project(c)
    import io
    from PIL import Image
    stream=io.BytesIO();Image.new('RGB',(32,24),'#445566').save(stream,format='PNG')
    reference=c.post('/api/projects/'+p['id']+'/assets',files={'file':('ark-reference.png',stream.getvalue(),'image/png')}).json()
    accepted=c.post('/api/projects/'+p['id']+'/jobs',json={
        'node_id':'ark-image-reference','kind':'image','submission_id':'ark-image-reference-job',
        'input':{'provider':'ark','prompt':'参考图一的人物生成新场景','asset_ids':[reference['id']],'allow_cloud':True},
    })
    assert accepted.status_code==200,accepted.text
    accepted_video=c.post('/api/projects/'+p['id']+'/jobs',json={
        'node_id':'ark-video-reference','kind':'video','submission_id':'ark-video-reference-job',
        'input':{'provider':'ark','prompt':'让人物走动','asset_ids':[reference['id']],'allow_cloud':True},
    })
    assert accepted_video.status_code==200,accepted_video.text
    accepted_transition=c.post('/api/projects/'+p['id']+'/jobs',json={
        'node_id':'ark-video-transition','kind':'video','submission_id':'ark-video-transition-job',
        'input':{'provider':'ark','prompt':'从首帧连续运动到尾帧','asset_ids':[reference['id']],
                 'end_asset_id':reference['id'],'allow_cloud':True},
    })
    assert accepted_transition.status_code==200,accepted_transition.text
    rejected_tail_only=c.post('/api/projects/'+p['id']+'/jobs',json={
        'node_id':'ark-video-tail-only','kind':'video','submission_id':'ark-video-tail-only-job',
        'input':{'provider':'ark','prompt':'移动到尾帧','end_asset_id':reference['id'],'allow_cloud':True},
    })
    assert rejected_tail_only.status_code==400 and '必须同时指定一张首帧' in rejected_tail_only.text
    rejected_video=c.post('/api/projects/'+p['id']+'/jobs',json={
        'node_id':'ark-video-many-references','kind':'video','submission_id':'ark-video-many-references-job',
        'input':{'provider':'ark','prompt':'让人物走动','asset_ids':[reference['id'],reference['id']],'allow_cloud':True},
    })
    assert rejected_video.status_code==400 and '最多接受一张首帧' in rejected_video.text
    c.post('/api/jobs/'+accepted.json()['id']+'/cancel')
    c.post('/api/jobs/'+accepted_video.json()['id']+'/cancel')
    c.post('/api/jobs/'+accepted_transition.json()['id']+'/cancel')
    rejected=c.post('/api/projects/'+p['id']+'/jobs',json={
        'node_id':'ark-image','kind':'image','submission_id':'ark-cloud-gate',
        'input':{'provider':'ark','prompt':'一只猫'},
    })
    assert rejected.status_code==400 and '允许使用此云端服务' in rejected.text
    queued=c.post('/api/projects/'+p['id']+'/jobs',json={
        'node_id':'ark-video','kind':'video','submission_id':'ark-cancel-cost-warning',
        'input':{'provider':'ark','prompt':'一只猫走过窗前','allow_cloud':True},
    }).json()
    with s.db() as db:
        db.execute('UPDATE jobs SET provider_job_id=? WHERE id=?',('remote-ark-task',queued['id']))
    monkeypatch.setattr('backend.providers.volcengine_ark.cancel',lambda job,provider:False)
    cancelled=c.post('/api/jobs/'+queued['id']+'/cancel').json()
    assert cancelled['status']=='cancelled'
    assert cancelled['phase']=='本地已取消；供应商可能继续生成并产生费用'
    verified=c.post('/api/providers/ark/verify')
    assert verified.status_code==200,verified.text
    assert verified.json()['counts']=={'text':1,'image':1,'video':1}
    for kind,model in provider['models'].items():
        tested=c.post('/api/providers/ark/test?kind='+kind)
        assert tested.status_code==200,tested.text
        assert tested.json()['status']=='listed' and tested.json()['model']==model
    assert all(call==('GET','https://ark.cn-beijing.volces.com/api/v3/models','Bearer ark-secret') for call in calls)


def test_ark_cancel_rereads_handle_attached_after_initial_snapshot(authenticated,monkeypatch):
    c=authenticated;p=project(c)
    now=time.time();jid='ark-cancel-reverse-race'
    provider=next(item for item in s.get_setting('providers',[]) if item['id']=='ark')
    with s.db() as db:
        db.execute('INSERT OR REPLACE INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',
                   (jid,jid,p['id'],'video-node','video','running',s.dumps({'provider':'ark','allow_cloud':True,'prompt':'test'}),now,now))
        db.execute('INSERT OR REPLACE INTO job_private VALUES(?,?)',(jid,s.dumps(provider)))
    original_job_update=s.job_update
    seen=[]
    def racing_job_update(job_id,**fields):
        if job_id==jid and fields.get('status')=='cancelled':
            s.attach_provider_job_id(jid,'task-attached-during-cancel')
        return original_job_update(job_id,**fields)
    monkeypatch.setattr(s,'job_update',racing_job_update)
    monkeypatch.setattr('backend.providers.volcengine_ark.cancel',lambda job,provider:seen.append(job['provider_job_id']) or True)
    cancelled=c.post('/api/jobs/'+jid+'/cancel')
    assert cancelled.status_code==200,cancelled.text
    assert seen==['task-attached-during-cancel']
    assert cancelled.json()['phase']=='已取消本地等待，并已请求供应商取消远端任务'

def test_revision_conflict_and_restore(authenticated):
    c=authenticated;p=project(c)
    doc=p['document'];doc['brief']='中文故事，严格保存。'
    payload={'name':p['name'],'revision':p['revision'],'document':doc}
    assert c.put('/api/projects/'+p['id'],json=payload).json()['revision']==2
    assert c.put('/api/projects/'+p['id'],json=payload).status_code==409
    assert c.get('/api/projects/'+p['id']).json()['document']['brief']==doc['brief']
    revisions=c.get('/api/projects/'+p['id']+'/revisions').json()
    assert len(revisions)==1
    old=c.get('/api/projects/'+p['id']+'/revisions/'+revisions[0]['id']).json()
    assert old['document']['brief']==''


def test_editor_timeline_round_trips_through_project_persistence(authenticated):
    c=authenticated;p=project(c);doc=p['document']
    timeline={
        'version':2,
        'tracks':[{'id':'v1','name':'V1','type':'video','elements':[{
            'id':'clip-1','type':'video','s':1.25,'e':4.5,
            'props':{'src':'/api/assets/a1/file','srcAssetId':'a1','time':.5,'volume':.7,'playbackRate':1.25,'opacity':.8,'mediaFilter':'cinematic','transition':{'toElementId':'clip-2','kind':'crossfade','duration':.4}},
            'metadata':{'assetId':'a1','mvc':{'fade':{'videoIn':.2,'videoOut':.4,'audioIn':.1,'audioOut':.3},'volumeKeyframes':[{'time':0,'value':.5},{'time':3.25,'value':1}]}},
            'frame':{'x':20,'y':30,'size':[640,360],'rotation':5},
        }]}],
        'assets':{'a1':{'id':'a1','type':'video','url':'/api/assets/a1/file'}},
    }
    doc['editor']={'version':1,'timeline':timeline}
    saved=c.put('/api/projects/'+p['id'],json={'name':p['name'],'revision':p['revision'],'document':doc})
    assert saved.status_code==200,saved.text
    restored=c.get('/api/projects/'+p['id']).json()['document']['editor']
    assert restored=={'version':1,'timeline':timeline}

def test_blank_project_name_uses_default(authenticated):
    c=authenticated
    item=c.post('/api/projects',json={'name':''}).json()
    assert item['name']=='未命名短片'
    saved=c.put('/api/projects/'+item['id'],json={'name':'   ','revision':item['revision'],'document':item['document']})
    assert saved.status_code==200
    assert c.get('/api/projects/'+item['id']).json()['name']=='未命名短片'

def test_only_empty_project_can_be_deleted(authenticated):
    c=authenticated
    empty=c.post('/api/projects',json={'name':'待删除'}).json()
    assert c.delete('/api/projects/'+empty['id']).json()=={'deleted':empty['id']}
    occupied=project(c)
    occupied['document']['nodes']=[{'id':'n1','data':{'kind':'text'}}]
    assert c.put('/api/projects/'+occupied['id'],json={'name':occupied['name'],'revision':occupied['revision'],'document':occupied['document']}).status_code==200
    assert c.delete('/api/projects/'+occupied['id']).status_code==400

def test_cloud_opt_in_idempotency_and_frozen_provider(authenticated):
    c=authenticated;p=project(c)
    payload={'node_id':'n1','kind':'text','submission_id':'stable-submission-001','input':{'provider':'cloud','prompt':'编写短片'}}
    assert c.post('/api/projects/'+p['id']+'/jobs',json=payload).status_code==400
    payload['input']['allow_cloud']=True
    first=c.post('/api/projects/'+p['id']+'/jobs',json=payload).json()
    second=c.post('/api/projects/'+p['id']+'/jobs',json=payload).json()
    assert first['id']==second['id']
    assert len(c.get('/api/projects/'+p['id']+'/jobs').json())==1
    assert 'do-not-expose' not in str(first)
    with s.db() as db:
        frozen=db.execute('SELECT provider FROM job_private WHERE job_id=?',(first['id'],)).fetchone()['provider']
    assert 'do-not-expose' in frozen

def test_cancel_wins_late_completion(authenticated):
    c=authenticated;p=project(c)
    job=c.post('/api/projects/'+p['id']+'/jobs',json={'node_id':'n','kind':'text','submission_id':'cancel-submission-001','input':{'provider':'local','prompt':'你好'}}).json()
    s.job_update(job['id'],status='running')
    assert c.post('/api/jobs/'+job['id']+'/cancel').json()['status']=='cancelled'
    assert s.job_update(job['id'],status='succeeded',result={'text':'late'}) is False
    assert c.get('/api/jobs/'+job['id']).json()['status']=='cancelled'

def test_media_upload_range_and_project_boundary(authenticated):
    from PIL import Image
    import io
    c=authenticated;p=project(c);other=project(c)
    stream=io.BytesIO();Image.new('RGB',(64,32),'#223344').save(stream,format='PNG')
    asset=c.post('/api/projects/'+p['id']+'/assets',files={'file':('sample.png',stream.getvalue(),'image/png')}).json()
    assert asset['metadata']['width']==64
    result=c.get(asset['url'],headers={'Range':'bytes=0-9'})
    assert result.status_code==206
    assert len(result.content)==10
    request={'node_id':'n','kind':'image','submission_id':'wrong-project-ref-001','input':{'prompt':'reference','asset_ids':[asset['id']]}}
    assert c.post('/api/projects/'+other['id']+'/jobs',json=request).status_code==400
    assert c.post('/api/projects/'+p['id']+'/assets',files={'file':('bad.html',b'<script>x</script>','text/html')}).status_code==400

def test_restart_marks_ambiguous_running_job(authenticated):
    c=authenticated;p=project(c)
    job=c.post('/api/projects/'+p['id']+'/jobs',json={'node_id':'n','kind':'text','submission_id':'interrupted-job-001','input':{'prompt':'test'}}).json()
    with s.db() as db:
        db.execute("UPDATE jobs SET status='cancelled' WHERE status='queued' AND id!=?",(job['id'],))
    s.job_update(job['id'],status='running',provider_job_id='upstream-paid-id')
    worker=Worker();worker.start();worker.stop()
    result=c.get('/api/jobs/'+job['id']).json()
    assert result['status']=='interrupted'
    assert result['provider_job_id']=='upstream-paid-id'

def test_graph_cycle_rejected_without_submitting(authenticated):
    c=authenticated;p=project(c);doc=p['document']
    doc['nodes']=[{'id':n,'data':{'kind':'text','prompt':'test'}} for n in ('a','b')]
    doc['edges']=[{'source':'a','target':'b'},{'source':'b','target':'a'}]
    assert c.put('/api/projects/'+p['id'],json={'name':p['name'],'revision':1,'document':doc}).status_code==200
    response=c.post('/api/projects/'+p['id']+'/run',json={'submission_id':'graph-cycle-test'})
    assert response.status_code==400
    assert c.get('/api/projects/'+p['id']+'/jobs').json()==[]

def test_graph_scheduler_consumes_upstream_text(authenticated,monkeypatch):
    c=authenticated;p=project(c);doc=p['document']
    c.put('/api/settings',json={'providers':[{'id':'local-test','name':'test','type':'openai','url':'http://127.0.0.1:1/v1','local':True}]})
    doc['nodes']=[{'id':n,'data':{'kind':'text','provider':'local-test','prompt':prompt}} for n,prompt in [('a','故事'),('b','分镜')]]
    doc['edges']=[{'source':'a','target':'b'}]
    assert c.put('/api/projects/'+p['id'],json={'name':p['name'],'revision':1,'document':doc}).status_code==200
    result=c.post('/api/projects/'+p['id']+'/run',json={'submission_id':'graph-run-test-001'}).json()
    assert result['count']==2
    received=[]
    def text(self,job,provider):
        received.append(job['input']['prompt'])
        return {'text':'上游已确认的故事'}
    monkeypatch.setattr(Worker,'text',text)
    worker=Worker();worker.start()
    try:
        for _ in range(100):
            jobs=c.get('/api/projects/'+p['id']+'/jobs').json()
            if all(j['status']=='succeeded' for j in jobs):break
            time.sleep(.03)
        assert all(j['status']=='succeeded' for j in jobs),jobs
        assert received[0]=='故事'
        assert '上游已确认的故事' in received[1]
    finally:worker.stop()

@pytest.mark.parametrize('provider_type',['maestro','comfy','video_api'])
def test_resume_only_queries_frozen_upstream(authenticated,monkeypatch,provider_type):
    import httpx,io
    from PIL import Image
    from backend import worker as module
    c=authenticated;p=project(c)
    provider={'id':'recover-'+provider_type,'type':provider_type,'url':'http://engine.test','local':True,'model':'test','workflow':{}}
    c.put('/api/settings',json={'providers':[provider]})
    kind='video' if provider_type=='video_api' else 'image'
    job=c.post('/api/projects/'+p['id']+'/jobs',json={'node_id':'n','kind':kind,'submission_id':'resume-'+provider_type,'input':{'provider':provider['id'],'prompt':'test'}}).json()
    s.job_update(job['id'],status='interrupted',provider_job_id='original-handle')
    # Editing the service after interruption must not change the polling target.
    c.put('/api/settings',json={'providers':[{**provider,'url':'http://changed.invalid'}]})
    assert c.post('/api/jobs/'+job['id']+'/resume').json()['status']=='queued'
    assert c.post('/api/jobs/'+job['id']+'/resume').json()['id']==job['id']
    job=c.get('/api/jobs/'+job['id']).json()
    calls=[];picture=io.BytesIO();Image.new('RGB',(16,16),'red').save(picture,format='PNG')
    def handle(request):
        calls.append((request.method,str(request.url)))
        assert request.method=='GET','Recovery must never submit or upload again'
        assert request.url.host=='engine.test'
        path=request.url.path
        if path=='/api/v1/status/original-handle':return httpx.Response(200,json={'status':'completed','output_files':['recovered.png']})
        if path=='/history/original-handle':return httpx.Response(200,json={'original-handle':{'outputs':{'1':{'images':[{'filename':'recovered.png'}]}}}})
        if path=='/videos/original-handle':return httpx.Response(200,json={'status':'completed','video_url':'https://result.test/video.mp4'})
        if path in ('/api/v1/uploads/recovered.png','/view'):return httpx.Response(200,content=picture.getvalue())
        raise AssertionError(path)
    original=httpx.Client
    monkeypatch.setattr(module.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(module,'download_result',lambda *args:{'id':'returned-video','kind':'video'})
    worker=Worker()
    class NoWait:
        def wait(self,seconds):return False
        def is_set(self):return False
    worker.halt=NoWait()
    assert worker.execute(job)['assets']
    assert calls

def test_resume_missing_handle_and_cancelled_rejected(authenticated):
    c=authenticated;p=project(c)
    job=c.post('/api/projects/'+p['id']+'/jobs',json={'node_id':'n','kind':'text','submission_id':'resume-no-handle','input':{'prompt':'test'}}).json()
    s.job_update(job['id'],status='interrupted')
    assert c.post('/api/jobs/'+job['id']+'/resume').status_code==409

def test_replicate_resume_uses_frozen_service_and_cancel_requests_remote_stop(authenticated,monkeypatch):
    from backend import replicate_api
    c=authenticated;p=project(c)
    provider={'id':'replicate-video','name':'Replicate','type':'replicate','kind':'video','url':'https://api.replicate.com/v1','model':'bytedance/seedance-1-pro','api_key':'test-key','local':False}
    assert c.put('/api/settings',json={'providers':[provider]}).status_code==200
    job=c.post('/api/projects/'+p['id']+'/jobs',json={'node_id':'n','kind':'video','submission_id':'replicate-resume-001','input':{'provider':'replicate-video','allow_cloud':True,'prompt':'镜头推进'}}).json()
    s.job_update(job['id'],status='interrupted',provider_job_id='prediction-original')
    assert c.put('/api/settings',json={'providers':[{**provider,'url':'https://changed.invalid'}]}).status_code==200
    assert c.post('/api/jobs/'+job['id']+'/resume').json()['status']=='queued'
    calls=[]
    monkeypatch.setattr(replicate_api,'cancel',lambda remote_job,frozen:calls.append((remote_job['provider_job_id'],frozen['url'])))
    assert c.post('/api/jobs/'+job['id']+'/cancel').json()['status']=='cancelled'
    assert calls==[('prediction-original','https://api.replicate.com/v1')]

    c.post('/api/jobs/'+job['id']+'/cancel')
    assert c.post('/api/jobs/'+job['id']+'/resume').status_code==409

def test_personal_prompt_library_versions_and_conflicts(authenticated):
    c=authenticated
    value=c.get('/api/prompt-library').json()
    body={'revision':value['revision'],'name':'我的电影分镜','kind':'storyboard','content':'只使用中文，保留角色。'}
    first=c.put('/api/prompt-library/test-template',json=body)
    assert first.status_code==200
    assert first.json()['templates'][0]['version']==1
    assert c.put('/api/prompt-library/test-template',json=body).status_code==409
    body.update(revision=first.json()['revision'],content='每镜一个动作。')
    second=c.put('/api/prompt-library/test-template',json=body).json()
    assert second['templates'][0]['history'][0]['content']=='只使用中文，保留角色。'
    assert c.get('/api/prompt-library').json()==second

def test_batch_late_validation_failure_rolls_back_all_jobs(authenticated):
    c=authenticated;p=project(c);doc=p['document']
    c.put('/api/settings',json={'providers':[{'id':'text-only','name':'text','type':'openai','kind':'text','url':'http://127.0.0.1:1','local':True}]})
    doc['nodes']=[{'id':'a','data':{'kind':'text','prompt':'story','provider':'text-only'}},{'id':'b','data':{'kind':'image','prompt':'frame','provider':'text-only'}}]
    doc['edges']=[{'id':'ab','source':'a','target':'b'}]
    c.put('/api/projects/'+p['id'],json={'name':p['name'],'revision':1,'document':doc})
    result=c.post('/api/projects/'+p['id']+'/run',json={'submission_id':'atomic-batch-validation'})
    assert result.status_code==400
    assert c.get('/api/projects/'+p['id']+'/jobs').json()==[]
