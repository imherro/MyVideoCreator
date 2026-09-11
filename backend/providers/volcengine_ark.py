"""Volcengine Ark adapters for Seedream images and Seedance video tasks."""
import base64
from urllib.parse import quote

import httpx

from .. import store as s


DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'


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


def _image_result(worker, job, value):
    from ..worker import download_result, register
    outputs = []
    for item in value.get('data', []):
        if worker.cancelled(job):
            raise InterruptedError()
        if item.get('url'):
            outputs.append(download_result(job, item['url'], '.png'))
        elif item.get('b64_json'):
            path = s.DATA / (s.uid('ark-image-') + '.png')
            try:
                path.write_bytes(base64.b64decode(item['b64_json']))
                outputs.append(register(job, path, 'Seedream 生成图.png'))
            finally:
                path.unlink(missing_ok=True)
    if not outputs:
        raise ValueError('火山方舟未返回可下载的图像')
    return {'assets': outputs}


def generate_image(worker, job, provider):
    from ..worker import assets_for, checked
    if assets_for(job):
        raise ValueError('本轮火山方舟仅支持纯文生图，请移除参考素材')
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
    worker.progress(job, '火山方舟生成图像')
    with httpx.Client(timeout=600, headers=_headers(provider), trust_env=True) as client:
        return _image_result(worker, job, checked(client.post(_root(provider) + '/images/generations', json=body)))


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
    from ..worker import assets_for, checked, download_result
    if assets_for(job) or job['input'].get('end_asset_id'):
        raise ValueError('本轮火山方舟仅支持纯文生视频，请移除首帧、尾帧和参考素材')
    model = model_for(provider, 'video')
    if not model:
        raise ValueError('请填写火山方舟视频模型 ID')
    root = _root(provider)
    remote = job.get('provider_job_id')
    params = {**provider.get('parameters', {}).get('video', {}), **job['input'].get('parameters', {})}
    with httpx.Client(timeout=120, headers=_headers(provider), trust_env=True) as client:
        if not remote:
            body = {
                'model': job['input'].get('model') or model,
                'content': [{'type': 'text', 'text': job['input']['prompt']}],
                'duration': int(params.get('duration', 5)),
                'resolution': str(params.get('resolution', '720p')),
                'ratio': str(job['input'].get('ratio') or params.get('ratio') or '16:9'),
                'generate_audio': bool(params.get('generate_audio', True)),
            }
            if worker.cancelled(job):
                raise InterruptedError()
            value = checked(client.post(root + '/contents/generations/tasks', json=body))
            remote = value.get('id') or value.get('task_id')
            if not remote:
                raise ValueError('火山方舟未返回 task id，请在控制台核对任务后再提交')
            remote = str(remote)
            # Persist before the first poll so a process restart resumes this task.
            s.job_update(job['id'], provider_job_id=remote)
        interval = max(1, min(int(params.get('poll_interval', 5)), 60))
        while not worker.halt.wait(interval):
            if worker.cancelled(job):
                raise InterruptedError()
            value = checked(client.get(root + '/contents/generations/tasks/' + quote(remote, safe='')))
            status = str(value.get('status') or '').lower()
            if status not in ('queued', 'pending', 'running', 'processing', 'succeeded', 'success', 'failed', 'cancelled', 'canceled'):
                raise ValueError('火山方舟返回未知任务状态，请保留任务编号核对：' + str(value.get('status')))
            worker.progress(job, {
                'queued': '火山方舟排队中', 'pending': '火山方舟排队中',
                'running': '火山方舟生成中', 'processing': '火山方舟生成中',
                'succeeded': '下载 Seedance 视频', 'success': '下载 Seedance 视频',
            }.get(status, '查询火山方舟任务'))
            if status in ('failed', 'cancelled', 'canceled'):
                detail = value.get('error') or value.get('message') or '请在火山方舟控制台核对任务详情'
                raise ValueError('火山方舟视频任务' + ('生成失败' if status == 'failed' else '已取消') + '：' + str(detail)[:500])
            if status in ('succeeded', 'success'):
                target = _video_url(value)
                if not target:
                    raise ValueError('火山方舟任务成功但未返回视频下载地址')
                return {'assets': [download_result(job, target, '.mp4')]}
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
        return
    try:
        with httpx.Client(timeout=20, headers=_headers(provider), trust_env=True) as client:
            client.delete(_root(provider) + '/contents/generations/tasks/' + quote(str(remote), safe=''))
    except (httpx.HTTPError, ValueError):
        # The local cancelled state still prevents polling and asset registration.
        return
