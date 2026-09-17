import asyncio
import json
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import store as s
from backend import assistant as a


@pytest.fixture
def client(monkeypatch):
    async def fake(provider,messages):
        assert provider['model']=='assistant-test'
        assert 'secret-test-key' not in json.dumps(messages)
        yield '先完善本集剧本。'
        yield '\n再进入分镜规划。'
    monkeypatch.setattr(a,'model_stream',fake)
    with TestClient(app) as c:
        app.state.worker.stop()
        c.post('/api/auth/login' if c.get('/api/auth/status').json()['configured'] else '/api/auth/setup',json={'password':'integration-test-only'}).raise_for_status()
        c.put('/api/settings',json={'providers':[{'id':'assistant-provider','name':'测试文本服务','type':'openai','kind':'text','url':'http://127.0.0.1:1/v1','model':'assistant-test','api_key':'secret-test-key','local':True}]}).raise_for_status()
        yield c


def project(c,name='助手隔离测试'):
    r=c.post('/api/projects',json={'name':name,'creation_mode':'direct','generation_policy':{'text':{'providerId':'assistant-provider','modelId':'assistant-test'},'image':None,'video':None}})
    r.raise_for_status();return r.json()


def question(p,**kw):
    return {'project_id':p['id'],'message':'下一步做什么','request_id':s.uid('chat-'),**kw}


def test_history_scoped_by_production_and_chat_does_not_mutate_project_or_jobs(client):
    p=project(client);other=project(client,'另一个作品')
    second=client.post('/api/productions/'+p['production_id']+'/episodes',json={'title':'第二集'}).json()
    before=client.get('/api/projects/'+p['id']).json()
    with s.db() as c:jobs=c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]
    payload=question(p);r=client.post('/api/assistant/chat',json=payload)
    assert r.status_code==200,r.text
    events=[json.loads(line) for line in r.text.splitlines()]
    assert [x['type'] for x in events]==['start','delta','delta','done']
    assert events[0]['context']['episode']==1
    assert events[0]['context']['model']['model']=='assistant-test'
    assert events[0]['actions'][0]['stage']=='script'
    assert client.get('/api/assistant/history',params={'project_id':other['id']}).json()==[]
    history=client.get('/api/assistant/history',params={'project_id':second['id']}).json()
    assert len(history)==2 and history[1]['status']=='complete'
    assert history[1]['content']=='先完善本集剧本。\n再进入分镜规划。'
    assert history[1]['context']['episode']==1
    assert client.post('/api/assistant/chat',json=payload).status_code==409
    assert client.get('/api/projects/'+p['id']).json()==before
    with s.db() as c:assert c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]==jobs


def test_chat_redacts_secrets_and_deleted_project_cannot_read_history(client):
    p=project(client)
    r=client.post('/api/assistant/chat',json=question(p,message='接口里有 secret-test-key，如何设置？',page_guide='token=secret-test-key'))
    assert r.status_code==200 and 'secret-test-key' not in r.text
    history=client.get('/api/assistant/history',params={'project_id':p['id']}).json()
    assert 'secret-test-key' not in json.dumps(history)
    assert client.delete('/api/productions/'+p['production_id']).status_code==200
    assert client.get('/api/assistant/history',params={'project_id':p['id']}).status_code==404
    assert client.post('/api/assistant/chat',json=question(p)).status_code==404


def test_upstream_failure_keeps_partial_answer_and_never_retries(client,monkeypatch):
    calls=[]
    async def fail(p,m):
        calls.append(1);yield '已读取本集状态。';raise ValueError('token=secret-test-key 服务断开')
    monkeypatch.setattr(a,'model_stream',fail)
    p=project(client);r=client.post('/api/assistant/chat',json=question(p))
    assert '"type": "error"' in r.text and len(calls)==1
    history=client.get('/api/assistant/history',params={'project_id':p['id']}).json()
    assert history[-1]['status']=='failed' and history[-1]['content'].startswith('已读取本集状态。')
    assert 'secret-test-key' not in json.dumps(history)


def test_cancellation_persists_partial_response(client,monkeypatch):
    async def cancelled(p,m):
        yield '部分回答';raise asyncio.CancelledError()
    monkeypatch.setattr(a,'model_stream',cancelled)
    p=project(client)
    async def consume():
        response=a.chat(a.ChatRequest(**question(p)))
        with pytest.raises(asyncio.CancelledError):
            async for chunk in response.body_iterator:pass
    asyncio.run(consume())
    history=client.get('/api/assistant/history',params={'project_id':p['id']}).json()
    assert history[-1]['status']=='interrupted' and history[-1]['content']=='部分回答'


