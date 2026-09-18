import json
import pytest
from fastapi.testclient import TestClient
from backend import store as s
from backend.app import app
from backend.creative_constraints import FIELDS, validate_draft
from backend.job_contracts import freeze_prompt_contract
from backend.worker import Worker

@pytest.fixture(scope='module')
def client():
    with TestClient(app) as client:
        app.state.worker.stop()
        endpoint='login' if client.get('/api/auth/status').json()['configured'] else 'setup'
        assert client.post('/api/auth/'+endpoint,json={'password':'integration-test-only'}).status_code==200
        yield client

def test_draft_is_durable_deduplicated_and_does_not_apply(client,monkeypatch):
    p=client.post('/api/projects',json={'name':'创作约束测试','creation_mode':'direct'}).json()
    with s.db() as c:
        row=c.execute('SELECT shared_context FROM productions WHERE id=?',(p['production_id'],)).fetchone()
        ctx=json.loads(row['shared_context']);ctx['generationPolicy']['text']={'providerId':'local','modelId':''};ctx['modelPool']=None
        ctx['filmBible']['story']['summary']='不得改变主角身份'
        c.execute('UPDATE productions SET shared_context=? WHERE id=?',(s.dumps(ctx),p['production_id']))
    path='/api/projects/'+p['id']+'/creative-constraints/draft'
    response=client.post(path,json={'submission_id':'constraints-test-submit'})
    assert response.status_code==200,response.text
    job=response.json()
    assert job['input']['schema_version']=='creative-constraints/v1'
    assert '不得改变主角身份' in job['input']['prompt']
    assert client.post(path,json={'submission_id':'constraints-test-repeat'}).status_code==409
    generated={key:'' for key in FIELDS};generated['summary']='【建议】围绕成长展开'
    monkeypatch.setattr(Worker,'_chat_text',lambda *a,**kw:json.dumps(generated))
    result=Worker().text(job,{'local':True})
    assert result['creativeConstraints']==generated
    current=client.get('/api/projects/'+p['id']).json()
    assert current['document']['filmBible']['story']['summary']=='不得改变主角身份'
    s.job_update(job['id'],status='succeeded',result=result)
    assert client.get('/api/jobs/'+job['id']).json()['result']['creativeConstraints']==generated

@pytest.mark.parametrize('value',[{},dict.fromkeys(FIELDS,''),{**dict.fromkeys(FIELDS,''),'summary':'x'*6001},{**dict.fromkeys(FIELDS,''),'summary':12}])
def test_bad_draft_rejected(value):
    with pytest.raises(ValueError):validate_draft(json.dumps(value))

def test_contract_snapshot_and_valid_draft():
    value={key:'' for key in FIELDS};value['summary']='保持事实；【建议】轻喜剧'
    assert validate_draft(json.dumps(value))==value
    frozen=freeze_prompt_contract('text',{'stage':'creative_constraints','prompt':'原著'})
    assert freeze_prompt_contract('text',frozen)==frozen
    assert '【建议】' in frozen['system_prompt']
