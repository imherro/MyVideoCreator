import copy
import hashlib
import json
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import store as s
from backend.visual_style import compile_visual_style, style_context
from backend.generation_fingerprint import build_generation_fingerprint, fingerprint_status


@pytest.fixture
def client():
    with TestClient(app) as c:
        app.state.worker.stop()
        endpoint='/api/auth/login' if c.get('/api/auth/status').json()['configured'] else '/api/auth/setup'
        assert c.post(endpoint,json={'password':'integration-test-only'}).status_code==200
        yield c


def new(c):
    result=c.post('/api/projects',json={'name':'风格与回收测试','style':'国风写实','creation_mode':'direct','video_reference_mode':'legacy','dialogue_mode':'full_dialogue'})
    assert result.status_code==200,result.text
    return result.json()


def test_whole_production_restore_preserves_individually_deleted_episode_and_sources(client):
    c=client;p=new(c);pid=p['production_id']
    second=c.post(f'/api/productions/{pid}/episodes',json={'title':'第二集'}).json()
    third=c.post(f'/api/productions/{pid}/episodes',json={'title':'之前已删除'}).json()
    assert c.delete('/api/projects/'+third['id']).status_code==200
    source=c.post(f'/api/productions/{pid}/sources/import',json={'title':'原著','content':'第一章\n原文保留','type':'txt'})
    assert source.status_code==200,source.text
    source_id=source.json()['id']
    response=c.delete('/api/productions/'+pid)
    assert response.status_code==200,response.text
    assert response.json()['episode_count']==2
    assert pid not in [v['id'] for v in c.get('/api/productions').json()]
    assert not any(v['production_id']==pid for v in c.get('/api/projects').json())
    assert c.get('/api/projects/'+p['id']).status_code==404
    assert c.get(f'/api/productions/{pid}/sources').status_code==404
    assert c.post(f'/api/productions/{pid}/episodes',json={'title':'不能偷偷新建'}).status_code==404
    assert c.post(f'/api/trash/project/{second["id"]}/restore').status_code==409
    trash=c.get('/api/trash').json()
    assert any(v['id']==pid for v in trash['productions'])
    assert not any(v['production_id']==pid for v in trash['projects'])
    with s.db() as db:
        assert db.execute('SELECT 1 FROM source_documents WHERE id=?',(source_id,)).fetchone()
        assert db.execute('SELECT COUNT(*) FROM projects WHERE production_id=?',(pid,)).fetchone()[0]==3
    assert c.post(f'/api/trash/production/{pid}/restore').status_code==200
    restored=c.get(f'/api/productions/{pid}/episodes').json()
    assert {v['id'] for v in restored}=={p['id'],second['id']}
    assert c.get('/api/projects/'+third['id']).status_code==404
    assert c.get(f'/api/productions/{pid}/sources').json()[0]['id']==source_id
    # Repeated cycles do not accumulate membership or resurrect the third episode.
    assert c.delete('/api/productions/'+pid).status_code==200
    assert c.post(f'/api/trash/production/{pid}/restore').status_code==200
    assert len(c.get(f'/api/productions/{pid}/episodes').json())==2


def test_empty_production_can_be_deleted_and_restored(client):
    c=client;p=c.post('/api/productions',json={'name':'空作品'}).json();pid=p['id']
    assert c.delete('/api/productions/'+pid).status_code==200
    assert pid not in [v['id'] for v in c.get('/api/productions').json()]
    assert c.post(f'/api/trash/production/{pid}/restore').status_code==200
    assert pid in [v['id'] for v in c.get('/api/productions').json()]


def test_active_job_blocks_whole_delete_atomically(client):
    c=client;p=new(c)
    j=c.post(f'/api/projects/{p["id"]}/jobs',json={'node_id':'text','kind':'text','submission_id':s.uid(),'input':{'provider':'local','prompt':'测试'}}).json()
    response=c.delete('/api/productions/'+p['production_id'])
    assert response.status_code==409,response.text
    assert c.get('/api/projects/'+p['id']).status_code==200
    with s.db() as db:
        assert not db.execute('SELECT 1 FROM production_trash_members WHERE production_id=?',(p['production_id'],)).fetchone()
        db.execute("UPDATE jobs SET status='cancelled' WHERE id=?",(j['id'],))


def test_style_contract_expands_presets_is_idempotent_and_preserves_references():
    doc={'style':'东方仙侠·半写实电影','filmBible':{'style':{'avoidItems':['塑料质感']},'continuity':{'characterSceneConsistency':'保持衣服'}}}
    original={'prompt':'角色说：“你好。”\n动作向前走','asset_ids':['a','b'],'seed':7}
    for kind in ('image','video','storyboard'):
        result=compile_visual_style(doc,kind,original)
        assert '非卡通、非传统 3D 动画' in result['prompt']
        if kind=='storyboard':
            assert '塑料质感' in result['prompt'] and '保持衣服' in result['prompt']
        else:
            assert '保持衣服' not in result['prompt']
            assert result['visual_style']['continuity']['characterSceneConsistency']=='保持衣服'
        assert result['asset_ids']==['a','b'] and result['seed']==7
        assert compile_visual_style(doc,kind,result)==result
        changed=compile_visual_style({**doc,'style':'自定义黑金剪影'},kind,result)
        assert '非卡通' not in changed['prompt'] and '自定义黑金剪影' in changed['prompt']
        assert changed['prompt'].count('[项目视觉风格]')==1
    assert original['prompt']=='角色说：“你好。”\n动作向前走'
    assert compile_visual_style(doc,'audio',original)==original
    assert compile_visual_style(doc,'image',{'prompt':''})=={'prompt':''}


