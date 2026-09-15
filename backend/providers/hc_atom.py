"""HC-ATOM (幻场 AI) unified text, image and asynchronous video adapter."""
from __future__ import annotations

import base64
from urllib.parse import quote

import httpx

from .. import store as s
from . import common


DEFAULT_BASE_URL = 'https://ai-aigc.fzyinghe.com'
KINDS = ('text', 'image', 'video')


def _root(provider):
    return str(provider.get('url') or DEFAULT_BASE_URL).rstrip('/').removesuffix('/v1')


def text_base_url(provider):
    return _root(provider) + '/v1'


def _headers(provider, idempotency_key=None):
    key = str(provider.get('api_key') or '').strip()
    if not key:
        raise ValueError('幻场 AI 尚未配置 API Key')
    headers = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    if idempotency_key:
        headers['Idempotency-Key'] = str(idempotency_key)
    return headers


def model_for(provider, kind):
    kind = 'text' if kind == 'storyboard' else kind
    return str((provider.get('models') or {}).get(kind) or provider.get('model') or '').strip()


def _unwrap(value):
    if isinstance(value, dict) and isinstance(value.get('data'), dict) and (
        'code' in value or 'msg' in value
    ):
        return value['data']
    return value


def _catalog_kind(model_id, provider, item=None):
    configured = provider.get('models') if isinstance(provider.get('models'), dict) else {}
    for kind in KINDS:
        if model_id == str(configured.get(kind) or '').strip():
            return kind
    item = item or {}
    path = str(item.get('apiPath') or item.get('api_path') or '').lower()
    domain = str(item.get('domain') or item.get('type') or '').lower()
    lowered = model_id.lower()
    if 'video/generation' in path or 'video' in domain or any(
        token in lowered for token in ('video', 'seedance', 'kling', 'hailuo', 'veo', 'wan2.6-v')
    ):
        return 'video'
    if 'image' in path or 'image' in domain or any(
        token in lowered for token in ('image', 'seedream', 'flux', 'midjourney', 'wan2.6-t2i', 'wan2.7')
    ):
        return 'image'
    if any(token in lowered for token in ('embedding', 'rerank', 'tts', 'speech', 'asr', 'music')):
        return None
    return 'text'


def list_models(provider):
    """Read the authenticated catalogue. This endpoint does not run a model."""
    try:
        with httpx.Client(timeout=30, headers=_headers(provider), trust_env=True) as client:
            value = common.checked(client.get(_root(provider) + '/v1/models'))
    except httpx.HTTPError as exc:
        raise ValueError('幻场 AI 连接失败，请检查网络、服务地址和代理设置') from exc
    data = value.get('data') if isinstance(value, dict) else None
    if isinstance(data, dict):
        data = data.get('models') or data.get('list')
    if not isinstance(data, list):
        raise ValueError('幻场 AI 模型目录返回格式不正确')
    result, seen = [], set()
    for item in data:
        if isinstance(item, str):
            item = {'id': item}
        if not isinstance(item, dict):
            continue
        model_id = str(item.get('id') or item.get('model') or item.get('innerCode') or '').strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        kind = _catalog_kind(model_id, provider, item)
        if not kind:
            continue
        result.append({
            'id': model_id,
            'name': str(item.get('name') or item.get('display_name') or model_id),
            'kind': kind,
            'capabilities': {
                'image_reference': kind in ('image', 'video'),
                'max_references': 10 if kind == 'image' else 1 if kind == 'video' else None,
                'end_frame': False,
            },
        })
    configured = provider.get('models') if isinstance(provider.get('models'), dict) else {}
    return sorted(result, key=lambda row: (row['id'] != configured.get(row['kind']), row['id']))


def check_configured_model(provider, kind):
    if kind not in KINDS:
        raise ValueError('幻场 AI 模型用途无效')
    model = model_for(provider, kind)
    if not model:
        raise ValueError(f'请先选择或填写幻场 AI {kind} 模型 ID')
    found = next((item for item in list_models(provider) if item['id'] == model), None)
    return {
        'status': 'listed' if found else 'unlisted',
        'kind': kind,
        'model': model,
        'message': '模型已在幻场 AI 目录中。' if found else '目录中未找到该 ID；可以保留手工填写值，实际生成时再验证。',
    }


def model_capabilities(provider, kind, model_id=None):
    target = str(model_id or model_for(provider, kind)).strip()
    model = next((item for item in list_models(provider) if item['id'] == target and item['kind'] == kind), None)
    if model:
        return model['capabilities']
    if kind == 'image' and target:
        return {'image_reference': True, 'max_references': 10, 'end_frame': False}
    return {'image_reference': kind == 'video', 'max_references': 1 if kind == 'video' else None, 'end_frame': False}


def _data_uri(asset):
    if asset.get('kind') != 'image':
        raise ValueError('幻场 AI 参考素材必须是图片')
    path = (s.ASSETS / str(asset.get('path') or '')).resolve()
    if not path.is_relative_to(s.ASSETS) or not path.is_file():
        raise ValueError('幻场 AI 参考图文件已丢失')
    mime = str(asset.get('mime') or 'image/png')
    if mime not in ('image/png', 'image/jpeg', 'image/webp'):
        raise ValueError('幻场 AI 参考图仅支持 PNG、JPEG 或 WebP')
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def _task_value(client, path):
    return _unwrap(common.checked(client.get(path), recoverable=True))


