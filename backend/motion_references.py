"""Shot-owned motion references; immutable, ordered video submission contract.

No upload or paid inference happens during compilation/preview. URLs are resolved
only inside the provider's first submission branch, never while resuming a task.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from . import store as s
from .media import ffmpeg_executable, probe
from .providers import common
from .reference_compiler import _binding_rows, _primary_reference, _version_chain

VERSION = 'shot-motion-v1'
START, END = '[镜头动作参考]', '[/镜头动作参考]'
_CACHE_LOCK = threading.Lock()


def capability(provider, model):
    """Only enable protocols verified in the provider's own API documentation."""
    kind = (provider or {}).get('type')
    model = str(model or '').lower()
    if kind == 'volcengine_ark' and re.match(r'^doubao-seedance-2-(?:0|5)(?:-|$)', model):
        newer = model.startswith('doubao-seedance-2-5')
        return {'supported': True, 'max_images': 30 if newer else 9,
                'max_duration': 30 if newer else 15, 'max_reference_duration': 30 if newer else 15,
                'audio_only': newer, 'max_audio': 10 if newer else 3}
    if kind == 'hc_atom' and re.match(r'^(doubao|dreamina)-seedance-2\.(0|5)(?:-|$)', model):
        newer = '2.5' in model
        return {'supported': True, 'max_images': 30 if newer else 9,
                'max_duration': 30 if newer else 15, 'max_reference_duration': 30 if newer else 15,
                'audio_only': newer, 'max_audio': 10 if newer else 3}
    if kind == 'runninghub' and model in ('bytedance/seedance-2.5-token', 'bytedance/seedance-2.5-global-token'):
        return {'supported': True, 'max_images': 30, 'max_duration': 30, 'max_reference_duration': 30, 'audio_only': True, 'max_audio': 10}
    return {'supported': False, 'reason': '当前供应商/模型尚未核实多模态参考协议；请选择火山方舟或幻场 AI Seedance 2.0/2.5，或 RunningHub Seedance 2.5。绑定会保留。'}


def strip_motion_prompt(prompt):
    return re.sub(re.escape(START) + r'.*?' + re.escape(END), '', str(prompt or ''), flags=re.S).strip()


