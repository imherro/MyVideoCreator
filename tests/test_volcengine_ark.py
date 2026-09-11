import json
import time
import uuid

import httpx
import pytest

from backend import store as s
from backend import worker as worker_module
from backend.providers import common, volcengine_ark as ark
from backend.worker import Worker, checked

s.init()


def stored_job(kind, provider, provider_job_id=None):
    pid='ark-project-'+uuid.uuid4().hex
    jid='ark-job-'+uuid.uuid4().hex
    now=time.time()
    inp={'provider':provider['id'],'allow_cloud':True,'prompt':'电影感机器人走向窗前'}
    with s.db() as db:
        db.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'Ark test','{}',now,now))
        db.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,provider_job_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
                   (jid,'ark-submit-'+uuid.uuid4().hex,pid,'node',kind,'running',s.dumps(inp),provider_job_id,now,now))
        db.execute('INSERT INTO job_private VALUES(?,?)',(jid,s.dumps(provider)))
    return {'id':jid,'project_id':pid,'node_id':'node','kind':kind,'status':'running','input':inp,'provider_job_id':provider_job_id}


class NoWait:
    def wait(self, seconds): return False
    def is_set(self): return False


def provider():
    return {
        'id':'ark','type':'volcengine_ark','local':False,
        'url':'https://ark.example/api/v3','api_key':'secret',
        'models':{'text':'doubao-text','image':'seedream-image','video':'seedance-video'},
        'parameters':{'video':{'duration':5,'resolution':'720p','ratio':'16:9','generate_audio':True,'poll_interval':1}},
    }


