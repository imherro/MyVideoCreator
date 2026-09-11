import pytest,httpx
from types import SimpleNamespace
from backend import minimax_video as m,worker as w

def test_payload_rejects_unsupported_combination():
    assert m.payload({'prompt':'故事'},{})['duration']==6
    with pytest.raises(ValueError):m.payload({'prompt':'故事','parameters':{'duration':10,'resolution':'1080P'}},{})
    with pytest.raises(ValueError):m.payload({'prompt':'故事','asset_ids':['ref','extra']},{})

def test_resume_queries_existing_task_without_post_or_credentials_on_download(monkeypatch):
    calls=[]
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kwargs):raise AssertionError('must not resubmit')
        def get(self,url,params):
            calls.append((url,params))
            return httpx.Response(200,json={'status':'Success','file_id':'file-1','base_resp':{'status_code':0}} if '/query/' in url else {'file':{'download_url':'https://cdn.example/result.mp4'},'base_resp':{'status_code':0}})
    monkeypatch.setattr(m.httpx,'Client',Client)
    monkeypatch.setattr(w,'download_result',lambda job,url,ext:{'id':'output','kind':'video'})
    worker=SimpleNamespace(halt=SimpleNamespace(wait=lambda seconds:False),cancelled=lambda job:False,progress=lambda *args:None)
    result=m.execute(worker,{'provider_job_id':'existing','input':{}},{'url':'https://api.minimax.io/v1','api_key':'test'})
    assert result['assets'][0]['id']=='output'
    assert calls[0][1]=={'task_id':'existing'}
    assert calls[1][1]=={'file_id':'file-1'}


def test_first_frame_validates_before_encoding(tmp_path,monkeypatch):
    from PIL import Image
    monkeypatch.setattr(m.s,'ASSETS',tmp_path)
    Image.new('RGB',(864,480)).save(tmp_path/'frame.png')
    assert m.first_frame({'path':'frame.png'},True).startswith('data:image/png;base64,')
    Image.new('RGB',(300,480)).save(tmp_path/'small.png')
    with pytest.raises(ValueError):m.first_frame({'path':'small.png'},True)


def test_first_submission_persists_handle_before_polling(monkeypatch):
    events=[]
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,json):
            events.append(('post',json));return httpx.Response(200,json={'task_id':'new-task','base_resp':{'status_code':0}})
        def get(self,url,params):
            assert events[1]==('persist',{'provider_job_id':'new-task'})
            return httpx.Response(200,json={'status':'Fail','base_resp':{'status_code':0}})
    monkeypatch.setattr(m.httpx,'Client',Client)
    monkeypatch.setattr(m.s,'job_update',lambda jid,**values:events.append(('persist',values)))
    monkeypatch.setattr(w,'assets_for',lambda job:[])
    worker=SimpleNamespace(halt=SimpleNamespace(wait=lambda seconds:False),cancelled=lambda job:False,progress=lambda *args:None)
    with pytest.raises(ValueError,match='生成失败'):m.execute(worker,{'id':'job','input':{'prompt':'test'}},{'url':'https://api.minimax.io/v1'})
    assert len([x for x in events if x[0]=='post'])==1


def test_business_error_does_not_poll_or_persist(monkeypatch):
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kwargs):return httpx.Response(200,json={'base_resp':{'status_code':1008,'status_msg':'insufficient balance'}})
        def get(self,*args,**kwargs):raise AssertionError('must not poll failed submission')
    monkeypatch.setattr(m.httpx,'Client',Client)
    monkeypatch.setattr(w,'assets_for',lambda job:[])
    monkeypatch.setattr(m.s,'job_update',lambda *args,**kwargs:pytest.fail('must not persist a missing task id'))
    worker=SimpleNamespace(cancelled=lambda job:False)
    with pytest.raises(ValueError,match='1008'):m.execute(worker,{'id':'job','input':{'prompt':'test'}},{'url':'https://api.minimax.io/v1'})