def test_real_image_preflight_reports_unbound_bible_without_generation(client):
    p=project(client)
    _,state=a.scope_state(p['id'])
    state['document']['nodes']=[{'id':'image-2','data':{'kind':'image','label':'SHOT 02','prompt':'角色走来'}}]
    state['document']['shots']=[{'uid':'s1'},{'uid':'s2','imageNode':'image-2'}]
    state['document']['filmBible']['visual']['cards']={'hero':{'id':'hero','name':'主角','kind':'character'}}
    context,actions=a.context_for(a.ChatRequest(**question(p,message='SHOT 02 为何不能生成',stage='images')),state)
    assert '尚未绑定' in context['selectedNode']['blockingReason']
    assert context['shots'][1]['missingReferences']==['本镜尚未绑定视觉资产']
    assert any(action.get('nodeId')=='image-2' for action in actions)


def test_missing_model_auth_and_duplicate_running_guards(client):
    p=project(client)
    _,state=a.scope_state(p['id'])
    state['document']['generationPolicy']['text']={'providerId':'missing','modelId':'x'}
    with pytest.raises(Exception,match='不存在'):a.provider_for(state)
    body=a.ChatRequest(**question(p))
    response=a.chat(body)
    assert client.post('/api/assistant/chat',json=question(p)).status_code==409
    # Consume the already reserved stream to leave this test scope clean.
    async def consume():
        async for chunk in response.body_iterator:pass
    asyncio.run(consume())
    client.cookies.clear()
    assert client.get('/api/assistant/history').status_code==401


def test_workspace_model_resolution_and_provider_protocols(client):
    from fastapi import HTTPException
    with pytest.raises(HTTPException):a.provider_for(None)
    for kind,expected in [('hc_atom','/v1'),('runninghub','https://llm.runninghub.ai/v1'),('volcengine_ark','https://ark.cn-beijing.volces.com/api/v3')]:
        p={'id':'cloud','name':'Cloud','type':kind,'models':{'text':'m'},'url':'https://ark.cn-beijing.volces.com/api/v3' if kind=='volcengine_ark' else 'https://api-aigc.fzyinghe.com'}
        s.set_setting('providers',[p])
        provider=a.provider_for({'document':{'generationPolicy':{'text':{'providerId':'cloud','modelId':'m'}}}})
        assert provider['url'].endswith(expected)


def test_opening_detects_progress_without_model_calls_or_chat_records(client,monkeypatch):
    async def must_not_call(p,m):
        raise AssertionError('opening must not call a model')
        yield ''
    monkeypatch.setattr(a,'model_stream',must_not_call)
    p=project(client)
    response=client.get('/api/assistant/context',params={'project_id':p['id'],'stage':'script'})
    assert response.status_code==200,response.text
    hint=response.json()['hint']
    assert hint['headline']=='先完善本集剧本'
    assert hint['action']['stage']=='script' and '粘贴' in hint['questions'][0]
    assert client.get('/api/assistant/history',params={'project_id':p['id']}).json()==[]
    # Model settings are not a prerequisite for proactive diagnosis.
    s.set_setting('providers',[])
    assert client.get('/api/assistant/context',params={'project_id':p['id']}).status_code==200
    assert client.get('/api/assistant/context').json()['hint']['progress']=='尚未打开作品'


def test_opening_prefers_active_tasks_and_does_not_repeat_resolved_old_errors():
    tasks=[{'id':'new','node_id':'n','created':2,'status':'succeeded','error':''},{'id':'old','node_id':'n','created':1,'status':'failed','error':'旧失败'}]
    context={'tasks':tasks,'script':{'hasBody':True,'status':'draft'},'shots':[]}
    action={'kind':'stage','stage':'storyboard','label':'进入分镜规划'}
    assert a.opening_hint(context,[action])['headline']=='剧本已有正文，可以拆解分镜'
    context['tasks'].insert(0,{'id':'run','node_id':'n','created':3,'status':'running','phase':'正在生成镜头明细'})
    hint=a.opening_hint(context,[action])
    assert '正在进行' in hint['headline'] and '无需重复' in hint['detail']


def test_asking_about_episode_does_not_select_a_shot(client):
    p=project(client);_,state=a.scope_state(p['id'])
    state['document']['shots']=[{'imageNode':'im'}]
    state['document']['nodes']=[{'id':'im','data':{'kind':'image'}}]
    context,_=a.context_for(a.ChatRequest(**question(p,message='第1集下一步是什么')),state)
    assert 'selectedNode' not in context