def test_ark_text_reuses_openai_compatible_worker(monkeypatch):
    item=stored_job('text',provider())
    original=httpx.Client
    def handle(request):
        assert request.url.path=='/api/v3/chat/completions'
        body=json.loads(request.read())
        assert body['model']=='doubao-text' and body['stream'] is True
        return httpx.Response(200,content=b'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')
    monkeypatch.setattr(worker_module.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    assert Worker().execute(item)=={'text':'OK'}


def test_seedream_downloads_into_existing_asset_library(monkeypatch):
    item=stored_job('image',provider())
    original=httpx.Client
    def handle(request):
        assert request.url.path=='/api/v3/images/generations'
        body=json.loads(request.read())
        assert body['model']=='seedream-image' and body['response_format']=='url'
        return httpx.Response(200,json={'data':[{'url':'https://result.example/frame.png'}]})
    monkeypatch.setattr(ark.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common,'download_result',lambda job,url,ext:{'id':'asset-image','kind':'image','url':'/api/assets/asset-image/file'})
    assert Worker().execute(item)['assets'][0]['id']=='asset-image'


def test_seedance_persists_task_and_resume_only_queries(monkeypatch):
    p=provider();item=stored_job('video',p)
    calls=[];downloads=[];original=httpx.Client
    def handle(request):
        calls.append((request.method,request.url.path))
        if request.method=='POST':
            body=json.loads(request.read())
            assert body['model']=='seedance-video' and body['content'][0]['type']=='text'
            return httpx.Response(200,json={'id':'ark-task-1','status':'queued'})
        return httpx.Response(200,json={'id':'ark-task-1','status':'succeeded','content':{'video_url':'https://result.example/movie.mp4'}})
    monkeypatch.setattr(ark.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    def download(job,url,ext,recoverable=False):
        downloads.append((url,ext,recoverable))
        return {'id':'asset-video','kind':'video'}
    monkeypatch.setattr(common,'download_result',download)
    worker=Worker();worker.halt=NoWait()
    assert worker.execute(item)['assets'][0]['id']=='asset-video'
    with s.db() as db:
        assert db.execute('SELECT provider_job_id FROM jobs WHERE id=?',(item['id'],)).fetchone()['provider_job_id']=='ark-task-1'
    assert calls==[('POST','/api/v3/contents/generations/tasks'),('GET','/api/v3/contents/generations/tasks/ark-task-1')]

    resumed=stored_job('video',p,'existing-task')
    calls.clear()
    assert worker.execute(resumed)['assets'][0]['id']=='asset-video'
    assert calls==[('GET','/api/v3/contents/generations/tasks/existing-task')]
    assert downloads==[
        ('https://result.example/movie.mp4','.mp4',True),
        ('https://result.example/movie.mp4','.mp4',True),
    ]


def test_seedance_cancel_requests_remote_delete(monkeypatch):
    calls=[];original=httpx.Client
    def handle(request):
        calls.append((request.method,request.url.path))
        return httpx.Response(204)
    monkeypatch.setattr(ark.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    assert ark.cancel({'provider_job_id':'task-to-cancel'},provider()) is True
    assert calls==[('DELETE','/api/v3/contents/generations/tasks/task-to-cancel')]


@pytest.mark.parametrize('status',[429,500,503])
def test_seedance_poll_failure_keeps_existing_task_recoverable(monkeypatch,status):
    item=stored_job('video',provider(),'existing-task')
    original=httpx.Client
    def handle(request):
        assert request.method=='GET'
        return httpx.Response(status,json={'error':{'message':'temporary'}})
    monkeypatch.setattr(ark.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    worker=Worker();worker.halt=NoWait()
    with pytest.raises(common.RecoverableProviderError):
        worker.execute(item)
    with s.db() as db:
        assert db.execute('SELECT provider_job_id FROM jobs WHERE id=?',(item['id'],)).fetchone()['provider_job_id']=='existing-task'


def test_worker_marks_recoverable_provider_error_interrupted(monkeypatch):
    item=stored_job('video',provider(),'existing-task')
    with s.db() as db:
        db.execute("UPDATE jobs SET status='queued',created=-1 WHERE id=?",(item['id'],))
    worker=Worker()
    def execute(job):
        worker.halt.set()
        raise common.RecoverableProviderError('temporary polling error')
    monkeypatch.setattr(worker,'execute',execute)
    worker.loop()
    with s.db() as db:
        row=db.execute('SELECT status,provider_job_id,phase FROM jobs WHERE id=?',(item['id'],)).fetchone()
    assert row['status']=='interrupted' and row['provider_job_id']=='existing-task'
    assert '可恢复查询' in row['phase']


def test_seedance_cancel_race_persists_remote_task_id(monkeypatch):
    item=stored_job('video',provider())
    calls=[];original=httpx.Client
    def handle(request):
        calls.append((request.method,request.url.path))
        if request.method=='POST':
            s.job_update(item['id'],status='cancelled',phase='已请求取消')
            return httpx.Response(200,json={'id':'paid-task-after-cancel'})
        return httpx.Response(204)
    monkeypatch.setattr(ark.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    worker=Worker();worker.halt=NoWait()
    with pytest.raises(InterruptedError):
        worker.execute(item)
    with s.db() as db:
        row=db.execute('SELECT status,provider_job_id,phase FROM jobs WHERE id=?',(item['id'],)).fetchone()
    assert row['status']=='cancelled' and row['provider_job_id']=='paid-task-after-cancel'
    assert '已请求供应商取消' in row['phase']
    assert calls==[('POST','/api/v3/contents/generations/tasks'),('DELETE','/api/v3/contents/generations/tasks/paid-task-after-cancel')]


def test_seedance_expired_status_is_explicit(monkeypatch):
    item=stored_job('video',provider(),'expired-task')
    original=httpx.Client
    monkeypatch.setattr(ark.httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(
        lambda request:httpx.Response(200,json={'id':'expired-task','status':'expired'})
    )))
    worker=Worker();worker.halt=NoWait()
    with pytest.raises(ValueError,match='任务已过期'):
        worker.execute(item)


@pytest.mark.parametrize('status,phrase',[(401,'鉴权失败'),(403,'服务拒绝访问'),(429,'服务限流'),(500,'服务暂时异常')])
def test_ark_http_errors_are_clear_in_chinese(status,phrase):
    with pytest.raises(ValueError,match=phrase):
        checked(httpx.Response(status,json={'error':{'message':'upstream detail'}}))
