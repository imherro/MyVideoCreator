import pytest

from backend.visual_references import validate_visual_reference_job


PROVIDERS = [{
    'id': 'ark', 'type': 'volcengine_ark', 'local': False,
    'models': {'image': 'seedream'},
}]


def document():
    return {
        'generationPolicy': {'text': None, 'image': {'providerId': 'ark', 'modelId': 'seedream'}, 'video': None},
        'filmBible': {'visual': {'cards': {
            'hero': {'id': 'hero', 'kind': 'character', 'status': 'active'},
            'wet': {'id': 'wet', 'kind': 'character_state', 'status': 'active'},
        }, 'versions': {
            'hero-v1': {
                'id': 'hero-v1', 'cardId': 'hero', 'status': 'locked',
                'parentVersionId': None,
                'references': [{'role': 'primary', 'assetId': 'asset-parent'}],
            },
            'wet-v1': {
                'id': 'wet-v1', 'cardId': 'wet', 'status': 'draft',
                'parentVersionId': 'hero-v1', 'references': [],
            },
        }}},
    }


def state_input():
    return {
        'provider': 'ark', 'model': 'seedream', 'prompt': '雨中状态',
        'asset_ids': ['asset-parent'], 'asset_category': 'character',
        'visual_reference': {
            'versionId': 'wet-v1', 'targetSource': 'project',
            'parentVersionId': 'hero-v1',
            'parentReferenceAssetId': 'asset-parent',
        },
    }


def test_state_reference_job_must_use_policy_and_frozen_locked_parent():
    doc = document()
    validate_visual_reference_job(doc, 'visual-version:wet-v1', 'image', state_input(), PROVIDERS)
    wrong = state_input(); wrong['asset_ids'] = []
    with pytest.raises(ValueError, match='必须且只能发送'):
        validate_visual_reference_job(doc, 'visual-version:wet-v1', 'image', wrong, PROVIDERS)
    wrong = state_input(); wrong['model'] = 'another-model'
    with pytest.raises(ValueError, match='生成策略不一致'):
        validate_visual_reference_job(doc, 'visual-version:wet-v1', 'image', wrong, PROVIDERS)
    doc['filmBible']['visual']['versions']['hero-v1']['status'] = 'pending_reference'
    with pytest.raises(ValueError, match='先确认并锁定父版本'):
        validate_visual_reference_job(doc, 'visual-version:wet-v1', 'image', state_input(), PROVIDERS)


def test_base_reference_job_rejects_hidden_image_conditioning():
    doc = document()
    value = {
        'provider': 'ark', 'model': 'seedream', 'prompt': '角色定妆',
        'asset_ids': [], 'asset_category': 'character',
        'visual_reference': {'versionId': 'hero-v1', 'targetSource': 'project'},
    }
    doc['filmBible']['visual']['versions']['hero-v1']['status'] = 'draft'
    validate_visual_reference_job(doc, 'visual-version:hero-v1', 'image', value, PROVIDERS)
    value['asset_ids'] = ['unrecorded-reference']
    with pytest.raises(ValueError, match='必须从文字规格生成'):
        validate_visual_reference_job(doc, 'visual-version:hero-v1', 'image', value, PROVIDERS)