def _wait_task(worker, job, client, path, remote, kind):
    while not worker.halt.wait(3):
        if worker.cancelled(job):
            try:
                client.delete(path + '/' + quote(str(remote), safe=''))
            finally:
                raise InterruptedError()
        value = _task_value(client, path + '/' + quote(str(remote), safe=''))
        status = str(value.get('status') or '').upper()
        worker.progress(job, f'幻场 AI {"生成图片" if kind == "image" else "生成视频"}', value.get('progress'))
        if status in ('FAILED', 'ERROR', 'CANCELLED'):
            raise ValueError(str(value.get('failReason') or value.get('error') or '幻场 AI 生成失败'))
        if status in ('SUCCESS', 'SUCCEEDED', 'COMPLETED'):
            urls = value.get('resultUrls') if kind == 'image' else None
            if not isinstance(urls, list):
                urls = [value.get('resultUrl') or value.get('url') or value.get('video_url')]
            urls = [url for url in urls if isinstance(url, str) and url]
            if not urls:
                raise ValueError('幻场 AI 任务成功，但没有返回媒体地址')
            ext = '.png' if kind == 'image' else '.mp4'
            return {'assets': [common.download_result(job, url, ext, recoverable=True) for url in urls]}
    raise InterruptedError()


def generate_image(worker, job, provider):
    model = str(job['input'].get('model') or model_for(provider, 'image')).strip()
    if not model:
        raise ValueError('请填写幻场 AI 图片模型 ID')
    refs = common.assets_for(job)
    params = {**(provider.get('parameters') or {}).get('image', {}), **job['input'].get('parameters', {})}
    use_task = bool(refs) or params.get('mode') == 'task'
    with httpx.Client(timeout=120, headers=_headers(provider, job.get('submission_id')), trust_env=True) as client:
        if use_task:
            path = _root(provider) + str(params.get('task_path') or '/image/generation/tasks')
            remote = job.get('provider_job_id')
            if not remote:
                body = {
                    'model': model,
                    'input': {'prompt': job['input']['prompt']},
                    'parameters': {k: v for k, v in params.items() if k not in ('mode', 'task_path')},
                }
                if refs:
                    body['input']['images'] = [_data_uri(asset) for asset in refs]
                value = _unwrap(common.checked(client.post(path, json=body)))
                remote = value.get('taskId') or value.get('task_id') or value.get('id')
                if not remote:
                    raise ValueError('幻场 AI 图片任务未返回 taskId')
                s.attach_provider_job_id(job['id'], str(remote))
            return _wait_task(worker, job, client, path, remote, 'image')
        body = {
            'model': model,
            'prompt': job['input']['prompt'],
            'n': int(params.get('n', 1)),
            'size': params.get('size') or job['input'].get('size') or '1024x1024',
            'response_format': params.get('response_format') or 'url',
        }
        worker.progress(job, '幻场 AI 生成图片')
        value = common.checked(client.post(_root(provider) + '/v1/images/generations', json=body))
        outputs = []
        for item in value.get('data', []):
            if item.get('url'):
                outputs.append(common.download_result(job, item['url'], '.png'))
            elif item.get('b64_json'):
                path = s.DATA / (s.uid('hc-image-') + '.png')
                try:
                    path.write_bytes(base64.b64decode(item['b64_json']))
                    outputs.append(common.register(job, path, '幻场 AI 生成图.png'))
                finally:
                    path.unlink(missing_ok=True)
        if not outputs:
            raise ValueError('幻场 AI 未返回可下载的图片')
        return {'assets': outputs}


def generate_video(worker, job, provider):
    model = str(job['input'].get('model') or model_for(provider, 'video')).strip()
    if not model:
        raise ValueError('请填写幻场 AI 视频模型 ID')
    if job['input'].get('end_asset_id'):
        raise ValueError('幻场 AI 通用视频接口暂未声明尾帧协议，请清除尾帧')
    refs = common.assets_for(job)
    if len(refs) > 1:
        raise ValueError('幻场 AI 通用视频接口最多提交一张参考图')
    params = {**(provider.get('parameters') or {}).get('video', {}), **job['input'].get('parameters', {})}
    path = _root(provider) + str(params.pop('task_path', None) or '/video/generation/tasks')
    with httpx.Client(timeout=120, headers=_headers(provider, job.get('submission_id')), trust_env=True) as client:
        remote = job.get('provider_job_id')
        if not remote:
            body = {**params, 'model': model, 'prompt': job['input']['prompt']}
            if refs:
                body['image'] = _data_uri(refs[0])
            value = _unwrap(common.checked(client.post(path, json=body)))
            remote = value.get('taskId') or value.get('task_id') or value.get('id')
            if not remote:
                raise ValueError('幻场 AI 视频任务未返回 taskId')
            s.attach_provider_job_id(job['id'], str(remote))
        return _wait_task(worker, job, client, path, remote, 'video')


def execute(worker, job, provider):
    if job['kind'] == 'image':
        return generate_image(worker, job, provider)
    if job['kind'] == 'video':
        return generate_video(worker, job, provider)
    raise ValueError('幻场 AI 适配器不支持此任务类型')


def cancel(job, provider):
    remote = job.get('provider_job_id')
    if not remote:
        return False
    kind = job.get('kind')
    section = ((provider.get('parameters') or {}).get(kind) or {})
    default = '/image/generation/tasks' if kind == 'image' else '/video/generation/tasks'
    path = _root(provider) + str(section.get('task_path') or default) + '/' + quote(str(remote), safe='')
    try:
        with httpx.Client(timeout=20, headers=_headers(provider), trust_env=True) as client:
            return client.delete(path).is_success
    except httpx.HTTPError:
        return False
