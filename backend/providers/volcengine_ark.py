"""Volcengine Ark adapters for Seedream images and Seedance video tasks."""
import base64
from urllib.parse import quote

import httpx
from PIL import Image

from .. import store as s
from . import common


DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
SUPPORTED_REFERENCE_FORMATS = {'JPEG': 'image/jpeg', 'PNG': 'image/png'}
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_REFERENCE_DIMENSION = 6000


def model_for(provider, kind):
    kind = 'text' if kind == 'storyboard' else kind
    return str(provider.get('models', {}).get(kind) or provider.get('model') or '').strip()


def _headers(provider):
    key = str(provider.get('api_key') or '').strip()
    if not key:
        raise ValueError('火山方舟尚未配置 ARK API Key')
    return {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}


def _root(provider):
    return str(provider.get('url') or DEFAULT_BASE_URL).rstrip('/')


def max_image_references(provider):
    parameters = provider.get('parameters') if isinstance(provider.get('parameters'), dict) else {}
    image = parameters.get('image') if isinstance(parameters.get('image'), dict) else {}
    value = image.get('max_references', 10)
    try:
        return max(1, min(int(value), 10))
    except (TypeError, ValueError):
        raise ValueError('火山方舟参考图上限必须是 1–10 的整数')


def load_image_asset(asset):
    """Load and decode an internal image without applying model-specific limits."""
    if asset.get('kind') != 'image':
        raise ValueError('火山方舟参考素材必须是图片')
    path = (s.ASSETS / str(asset.get('path') or '')).resolve()
    if not path.is_relative_to(s.ASSETS) or not path.is_file():
        raise ValueError('火山方舟参考图文件已丢失')
    try:
        with Image.open(path) as image:
            mime = SUPPORTED_REFERENCE_FORMATS.get(image.format or '')
            width, height = image.size
            image.verify()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ValueError('火山方舟无法读取参考图，请重新上传 PNG 或 JPEG') from exc
    if not mime:
        raise ValueError('火山方舟参考图仅支持 PNG 或 JPEG')
    return {'path':path,'size':path.stat().st_size,'mime':mime,'width':width,'height':height}


def resolve_image_reference(asset):
    """Resolve an internal asset to the data URI accepted by Seedream."""
    loaded=load_image_asset(asset)
    if loaded['size'] > MAX_REFERENCE_BYTES:
        raise ValueError('火山方舟单张参考图不能超过 10MB')
    width,height=loaded['width'],loaded['height']
    if width <= 14 or height <= 14 or not 1 / 3 <= width / height <= 3:
        raise ValueError('火山方舟参考图尺寸或宽高比不符合要求（边长需大于 14，宽高比 1:3–3:1）')
    if width > MAX_REFERENCE_DIMENSION or height > MAX_REFERENCE_DIMENSION:
        raise ValueError('火山方舟参考图长边不能超过 6000 像素')
    return f'data:{loaded["mime"]};base64,' + base64.b64encode(loaded['path'].read_bytes()).decode('ascii')


def seedance_frame(asset):
    """Validate and resolve one local still for a Seedance frame role."""
    loaded=load_image_asset(asset)
    if loaded['size'] > MAX_REFERENCE_BYTES:
        raise ValueError('火山方舟视频首帧不能超过 10MB')
    width,height=loaded['width'],loaded['height']
    if width <= 14 or height <= 14 or not 1 / 3 <= width / height <= 3:
        raise ValueError('火山方舟视频首帧尺寸或宽高比不符合要求（边长需大于 14，宽高比 1:3–3:1）')
    if width > MAX_REFERENCE_DIMENSION or height > MAX_REFERENCE_DIMENSION:
        raise ValueError('火山方舟视频首帧长边不能超过 6000 像素')
    return {
        'url':f'data:{loaded["mime"]};base64,' + base64.b64encode(loaded['path'].read_bytes()).decode('ascii'),
        'width':width,
        'height':height,
    }


def resolve_seedance_frame(asset):
    return seedance_frame(asset)['url']


def _image_result(worker, job, value):
    outputs = []
    for item in value.get('data', []):
        if worker.cancelled(job):
            raise InterruptedError()
        if item.get('url'):
            outputs.append(common.download_result(job, item['url'], '.png'))
        elif item.get('b64_json'):
            path = s.DATA / (s.uid('ark-image-') + '.png')
            try:
                path.write_bytes(base64.b64decode(item['b64_json']))
                outputs.append(common.register(job, path, 'Seedream 生成图.png'))
            finally:
                path.unlink(missing_ok=True)
    if not outputs:
        raise ValueError('火山方舟未返回可下载的图像')
    return {'assets': outputs}


def generate_image(worker, job, provider):
    assets = common.assets_for(job)
    limit = max_image_references(provider)
    if len(assets) > limit:
        raise ValueError(f'当前火山方舟图片模型最多支持 {limit} 张参考图，请移除多余引用')
    model = model_for(provider, 'image')
    if not model:
        raise ValueError('请填写火山方舟图片模型 ID')
    params = {**provider.get('parameters', {}).get('image', {}), **job['input'].get('parameters', {})}
    body = {
        'model': job['input'].get('model') or model,
        'prompt': job['input']['prompt'],
        'size': params.get('size') or '2K',
        'response_format': 'url',
        'watermark': bool(params.get('watermark', False)),
    }
    if assets:
        references = [resolve_image_reference(asset) for asset in assets]
        body['image'] = references[0] if len(references) == 1 else references
    worker.progress(job, '火山方舟生成图像')
    with httpx.Client(timeout=600, headers=_headers(provider), trust_env=True) as client:
        return _image_result(worker, job, common.checked(client.post(_root(provider) + '/images/generations', json=body)))


