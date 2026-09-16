import copy
import json
import pytest
from backend.film_bible.reuse import normalize_reusable_visual, visual_catalog, visual_user_prompt
from backend.film_bible.extract import extract_storyboard
from backend.film_bible.validate import normalize_visual_bible, normalize_bound_storyboard
from backend.film_bible.versioning import validate_film_bible_transition
from test_film_bible import visual_input, storyboard_input


def fixture():
    visual, keys = normalize_visual_bible(visual_input())
    for version in visual['versions'].values():
        version['status'] = 'locked'
        version['references'] = [{'role':'primary','assetId':'confirmed-' + version['id']}]
    return visual, keys


def test_replanning_reuses_ids_and_preserves_every_historical_version():
    old, old_keys = fixture(); frozen = copy.deepcopy(old)
    raw = visual_input(); raw['cards'][0]['description'] = '模型试图修改已确认外观'
    merged, keys = normalize_reusable_visual(raw, old)
    assert keys == old_keys
    assert merged == old == frozen
    ep1 = normalize_bound_storyboard(storyboard_input(), old, old_keys)['shots']
    ep2 = normalize_bound_storyboard(storyboard_input(), merged, keys)['shots']
    assert ep2[0]['dialogues'][0]['characterCardId'] == old_keys['hero'][0]
    validate_film_bible_transition({'filmBible':{'visual':old},'shots':ep1},
                                  {'filmBible':{'visual':merged},'shots':ep1 + ep2})


def test_explicit_existing_keys_and_new_state_keep_parent_reference():
    old, old_keys = fixture(); hero, hero_v = old_keys['hero']
    state = {**visual_input()['cards'][1], 'key':'hero_injured','name':'林岚·受伤', 'parent_key':hero}
    merged, keys = normalize_reusable_visual({'cards':[state]}, old)
    assert keys[hero] == old_keys['hero']
    cid, vid = keys['hero_injured']
    assert merged['cards'][cid]['parentCardId'] == hero
    assert merged['versions'][vid]['parentVersionId'] == hero_v
    assert len(merged['cards']) == len(old['cards']) + 1
    assert merged['versions'][hero_v] == old['versions'][hero_v]


def test_explicit_reuse_allows_alias_but_rejects_wrong_kind_and_deleted_card():
    old, keys = fixture(); hero, _ = keys['hero']
    raw = {'cards':[{**visual_input()['cards'][0], 'key':hero,'name':'小林'}]}
    merged, new_keys = normalize_reusable_visual(raw, old)
    assert new_keys[hero] == keys['hero'] and merged == old
    raw['cards'][0]['kind'] = 'scene'
    with pytest.raises(ValueError, match='不匹配'):normalize_reusable_visual(raw, old)
    raw['cards'][0]['kind'] = 'character';old['cards'][hero]['deletedAt'] = 123
    assert hero not in [x['key'] for x in visual_catalog(old)]
    with pytest.raises(ValueError, match='不可复用'):normalize_reusable_visual(raw, old)


def test_ambiguous_name_requires_explicit_key():
    old, _ = fixture(); duplicate, _ = normalize_visual_bible({'cards':[visual_input()['cards'][0]]})
    old['cards'].update(duplicate['cards']);old['versions'].update(duplicate['versions'])
    with pytest.raises(ValueError, match='多个同名'):
        normalize_reusable_visual({'cards':[visual_input()['cards'][0]]}, old)


def test_confirmed_aliases_reuse_identity_without_fuzzy_matching():
    old, keys = fixture(); hero,_ = keys['hero'];old['cards'][hero]['aliases']=['小林']
    raw={'cards':[{**visual_input()['cards'][0],'name':'小林'}]}
    merged,resolved=normalize_reusable_visual(raw,old)
    assert merged==old and resolved['hero']==keys['hero']
    assert '小林' in visual_user_prompt('下一集',old)


def test_both_model_passes_receive_canonical_reused_appearance():
    old, keys = fixture(); calls = []
    def request(system, user, schema, phase, stage):
        calls.append((stage,user))
        return json.dumps(visual_input() if stage == 'visual_bible' else storyboard_input())
    result = extract_storyboard('EP02 雨巷',5,'ark','doubao',request,existing_visual=old)
    assert keys['hero'][0] in calls[0][1]
    assert '不得仅因换集而重建' in calls[0][1] and '灰色风衣' in calls[1][1]
    assert result['filmBible']['visual'] == old
    assert result['shots'][0]['assetBindings']['characters'][0]['versionId'] == keys['hero_wet'][1]
    assert visual_user_prompt('旧任务',None) == '旧任务'
