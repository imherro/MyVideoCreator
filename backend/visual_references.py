"""Server-side contract for Visual Bible primary-reference jobs."""
from __future__ import annotations

from .generation_policy import resolve_generation_target

STATE_KINDS = {'character_state', 'scene_state'}


def _primary_reference(version):
    references = version.get('references') or []
    return next((item for item in references if isinstance(item, dict) and item.get('role') == 'primary'), None)


def validate_visual_reference_job(document, node_id, kind, input_value, providers):
    """Validate policy and identity constraints before a reference job queues."""
    marker = input_value.get('visual_reference')
    if marker is None:
        return
    if kind != 'image' or not isinstance(marker, dict):
        raise ValueError('视觉参考任务必须是图片生成任务')
    version_id = marker.get('versionId')
    if not isinstance(version_id, str) or node_id != 'visual-version:' + version_id:
        raise ValueError('视觉参考任务与版本标识不一致')
    visual = ((document.get('filmBible') or {}).get('visual') or {})
    versions = visual.get('versions') or {}
    cards = visual.get('cards') or {}
    version = versions.get(version_id)
    card = cards.get(version.get('cardId')) if isinstance(version, dict) else None
    if not isinstance(version, dict) or not isinstance(card, dict):
        raise ValueError('视觉参考任务所用版本不存在')
    if version.get('status') not in ('draft', 'pending_reference'):
        raise ValueError('已锁定或已弃用的视觉版本不能生成参考图')
    override = ((card.get('generation') or {}).get('image'))
    target = resolve_generation_target('image', override, document.get('generationPolicy'), providers)
    if input_value.get('provider') != target['providerId'] or input_value.get('model') != target['modelId']:
        raise ValueError('视觉参考任务模型与资产卡/项目生成策略不一致，请刷新后重试')
    if marker.get('targetSource') != target['source']:
        raise ValueError('视觉参考任务的策略来源记录不一致')
    expected_category = (
        'character' if card.get('kind') in ('character', 'character_state')
        else 'scene' if card.get('kind') in ('scene', 'scene_state')
        else 'prop'
    )
    if input_value.get('asset_category') != expected_category:
        raise ValueError('视觉参考任务的素材分类不一致')
    references = input_value.get('asset_ids') or []
    if card.get('kind') not in STATE_KINDS:
        if references:
            raise ValueError('基础视觉版本主参考图必须从文字规格生成')
        if marker.get('parentVersionId') or marker.get('parentReferenceAssetId'):
            raise ValueError('基础视觉版本不能声明父参考图')
        return
    parent_id = version.get('parentVersionId')
    parent = versions.get(parent_id)
    if not isinstance(parent, dict):
        raise ValueError('状态资产缺少创建时冻结的父版本')
    if parent.get('status') != 'locked':
        raise ValueError('请先确认并锁定父版本参考图，再生成状态资产')
    reference = _primary_reference(parent)
    asset_id = reference.get('assetId') if reference else None
    if not asset_id:
        raise ValueError('父版本缺少已锁定的主参考图')
    if marker.get('parentVersionId') != parent_id or marker.get('parentReferenceAssetId') != asset_id:
        raise ValueError('状态资产的父参考图记录不一致')
    if references != [asset_id]:
        raise ValueError('状态资产必须且只能发送创建时冻结的父版本主参考图')
