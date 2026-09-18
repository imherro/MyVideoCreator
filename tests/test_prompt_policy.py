import copy
import pytest

from backend.prompt_policy import VERSION, repair_context, source_chunk_limit, text_parameters
from backend.job_contracts import freeze_prompt_contract
from backend.source_extraction import split_input
from backend.text_output import output_budget


def test_new_contract_version_and_old_snapshots_remain_immutable():
    original = {'stage': 'script_generation', 'provider': 'ark', 'model': 'doubao-seed-2-1-pro', 'prompt': '本集'}
    saved = copy.deepcopy(original)
    frozen = freeze_prompt_contract('text', original)
    assert original == saved
    assert frozen['prompt_policy_version'] == VERSION
    assert '实际表演' in frozen['system_prompt']
    assert freeze_prompt_contract('text', frozen) == frozen
    legacy = {'prompt': '旧任务', 'system_prompt': '历史系统提示词', 'schema_version': 'old'}
    restored = freeze_prompt_contract('text', legacy)
    assert restored['system_prompt'] == '历史系统提示词'
    assert 'prompt_policy_version' not in restored


def test_sampling_is_task_specific_without_forcing_unknown_reasoning_models():
    inp = {'model': 'doubao-seed-2-1-pro', 'stage': 'script_import_analysis', 'prompt_policy_version': VERSION}
    assert text_parameters(inp)['temperature'] == .2
    assert text_parameters({**inp, 'stage': 'script_generation'})['temperature'] == .6
    assert text_parameters(inp, 'visual_bible_repair')['temperature'] == .2
    assert text_parameters({**inp, 'model': 'unknown-reasoning'}) == {}
    assert text_parameters(inp, local=True) == {'temperature': .6}
    assert text_parameters({'stage': 'script_import_analysis'}) == {'temperature': .6}


def test_source_chunk_budget_preserves_all_text_and_local_compatibility():
    inp = {'provider': 'ark', 'model': 'doubao-seed-2-1-pro', 'prompt_policy_version': VERSION}
    assert source_chunk_limit(inp, {}) == 16000
    assert source_chunk_limit(inp, {'local': True}) == 6000
    assert source_chunk_limit({'provider': 'ark'}, {}) == 6000
    text = ('场景一：完整动作与对白。\n\n' * 3000) + '结尾不能丢失'
    parts = split_input(text, source_chunk_limit(inp, {}))
    assert ''.join(parts) == text
    assert max(map(len, parts)) <= 16000
    assert output_budget({**inp, 'stage': 'script_generation'}) == 24576


def test_repair_keeps_tail_instead_of_silently_cutting_json():
    text = '前文' * 14000 + '最后一镜有错误'
    assert repair_context(text) == text
    with pytest.raises(ValueError, match='未截断'):
        repair_context(text, local=True)
    with pytest.raises(ValueError, match='未截断'):
        repair_context('x' * 160001)


def test_storyboard_contract_does_not_require_generated_image():
    result = freeze_prompt_contract('storyboard', {'film_bible': True, 'prompt': '剧本'})
    director = result['prompt_stages'][1]['system_prompt']
    assert '可能完全没有预先生成的分镜图' in director
    assert 'video_prompt 必须独立完整' in director
    assert '禁止凭空写 @图片1' in director
    assert '一个叙事目的' in director
