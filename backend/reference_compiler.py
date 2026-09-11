"""Compile Film Bible shot bindings into immutable image-generation inputs."""
from __future__ import annotations

from .visual_references import resolve_image_model_capabilities


GROUP_KINDS = {
    'character': {'character', 'character_state'},
    'scene': {'scene', 'scene_state'},
    'prop': {'prop'},
}


def _primary_reference(version):
    return next((
        item for item in version.get('references', [])
        if isinstance(item, dict) and item.get('role') == 'primary'
    ), None)


def _shot_for_image_node(document, node_id):
    return next((
        shot for shot in document.get('shots', [])
        if shot.get('imageNode') == node_id
        or (shot.get('pipeline') or {}).get('imageNodeId') == node_id
    ), None)


def _binding_rows(shot):
    bindings = shot.get('assetBindings') or {}
    rows = []
    for item in bindings.get('characters') or []:
        rows.append(('character', item))
    if bindings.get('scene'):
        rows.append(('scene', bindings['scene']))
    for item in bindings.get('props') or []:
        rows.append(('prop', item))
    return rows


def _constraint_lines(index, group, card, version):
    labels = {'character': '角色', 'scene': '场景', 'prop': '道具'}
    attributes = '；'.join(
        f"{str(item.get('name') or '').strip()}：{str(item.get('value') or '').strip()}"
        for item in version.get('spec', {}).get('attributes', [])
        if isinstance(item, dict) and item.get('name') and item.get('value')
    )
    invariants = '；'.join(str(item).strip() for item in version.get('invariants', []) if str(item).strip())
    lines = [
        f"图{index}｜{labels[group]}｜{card.get('name', card['id'])}",
        f"  可见规格：{str(version.get('spec', {}).get('description') or '').strip() or '按参考图'}",
    ]
    if attributes:
        lines.append(f"  固定属性：{attributes}")
    if invariants:
        lines.append(f"  不可改变：{invariants}")
    return lines


def compile_shot_image_input(
    document, node_id, kind, input_value, providers, capability_resolver=None,
):
    """Return a provider-ready input compiled only from shot.assetBindings.

    Each reference remains an independent asset in semantic order. The compiler
    never creates a composite reference board and never truncates references.
    """
    result = dict(input_value)
    if kind != 'image':
        return result
    shot = _shot_for_image_node(document, node_id)
    if not shot:
        return result
    rows = _binding_rows(shot)
    if not rows:
        return result
    result.pop('model_capabilities', None)
    result.pop('allow_reference_text_fallback', None)

    visual = ((document.get('filmBible') or {}).get('visual') or {})
    cards = visual.get('cards') or {}
    versions = visual.get('versions') or {}
    compiled = []
    constraint_lines = []
    for index, (group, binding) in enumerate(rows, 1):
        if not isinstance(binding, dict) or not binding.get('versionId'):
            raise ValueError('分镜视觉绑定缺少版本编号，请重新绑定资产')
        version_id = binding['versionId']
        version = versions.get(version_id)
        card = cards.get(version.get('cardId')) if isinstance(version, dict) else None
        if not version or not card:
            raise ValueError(f'分镜视觉绑定 {version_id} 已悬空，请重新绑定资产')
        if card.get('kind') not in GROUP_KINDS[group]:
            raise ValueError(f'分镜视觉绑定 {card.get("name", version_id)} 的资产类型不正确')
        if version.get('status') != 'locked':
            raise ValueError(f'高一致性生成要求先确认并锁定“{card.get("name", version_id)}”的主参考图')
        reference = _primary_reference(version)
        asset_id = reference.get('assetId') if reference else None
        if not asset_id:
            raise ValueError(f'高一致性生成缺少“{card.get("name", version_id)}”的主参考图')
        compiled.append({
            'group': group,
            'role': binding.get('role', ''),
            'cardId': card['id'],
            'versionId': version_id,
            'assetId': asset_id,
        })
        constraint_lines.extend(_constraint_lines(index, group, card, version))

    provider_id = str(result.get('provider') or '')
    provider = next((item for item in providers if item.get('id') == provider_id), None)
    if not provider:
        raise ValueError('分镜图片模型服务已不存在，无法应用视觉圣经参考图')
    model_id = str(
        result.get('model')
        or (provider.get('models') or {}).get('image')
        or provider.get('model')
        or ''
    )
    if not model_id:
        raise ValueError('请选择具体图片模型后再应用视觉圣经参考图')
    capabilities = (capability_resolver or resolve_image_model_capabilities)(provider, model_id)
    if not isinstance(capabilities, dict) or capabilities.get('image_reference') is not True:
        raise ValueError('所选图片模型未明确支持参考图；高一致性模式不会自动降级为纯文生图')
    maximum = capabilities.get('max_references')
    if isinstance(maximum, bool) or not isinstance(maximum, int) or maximum < 1:
        raise ValueError('所选图片模型未明确报告最大参考图数量，无法安全提交高一致性任务')
    if len(compiled) > maximum:
        raise ValueError(
            f'当前分镜绑定了 {len(compiled)} 张主参考图，但所选模型最多支持 {maximum} 张；'
            '请调整绑定或模型，系统不会截断参考图'
        )

    original_prompt = str(result.get('prompt') or '').strip()
    prompt_lines = [
        original_prompt,
        '',
        '[视觉圣经一致性约束]',
        '以下图号对应按角色、场景、道具顺序提交的独立参考图；不要把它们理解为拼贴画。',
        *constraint_lines,
        '必须保持上述身份、服装、场景结构和道具外观；只改变本镜头明确要求的动作、表情、构图和光线。',
    ]
    asset_ids = [item['assetId'] for item in compiled]
    result.update({
        'model': model_id,
        'prompt': '\n'.join(prompt_lines).strip(),
        'asset_ids': asset_ids,
        'image_reference_sources': [
            {'type': 'asset', 'asset_id': asset_id} for asset_id in asset_ids
        ],
        'reference_compiler': {
            'version': 1,
            'source': 'shot.assetBindings',
            'shotUid': str(shot.get('uid') or shot.get('id') or ''),
            'consistency': 'high',
            'providerId': provider_id,
            'modelId': model_id,
            'maximumReferences': maximum,
            'bindings': compiled,
        },
    })
    return result