def _video_url(value):
    content = value.get('content') or value.get('result') or {}
    if isinstance(content, dict):
        return content.get('video_url') or content.get('url')
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and (item.get('video_url') or item.get('url')):
                return item.get('video_url') or item.get('url')
    return value.get('video_url') or value.get('output_url')


def generate_video(worker, job, provider):
    if len(job['input'].get('asset_ids',[]))>1:
        raise ValueError('当前火山方舟视频最多接受一张首帧，请移除多余引用')
    if job['input'].get('end_asset_id') and len(job['input'].get('asset_ids',[]))!=1:
        raise ValueError('使用火山方舟尾帧时必须同时指定一张首帧')
    model = model_for(provider, 'video')
    if not model:
        raise ValueError('请填写火山方舟视频模型 ID')
    root = _root(provider)
    remote = job.get('provider_job_id')
    params = {**provider.get('parameters', {}).get('video', {}), **job['input'].get('parameters', {})}
    with httpx.Client(timeout=120, headers=_headers(provider), trust_env=True) as client:
        if not remote:
            assets=common.assets_for(job)
            content=[{'type': 'text', 'text': job['input']['prompt']}]
            if assets:
                first=seedance_frame(assets[0])
                content.append({
                    'type':'image_url',
                    'image_url':{'url':first['url']},
                    'role':'first_frame',
                })
                if job['input'].get('end_asset_id'):
                    tail=common.assets_for({**job,'input':{'asset_ids':[job['input']['end_asset_id']]}})[0]
                    last=seedance_frame(tail)
                    if first['width']*last['height']!=last['width']*first['height']:
                        raise ValueError('火山方舟首帧与尾帧的宽高比必须一致')
                    content.append({
                        'type':'image_url',
                        'image_url':{'url':last['url']},
                        'role':'last_frame',
                    })
            body = {
                'model': job['input'].get('model') or model,
                'content': content,
                'duration': int(params.get('duration', 5)),
                'resolution': str(params.get('resolution', '720p')),
                'ratio': str(job['input'].get('ratio') or params.get('ratio') or '16:9'),
                'generate_audio': bool(params.get('generate_audio', True)),
            }
            if worker.cancelled(job):
                raise InterruptedError()
            value = common.checked(client.post(root + '/contents/generations/tasks', json=body))
            remote = value.get('id') or value.get('task_id')
            if not remote:
                raise ValueError('火山方舟未返回 task id，请在控制台核对任务后再提交')
            remote = str(remote)
            # Persist before the first poll so a process restart resumes this task.
            state=s.attach_provider_job_id(job['id'],remote)
            if state=='cancelled':
                try:
                    response=client.delete(root + '/contents/generations/tasks/' + quote(remote, safe=''))
                    phase=('已取消本地等待，并已请求供应商取消远端任务' if response.is_success
                           else '本地已取消；供应商可能继续生成并产生费用')
                except httpx.HTTPError:
                    phase='本地已取消；供应商可能继续生成并产生费用'
                s.cancelled_phase(job['id'],phase)
                raise InterruptedError()
        interval = max(1, min(int(params.get('poll_interval', 5)), 60))
        while not worker.halt.wait(interval):
            if worker.cancelled(job):
                raise InterruptedError()
            value = common.checked(client.get(root + '/contents/generations/tasks/' + quote(remote, safe='')),recoverable=True)
            status = str(value.get('status') or '').lower()
            if status not in ('queued', 'pending', 'running', 'processing', 'succeeded', 'success', 'failed', 'cancelled', 'canceled', 'expired'):
                raise ValueError('火山方舟返回未知任务状态，请保留任务编号核对：' + str(value.get('status')))
            worker.progress(job, {
                'queued': '火山方舟排队中', 'pending': '火山方舟排队中',
                'running': '火山方舟生成中', 'processing': '火山方舟生成中',
                'succeeded': '下载 Seedance 视频', 'success': '下载 Seedance 视频',
            }.get(status, '查询火山方舟任务'))
            if status in ('failed', 'cancelled', 'canceled'):
                detail = value.get('error') or value.get('message') or '请在火山方舟控制台核对任务详情'
                raise ValueError('火山方舟视频任务' + ('生成失败' if status == 'failed' else '已取消') + '：' + str(detail)[:500])
            if status=='expired':
                raise ValueError('火山方舟任务已过期，原任务无法继续查询，请重新生成')
            if status in ('succeeded', 'success'):
                target = _video_url(value)
                if not target:
                    raise ValueError('火山方舟任务成功但未返回视频下载地址')
                return {'assets': [common.download_result(job, target, '.mp4', recoverable=True)]}
    raise InterruptedError()


def execute(worker, job, provider):
    if job['kind'] == 'image':
        return generate_image(worker, job, provider)
    if job['kind'] == 'video':
        return generate_video(worker, job, provider)
    raise ValueError('火山方舟媒体适配器仅处理图像和视频任务')


def cancel(job, provider):
    remote = job.get('provider_job_id')
    if not remote:
        return None
    try:
        with httpx.Client(timeout=20, headers=_headers(provider), trust_env=True) as client:
            response=client.delete(_root(provider) + '/contents/generations/tasks/' + quote(str(remote), safe=''))
            return response.is_success
    except (httpx.HTTPError, ValueError):
        # The local cancelled state still prevents polling and asset registration.
        return False
