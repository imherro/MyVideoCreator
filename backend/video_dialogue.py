"""Compile canonical storyboard dialogue into video-generation prompts."""
from __future__ import annotations


MARKER = '[对白与声音]'


def _shot_for_video_node(document, node_id):
    return next((
        shot for shot in document.get('shots', [])
        if shot.get('videoNode') == node_id
        or (shot.get('pipeline') or {}).get('videoNodeId') == node_id
    ), None)


def compile_video_prompt(base_prompt, shot):
    """Append exact structured dialogue without duplicating an older projection."""
    base = str(base_prompt or '').split(MARKER, 1)[0].rstrip()
    dialogues = [
        item for item in (shot.get('dialogues') or [])
        if isinstance(item, dict) and str(item.get('text') or '').strip()
    ]
    if not dialogues:
        return base
    if all(str(item.get('text') or '').strip() in base for item in dialogues):
        return base
    lines = [
        base,
        '',
        MARKER,
        '以下台词必须按原文说出，人物口型、开口时机和情绪与台词同步；不得改词、漏词或增加额外对白。',
    ]
    for index, dialogue in enumerate(dialogues, 1):
        name = str(dialogue.get('characterName') or f'角色{index}').strip()
        emotion = str(dialogue.get('emotion') or '').strip()
        text = str(dialogue.get('text') or '').strip().replace('“', '「').replace('”', '」')
        qualifier = f'（{emotion}）' if emotion else ''
        lines.append(f'{index}. {name}{qualifier}说：“{text}”')
    lines.append('没有台词的角色保持闭嘴；保留分镜要求的环境声和动作声，不生成字幕。')
    return '\n'.join(lines).strip()


def compile_shot_video_input(document, node_id, kind, input_value, production_context=None):
    """Project the shot's dialogue into every video submission, including old nodes."""
    result = dict(input_value)
    if kind != 'video':
        return result
    if production_context is not None:
        from .production_context import compose_project_document
        document = compose_project_document(document, production_context)
    shot = _shot_for_video_node(document, node_id)
    if not shot:
        return result
    result['prompt'] = compile_video_prompt(
        result.get('prompt') or shot.get('video_prompt'), shot,
    )
    dialogues = [item for item in (shot.get('dialogues') or []) if isinstance(item, dict) and str(item.get('text') or '').strip()]
    if dialogues:
        result['dialogue_projection'] = {
            'version': 'shot-dialogue/v1',
            'shotUid': str(shot.get('uid') or shot.get('id') or ''),
            'dialogues': [
                {
                    'id': str(item.get('id') or ''),
                    'characterCardId': str(item.get('characterCardId') or ''),
                    'characterName': str(item.get('characterName') or ''),
                    'emotion': str(item.get('emotion') or ''),
                    'text': str(item.get('text') or ''),
                }
                for item in dialogues
            ],
        }
    else:
        result.pop('dialogue_projection', None)
    return result
