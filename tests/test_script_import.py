import copy
import json

import pytest
from fastapi.testclient import TestClient
from backend import store as s
from backend.app import app
from backend.script_import import rule_manifest,validate_manifest,apply_analysis,extract

SAMPLE='剧名：《导入测试》\r\n集数：3集\r\n女主：小林\r\n人物设定：勇敢。\r\n第1集：初遇\r\n时长：50秒\r\n场景：雨夜\r\n【镜头1：小林打开门】\r\n小林：你好。\r\n第2集：重逢\r\n时长：45秒\r\n小林：怎么是'

@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        app.state.worker.stop()
        action='login' if c.get('/api/auth/status').json()['configured'] else 'setup'
        assert c.post('/api/auth/'+action,json={'password':'integration-test-only'}).status_code==200
        yield c

def project(client):
    return client.post('/api/projects',json={'name':'导入隔离验证','creation_mode':'direct','ratio':'9:16','video_resolution':'480p'}).json()

def preview(client,p,content=SAMPLE):
    result=client.post(f'/api/productions/{p["production_id"]}/script-imports',json={'filename':'测试剧本.txt','content':content})
    assert result.status_code==200,result.text
    return result.json()

def test_titles_subheadings_incomplete_and_exact_ranges():
    data=rule_manifest(SAMPLE,'a.txt')
    assert [x['episodeNo'] for x in data['episodes']]==[1,2]
    assert data['declaredEpisodes']==3
    assert data['episodes'][-1]['incomplete'] is True
    body=extract(SAMPLE, data['episodes'][0]['startLine'],data['episodes'][0]['endLine'])
    assert body=='第1集：初遇\r\n时长：50秒\r\n场景：雨夜\r\n【镜头1：小林打开门】\r\n小林：你好。\r\n'
    assert len(rule_manifest('# 第一集 初遇\n## 人物\n小林\n# 第二集 重逢\n结束。','a.md')['episodes'])==2
    assert [x['episodeNo'] for x in rule_manifest('EP01 初遇\n正文\nEP02:重逢\n正文。','a.txt')['episodes']]==[1,2]
    from backend.source_library import split_chapters
    chapters=split_chapters('# 第一集 初遇\n## 人物\n小林\n# 第二集 重逢\n结束。')
    assert len(chapters)==2 and '## 人物' in chapters[0][1]

def test_model_cannot_rewrite_or_drop_source():
    rules=rule_manifest(SAMPLE,'a.txt');value={k:v for k,v in copy.deepcopy(rules).items() if k!='method'}
    value['episodes'][0]['endLine']-=1
    with pytest.raises(ValueError,match='分集边界'):validate_manifest(SAMPLE,value,rules)
    value={k:v for k,v in copy.deepcopy(rules).items() if k!='method'}
    value['episodes'][0]['body']='改写台词'
    with pytest.raises(ValueError,match='字段'):validate_manifest(SAMPLE,value,rules)
    unmarked=rule_manifest('甲出门。\n乙关门。','a.txt')
    value={**unmarked,'episodes':[{'episodeNo':1,'title':'甲出门','startLine':1,'endLine':1,'durationSeconds':0,'characters':[],'scenes':[],'incomplete':False,'warnings':[]}]};value.pop('method')
    with pytest.raises(ValueError,match='文件末尾'):validate_manifest('甲出门。\n乙关门。',value,unmarked)

def test_preview_confirm_idempotency_and_original_preservation(client):
    p=project(client);d=preview(client,p);path=f'/api/productions/{p["production_id"]}/script-imports/{d["id"]}'
    assert preview(client,p)['id']==d['id']
    assert d['missingEpisodes']==[3] and not any(ep['conflict'] for ep in d['manifest']['episodes'])
    result=client.post(path+'/confirm',json={'episode_nos':[1,2],'include_shared':True})
    assert result.status_code==200,result.text
    assert client.post(path+'/confirm',json={'episode_nos':[1,2]}).json()==result.json()
    assert len(client.get(f'/api/productions/{p["production_id"]}/episodes').json())==2
    for ep in result.json()['episodes']:
        sc=client.get(f'/api/productions/{p["production_id"]}/episode-scripts/{ep["episodeNo"]}').json()
        row=d['manifest']['episodes'][ep['episodeNo']-1]
        assert sc['body']==row['body'].strip() # canonical script storage trims outer whitespace only
        assert sc['estimatedDuration']==row['durationSeconds']
        state=client.get('/api/projects/'+ep['projectId']).json()['document']
        assert state['ratio']=='9:16' and state['videoResolution']=='480p' and state['creationMode']=='direct'
        assert '小林' in state['filmBible']['story']['summary']
        assert any(n['data'].get('text')==sc['body'] for n in state['nodes'])
        assert sc['metadata']['adaptationLinked'] is False
    source=client.get(f'/api/productions/{p["production_id"]}/sources').json()[0]
    assert source['metadata']['originalContent']==SAMPLE
    job=client.post(f'/api/projects/{p["id"]}/jobs',json={'node_id':'import-board','kind':'storyboard','submission_id':'import-storyboard-context','input':{'provider':'local','film_bible':True,'prompt':'小林打开门'}})
    assert job.status_code==200,job.text
    frozen=job.json()['input']
    assert '人物设定：勇敢。' in frozen['storyboard_visual_context']['imported_story']
    assert '人物设定：勇敢。' in frozen['prompt_stages'][0]['user_prompt']
    assert client.get(path).json()['status']=='imported'
    from backend.adaptation import SCRIPT_FIELDS
    script_url=f'/api/productions/{p["production_id"]}/episode-scripts/2'
    sc=client.get(script_url).json()
    fixed=client.put(script_url,json={**{key:sc[key] for key in SCRIPT_FIELDS},'revision':sc['revision'],'body':sc['body']+'你。'})
    assert fixed.status_code==200,fixed.text
    assert fixed.json()['metadata']['incomplete'] is False
    again=preview(client,p)
    assert all(ep['conflict'] for ep in again['manifest']['episodes'])
    conflict=client.post(f'/api/productions/{p["production_id"]}/script-imports/{again["id"]}/confirm',json={'episode_nos':[1,2]})
    assert conflict.status_code==400

