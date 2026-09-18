import copy
import json
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import store as s
from backend.video_prompt_advice import validate_advice,advice_context
from backend.worker import Worker

@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        app.state.worker.stop()
        endpoint='login' if c.get('/api/auth/status').json()['configured'] else 'setup'
        assert c.post('/api/auth/'+endpoint,json={'password':'integration-test-only'}).status_code==200
        yield c

def test_task_does_not_apply_and_keeps_original(client,monkeypatch):
    p=client.post('/api/projects',json={'name':'提示词优化测试','creation_mode':'direct'}).json()
    shot={'id':'shot-a','videoNode':'video-a','video_prompt':'机器人转头，不要手臂。','duration':4,'dialogues':[{'text':'你好。','character':'机器人'}]}
    with s.db() as c:
        row=c.execute('SELECT shared_context FROM productions WHERE id=?',(p['production_id'],)).fetchone()
        context=json.loads(row['shared_context']);context['generationPolicy']['text']={'providerId':'local','modelId':''};context['modelPool']=None
        c.execute('UPDATE productions SET shared_context=? WHERE id=?',(s.dumps(context),p['production_id']))
        doc=json.loads(c.execute('SELECT document FROM projects WHERE id=?',(p['id'],)).fetchone()['document'])
        doc['shots']=[shot];doc['nodes']=[{'id':'video-a','type':'video','data':{}}]
        c.execute('UPDATE projects SET document=? WHERE id=?',(s.dumps(doc),p['id']))
    path='/api/projects/'+p['id']+'/video-prompt-advice/video-a'
    response=client.post(path,json={'submission_id':'video-advice-test-1'})
    assert response.status_code==200,response.text
    job=response.json();assert job['input']['original_prompt']==shot['video_prompt']
    assert job['input']['schema_version']=='video-prompt-advice/v1'
    assert client.post(path,json={'submission_id':'video-advice-test-2'}).status_code==409
    result={'prompt':'机器人转头，说：“你好。”不要手臂。','changes':['明确对白归属'],'warnings':[]}
    monkeypatch.setattr(Worker,'_chat_text',lambda *a,**k:json.dumps(result))
    assert Worker().text(job,{'local':True})['videoPromptAdvice']==result
    after=client.get('/api/projects/'+p['id']).json()['document']['shots'][0]
    assert after['video_prompt']==shot['video_prompt'] and after['duration']==4
    s.job_update(job['id'],status='succeeded',result={'videoPromptAdvice':result})
    assert client.get('/api/jobs/'+job['id']).json()['result']['videoPromptAdvice']==result

@pytest.mark.parametrize('prompt',['改掉台词','@图片2 说你好。',''])
def test_invalid_suggestion_never_replaces_prompt(prompt):
    with pytest.raises(ValueError):validate_advice(json.dumps({'prompt':prompt,'changes':[],'warnings':[]}),{'dialogues':[{'text':'你好。'}]})

def test_context_preserves_mode_and_only_bound_versions():
    doc={'videoReferenceMode':'multimodal','dialogueMode':'voice_sample','shots':[{'videoNode':'v','video_prompt':'不要手臂','assetBindings':{'characters':[{'versionId':'ver'}]}}],'filmBible':{'visual':{'cards':{'c':{'id':'c','name':'机器人'}},'versions':{'ver':{'id':'ver','cardId':'c','invariants':['无手臂']},'other':{'id':'other','description':'不应出现'}}}}}
    before=copy.deepcopy(doc)
    shot,text=advice_context(doc,'v')
    assert '无手臂' in text and '不应出现' not in text and 'voice_sample' in text and 'multimodal' in text
    assert doc==before
