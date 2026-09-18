import copy
import re
import pytest
from backend.script_import import rule_manifest,validate_manifest,extract,_EP_PROPERTIES


@pytest.mark.parametrize('title,error', [('正常标题',None),('',None),(' \t\n','仅含空白'),('长'*201,'标题过长')])
def test_title_schema_matches_validation_and_preserves_ranges(title,error):
    content='第1集 原集名\n原文不可改。\n第2集 后续\n结束。'
    rules=rule_manifest(content,'test.txt')
    value={k:copy.deepcopy(v) for k,v in rules.items() if k!='method'}
    value['episodes'][0]['title']=title
    field=_EP_PROPERTIES['title']
    accepted=len(title)<=field['maxLength'] and re.search(field['pattern'],title) is not None
    assert accepted==(error is None)
    if error:
        with pytest.raises(ValueError,match='第 1 集.*'+error):validate_manifest(content,value,rules)
    else:
        result=validate_manifest(content,value,rules)
        assert result['episodes'][0]['title']==(title or '原集名')
        for actual,original in zip(result['episodes'],rules['episodes']):
            assert (actual['episodeNo'],actual['startLine'],actual['endLine'])==(original['episodeNo'],original['startLine'],original['endLine'])
            assert extract(content,actual['startLine'],actual['endLine'])==extract(content,original['startLine'],original['endLine'])


def test_no_original_episode_name_uses_number_without_inventing_prose():
    content='甲出门。\n乙关门。';rules=rule_manifest(content,'test.txt')
    row={'episodeNo':1,'title':'','startLine':1,'endLine':2,'durationSeconds':0,'characters':['甲','乙'],'scenes':[],'incomplete':False,'warnings':[]}
    value={'title':'作品','declaredEpisodes':0,'episodes':[row],'warnings':[]}
    result=validate_manifest(content,value,rules)
    assert result['episodes'][0]['title']=='第 1 集'
    assert result['episodes'][0]['warnings']
    assert extract(content,1,2)==content