def test_style_and_bible_changes_invalidate_new_fingerprints_without_invalidating_legacy():
    doc={'style':'国风写实','filmBible':{'styleVersion':1,'style':{}}}
    shot={'id':'s','image_prompt':'画面'}
    current=build_generation_fingerprint(doc,shot,'p','m')
    changed=build_generation_fingerprint({**doc,'style':'水墨动画'},shot,'p','m')
    assert fingerprint_status(current,changed)=='stale'
    bible_changed=copy.deepcopy(doc);bible_changed['filmBible']['style']['colorLighting']='暖光'
    assert fingerprint_status(current,build_generation_fingerprint(bible_changed,shot,'p','m'))=='stale'
    legacy=copy.deepcopy(current);legacy['inputs'].pop('visualStyle')
    legacy['hash']=hashlib.sha256(json.dumps(legacy['inputs'],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assert fingerprint_status(legacy,current)=='current'


def test_new_video_style_matches_until_style_actually_changes():
    from backend.video_result_status import matches_video_result
    doc={'style':'国风写实','nodes':[],'edges':[]}
    node={'id':'v','data':{'resultJob':'j','assetId':'a'}}
    raw={'prompt':'角色向前走','motion_compiler':{'version':'v1'}}
    submitted=compile_visual_style(doc,'video',raw)
    job={'id':'j','status':'succeeded','input':submitted,'result':{'assets':[{'id':'a'}]}}
    assert matches_video_result(doc,node,job,compile_visual_style(doc,'video',raw))
    changed={**doc,'style':'水墨动画'}
    assert not matches_video_result(changed,node,job,compile_visual_style(changed,'video',raw))


def test_single_batch_preview_and_retry_use_canonical_style(client):
    c=client;p=new(c);pid=p['id']
    assert c.put('/api/settings',json={'providers':[
        {'id':'style-image','name':'test image','type':'openai','kind':'image','url':'http://localhost:1','model':'test','local':True},
        {'id':'style-video','name':'test video','type':'video_api','kind':'video','url':'http://localhost:1','model':'test','local':True},
    ]}).status_code==200
    doc=p['document'];doc['nodes']=[{'id':'video','data':{'kind':'video','prompt':'向前走','provider':'style-video','model':'test'}},{'id':'image','data':{'kind':'image','prompt':'一位角色','provider':'style-image','model':'test'}}]
    assert c.put('/api/projects/'+pid,json={'name':p['name'],'revision':p['revision'],'document':doc}).status_code==200
    preview=c.get(f'/api/projects/{pid}/nodes/video/video-preview')
    assert preview.status_code==200,preview.text
    assert '东方美学，克制色彩' in preview.json()['prompt']
    body={'node_id':'video','kind':'video','submission_id':s.uid(),'input':doc['nodes'][0]['data']}
    submitted=c.post(f'/api/projects/{pid}/jobs',json=body)
    assert submitted.status_code==200,submitted.text
    job=submitted.json()
    assert job['input']['prompt']==preview.json()['prompt']
    assert job['input']['visual_style']==style_context(doc)
    image_body={'node_id':'image','kind':'image','submission_id':s.uid(),'input':doc['nodes'][1]['data']}
    image=c.post(f'/api/projects/{pid}/jobs',json=image_body)
    assert image.status_code==200,image.text
    assert '东方美学，克制色彩' in image.json()['input']['prompt']
    with s.db() as db:db.execute("UPDATE jobs SET status='cancelled' WHERE project_id=?",(pid,))
    batch=c.post(f'/api/projects/{pid}/run',json={'submission_id':s.uid(),'node_ids':['video','image']})
    assert batch.status_code==200,batch.text
    jobs=c.get(f'/api/projects/{pid}/jobs').json()
    assert all('东方美学，克制色彩' in j['input']['prompt'] for j in jobs)
    # A browser retry never rewrites an accepted job after the project style changed.
    fresh=c.get('/api/projects/'+pid).json();fresh['document']['style']='水墨动画'
    assert c.put('/api/projects/'+pid,json={'name':fresh['name'],'revision':fresh['revision'],'document':fresh['document']}).status_code==200
    retried=c.post(f'/api/projects/{pid}/jobs',json=body)
    assert retried.status_code==200,retried.text
    assert retried.json()['id']==job['id'] and retried.json()['input']==job['input']
    with s.db() as db:db.execute("UPDATE jobs SET status='cancelled' WHERE project_id=?",(pid,))
