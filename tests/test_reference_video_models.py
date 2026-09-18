import copy
import json
import httpx
import pytest
from backend import store as s
from backend.providers import common, hc_atom, runninghub
from backend.reference_video_models import MODELS, validate
from backend.motion_references import capability

class Worker:
    halt=type('Halt',(),{'wait':lambda *args:False})()
    def cancelled(self,*args): return False
    def progress(self,*args): pass

CASES=[(provider,model) for provider,models in MODELS.items() for model in models]

@pytest.mark.parametrize('provider_type,model',CASES)
@pytest.mark.parametrize('motion',[False,True])
@pytest.mark.parametrize('audio',[False,True])
def test_reference_protocol_retains_single_image_audio_and_optional_video(monkeypatch,provider_type,model,motion,audio):
    provider={'type':provider_type,'api_key':'test','url':'https://provider.example'}
    inp={'model':model,'prompt':'@图片1中的人物参考@视频1运动。','generation_mode':{'requested':'multimodal'},
         'parameters':{'duration':5,'resolution':'2k' if 'h3' in model.lower() else '720p'},'asset_ids':['image'],
         'voice_samples':[{'assetId':'audio','media':{'duration':4}}]}
    if not audio: inp.pop('voice_samples')
    if motion: inp['motion_reference']={'assetId':'motion','media':{'duration':5}}
    job={'id':'test','project_id':'project','input':inp}
    monkeypatch.setattr(common,'assets_for',lambda _: [{'id':'image'}])
    monkeypatch.setattr('backend.motion_references.silent_motion_asset',lambda _: {'id':'silent'})
    monkeypatch.setattr('backend.voice_samples.submission_assets',lambda _: [{'id':'audio'}])
    monkeypatch.setattr('backend.provider_assets.public_asset_url',lambda p,aid:'https://media.example/'+aid)
    monkeypatch.setattr(runninghub,'_upload',lambda c,r,a:'https://media.example/'+a['id'])
    monkeypatch.setattr(s,'attach_provider_job_id',lambda *args:None)
    monkeypatch.setattr(common,'download_result',lambda *args,**kwargs:{'id':'result'})
    requests=[]
    def respond(request):
        requests.append(request)
        if request.method=='POST' and not request.url.path.endswith('/query'):
            return httpx.Response(200,json={'taskId':'remote'})
        if provider_type=='runninghub': return httpx.Response(200,json={'status':'SUCCESS','results':[{'url':'https://media.example/result.mp4'}]})
        if model=='MiniMax-H3': return httpx.Response(200,json={'task':{'status':'succeeded','content':{'url':'https://media.example/result.mp4'}}})
        return httpx.Response(200,json={'code':200,'data':{'status':'SUCCESS','resultUrl':'https://media.example/result.mp4'}})
    original=httpx.Client
    monkeypatch.setattr(httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(respond)))
    adapter=runninghub if provider_type=='runninghub' else hc_atom
    before=copy.deepcopy(inp)
    assert adapter.generate_video(Worker(),job,provider)['assets']==[{'id':'result'}]
    body=json.loads(requests[0].content)
    if provider_type=='runninghub':
        assert body['imageUrls']==['https://media.example/image']
        assert body.get('audioUrls',[])==(['https://media.example/audio'] if audio else [])
        assert bool(body.get('videoUrls'))==motion
        assert 'firstFrameUrl' not in body
        assert requests[0].url.path.endswith('multimodal-to-video' if 'h3' in model else 'reference-to-video')
    else:
        assert requests[0].url.path=='/video/generation/tasks'
        media=body['content'][1:] if model=='MiniMax-H3' else body['input']['media']
        assert len(media)==1+audio+motion
        assert all(x.get('role',x['type']).startswith('reference_') for x in media)
    assert inp==before
    requests.clear(); job['provider_job_id']='remote'
    monkeypatch.setattr(common,'assets_for',lambda _:pytest.fail('resume must not resolve mutable references'))
    assert adapter.generate_video(Worker(),job,provider)['assets']==[{'id':'result'}]
    assert not any(r.method=='POST' and not r.url.path.endswith('/query') for r in requests)

@pytest.mark.parametrize('provider_type,model',CASES)
def test_limits_fail_closed(provider_type,model):
    p={'type':provider_type}
    inp={'model':model,'asset_ids':['a'],'generation_mode':{'requested':'multimodal'},'parameters':{'duration':5,'resolution':'2k' if 'h3' in model.lower() else '720p'}}
    assert capability(p,model)['supported']
    assert validate(p,inp)['duration']==5
    for change in [{'generation_mode':{'requested':'first_frame'}},{'asset_ids':list(range(31))},{'end_asset_id':'tail'}]:
        with pytest.raises(ValueError): validate(p,{**inp,**change})
    for params in [{'duration':31},{'resolution':'4k'},{'outputFormat':'mov'},{'duration':-1}]:
        with pytest.raises(ValueError): validate(p,{**inp,'parameters':{**inp['parameters'],**params}})


def test_wan_combined_video_duration_is_checked():
    p={'type':'runninghub'}
    with pytest.raises(ValueError,match='合计'):
        validate(p,{'model':'alibaba/wan-3.0','asset_ids':['a'],'generation_mode':{'requested':'multimodal'},'parameters':{'duration':25,'resolution':'720p'},'motion_reference':{'media':{'duration':10}}})
