import json
import pytest
from fastapi.testclient import TestClient
from backend import store as s
from backend.app import app
from backend.adaptation import SCRIPT_FIELDS, _stale_scripts, apply_episode_script_generation


@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        app.state.worker.stop()
        endpoint = 'login' if c.get('/api/auth/status').json()['configured'] else 'setup'
        assert c.post('/api/auth/'+endpoint,json={'password':'integration-test-only'}).status_code == 200
        yield c


def new_project(client):
    p=client.post('/api/projects',json={'name':'直接创作测试','creation_mode':'direct','duration':15,'ratio':'9:16','video_resolution':'480p'}).json()
    # Prove the script path works with no adaptation record for any episode.
    with s.db() as c:
        row=c.execute('SELECT shared_context FROM productions WHERE id=?',(p['production_id'],)).fetchone()
        context=json.loads(row['shared_context']); context['episodePlans']=[]
        c.execute('UPDATE productions SET shared_context=? WHERE id=?',(s.dumps(context),p['production_id']))
    return p


def save_script(client,p,body):
    path=f'/api/productions/{p["production_id"]}/episode-scripts/{p["episode_no"]}'
    read=client.get(path)
    assert read.status_code==200,read.text
    draft=read.json()
    result=client.put(path,json={**{key:draft[key] for key in SCRIPT_FIELDS},'revision':draft['revision'],'body':body})
    assert result.status_code==200,result.text
    return result.json()


def test_no_plan_manual_script_new_episode_and_projection(client):
    p=new_project(client)
    first=save_script(client,p,'外景 山顶\n甲：你好。')
    second=client.post(f'/api/productions/{p["production_id"]}/episodes',json={'title':'第二集','creation_mode':'direct'}).json()
    assert second['document']['ratio']=='9:16'
    assert second['document']['videoResolution']=='480p'
    assert second['document']['duration']==15
    assert second['document']['creationMode']=='direct'
    rows=client.get(f'/api/productions/{p["production_id"]}/scripts').json()
    assert [row['episodeNo'] for row in rows]==[1,2]
    assert all(row['plan'] is None for row in rows)
    save_script(client,second,'内景 茶室\n甲：又见面了。')
    doc=client.get('/api/projects/'+second['id']).json()['document']
    projection=[n for n in doc['nodes'] if n['data'].get('canonicalScriptProjection')]
    assert len(projection)==1 and '又见面了' in projection[0]['data']['text']
    with s.db() as c:
        _stale_scripts(c,p['production_id'])
    unchanged=client.get(f'/api/productions/{p["production_id"]}/episode-scripts/1').json()
    assert unchanged['body']==first['body'] and unchanged['revision']==first['revision']
    assert unchanged['status']!='stale'
    assert client.get(f'/api/productions/{p["production_id"]}/episode-scripts/999').status_code==404


def test_direct_assist_is_durable_scoped_idempotent_and_uses_previous_episode(client):
    p=new_project(client); save_script(client,p,'甲已拿到钥匙，走向山门。')
    second=client.post(f'/api/productions/{p["production_id"]}/episodes',json={'title':'第二集','creation_mode':'direct'}).json()
    draft=save_script(client,second,'')
    path=f'/api/productions/{p["production_id"]}/episode-scripts/2/assist'
    payload={'provider':'local','instruction':'承接前集，写 15 秒开门的剧本','revision':draft['revision'],'submission_id':'direct-assist-duplicate'}
    response=client.post(path,json=payload)
    assert response.status_code==200,response.text
    job=response.json()['jobs'][0]
    assert client.post(path,json=payload).json()['jobs'][0]['id']==job['id']
    assert client.post(path,json={**payload,'submission_id':'direct-assist-another'}).status_code==409
    assert job['input']['schema_version']=='direct-episode-script/v1'
    assert '无需原著' in job['input']['system_prompt']
    marker=job['input']['episode_script_generation']
    assert marker['context']['previousEpisodes'][0]['body']=='甲已拿到钥匙，走向山门。'
    assert marker['context']['duration']==15
    s.job_update(job['id'],status='running')
    result=apply_episode_script_generation(job,{'title':'开门','synopsis':'甲打开山门','body':'外景 山门\n甲转动钥匙。','estimatedDuration':15,'characters':['甲'],'scenes':['山门'],'props':['钥匙']})
    assert result['script']['metadata']['adaptationLinked'] is False
    assert result['script']['metadata']['origin']=='direct_ai'
    s.job_update(job['id'],status='succeeded')
    assert client.get(f'/api/productions/{p["production_id"]}/episode-scripts/1').json()['body']=='甲已拿到钥匙，走向山门。'


