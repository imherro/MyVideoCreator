"""Explicit node video ratio, shared by preview, single and batch submission."""
RATIOS = ('21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive')


def compile_video_ratio(document, node_id, result, provider, mode):
    node = next((n.get('data', {}) for n in document.get('nodes', []) if n['id'] == node_id), {})
    override = node.get('videoRatio')
    requested = override or document.get('videoRatio') or document.get('ratio') or '16:9'
    if requested not in RATIOS:
        raise ValueError('视频画幅无效，请重新选择本节点或项目的视频比例')
    strict = mode.get('actual') in ('first_frame', 'first_last_frame')
    from .reference_video_models import family
    kind = family(provider, result.get('model'))
    from .motion_references import capability
    supported = capability(provider, result.get('model') or (provider or {}).get('models', {}).get('video')).get('supported')
    if override and not strict and not supported:
        raise ValueError('当前模型适配器尚未支持单镜视频画幅设置，请使用继承项目或已支持的多模态模型')
    if kind == 'wan' and requested == '21:9':
        raise ValueError('当前 Wan 模型不支持 21:9，请调整本镜视频画幅')
    actual = 'adaptive' if strict else requested
    result['ratio'] = actual
    result['parameters'] = {**(result.get('parameters') or {}), 'ratio': actual}
    result['video_ratio_selection'] = {'requested': requested, 'source': 'node' if override else 'project',
                                       'actual': 'first_frame' if strict else actual}
    return result