def file_hash(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def inspect_motion(asset, caps):
    path = (s.ASSETS / asset['path']).resolve()
    if not path.is_relative_to(s.ASSETS.resolve()) or not path.is_file():
        raise ValueError('动作参考视频文件不存在')
    if asset.get('kind') != 'video' or path.suffix.lower() != '.mp4':
        raise ValueError('本期动作参考仅接受 MP4 视频，请先在外部导出为 MP4')
    if path.stat().st_size > 200 * 1024**2:
        raise ValueError('动作参考视频不能超过 200 MB')
    with path.open('rb') as handle:
        header = handle.read(64)
    if b'ftyp' not in header:
        raise ValueError('动作参考不是真实 MP4 文件')
    metadata = probe(path)
    w, h, fps = metadata.get('width') or 0, metadata.get('height') or 0, metadata.get('fps') or 0
    duration = metadata.get('duration') or 0
    if not all(math.isfinite(float(x)) for x in (w, h, fps, duration)) or not w or not h:
        raise ValueError('动作参考缺少可读取的视频流')
    if not 2 <= duration <= caps['max_reference_duration']:
        raise ValueError(f"动作参考时长需为 2–{caps['max_reference_duration']} 秒，请在外部裁剪后上传")
    if not (300 <= w <= 6000 and 300 <= h <= 6000 and .4 <= w / h <= 2.5 and 407696 <= w * h <= 8295044):
        raise ValueError('动作参考尺寸不符合要求：边长 300–6000，宽高比 0.4–2.5，总像素 407696–8295044')
    if metadata.get('video_codec') not in ('h264', 'hevc'):
        raise ValueError('动作参考 MP4 需使用 H.264 或 H.265 编码，请在外部重新导出')
    if not 24 <= fps <= 60:
        raise ValueError('动作参考帧率需为 24–60 FPS')
    digest = file_hash(path)
    # Validate decodability once per immutable file, not on every preview.
    marker = s.ASSETS / ('.motion-validated-' + digest)
    if not marker.exists():
        checked = subprocess.run([ffmpeg_executable(), '-v', 'error', '-xerror', '-i', str(path),
                                  '-map', '0:v:0', '-an', '-f', 'null', '-'], capture_output=True,
                                 timeout=120, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if checked.returncode:
            raise ValueError('动作参考视频无法完整解码，请重新导出 MP4')
        marker.touch()
    return {**metadata, 'bytes': path.stat().st_size, 'sha256': digest}


def resolve_generation_mode(document, shot, input_value):
    requested = (shot or {}).get('videoReferenceMode') or document.get('videoReferenceMode') or 'legacy'
    if requested not in ('legacy', 'multimodal', 'first_frame', 'first_last_frame'):
        raise ValueError('视频生成模式无效')
    return {'requested': requested, 'actual': requested, 'source': 'shot' if (shot or {}).get('videoReferenceMode') else 'project'}


def compile_motion_input(document, node_id, kind, input_value, project_id, provider):
    if kind != 'video':
        return dict(input_value)
    shot = next((x for x in document.get('shots', [])
                 if (x.get('videoNode') or (x.get('pipeline') or {}).get('videoNodeId')) == node_id), None)
    result = dict(input_value)
    result['prompt'] = strip_motion_prompt(result.get('prompt'))
    # Browser/node snapshots cannot authorize a reference: the shot is canonical.
    for key in ('motion_reference', 'reference_manifest', 'motion_compiler', 'motion_warnings'):
        result.pop(key, None)
    reference = (shot or {}).get('motionReference')
    mode = resolve_generation_mode(document, shot, result)
    result['generation_mode'] = mode
    from .voice_samples import dialogue_mode, validate_samples
    samples_requested = dialogue_mode(document, shot or {}) == 'voice_sample' and any(str(x.get('text') or '').strip() for x in (shot or {}).get('dialogues', []))
    if samples_requested:
        if mode['requested'] != 'multimodal':
            raise ValueError('音色样本参考需要明确选择多模态参考生成；不会自动改变首帧约束')
        if not capability(provider, result.get('model') or (provider or {}).get('models', {}).get('video'))['supported']:
            raise ValueError('当前适配器尚未实现音色样本参考，请选择已支持的方舟、幻场 AI 或 RunningHub Seedance 模型')
        if not result.get('voice_samples'):
            raise ValueError('未编译角色声音参考，请先确认角色样本后重新提交')
    else:
        result.pop('voice_samples', None)
    if mode['requested'] in ('first_frame', 'first_last_frame'):
        nodes = {n['id']: n.get('data', {}) for n in document.get('nodes', [])}
        ids = list(nodes.get(node_id, {}).get('asset_ids', []))
        for edge in document.get('edges', []):
            data = nodes.get(edge.get('source'), {})
            if edge.get('target') == node_id and data.get('kind') == 'image' and data.get('assetId'):
                ids.append(data['assetId'])
        ids = list(dict.fromkeys([*ids, *result.get('asset_ids', [])]))
        result['asset_ids'] = ids
        result['image_reference_sources'] = [{'type': 'asset', 'asset_id': aid} for aid in ids]
        frame_ids = [*ids, *([result['end_asset_id']] if result.get('end_asset_id') else [])]
        frames = common.assets_by_ids({'project_id': project_id}, frame_ids)
        if any(a['kind'] != 'image' for a in frames):
            raise ValueError('首帧/尾帧只能使用图片')
        result['reference_manifest'] = [{'kind': 'image', 'index': i + 1, 'assetId': a['id'], 'name': a['name'],
                                         'purpose': '严格首帧' if i == 0 else '严格尾帧'} for i, a in enumerate(frames)]
    # Historical tasks and legacy projects keep their existing protocol semantics.
    if mode['requested'] == 'legacy' and not reference:
        mode['actual'] = 'multimodal' if result.get('dialogue_audio') else 'first_last_frame' if result.get('end_asset_id') else 'first_frame' if result.get('asset_ids') else 'text_to_video'
        return result
    if mode['requested'] != 'multimodal':
        if reference or result.get('dialogue_audio'):
            raise ValueError('首帧/首尾帧模式不能混入动作视频或对白音频；请确认切换为多模态，起止画面将变为参考语义')
        count = len(result.get('image_reference_sources', result.get('asset_ids', [])))
        if count != 1:
            raise ValueError('严格首帧模式必须且只能指定一张首帧，其他参考素材不会被自动删除')
        if bool(result.get('end_asset_id')) != (mode['requested'] == 'first_last_frame'):
            raise ValueError('首尾帧模式需要尾帧；单首帧模式不能混入尾帧，请调整模式或素材')
        allowed = set(result.get('asset_ids', [])) | {result.get('end_asset_id')}
        visual = (document.get('filmBible') or {}).get('visual') or {}
        for _, binding in _binding_rows(shot or {}):
            version = (visual.get('versions') or {}).get(binding.get('versionId')) or {}
            aid = (_primary_reference(version) or {}).get('assetId')
            if not aid or aid not in allowed:
                raise ValueError('严格首帧协议不能同时提交已绑定的角色、场景或道具参考；请改用多模态或明确调整绑定，不会静默丢弃素材')
        if (provider or {}).get('type') not in ('volcengine_ark', 'runninghub', 'hc_atom'):
            raise ValueError('当前适配器尚未核实所选严格首帧协议')
        if provider.get('type') == 'hc_atom' and mode['requested'] == 'first_last_frame':
            raise ValueError('幻场适配器尚未实现严格首尾帧协议')
        caps = capability(provider, result.get('model') or provider.get('models', {}).get('video'))
        if provider.get('type') in ('volcengine_ark', 'runninghub'):
            if not caps['supported']:
                raise ValueError('当前适配器尚未核实此模型的严格首帧协议')
            duration = max(4, math.ceil(float((result.get('parameters') or {}).get('duration') or (shot or {}).get('duration') or 5)))
            if duration > caps['max_duration']:
                raise ValueError('镜头时长超出当前模型上限，请调整后提交')
            from .video_dialogue import _apply_duration
            _apply_duration(result, duration, float((shot or {}).get('duration') or duration))
        return result
    caps = capability(provider, result.get('model') or ((provider or {}).get('models') or {}).get('video'))
    if not caps['supported']:
        raise ValueError(caps['reason'])
    if reference and (not isinstance(reference, dict) or not reference.get('assetId')):
        raise ValueError('动作参考绑定无效')
    if reference and provider.get('type') == 'volcengine_ark':
        base = ((provider.get('parameters') or {}).get('video') or {}).get('public_base_url') or provider.get('public_base_url') or s.get_setting('public_base_url', '')
        parsed = urlparse(str(base or ''))
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username:
            raise ValueError('火山方舟下载动作视频需要供应商设置中的公网访问地址；纯局域网可选择支持直接上传的 RunningHub')
    camera = (reference or {}).get('cameraMode')
    if reference and camera not in ('follow_reference', 'use_shot_camera'):
        raise ValueError('请选择动作参考的摄像机模式')
    job = {'project_id': project_id}
    asset = common.assets_by_ids(job, [reference['assetId']])[0] if reference else None
    metadata = inspect_motion(asset, caps) if reference else None
    shot = shot or {'duration': result.get('shot_duration') or (result.get('parameters') or {}).get('duration', 5)}
    nodes = {n['id']: n for n in document.get('nodes', [])}
    node = nodes.get(node_id, {}).get('data', {})
    ids = []
    manifest = []

    def image(aid, **labels):
        if not aid:
            return
        if aid not in ids:
            row = common.assets_by_ids(job, [aid])[0]
            if row['kind'] != 'image':
                raise ValueError('视觉参考必须是图像素材')
            ids.append(aid)
            manifest.append({'kind': 'image', 'index': len(ids), 'assetId': aid, 'name': row['name'], **labels})
        return ids.index(aid) + 1

    frame = nodes.get(shot.get('imageNode') or (shot.get('pipeline') or {}).get('imageNodeId'), {}).get('data', {})
    image(frame.get('assetId'), purpose='构图参考（非硬首帧）')
    image(node.get('end_asset_id') or result.get('end_asset_id'), purpose='结束构图参考（非硬尾帧）')
    for aid in dict.fromkeys([*node.get('asset_ids', []), *input_value.get('asset_ids', [])]):
        image(aid)
    for edge in document.get('edges', []):
        if edge.get('target') == node_id:
            parent = nodes.get(edge.get('source'), {}).get('data', {})
            if parent.get('kind') == 'image':
                image(parent.get('assetId'))
    visual = (document.get('filmBible') or {}).get('visual') or {}
    cards, versions = visual.get('cards') or {}, visual.get('versions') or {}
    actor_indices = {}
    image_lines = []
    for group, binding in _binding_rows(shot):
        version = versions.get(binding.get('versionId')) or {}
        card = cards.get(version.get('cardId')) or {}
        if not card or card.get('deletedAt') or version.get('status') not in ('locked', 'deprecated'):
            raise ValueError('动作参考镜头绑定的视觉资产须先确认主参考图')
        chain = _version_chain(visual, version)
        aid = (_primary_reference(version) or {}).get('assetId')
        if not aid:
            raise ValueError('视觉绑定缺少主参考图')
        index = image(aid, cardId=card['id'], versionId=version['id'], purpose=group)
        image_lines.append(f"@图片{index}：{card.get('name', card['id'])}的外观、服装及状态参考。")
        if group == 'character':
            for linked_card, _ in chain:
                actor_indices[linked_card['id']] = index
    character = (reference or {}).get('characterCardId')
    if character and character not in actor_indices:
        raise ValueError('动作执行角色必须是本镜头已绑定的角色或其基础角色')
    if len(ids) > caps['max_images']:
        raise ValueError(f"完整参考图共 {len(ids)} 张，超出模型上限 {caps['max_images']}，不会截断提交")
    duration = max(4, math.ceil(float((result.get('parameters') or {}).get('duration') or shot.get('duration') or 0)))
    if duration > caps['max_duration']:
        raise ValueError(f"对白及项目策略要求 {duration} 秒，超出当前模型 {caps['max_duration']} 秒，请先调整镜头")
    from .video_dialogue import _apply_duration, TIMING_MARKER
    timing = result['prompt'].split(TIMING_MARKER, 1)
    _apply_duration(result, duration, float(shot.get('duration') or 0))
    if len(timing) == 2:
        result['prompt'] += '\n\n' + TIMING_MARKER + timing[1]
    if asset:
        manifest.append({'kind': 'video', 'index': 1, 'assetId': asset['id'], 'name': asset['name'],
                         'duration': metadata['duration'], 'audio': 'stripped'})
    if result.get('dialogue_audio'):
        manifest.append({'kind': 'audio', 'index': 1, 'assetIds': result.get('dialogue_audio_asset_ids', []),
                         'name': '固定音色对白时序合成', 'duration': duration})
    if result.get('voice_samples'):
        if result.get('dialogue_audio'):
            raise ValueError('音色样本与完整对白不能同时作为同一镜头的对白方式')
        result['voice_samples'] = validate_samples({'project_id': project_id, 'input': result}, caps)
        for sample in result['voice_samples']:
            if not any(x['kind'] == 'audio' and x.get('assetId') == sample['assetId'] for x in manifest):
                manifest.append({'kind': 'audio', 'index': sample['index'], 'assetId': sample['assetId'],
                                 'name': sample['media']['name'], 'purpose': '仅参考音色，不复述样本',
                                 'duration': sample['media']['duration']})
    audio_reference = bool(result.get('dialogue_audio') or result.get('voice_samples'))
    if not ids and not asset and not audio_reference:
        raise ValueError('多模态参考模式至少需要一项图片、视频或音频参考')
    if not ids and not asset and audio_reference and not caps['audio_only']:
        raise ValueError('当前模型不支持仅音频参考，请同时提供图片或动作视频')
    lines = [START, '生成模式：多模态参考。所有图片均为参考语义，不是严格首帧或尾帧约束。', *image_lines]
    for item in manifest:
        if item.get('purpose') == '构图参考（非硬首帧）':
            lines.append(f"@图片{item['index']}作为起始构图参考，外观以角色和场景参考为准。")
        if item.get('purpose') == '结束构图参考（非硬尾帧）':
            lines.append(f"@图片{item['index']}作为结束构图参考，不是严格尾帧约束。")
    warnings, frozen = [], None
    if reference:
        actor = f"@图片{actor_indices[character]}中的角色" if character else '本镜头中符合动作描述的主体'
        lines.append(f'{actor}参考@视频1的动作顺序、姿态、移动路径及节奏；不复制参考视频中的人物外观、服装、场景或声音。')
        lines.append('摄像机以@视频1的机位、运动及节奏为准，覆盖镜头文字中冲突的运镜要求。'
                     if camera == 'follow_reference' else f"仅参考@视频1的主体动作，不复制其运镜。摄像机以本镜头为准：{shot.get('camera') or '保持本镜头提示词中的机位要求'}。")
        lines.extend([str(reference.get('description') or '').strip(), '动作参考不是逐帧锁定，不得改变本镜对白文字和音色。'])
        if abs(metadata['duration'] - duration) > max(.1, 2 / metadata['fps']):
            warnings.append(f"动作参考 {metadata['duration']:.2f} 秒，实际提交 {duration} 秒；未裁剪、变速或强制改变对白，请在外部调整素材以改善节奏匹配。")
        frozen = {**{k: reference[k] for k in ('assetId', 'characterCardId', 'cameraMode', 'description') if k in reference},
                  'media': metadata, 'silent_derivative': VERSION}
    if result.get('dialogue_audio'):
        lines.append('严格使用@音频1的音色、情绪、语速及开口时序表演对白并匹配口型，不得改词或增加对白。')
    for sample in result.get('voice_samples') or []:
        visual_role = f"（@图片{actor_indices[sample['characterCardId']]}中的角色）" if sample['characterCardId'] in actor_indices else ''
        lines.append(f"{sample['characterName']}{visual_role}仅参考@音频{sample['index']}的音色与声线。不要复述、混入或播放样本台词，不沿用样本情绪、语调或说话时长。")
    if result.get('voice_samples'):
        lines.append('对白内容、情绪、语速和开口时机以本镜分镜及台词为准；不要串用其他角色的声音，未分配台词的角色不说话。')
    lines.append(END)
    result.update(prompt=result['prompt'].rstrip() + '\n\n' + '\n'.join(filter(None, lines)),
                  asset_ids=ids, image_reference_sources=[{'type': 'asset', 'asset_id': aid} for aid in ids],
                  motion_reference=frozen, reference_manifest=manifest, motion_warnings=warnings,
                  motion_compiler={'version': VERSION, 'mode': 'multimodal',
                                   'fingerprint': hashlib.sha256(s.dumps([mode, frozen, manifest, result.get('dialogue_mode'), result.get('voice_samples')]).encode()).hexdigest()},
                  generation_revision=node.get('generation_revision', 0))
    # Explicit multimodal choice changes the protocol role, never drops the image.
    result.pop('end_asset_id', None)
    return result


def silent_motion_asset(job):
    """Cache a silent stream-copy derivative, keeping the source and its timing."""
    frozen = job['input']['motion_reference']
    source = common.assets_by_ids(job, [frozen['assetId']])[0]
    path = s.ASSETS / source['path']
    digest = file_hash(path)
    if digest != frozen['media']['sha256']:
        raise ValueError('动作参考文件在提交后发生变化，请重新提交')
    if not frozen['media']['has_audio']:
        return source
    aid = 'motion-silent-' + hashlib.sha256((source['id'] + digest + VERSION).encode()).hexdigest()[:40]
    output = s.ASSETS / (aid + '.mp4')
    with _CACHE_LOCK:
        with s.db() as c:
            existing = c.execute('SELECT * FROM assets WHERE id=?', (aid,)).fetchone()
        if existing and output.exists():
            return s.unpack(existing)
        temp = output.with_suffix('.partial.mp4')
        try:
            run = subprocess.run([ffmpeg_executable(), '-v', 'error', '-y', '-i', str(path),
                                  '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', str(temp)],
                                 capture_output=True, timeout=120, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if run.returncode:
                raise ValueError('无法为动作参考生成静音副本')
            metadata = probe(temp)
            if metadata.get('has_audio') or abs(metadata['duration'] - frozen['media']['duration']) > max(.1, 2 / frozen['media']['fps']):
                raise ValueError('静音副本校验失败，未提交模型任务')
            temp.replace(output)
            metadata.update(motionDerivedFrom=source['id'], sourceSha256=digest, derivativeVersion=VERSION)
            with s.db() as c:
                c.execute('INSERT OR REPLACE INTO assets(id,project_id,production_id,name,kind,path,mime,metadata,created,category,source) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                          (aid, source['project_id'], source.get('production_id'), '动作参考·静音·' + source['name'], 'video', output.name,
                           'video/mp4', s.dumps(metadata), time.time(), 'other', 'derived'))
                return s.unpack(c.execute('SELECT * FROM assets WHERE id=?', (aid,)).fetchone())
        finally:
            temp.unlink(missing_ok=True)


def invalidate_motion_changes(previous, incoming):
    """Enforce revisions also for non-UI saves and in-flight reference edits."""
    old_shots = {x.get('uid') or x.get('id'): x for x in previous.get('shots', [])}
    affected = set()
    if previous.get('videoReferenceMode', 'legacy') != incoming.get('videoReferenceMode', 'legacy'):
        overridden = {(x.get('videoNode') or (x.get('pipeline') or {}).get('videoNodeId'))
                      for x in incoming.get('shots', []) if x.get('videoReferenceMode')}
        affected.update(n['id'] for n in incoming.get('nodes', [])
                        if n.get('data', {}).get('kind') == 'video' and n['id'] not in overridden)
    for shot in incoming.get('shots', []):
        if (shot.get('uid') or shot.get('id')) not in old_shots and not shot.get('videoReferenceMode') and incoming.get('videoReferenceMode', 'legacy') == 'legacy':
            shot['videoReferenceMode'] = 'multimodal'
        old = old_shots.get(shot.get('uid') or shot.get('id'), {})
        from .voice_resolution import resolved_voice
        def signatures(doc, item):
            keys = ('status', 'version', 'voiceType', 'providerId', 'referenceAssetId', 'referenceVersion')
            result = []
            for d in item.get('dialogues', []):
                cid, profile = resolved_voice(doc, item, d)
                result.append((cid, {k: profile.get(k) for k in keys}))
            return result
        resolved_voice_changed = signatures(previous, old) != signatures(incoming, shot)

        if (resolved_voice_changed or any(old.get(key) != shot.get(key) for key in ('motionReference', 'videoReferenceMode', 'dialogueMode'))
                or (not shot.get('videoReferenceMode') and previous.get('videoReferenceMode') != incoming.get('videoReferenceMode'))
                or (not shot.get('dialogueMode') and previous.get('dialogueMode', 'full_dialogue') != incoming.get('dialogueMode', 'full_dialogue'))):
            affected.add(shot.get('videoNode') or (shot.get('pipeline') or {}).get('videoNodeId'))
    pending = list(affected)
    while pending:
        node_id = pending.pop()
        for edge in incoming.get('edges', []):
            if edge.get('source') == node_id and edge.get('target') not in affected:
                affected.add(edge['target']); pending.append(edge['target'])
    old_nodes = {n['id']: n.get('data', {}) for n in previous.get('nodes', [])}
    nodes = []
    for node in incoming.get('nodes', []):
        if node['id'] in affected:
            data, old = node.get('data', {}), old_nodes.get(node['id'], {})
            node = {**node, 'data': {**data,
                    'generation_revision': max(int(data.get('generation_revision') or 0), int(old.get('generation_revision') or 0) + 1),
                    'stale': bool(data.get('assetId') or data.get('resultJob') or data.get('text'))}}
        nodes.append(node)
    return {**incoming, 'nodes': nodes}
