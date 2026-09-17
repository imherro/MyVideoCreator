"""Static composition images supplement (never replace) visual identity references."""

def composition_sources(document, node_id):
    ids = {e.get('source') for e in document.get('edges', []) if e.get('target') == node_id}
    return [n for n in document.get('nodes', []) if n.get('id') in ids
            and n.get('data', {}).get('referencePurpose') == 'composition']


def append_composition_input(document, node_id, result, maximum=None):
    sources = composition_sources(document, node_id)
    if not sources:
        return result
    assets = list(result.get('asset_ids') or [])
    snapshots = []
    lines = ['[构图参考]', '以下图片仅提供人物站位、空间布局和摄影机角度；角色身份、服装及场景细节以视觉资产参考为准。不要照搬白模、方块、网格或辅助线。']
    for node in sources:
        data = node['data']
        if data.get('stale') or not data.get('assetId'):
            raise ValueError('构图参考需要更新，请打开对应辅助节点并保存构图')
        aid = data['assetId']
        if aid not in assets:
            assets.append(aid)
        lines.append(f'图片{assets.index(aid)+1}：{data.get("label", "构图参考")}。{data.get("compositionDescription", "")}')
        snapshots.append({'nodeId': node['id'], 'assetId': aid, 'purpose': 'composition'})
    if maximum is not None and len(assets) > maximum:
        raise ValueError(f'视觉资产与构图参考共 {len(assets)} 张，超过模型支持的 {maximum} 张；请调整参考或模型，不会删除已选素材')
    return {**result, 'asset_ids': assets, 'image_reference_sources': [{'type': 'asset', 'asset_id': aid} for aid in assets],
            'composition_references': snapshots, 'prompt': str(result.get('prompt') or '') + '\n\n' + '\n'.join(lines)}