def test_atomic_conflict_and_production_isolation(client):
    p=project(client);other=project(client);d=preview(client,p)
    assert client.get(f'/api/productions/{other["production_id"]}/script-imports/{d["id"]}').status_code==400
    # A draft that was empty at preview becomes occupied before confirmation.
    with s.db() as c:c.execute('UPDATE episode_scripts SET body=? WHERE project_id=?',('保留的原剧本',p['id']))
    result=client.post(f'/api/productions/{p["production_id"]}/script-imports/{d["id"]}/confirm',json={'episode_nos':[2,1]})
    assert result.status_code==400
    assert len(client.get(f'/api/productions/{p["production_id"]}/episodes').json())==1
    assert client.get(f'/api/productions/{p["production_id"]}/sources').json()==[]

def test_ai_job_contract_and_guarded_result(client):
    p=project(client);d=preview(client,p)
    # A configured project choice is required; no silent fallback to a local model.
    path=f'/api/productions/{p["production_id"]}/script-imports/{d["id"]}'
    with s.db() as c:
        row=c.execute('SELECT shared_context FROM productions WHERE id=?',(p['production_id'],)).fetchone()
        context=json.loads(row['shared_context']);context['generationPolicy']['text']={'providerId':'local','modelId':''}
        c.execute('UPDATE productions SET shared_context=? WHERE id=?',(s.dumps(context),p['production_id']))
    job=client.post(path+'/analyze',json={'project_id':p['id'],'submission_id':'script-import-analysis-test'})
    assert job.status_code==200,job.text
    job=job.json()['jobs'][0]
    assert job['scope']=='production'
    assert job['input']['schema_version']=='script-import/v3'
    assert '不改写' in job['input']['system_prompt']
    assert client.post(path+'/analyze',json={'project_id':p['id'],'submission_id':'script-import-analysis-duplicate'}).json()['jobs'][0]['id']==job['id']
    assert client.post(path+'/confirm',json={'episode_nos':[1]}).status_code==400
    with s.db() as c:c.execute("UPDATE jobs SET status='running' WHERE id=?",(job['id'],))
    value={k:v for k,v in rule_manifest(SAMPLE,'a.txt').items() if k!='method'}
    value['warnings']=['测试检查提醒'];value['episodes'][0]['characters']=['小林']
    apply_analysis(job,value)
    with s.db() as c:c.execute("UPDATE jobs SET status='succeeded' WHERE id=?",(job['id'],))
    draft=client.get(path).json()
    assert draft['manifest']['method']=='ai' and draft['manifest']['episodes'][0]['characters']==['小林']
    assert len(client.get(f'/api/productions/{p["production_id"]}/episodes').json())==1 # AI never imports
    with s.db() as c:c.execute("UPDATE jobs SET status='cancelled' WHERE id=?",(job['id'],))
    with pytest.raises(ValueError,match='失效'):apply_analysis(job,value)


def test_import_model_override_is_frozen_and_does_not_change_project_default(client):
    previous=s.get_setting('providers',[])
    providers=[{'id':'import-models','name':'Import models','type':'openai','kind':'text','model':'default-text',
                'enabled_models':{'text':['default-text','analysis-text','outside-pool']}}]
    s.set_setting('providers',providers)
    try:
        target={'providerId':'import-models','modelId':'default-text'}
        p=client.post('/api/projects',json={
            'name':'导入模型选择测试','generation_policy':{'text':target,'image':None,'video':None},
            'model_pool':{'text':[target,{'providerId':'import-models','modelId':'analysis-text'}],'image':[],'video':[],'audio':[]},
        }).json()
        d=preview(client,p)
        assert d['job'] is None
        path=f'/api/productions/{p["production_id"]}/script-imports/{d["id"]}/analyze'
        body={'project_id':p['id'],'submission_id':'import-selected-model-test','provider_id':'import-models'}
        for model in ['disabled-model','outside-pool']:
            response=client.post(path,json={**body,'model_id':model})
            assert response.status_code==400,response.text
        response=client.post(path,json={**body,'model_id':'analysis-text'})
        assert response.status_code==200,response.text
        job=response.json()['jobs'][0]
        assert job['input']['provider']=='import-models'
        assert job['input']['model']=='analysis-text'
        assert client.get('/api/projects/'+p['id']).json()['document']['generationPolicy']['text']==target
        duplicate=client.post(path,json={**body,'submission_id':'import-model-duplicate','model_id':'default-text'})
        assert duplicate.json()['jobs'][0]['id']==job['id']
        assert duplicate.json()['jobs'][0]['input']['model']=='analysis-text'
    finally:
        s.set_setting('providers',previous)
