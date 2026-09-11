import pytest

from backend.reference_compiler import compile_shot_image_input


PROVIDERS = [{
    'id': 'image-provider', 'name': 'Image Provider', 'type': 'openai',
    'kind': 'image', 'local': True, 'model': 'image-model',
}]


def document():
    cards = {
        'hero': {'id': 'hero', 'kind': 'character', 'name': '林岚'},
        'friend': {'id': 'friend', 'kind': 'character_state', 'name': '雨中的阿杰'},
        'alley': {'id': 'alley', 'kind': 'scene', 'name': '雨巷'},
        'umbrella': {'id': 'umbrella', 'kind': 'prop', 'name': '红伞'},
    }
    versions = {}
    for card_id, card in cards.items():
        version_id = card_id + '-v1'
        versions[version_id] = {
            'id': version_id, 'cardId': card_id, 'status': 'locked',
            'spec': {
                'description': card['name'] + '的固定外观',
                'attributes': [{'name': '颜色', 'value': card_id + '-color'}],
            },
            'invariants': [card['name'] + '不可改变'],
            'references': [{'role': 'primary', 'assetId': 'asset-' + card_id}],
            'provenance': {'lockedAt': 1},
        }
    return {
        'filmBible': {'visual': {'cards': cards, 'versions': versions}},
        'shots': [{
            'id': 'shot-001', 'uid': 'shot-stable', 'imageNode': 'image-1',
            'assetBindings': {
                'characters': [
                    {'role': '主角', 'versionId': 'hero-v1'},
                    {'role': '朋友', 'versionId': 'friend-v1'},
                ],
                'scene': {'versionId': 'alley-v1'},
                'props': [{'role': '关键道具', 'versionId': 'umbrella-v1'}],
            },
        }],
        'nodes': [
            {'id': 'visual', 'data': {'managed': True, 'kind': 'visual_asset'}},
            {'id': 'manual-reference', 'data': {'kind': 'reference', 'assetId': 'asset-manual'}},
            {'id': 'image-1', 'data': {'kind': 'image'}},
        ],
        'edges': [
            {'source': 'visual', 'target': 'image-1'},
            {'source': 'manual-reference', 'target': 'image-1'},
        ],
    }


def input_value():
    return {
        'provider': 'image-provider', 'model': 'image-model',
        'prompt': '中景，林岚撑伞走过雨巷',
        'asset_ids': ['asset-manual'],
    }


def supports(maximum=4):
    return lambda provider, model_id: {
        'image_reference': True, 'max_references': maximum,
    }


def test_compiler_uses_only_asset_bindings_in_character_scene_prop_order():
    value = {
        **input_value(),
        'model_capabilities': {'image_reference': False, 'max_references': 1},
        'allow_reference_text_fallback': True,
    }
    result = compile_shot_image_input(
        document(), 'image-1', 'image', value, PROVIDERS, supports(),
    )
    assert result['asset_ids'] == [
        'asset-hero', 'asset-friend', 'asset-alley', 'asset-umbrella',
    ]
    assert result['image_reference_sources'] == [
        {'type': 'asset', 'asset_id': asset_id} for asset_id in result['asset_ids']
    ]
    assert [item['group'] for item in result['reference_compiler']['bindings']] == [
        'character', 'character', 'scene', 'prop',
    ]
    assert result['reference_compiler']['source'] == 'shot.assetBindings'
    assert 'asset-manual' not in result['asset_ids']
    assert 'model_capabilities' not in result
    assert 'allow_reference_text_fallback' not in result
    assert '视觉圣经一致性约束' in result['prompt']
    assert '可见规格：林岚的固定外观' in result['prompt']
    assert '固定属性：颜色：hero-color' in result['prompt']
    assert '不可改变：林岚不可改变' in result['prompt']
    assert '拼贴画' in result['prompt']
    assert 'composite' not in result['reference_compiler']


@pytest.mark.parametrize('capabilities', [
    None,
    {},
    {'image_reference': False, 'max_references': 4},
    {'image_reference': True},
    {'image_reference': True, 'max_references': None},
])
def test_compiler_requires_explicit_reference_support_and_limit(capabilities):
    value = {**input_value(), 'allow_reference_text_fallback': True}
    with pytest.raises(ValueError, match='未明确支持参考图|最大参考图数量'):
        compile_shot_image_input(
            document(), 'image-1', 'image', value, PROVIDERS,
            lambda provider, model_id: capabilities,
        )


def test_compiler_blocks_missing_model_and_never_truncates_excess_references():
    with pytest.raises(ValueError, match='目录中找不到'):
        compile_shot_image_input(
            document(), 'image-1', 'image', input_value(), PROVIDERS,
            lambda provider, model_id: (_ for _ in ()).throw(ValueError('模型目录中找不到该模型')),
        )
    with pytest.raises(ValueError, match='绑定了 4 张.*最多支持 3 张.*不会截断'):
        compile_shot_image_input(
            document(), 'image-1', 'image', input_value(), PROVIDERS, supports(3),
        )


def test_high_consistency_blocks_unlocked_or_missing_primary_references():
    unlocked = document()
    unlocked['filmBible']['visual']['versions']['hero-v1']['status'] = 'pending_reference'
    with pytest.raises(ValueError, match='确认并锁定'):
        compile_shot_image_input(
            unlocked, 'image-1', 'image', input_value(), PROVIDERS, supports(),
        )
    missing = document()
    missing['filmBible']['visual']['versions']['hero-v1']['references'] = []
    with pytest.raises(ValueError, match='缺少.*主参考图'):
        compile_shot_image_input(
            missing, 'image-1', 'image', input_value(), PROVIDERS, supports(),
        )


def test_non_shot_and_unbound_shot_inputs_are_not_rewritten():
    value = input_value()
    assert compile_shot_image_input(
        document(), 'other-image', 'image', value, PROVIDERS,
        lambda *_: (_ for _ in ()).throw(AssertionError('must not resolve')),
    ) == value
    unbound = document()
    unbound['shots'][0]['assetBindings'] = {'characters': [], 'scene': None, 'props': []}
    assert compile_shot_image_input(
        unbound, 'image-1', 'image', value, PROVIDERS,
        lambda *_: (_ for _ in ()).throw(AssertionError('must not resolve')),
    ) == value
