import io
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from backend.app import app
from backend import store as s
from test_api import project


@pytest.fixture
def batch_authenticated():
    with TestClient(app) as client:
        app.state.worker.stop()
        status=client.get('/api/auth/status').json()
        endpoint='/api/auth/login' if status['configured'] else '/api/auth/setup'
        assert client.post(endpoint,json={'password':'integration-test-only'}).status_code==200
        yield client


def _image(client,pid,name):
    stream=io.BytesIO()
    Image.new('RGB',(864,480),'#283040').save(stream,format='PNG')
    return client.post('/api/projects/'+pid+'/assets',files={'file':(name,stream.getvalue(),'image/png')}).json()


def _minimax_settings(client):
    client.put('/api/settings',json={'providers':[{
        'id':'hailuo','name':'Hailuo','type':'minimax','kind':'video',
        'url':'https://api.minimax.io/v1','model':'MiniMax-Hailuo-2.3','local':False
    }]})


def test_batch_carries_static_reference_asset_to_minimax(batch_authenticated):
    client=batch_authenticated;item=project(client);asset=_image(client,item['id'],'first.png');_minimax_settings(client)
    doc=item['document']
    doc['nodes']=[
        {'id':'reference','data':{'kind':'reference','assetId':asset['id']}},
        {'id':'video','data':{'kind':'video','provider':'hailuo','prompt':'镜头向前推进'}},
    ]
    doc['edges']=[{'id':'frame','source':'reference','target':'video'}]
    assert client.put('/api/projects/'+item['id'],json={'name':item['name'],'revision':item['revision'],'document':doc}).status_code==200
    result=client.post('/api/projects/'+item['id']+'/run',json={'submission_id':'static-frame-batch-001','allow_cloud':True})
    assert result.status_code==200,result.text
    jobs=client.get('/api/projects/'+item['id']+'/jobs').json()
    assert len(jobs)==1
    assert jobs[0]['input']['asset_ids']==[asset['id']]
    with s.db() as db:
        frozen=db.execute('SELECT provider FROM job_private WHERE job_id=?',(jobs[0]['id'],)).fetchone()['provider']
    assert 'MiniMax-Hailuo-2.3' in frozen


def test_batch_rejects_multiple_minimax_frames_before_queueing(batch_authenticated):
    client=batch_authenticated;item=project(client);one=_image(client,item['id'],'one.png');two=_image(client,item['id'],'two.png');_minimax_settings(client)
    doc=item['document']
    doc['nodes']=[
        {'id':'one','data':{'kind':'reference','assetId':one['id']}},
        {'id':'two','data':{'kind':'reference','assetId':two['id']}},
        {'id':'video','data':{'kind':'video','provider':'hailuo','prompt':'镜头向前推进'}},
    ]
    doc['edges']=[{'id':'one-edge','source':'one','target':'video'},{'id':'two-edge','source':'two','target':'video'}]
    assert client.put('/api/projects/'+item['id'],json={'name':item['name'],'revision':item['revision'],'document':doc}).status_code==200
    result=client.post('/api/projects/'+item['id']+'/run',json={'submission_id':'many-frame-batch-001','allow_cloud':True})
    assert result.status_code==400
    assert '一张首帧' in result.text
    assert client.get('/api/projects/'+item['id']+'/jobs').json()==[]
