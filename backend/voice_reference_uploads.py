"""Local voice-reference admission; provider limits are checked at submission."""
import math
import subprocess
from pathlib import Path
from . import store as s
from .media import probe, ffmpeg_executable

MAX_BYTES = 30 * 1024**2
MAX_SECONDS = 120


def validate_file(path):
    path = Path(path)
    if path.suffix.lower() not in ('.mp3', '.wav') or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError('声音样本仅支持 MP3 / WAV，大小须在 0–30 MB 之间')
    with path.open('rb') as stream:
        header=stream.read(12)
    if path.suffix.lower()=='.wav':
        valid=header[:4] in (b'RIFF',b'RF64') and header[8:12]==b'WAVE'
    else:
        valid=header[:3]==b'ID3' or (len(header)>1 and header[0]==255 and header[1]&224==224)
    if not valid: raise ValueError('声音样本真实格式与扩展名不符')
    metadata = probe(path)
    duration = float(metadata.get('duration') or 0)
    if not metadata.get('has_audio') or metadata.get('video_codec') or not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
        raise ValueError('声音样本须为可播放的纯音频，系统上传上限为 120 秒；模型提交限制另行检查')
    result = subprocess.run([ffmpeg_executable(), '-v', 'error', '-xerror', '-i', str(path), '-map', '0:a:0', '-f', 'null', '-'], capture_output=True, timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('声音样本解码失败，请检查文件是否完整')
    return metadata


def validate_transition(c, pid, before, after):
    old = ((before.get('filmBible') or {}).get('voices') or {}).get('profiles') or {}
    new = ((after.get('filmBible') or {}).get('voices') or {}).get('profiles') or {}
    cards = ((after.get('filmBible') or {}).get('visual') or {}).get('cards') or {}
    for cid, profile in new.items():
        if profile == old.get(cid):
            continue
        source = profile.get('source') or {'type': 'doubao_tts'}
        previous=old.get(cid) or {}
        def config_identity(value):
            src=value.get('source') or {'type':'doubao_tts'}
            return (['uploaded',src.get('originalAssetId')] if src.get('type')=='uploaded'
                    else ['doubao_tts',value.get('providerId'),value.get('voiceType'),value.get('previewText'),value.get('parameters')])
        if profile.get('source') and previous and config_identity(previous)!=config_identity(profile) and profile.get('version',0)<=previous.get('version',0):
            raise ValueError('声音配置发生变化，必须建立新的声音修订')
        previous=old.get(cid) or {}
        history=dict(previous.get('lockedVersions') or {})
        if previous.get('status')=='locked': history[str(previous['version'])]=previous
        def identity(value):
            return {key:value.get(key) for key in ('source','providerId','voiceType','previewText','parameters','previewAssetId','referenceAssetId','referenceVersion','version')}
        if (cards.get(cid) or {}).get('kind')=='character_state' and profile.get('sourceVoiceVersion'):
            history={}  # State bindings pin the canonical character library; they do not own a second library.
        for version, frozen in history.items():
            if not frozen.get("source"): continue  # Old profiles keep their legacy compatibility rules.
            candidate=(profile.get('lockedVersions') or {}).get(version)
            if profile.get('status')=='locked' and str(profile.get('version'))==version: candidate=profile
            if candidate is None or identity(candidate)!=identity(frozen):
                raise ValueError('已锁定声音版本不可替换或删除，请创建新版本')
        if source.get('type') not in ('uploaded', 'doubao_tts'):
            raise ValueError('声音来源无效')
        if source.get('type') != 'uploaded':
            if profile.get('source') and (not profile.get('providerId') or not profile.get('voiceType') or not profile.get('previewText')):
                raise ValueError('豆包声音需要语音服务、音色 ID 和试听台词')
            if profile.get('source') and profile.get('status')=='locked' and identity(profile)!=identity(previous):
                aid=profile.get('referenceAssetId')
                row=c.execute('SELECT a.* FROM assets a JOIN projects p ON p.id=? WHERE a.id=? AND a.production_id=p.production_id',(pid,aid)).fetchone()
                if not row: raise ValueError('声音试听样本不存在或不可访问')
                if c.execute("SELECT 1 FROM deleted_items WHERE kind='asset' AND item_id=?",(aid,)).fetchone(): raise ValueError('声音试听样本已删除')
                path=(s.ASSETS/row['path']).resolve()
                if not path.is_relative_to(s.ASSETS.resolve()) or not path.is_file(): raise ValueError('声音试听样本文件已丢失')
                sample_media=validate_file(path)
                if not 2<=float(sample_media.get('duration') or 0)<=30:
                    raise ValueError(f'当前试听样本为 {float(sample_media.get("duration") or 0):.2f} 秒，不能锁定为视频声音参考；需 2–30 秒，请补充试听文本后重新生成')
                inp=s.unpack(row).get('metadata',{}).get('input',{})
                params=inp.get('parameters') or {}
                expected=profile.get('parameters') or {}
                if (profile.get('previewAssetId')!=aid or inp.get('voice_version')!=(profile.get('sourceVoiceVersion') or profile.get('version')) or
                    inp.get('provider')!=profile.get('providerId') or inp.get('voice_type')!=profile.get('voiceType') or
                    inp.get('prompt')!=profile.get('previewText') or params.get('speech_rate',0)!=expected.get('speechRate',0) or params.get('emotion','')!=expected.get('emotion','')):
                    raise ValueError('试听样本不对应当前声音设置，请重新生成试听')
            continue
        if cid not in cards:
            raise ValueError('声音所属角色不存在')
        aid = source.get('originalAssetId')
        row = c.execute('''SELECT a.* FROM assets a JOIN projects p ON p.id=?
            WHERE a.id=? AND a.production_id=p.production_id
            AND NOT EXISTS(SELECT 1 FROM deleted_items d WHERE d.kind='asset' AND d.item_id=a.id)''', (pid, aid)).fetchone()
        if not row:
            raise ValueError('声音素材不存在或不属于当前作品')
        asset = s.unpack(row)
        admission = asset.get('metadata', {}).get('voice_reference', {})
        if not admission.get('authorized_at') or source.get('authorizedAt') != admission['authorized_at']:
            raise ValueError('请先校验声音样本并确认使用权')
        if profile.get('previewAssetId') not in (None, aid):
            raise ValueError('声音试听与上传来源不一致')
        if profile.get('status') == 'locked':
            if profile.get('referenceAssetId') != aid or profile.get('referenceVersion') != profile.get('version'):
                raise ValueError('锁定声音样本与版本不一致')
            path = (s.ASSETS / asset['path']).resolve()
            if not path.is_relative_to(s.ASSETS.resolve()) or not path.is_file():
                raise ValueError('声音样本文件已丢失')
            from .motion_references import file_hash
            if file_hash(path)!=asset.get('metadata',{}).get('voice_reference_sha256'):
                raise ValueError('声音样本文件已变化，请重新上传')
        previous = old.get(cid) or {}
        if previous.get('status') == 'locked' and profile.get('version') == previous.get('version'):
            if profile.get('source') != previous.get('source') or profile.get('referenceAssetId') != previous.get('referenceAssetId'):
                raise ValueError('已锁定声音不可原地替换，请创建新声音版本')
