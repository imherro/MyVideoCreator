import json,time
import pytest
from backend import store as s
from backend.generation_policy import default_ark_policy,default_model_pool,default_new_project_model_pool,resolve_generation_target,validate_generation_policy,validate_model_pool,validate_policy_in_pool
from backend.project_schema import CURRENT_SCHEMA_VERSION,migrate_document,new_document

def test_legacy_migration_is_lossless_and_idempotent():
    old={'nodes':[{'id':'n'}],'edges':[{'id':'e'}],'shots':[{'id':'shot-001'}],
         'timeline':[{'id':'clip'}],'characters':[{'name':'旧角色'}],'editor':{'timeline':{'tracks':[]}},'custom':{'kept':True}}
    migrated=migrate_document(old)
    assert migrated['schemaVersion']==CURRENT_SCHEMA_VERSION
    assert migrated['nodes']==old['nodes'] and migrated['edges']==old['edges']
    assert migrated['shots'][0]['id']==old['shots'][0]['id'] and migrated['shots'][0]['uid'].startswith('shot-')
    assert migrated['timeline']==old['timeline']
    assert migrated['editor']==old['editor'] and migrated['characters']==old['characters']
    assert migrated['custom']==old['custom']
    assert migrated['filmBible']=={'visual':{'cards':{},'versions':{}},'continuity':{},'style':{},'styleVersion':1,'story':{},'voices':{'profiles':{}}}
    assert migrated['generationPolicy']=={'text':None,'image':None,'video':None}
    assert migrated['videoResolution']=='720p'
    assert migrated['videoRatio']=='16:9'
    assert migrated['videoDuration']==-1
    assert migrated['videoFormat']=='mp4'
    assert migrated['modelPool'] is None
    assert migrate_document(migrated)==migrated
    assert migrate_document(old)['shots'][0]['uid']==migrated['shots'][0]['uid']
    assert 'schemaVersion' not in old

@pytest.mark.parametrize('version',[CURRENT_SCHEMA_VERSION+1,-1,1.5,True,'1'])
def test_invalid_or_future_schema_is_rejected(version):
    message='更新版本' if version==CURRENT_SCHEMA_VERSION+1 else '版本无效'
    with pytest.raises(ValueError,match=message):
        migrate_document({'schemaVersion':version,'nodes':[]})

def test_generation_policy_precedence_fallback_and_deleted_provider():
    providers=[{'id':'ark','type':'volcengine_ark','models':{'text':'doubao','image':'seedream','video':'seedance'},'local':False},
               {'id':'local-image','kind':'image','model':'flux','local':True}]
    policy=default_ark_policy(providers)
    assert resolve_generation_target('image',None,policy,providers)['modelId']=='seedream'
    override={'mode':'override','providerId':'local-image','modelId':'flux-special'}
    assert resolve_generation_target('image',override,policy,providers)=={'providerId':'local-image','modelId':'flux-special','source':'override'}
    assert resolve_generation_target('image',None,{'text':None,'image':None,'video':None},providers)['providerId']=='ark'
    with pytest.raises(ValueError,match='自动切换'):
        resolve_generation_target('video',None,{'video':{'providerId':'deleted','modelId':'paid'}},providers)
    with pytest.raises(ValueError,match='已不存在'):
        validate_generation_policy({'text':None,'image':{'providerId':'deleted'},'video':None},providers)

def test_new_document_can_receive_ark_defaults():
    providers=[{'id':'ark','type':'volcengine_ark','models':{'text':'t','image':'i','video':'v'}}]
    document=new_document(default_ark_policy(providers))
    assert document['schemaVersion']==CURRENT_SCHEMA_VERSION
    assert document['generationPolicy']['video']=={'providerId':'ark','modelId':'v'}

def test_new_project_pool_includes_cloud_models_without_changing_preferred_defaults():
    providers=[
        {'id':'local-image','type':'maestro','kind':'image','model':'flux','local':True},
        {'id':'rh','type':'runninghub','models':{'text':'rh-t','image':'rh-i','video':'rh-v'}},
        {'id':'ark','type':'volcengine_ark','models':{'text':'doubao-seed-2-1-pro-260628','image':'doubao-seedream-5-0-pro-260628','video':'doubao-seedance-2-5-260628'}},
        {'id':'hc','type':'hc_atom','models':{'text':'hc-t','image':'hc-i','video':'doubao-seedance-2.5'}},
        {'id':'speech','type':'volcengine_speech','kind':'audio','resource_id':'seed-tts-2.0'},
    ]
    assert default_ark_policy(providers)=={
        'text':{'providerId':'ark','modelId':'doubao-seed-2-1-pro-260628'},
        'image':{'providerId':'ark','modelId':'doubao-seedream-5-0-pro-260628'},
        'video':{'providerId':'hc','modelId':'doubao-seedance-2.5'},
    }
    pool=default_new_project_model_pool(providers)
    assert [target['providerId'] for target in pool['image']]==['rh','ark','hc']
    assert [target['providerId'] for target in pool['video']]==['rh','ark','hc']
    assert pool['audio']==[{'providerId':'speech','modelId':'seed-tts-2.0'}]

def test_model_pool_limits_projects_to_system_enabled_models():
    providers=[{'id':'ark','name':'Ark','type':'volcengine_ark','models':{'text':'t','image':'i','video':'v'},'enabled_models':{'text':['t','t-fast'],'image':['i'],'video':[]}},
               {'id':'speech','name':'Speech','type':'volcengine_speech','kind':'audio','resource_id':'seed-tts-2.0'}]
    pool=default_model_pool(providers)
    assert [target['modelId'] for target in pool['text']]==['t','t-fast']
    assert pool['video']==[]
    assert default_new_project_model_pool(providers)==pool
    assert pool['audio']==[{'providerId':'speech','modelId':'seed-tts-2.0'}]
    with pytest.raises(ValueError,match='未在系统模型库启用'):
        validate_model_pool({**pool,'image':[{'providerId':'ark','modelId':'other'}]},providers)
    with pytest.raises(ValueError,match='必须先加入'):
        validate_policy_in_pool({'text':{'providerId':'ark','modelId':'t'},'image':None,'video':None},{**pool,'text':[]})
