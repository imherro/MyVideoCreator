import pytest
from backend.video_ratio import compile_video_ratio

P = {'type':'volcengine_ark'}
MODEL = 'doubao-seedance-2-5-260628'


def resolve(override=None, project='16:9', mode='multimodal'):
    doc={'videoRatio':project,'nodes':[{'id':'v','data':{'videoRatio':override}}]}
    value={'model':MODEL,'ratio':'4:3','parameters':{'ratio':'1:1','duration':8}}
    return compile_video_ratio(doc,'v',value,P,{'actual':mode})


def test_inherited_ratio_overrides_stale_request_parameters():
    result=resolve(project='9:16')
    assert result['ratio']==result['parameters']['ratio']=='9:16'
    assert result['parameters']['duration']==8
    assert result['video_ratio_selection']['source']=='project'


def test_node_ratio_overrides_project_without_mutating_it():
    result=resolve('1:1')
    assert result['ratio']==result['parameters']['ratio']=='1:1'
    assert result['video_ratio_selection']['source']=='node'
    assert resolve()['ratio']=='16:9'


@pytest.mark.parametrize('mode',['first_frame','first_last_frame'])
def test_strict_frame_reports_follow_frame(mode):
    result=resolve('9:16',mode=mode)
    assert result['ratio']=='adaptive'
    assert result['video_ratio_selection']['actual']=='first_frame'
    assert result['video_ratio_selection']['requested']=='9:16'


def test_invalid_ratio_rejected():
    with pytest.raises(ValueError,match='画幅无效'):
        resolve('7:2')


def test_wan_does_not_accept_ultrawide():
    with pytest.raises(ValueError,match='21:9'):
        compile_video_ratio({'nodes':[{'id':'v','data':{'videoRatio':'21:9'}}]},'v',{'model':'wan3.0-video'},{'type':'hc_atom'},{'actual':'multimodal'})
