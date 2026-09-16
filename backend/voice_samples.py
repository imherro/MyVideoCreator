"""Role timbre references: separate files, never timed or mixed as dialogue."""
from .voice_resolution import resolved_voice
import base64
import math

from . import store as s
from .media import probe
from .providers import common


def dialogue_mode(document, shot):
    mode = shot.get('dialogueMode') or document.get('dialogueMode') or 'full_dialogue'
    if mode not in ('voice_sample', 'full_dialogue'):
        raise ValueError('对白生成方式无效')
    return mode


def bind_voice_samples(document, shot, result, assets):
    profiles = ((document.get('filmBible') or {}).get('voices') or {}).get('profiles') or {}
    asset_map = {a['id']: a for a in assets or []}
    samples = []
    seen = set()
    for dialogue in shot.get('dialogues') or []:
        if not str(dialogue.get('text') or '').strip():
            continue
        card_id = str(dialogue.get('characterCardId') or '')
        if card_id in seen:
            continue
        name = str(dialogue.get('characterName') or '角色')
        voice_card, profile = resolved_voice(document, shot, dialogue)
        aid = profile.get('referenceAssetId')
        if (not card_id or profile.get('status') != 'locked' or not aid
                or profile.get('referenceVersion') != profile.get('version')):
            raise ValueError(f'{name}尚未确认当前版本的声音参考，请到塑角造景试听并锁定为角色声音参考')
        asset = asset_map.get(aid)
        if not asset or asset.get('kind') != 'audio':
            raise ValueError(f'{name}的声音参考已丢失或不可访问，请重新确认样本')
        # Keep a distinct mapping even when two roles intentionally share a file.
        samples.append({'characterCardId': card_id, 'characterName': name, 'assetId': aid,
                        'voiceCardId': voice_card, 'voiceVersion': profile['version'], 'voiceType': profile.get('voiceType', ''),
                        'purpose': 'timbre_only'})
        seen.add(card_id)
    result['voice_samples'] = samples
    result['dialogue_audio_mode'] = 'voice_sample'
    return result


def validate_samples(job, caps):
    """Verify actual media before queuing, freeze duration/hash without URLs."""
    from .motion_references import file_hash
    samples = job['input'].get('voice_samples') or []
    ids = list(dict.fromkeys(x['assetId'] for x in samples))
    limit = caps.get('max_audio', 0)
    if len(ids) > limit:
        raise ValueError(f'音色样本共 {len(ids)} 个，当前模型最多支持 {limit} 个；不会截断或混合样本')
    media = {}
    for asset in common.assets_by_ids(job, ids):
        path = (s.ASSETS / asset['path']).resolve()
        if asset.get('kind') != 'audio' or not path.is_relative_to(s.ASSETS.resolve()) or not path.is_file():
            raise ValueError('声音样本已丢失或不是音频')
        if path.suffix.lower() not in ('.mp3', '.wav') or path.stat().st_size > 15 * 1024**2:
            raise ValueError('声音样本需为不超过 15 MB 的 MP3 或 WAV')
        metadata = probe(path)
        duration = float(metadata.get('duration') or 0)
        if not metadata.get('has_audio') or metadata.get('video_codec') or not math.isfinite(duration) or not 2 <= duration <= caps['max_reference_duration']:
            raise ValueError(f"声音样本需为 2–{caps['max_reference_duration']} 秒的有效纯音频，请重新制作试听样本")
        media[asset['id']] = {'duration': duration, 'sha256': file_hash(path), 'name': asset['name']}
    if sum(x['duration'] for x in media.values()) > caps['max_reference_duration']:
        raise ValueError(f"声音样本总时长超过 {caps['max_reference_duration']} 秒，请缩短样本；不会自动裁剪")
    return [{**x, 'media': media[x['assetId']], 'index': ids.index(x['assetId']) + 1} for x in samples]


def submission_assets(job):
    from .motion_references import file_hash
    samples = job['input'].get('voice_samples') or []
    by_id = {x['assetId']: x for x in samples}
    assets = common.assets_by_ids(job, list(by_id))
    for asset in assets:
        path = (s.ASSETS / asset['path']).resolve()
        if not path.is_relative_to(s.ASSETS.resolve()) or file_hash(path) != by_id[asset['id']]['media']['sha256']:
            raise ValueError('声音样本在提交后发生变化，请重新提交')
    return assets


def sample_data_uri(asset):
    path = s.ASSETS / asset['path']
    mime = 'audio/wav' if path.suffix.lower() == '.wav' else 'audio/mpeg'
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')
