import copy
from backend.character_sheet import prepare_character_sheet,PROMPT,REFERENCE_RULE
from backend.image_settings import resolve_image_settings
from backend.job_contracts import freeze_prompt_contract
from backend.reference_compiler import _constraint_lines, compile_shot_prompt
import pytest

@pytest.mark.parametrize('kind',['character','character_state'])
def test_character_sheet_square_and_preserves_identity(kind):
    document={'ratio':'9:16','filmBible':{'visual':{'cards':{'c':{'id':'c','kind':kind}},'versions':{'v':{'id':'v','cardId':'c'}}}}}
    value={'prompt':'不要手臂，白衣','visual_reference':{'versionId':'v'},'asset_ids':['parent']}
    before=copy.deepcopy(value)
    prepared=prepare_character_sheet(document,value)
    assert value==before and prepared['asset_ids']==['parent']
    assert '不要手臂，白衣' in prepared['prompt'] and PROMPT in prepared['prompt']
    assert prepare_character_sheet(document,prepared)==prepared
    for provider in ['volcengine_ark','hc_atom','runninghub','maestro']:
        spec=resolve_image_settings(document,prepared,{'type':provider})
        assert spec['ratio']=='1:1' and spec['size']=='2048x2048'
    contract=freeze_prompt_contract('image',prepared)
    assert contract['schema_version']=='character-sheet/v1' and '上下两排' in contract['system_prompt']
    assert document['ratio']=='9:16'

@pytest.mark.parametrize('kind',['scene','scene_state','prop'])
def test_other_assets_do_not_change(kind):
    document={'ratio':'16:9','filmBible':{'visual':{'cards':{'c':{'id':'c','kind':kind}},'versions':{'v':{'id':'v','cardId':'c'}}}}}
    value={'prompt':'原提示词','visual_reference':{'versionId':'v'}}
    assert prepare_character_sheet(document,value)==value
    assert resolve_image_settings(document,value,{'type':'volcengine_ark'})['ratio']=='16:9'

def test_regular_shot_image_and_historical_contract_unchanged():
    assert prepare_character_sheet({}, {'prompt':'普通分镜'})=={'prompt':'普通分镜'}
    old={'prompt':'旧任务','system_prompt':'历史规则','schema_version':'old'}
    assert freeze_prompt_contract('image',old)['system_prompt']=='历史规则'
    lines=_constraint_lines(1,'character',[({'id':'c','name':'人物'},{'id':'v','spec':{},'invariants':[]})])
    assert compile_shot_prompt({}, {}, lines).count(REFERENCE_RULE)==1
