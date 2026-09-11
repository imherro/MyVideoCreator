import httpx
from types import SimpleNamespace
from PIL import Image
from backend import replicate_api as r,worker as w


def test_input_template_expands_prompt_images_and_system_prompt(tmp_path,monkeypatch):
    monkeypatch.setattr(r.s,'ASSETS',tmp_path)
    Image.new('RGB',(64,64),'#223344').save(tmp_path/'frame.png')
    job={'kind':'video','input':{'prompt':'雨中的猫'}}
    provider={'parameters':{'input':{'prompt':'{{prompt}}','first_frame':'{{image}}','frames':'{{images}}','system':'{{system_prompt}}'}}}
    body=r.prediction_input(job,provider,[{'path':'frame.png','mime':'image/png'}])
    assert body['prompt']=='雨中的猫'
    assert body['first_frame'].startswith('data:image/png;base64,')
    assert body['frames']==[body['first_frame']]
    assert isinstance(body['system'],str) and body['system']


def test_video_prediction_persists_id_then_downloads_result(monkeypatch):
    calls=[];saved=[]
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,json):
            calls.append(('post',url,json));return httpx.Response(201,json={'id':'prediction-1','status':'starting'})
        def get(self,url):
            calls.append(('get',url));return httpx.Response(200,json={'id':'prediction-1','status':'succeeded','output':['https://cdn.example/clip.mp4']})
    monkeypatch.setattr(r.httpx,'Client',Client)
    monkeypatch.setattr(w,'assets_for',lambda job:[])
    monkeypatch.setattr(w,'download_result',lambda job,url,ext:{'id':'video-asset','kind':'video','url':url,'ext':ext})
    monkeypatch.setattr(r.s,'job_update',lambda jid,**fields:saved.append((jid,fields)))
    engine=SimpleNamespace(halt=SimpleNamespace(wait=lambda seconds:False),cancelled=lambda job:False,progress=lambda *args:None)
    result=r.execute(engine,{'id':'local-job','kind':'video','input':{'prompt':'推进镜头'}},{'url':'https://api.replicate.com/v1','model':'bytedance/seedance-1-pro','api_key':'test'})
    assert calls[0][1].endswith('/models/bytedance/seedance-1-pro/predictions')
    assert calls[0][2]['input']=={'prompt':'推进镜头'}
    assert saved==[('local-job',{'provider_job_id':'prediction-1'})]
    assert result['assets'][0]['id']=='video-asset'


def test_resume_does_not_submit_again_and_text_output_is_preserved(monkeypatch):
    calls=[]
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kwargs):raise AssertionError('recovery must not submit again')
        def get(self,url):
            calls.append(url);return httpx.Response(200,json={'id':'existing','status':'succeeded','output':'已完成的云端文本'})
    monkeypatch.setattr(r.httpx,'Client',Client)
    engine=SimpleNamespace(halt=SimpleNamespace(wait=lambda seconds:False),cancelled=lambda job:False,progress=lambda *args:None)
    result=r.execute(engine,{'provider_job_id':'existing','kind':'text','input':{'prompt':'写一句话'}},{'url':'https://api.replicate.com/v1','model':'meta/meta-llama-3-70b'})
    assert result=={'text':'已完成的云端文本'}
    assert calls==['https://api.replicate.com/v1/predictions/existing']