def test_direct_assist_does_not_overwrite_edits_made_while_running(client):
    p=new_project(client); draft=save_script(client,p,'第一版')
    path=f'/api/productions/{p["production_id"]}/episode-scripts/1/assist'
    response=client.post(path,json={'provider':'local','instruction':'润色','revision':draft['revision'],'submission_id':'direct-assist-conflict'})
    assert response.status_code==200,response.text
    job=response.json()['jobs'][0]
    save_script(client,p,'用户第二版')
    s.job_update(job['id'],status='running')
    with pytest.raises(ValueError,match='生成期间更新'):
        apply_episode_script_generation(job,{'title':'标题','synopsis':'概要','body':'旧结果','estimatedDuration':15,'characters':[],'scenes':[],'props':[]})
    client.post('/api/jobs/'+job['id']+'/cancel')


def test_direct_script_only_tracks_explicit_source_references(client):
    p=new_project(client)
    path=f'/api/productions/{p["production_id"]}'
    imported=client.post(path+'/sources/import',json={'title':'可选原著','type':'txt','metadata':{},'content':'第一章\n山门打开。'})
    assert imported.status_code==200,imported.text
    chapter=client.get(path+'/chapters').json()[0]
    script=save_script(client,p,'手写剧本')
    response=client.put(path+'/episode-scripts/1',json={**{key:script[key] for key in SCRIPT_FIELDS},'revision':script['revision'],'sourceChapterRefs':[chapter['id']]})
    assert response.status_code==200,response.text
    response=client.put(path+'/chapters/'+chapter['id'],json={'title':chapter['title'],'content':'山门关闭了。','revision':chapter['revision']})
    assert response.status_code==200,response.text
    assert client.get(path+'/episode-scripts/1').json()['status']=='stale'


def test_direct_canvas_adoption_keeps_revision_history(client):
    p=new_project(client)
    original=save_script(client,p,'原来的正式正文')
    project=client.get('/api/projects/'+p['id']).json()
    project['document']['nodes'].append({'id':'candidate','type':'media','position':{'x':0,'y':0},'data':{'kind':'text','text':'画布候选正文'}})
    stored=client.put('/api/projects/'+p['id'],json={key:project[key] for key in ('name','revision','production_revision','document')})
    assert stored.status_code==200,stored.text
    result=client.put(f'/api/productions/{p["production_id"]}/episode-scripts/1',json={**{key:original[key] for key in SCRIPT_FIELDS},'revision':original['revision'],'body':'画布候选正文','canvasNodeId':'candidate'})
    assert result.status_code==200,result.text
    assert result.json()['metadata']['origin']=='canvas'
    assert result.json()['metadata']['adaptationLinked'] is False
    with s.db() as c:
        history=c.execute('SELECT snapshot FROM episode_script_revisions WHERE project_id=? AND revision=?',(p['id'],original['revision'])).fetchone()
    assert json.loads(history['snapshot'])['body']=='原来的正式正文'


def test_direct_assist_rejects_blank_instruction(client):
    p=new_project(client)
    script=save_script(client,p,'')
    response=client.post(f'/api/productions/{p["production_id"]}/episode-scripts/1/assist',json={'provider':'local','instruction':'   ','revision':script['revision'],'submission_id':'direct-assist-blank'})
    assert response.status_code==400,response.text
