import copy
import json
import pytest
from backend.adaptation_references import reference_map,decode_references
from backend.job_contracts import freeze_prompt_contract


def task():
    events=['source-event-88d514e9a7db4128b71f7a66ca6d79d2','source-event-31efd88c4a6945afa0d7b2e74b7ba796']
    chapters=['chapter-abcdef']
    return {'sourceEventIds':events,'sourceChapterIds':chapters,'referenceMap':reference_map(events,chapters)}


def test_freeze_maps_prompt_and_schema_without_mutating_source():
    marker=task()
    original={'stage':'adaptation_generation','prompt':json.dumps([{'id':eid,'chapterId':marker['sourceChapterIds'][0],'summary':'不改原文'} for eid in marker['sourceEventIds']]),'adaptation_generation':marker}
    before=copy.deepcopy(original)
    frozen=freeze_prompt_contract('text',original)
    assert original==before
    assert frozen['schema_version']=='adaptation-plan/v2'
    assert all(real not in frozen['prompt'] for real in marker['sourceEventIds']+marker['sourceChapterIds'])
    assert 'E001' in frozen['prompt'] and 'C001' in frozen['prompt']
    assert frozen['response_schema']['properties']['adaptationPlan']['properties']['sourceEventIds']['items']['enum']==['E001','E002']
    assert freeze_prompt_contract('text',frozen)==frozen


def test_decode_preserves_original_response_and_narrative():
    marker=task()
    value={'adaptationPlan':{'sourceEventIds':['E002','E001'],'storyCore':'完整剧情'},'episodePlans':[{'sourceChapterRefs':['C001'],'hook':'悬念'}]}
    before=copy.deepcopy(value);result=decode_references(value,marker)
    assert value==before
    assert result['adaptationPlan']['sourceEventIds']==marker['sourceEventIds'][::-1]
    assert result['episodePlans'][0]['sourceChapterRefs']==marker['sourceChapterIds']
    assert result['adaptationPlan']['storyCore']=='完整剧情'


@pytest.mark.parametrize('bad',['E003','E01','source-event-88d514e9a7db4128b7f1a766ca6d79d2',None])
def test_unknown_reference_fails_without_fuzzy_matching(bad):
    with pytest.raises(ValueError,match=r'adaptationPlan.sourceEventIds.*无效编号'):
        decode_references({'adaptationPlan':{'sourceEventIds':[bad]}},task())


def test_unknown_chapter_and_corrupt_mapping_are_rejected():
    with pytest.raises(ValueError,match=r'episodePlans\[0\].sourceChapterRefs'):
        decode_references({'episodePlans':[{'sourceChapterRefs':['C002']}]},task())
    marker=task();marker['referenceMap']['events']['E001']='event-not-in-snapshot'
    with pytest.raises(ValueError,match='无效编号'):
        decode_references({'adaptationPlan':{'sourceEventIds':['E001']}},marker)


def test_legacy_snapshot_stays_on_real_identifiers():
    marker=task();marker.pop('referenceMap')
    value={'adaptationPlan':{'sourceEventIds':marker['sourceEventIds']}}
    assert decode_references(value,marker)==value
    frozen=freeze_prompt_contract('text',{'stage':'adaptation_generation','prompt':'旧任务','adaptation_generation':marker})
    assert frozen['schema_version']=='adaptation-plan/v1'
