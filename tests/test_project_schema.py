import json,time
import pytest
from backend import store as s
from backend.generation_policy import default_ark_policy,resolve_generation_target,validate_generation_policy
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
    assert migrated['filmBible']=={'visual':{'cards':{},'versions':{}},'continuity':{},'style':{},'styleVersion':1,'story':{}}
    assert migrated['generationPolicy']=={'text':None,'image':None,'video':None}
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
    assert resolve_generation_target('image',None,{'text':None,'image':None,'video':None},providers)['providerId']=='local-image'
    with pytest.raises(ValueError,match='自动切换'):
        resolve_generation_target('video',None,{'video':{'providerId':'deleted','modelId':'paid'}},providers)
    with pytest.raises(ValueError,match='已不存在'):
        validate_generation_policy({'text':None,'image':{'providerId':'deleted'},'video':None},providers)

def test_new_document_can_receive_ark_defaults():
    providers=[{'id':'ark','type':'volcengine_ark','models':{'text':'t','image':'i','video':'v'}}]
    document=new_document(default_ark_policy(providers))
    assert document['schemaVersion']==CURRENT_SCHEMA_VERSION
    assert document['generationPolicy']['video']=={'providerId':'ark','modelId':'v'}
