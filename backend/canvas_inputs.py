"""Freeze connected script output for single-node storyboard submission."""

def compile_storyboard_script_input(document, node_id, kind, data, active_node_ids=()):
    if kind != 'storyboard':
        return data
    source_ids = {edge.get('source') for edge in document.get('edges', []) if edge.get('target') == node_id}
    sources = [node for node in document.get('nodes', [])
               if node.get('id') in source_ids and node.get('data', {}).get('kind') == 'text']
    if not sources:
        return data
    snapshots = []
    for node in sources:
        value = node['data']
        if node['id'] in active_node_ids:
            raise ValueError('上游剧本正在生成，请等待完成')
        text = str(value.get('text') or '').strip()
        if not text:
            raise ValueError('已连接的剧本还没有正文，请先编写或生成剧本')
        if value.get('stale') or value.get('scriptStatus') == 'stale':
            raise ValueError('上游剧本需要更新，请先确认或更新正文')
        snapshots.append({'nodeId': node['id'], 'label': value.get('label', '剧本'), 'text': text,
                          'resultJob': value.get('resultJob'), 'scriptRevision': value.get('scriptRevision')})
    instruction = str(data.get('prompt') or '').strip()
    # The older shortcut copied the whole script into the description.
    if not instruction or instruction in [item['text'] for item in snapshots]:
        instruction = '将以下已完成的剧本拆解为结构化分镜，保留剧情、人物和对白。'
    prompt = instruction + '\n\n上游剧本正文：\n' + '\n\n'.join(
        f'【{item["label"]}】\n{item["text"]}' for item in snapshots)
    return {**data, 'prompt': prompt, 'canvas_script_sources': snapshots,
            'canvas_script_instruction': str(data.get('prompt') or '')}
