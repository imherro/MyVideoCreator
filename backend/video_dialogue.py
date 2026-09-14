"""Compile canonical storyboard dialogue into video-generation prompts."""
from __future__ import annotations


MARKER = '[对白与声音]'
TIMING_MARKER = '[固定对白音轨时序]'


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


def bind_fixed_dialogue_audio(document, node_id, kind, input_value, assets, production_context=None):
    """Freeze current locked-voice dialogue takes into a video job."""
    result = dict(input_value)
    if kind != 'video':
        return result
    if production_context is not None:
        from .production_context import compose_project_document
        document = compose_project_document(document, production_context)
    shot = _shot_for_video_node(document, node_id)
    if not shot:
        return result
    dialogues = [
        item for item in (shot.get('dialogues') or [])
        if isinstance(item, dict) and str(item.get('text') or '').strip()
    ]
    if not dialogues:
        result.pop('dialogue_audio_asset_ids', None)
        result.pop('dialogue_audio', None)
        return result
    profiles = (((document.get('filmBible') or {}).get('voices') or {}).get('profiles') or {})
    candidates = sorted(assets or [], key=lambda item: float(item.get('created') or 0), reverse=True)
    selected = []
    for dialogue in dialogues:
        card_id = str(dialogue.get('characterCardId') or '')
        profile = profiles.get(card_id) or {}
        if profile.get('status') != 'locked' or not str(profile.get('voiceType') or '').strip():
            name = str(dialogue.get('characterName') or '角色')
            raise ValueError(f'{name}尚未锁定固定音色，请先在塑角造景中设置并锁定')
        version = int(profile.get('version') or 1)
        match = next((asset for asset in candidates if (
            asset.get('kind') == 'audio'
            and ((asset.get('metadata') or {}).get('input') or {}).get('dialogue', {}).get('id') == dialogue.get('id')
            and int((((asset.get('metadata') or {}).get('input') or {}).get('dialogue', {}).get('voiceVersion') or 0)) == version
        )), None)
        if not match:
            name = str(dialogue.get('characterName') or '角色')
            raise ValueError(f'{name}的本镜对白尚未使用当前固定音色生成，请先生成本集对白')
        duration = float((match.get('metadata') or {}).get('duration') or 0)
        if duration <= 0:
            raise ValueError(f'对白音频“{match.get("name") or match.get("id")}”时长无效，请重新生成')
        selected.append((dialogue, profile, match, duration))
    shot_duration = float(shot.get('duration') or (result.get('parameters') or {}).get('duration') or 0)
    gaps = max(0, len(selected) - 1) * .12
    spoken_duration = sum(item[3] for item in selected) + gaps
    if shot_duration and spoken_duration > shot_duration + .08:
        raise ValueError(f'本镜固定对白共 {spoken_duration:.2f} 秒，超过镜头 {shot_duration:.2f} 秒，请缩短对白或延长镜头')
    cursor = min(.3, max(0, (shot_duration - spoken_duration) / 2)) if shot_duration else .3
    frozen = []
    timing_lines = []
    for dialogue, profile, asset, duration in selected:
        start = round(cursor, 3)
        end = round(cursor + duration, 3)
        frozen.append({
            'dialogueId': str(dialogue.get('id') or ''),
            'characterCardId': str(dialogue.get('characterCardId') or ''),
            'characterName': str(dialogue.get('characterName') or ''),
            'assetId': str(asset['id']),
            'voiceType': str(profile.get('voiceType') or ''),
            'voiceVersion': int(profile.get('version') or 1),
            'start': start,
            'duration': round(duration, 3),
        })
        timing_lines.append(f'{dialogue.get("characterName") or "角色"}从约 {start:.2f} 秒开口，到约 {end:.2f} 秒结束并自然闭嘴。')
        cursor = end + .12
    base = str(result.get('prompt') or '').split(TIMING_MARKER, 1)[0].rstrip()
    result['prompt'] = base + '\n\n' + TIMING_MARKER + '\n' + '\n'.join(timing_lines)
    result['dialogue_audio_asset_ids'] = [item['assetId'] for item in frozen]
    result['dialogue_audio'] = frozen
    result['parameters'] = {**(result.get('parameters') or {}), 'generate_audio': False}
    return result
