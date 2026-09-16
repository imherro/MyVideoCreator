import copy
import pytest
from backend.video_result_status import matches_video_result


def fixture():
    inp={'provider':'rh','model':'seedance','prompt':'same compiled prompt','parameters':{'duration':4,'resolution':'480p'},'asset_ids':['i'],'ratio':'16:9',
         'motion_compiler':{'version':'v1'},'generation_revision':14,'generation_mode':{'requested':'multimodal','actual':'multimodal'},
         'voice_samples':[{'characterCardId':'hero','voiceCardId':'hero','voiceVersion':1,'assetId':'audio','index':1,'purpose':'timbre_only','media':{'sha256':'abc','duration':3}}]}
    job={'id':'j','status':'succeeded','input':inp,'result':{'assets':[{'id':'video'}]}}
    node={'id':'v','data':{'kind':'video','stale':True,'resultJob':'j','assetId':'video','generation_revision':18}}
    doc={'nodes':[node,{'id':'i','data':{'stale':False}}],'edges':[{'source':'i','target':'v'}]}
    return doc,node,job,copy.deepcopy(inp)


def test_reverting_exact_inputs_clears_warning_despite_revision_counter():
    doc,node,job,current=fixture();current['generation_revision']=18
    current['parameters']['outputFormat']='mp4'
    current['voice_samples'][0]['source']='doubao_tts' # Newly added provenance is not a changed reference.
    assert matches_video_result(doc,node,job,current)
    assert node['data']['stale'] is True # Read-only check, caller applies with concurrency guard.
    assert job['input']['generation_revision']==14


@pytest.mark.parametrize('field,value',[('model','different'),('provider','other'),('prompt','changed'),('ratio','9:16'),('asset_ids',['new-image']),('parameters',{'duration':5,'resolution':'480p'}),('generation_mode',{'requested':'first_frame','actual':'first_frame'})])
def test_actual_input_change_remains_stale(field,value):
    doc,node,job,current=fixture();current[field]=value
    assert not matches_video_result(doc,node,job,current)


def test_changed_sample_upstream_or_result_cannot_be_cleared():
    doc,node,job,current=fixture();current['voice_samples'][0]['assetId']='new-audio'
    assert not matches_video_result(doc,node,job,current)
    doc,node,job,current=fixture();doc['nodes'][1]['data']['stale']=True
    assert not matches_video_result(doc,node,job,current)
    doc,node,job,current=fixture();node['data']['assetId']='different-take'
    assert not matches_video_result(doc,node,job,current)
