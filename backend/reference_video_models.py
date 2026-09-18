"""Verified Wan 3 / H3 reference protocols. No implicit frame-mode fallback."""
import math
import re

MODELS = {
    'hc_atom': {'wan3.0-video': 'wan', 'MiniMax-H3': 'h3'},
    'runninghub': {'alibaba/wan-3.0': 'wan', 'minimax/hailuo-h3': 'h3'},
}


def family(provider, model):
    return MODELS.get((provider or {}).get('type'), {}).get(str(model or ''))


def caps(provider, model):
    kind = family(provider, model)
    if not kind:
        return None
    return {'supported': True, 'max_images': 10 if kind == 'wan' else 9,
            'min_duration': 2 if kind == 'wan' else 5,
            'max_duration': 30 if kind == 'wan' else 15,
            'max_reference_duration': 15, 'max_audio': 5 if kind == 'wan' else 3,
            'audio_only': False, 'strict_frames': False}


def validate(provider, inp, image_count=None):
    kind = family(provider, inp.get('model'))
    if not kind:
        raise ValueError('未识别的参考视频模型')
    limits = caps(provider, inp['model'])
    if (inp.get('generation_mode') or {}).get('requested') != 'multimodal' or inp.get('end_asset_id'):
        raise ValueError('Wan 3.0 / H3 当前适配器仅实现多模态参考模式，请明确选择该模式；不会自动改成首帧')
    params = {**((provider.get('parameters') or {}).get('video') or {}), **(inp.get('parameters') or {})}
    if int(params.get('seed', -1)) != -1:
        raise ValueError('当前 Wan 3.0 / H3 适配器暂未实现指定随机种子，请使用随机种子 -1')
    if kind == 'h3' and not bool(params.get('generate_audio', params.get('generateAudio', True))):
        raise ValueError('当前 H3 接口未提供关闭原生音轨的选项，请启用生成声音')
    duration = float(params.get('duration') or inp.get('duration') or 5)
    if not math.isfinite(duration) or duration != int(duration) or not limits['min_duration'] <= duration <= limits['max_duration']:
        raise ValueError(f"当前模型支持 {limits['min_duration']}–{limits['max_duration']} 秒整数时长，请修改镜头时长；本适配器暂不支持自动时长")
    resolution = str(params.get('resolution') or '720p').upper()
    allowed = ('480P','720P','1080P') if kind == 'wan' else (('2K',) if provider['type']=='runninghub' else ('768P','2K'))
    if resolution not in allowed:
        raise ValueError('当前模型视频分辨率支持 ' + ' / '.join(allowed) + '，请修改项目视频输出分辨率')
    ratio = str(inp.get('ratio') or params.get('ratio') or '16:9')
    if ratio not in ('adaptive','16:9','4:3','1:1','3:4','9:16') + (('21:9',) if kind=='h3' else ()):
        raise ValueError('当前模型不支持所选视频宽高比，请调整项目设置')
    if str(params.get('outputFormat') or params.get('output_format') or 'mp4').lower() != 'mp4':
        raise ValueError('当前 Wan 3.0 / H3 适配器仅实现 MP4 输出，请修改项目视频格式')
    images = len(inp.get('asset_ids') or []) if image_count is None else image_count
    audio_ids = {x['assetId'] for x in inp.get('voice_samples', [])}
    audio_count = len(audio_ids) + bool(inp.get('dialogue_audio'))
    motion = inp.get('motion_reference')
    if images > limits['max_images'] or audio_count > limits['max_audio'] or images + audio_count + bool(motion) > (20 if kind=='wan' else 12):
        raise ValueError('参考素材数量超出当前模型限制；不会删除或截断素材')
    if not images and not motion:
        raise ValueError('当前参考适配器需要至少一张图片或一段动作视频')
    audio_seconds = sum(float(x.get('media',{}).get('duration') or 0) for i,x in enumerate(inp.get('voice_samples', [])) if x['assetId'] not in {y['assetId'] for y in inp.get('voice_samples', [])[:i]})
    if audio_seconds > 15 or (inp.get('dialogue_audio') and duration > 15):
        raise ValueError('当前模型参考音频总时长不能超过 15 秒')
    video_seconds = float((motion or {}).get('media',{}).get('duration') or 0)
    if video_seconds > 15 or (kind=='wan' and video_seconds + duration > 30):
        raise ValueError('动作参考最长 15 秒；Wan 3.0 参考视频与输出视频合计不能超过 30 秒')
    return {'duration':int(duration),'resolution':resolution,'ratio':ratio,
            'audio':bool(params.get('generate_audio',params.get('generateAudio',True))),
            'watermark':bool(params.get('watermark',False))}


def prompt_for(provider, inp):
    prompt = str(inp.get('prompt') or '')
    # Keep reference numbering identical to the ordered submission manifest.
    if family(provider, inp.get('model')) == 'wan':
        prompt = re.sub(r'@图片(\d+)', r'图\1', prompt)
        prompt = re.sub(r'@(视频|音频)(\d+)', r'\1\2', prompt)
    return prompt
