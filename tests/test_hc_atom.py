import json
import time
import uuid

import httpx

from backend import store as s
from backend import worker as worker_module
from backend.providers import common, hc_atom
from backend.worker import Worker

s.init()


class NoWait:
    def wait(self, seconds):
        return False

    def is_set(self):
        return False


def provider():
    return {
        'id': 'hc', 'name': '幻场 AI', 'type': 'hc_atom', 'local': False,
        'url': 'https://ai.example', 'api_key': 'yh-secret',
        'models': {'text': 'qwen-text', 'image': 'flux-image', 'video': 'kling-video'},
        'parameters': {'image': {'size': '1024x1024'}, 'video': {'duration': 5, 'ratio': '16:9'}},
    }


def stored_job(kind, provider_value, provider_job_id=None):
    pid = 'hc-project-' + uuid.uuid4().hex
    jid = 'hc-job-' + uuid.uuid4().hex
    now = time.time()
    inp = {'provider': provider_value['id'], 'prompt': '电影感镜头'}
    with s.db() as db:
        db.execute(
            'INSERT INTO projects(id,name,revision,document,created,updated) VALUES(?,?,1,?,?,?)',
            (pid, 'HC test', '{}', now, now),
        )
        db.execute(
            'INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,provider_job_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
            (jid, 'hc-submit-' + uuid.uuid4().hex, pid, 'node', kind, 'running', s.dumps(inp), provider_job_id, now, now),
        )
        db.execute('INSERT INTO job_private VALUES(?,?)', (jid, s.dumps(provider_value)))
    return {'id': jid, 'submission_id': 'hc-submit-test', 'project_id': pid, 'node_id': 'node', 'kind': kind, 'status': 'running', 'input': inp, 'provider_job_id': provider_job_id}


def test_catalog_is_read_only_and_classifies_unified_models(monkeypatch):
    original = httpx.Client

    def handle(request):
        assert request.method == 'GET'
        assert request.url.path == '/v1/models'
        assert request.headers['authorization'] == 'Bearer yh-secret'
        return httpx.Response(200, json={'data': [
            {'id': 'qwen-text'}, {'id': 'flux-image'}, {'id': 'kling-video'}, {'id': 'embedding-v1'},
        ]})

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    models = hc_atom.list_models(provider())
    assert [(row['id'], row['kind']) for row in models] == [
        ('flux-image', 'image'), ('kling-video', 'video'), ('qwen-text', 'text'),
    ]


def test_text_reuses_openai_compatible_streaming_endpoint(monkeypatch):
    item = stored_job('text', provider())
    original = httpx.Client

    def handle(request):
        assert request.url.path == '/v1/chat/completions'
        body = json.loads(request.read())
        assert body['model'] == 'qwen-text'
        return httpx.Response(200, content=b'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')

    monkeypatch.setattr(worker_module.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    assert Worker().execute(item) == {'text': 'OK'}


def test_video_submit_poll_and_download(monkeypatch):
    item = stored_job('video', provider())
    calls = []
    original = httpx.Client

    def handle(request):
        calls.append((request.method, request.url.path))
        if request.method == 'POST':
            body = json.loads(request.read())
            assert body['model'] == 'kling-video' and body['duration'] == 5
            assert request.headers['idempotency-key'] == item['submission_id']
            return httpx.Response(200, json={'code': 200, 'data': {'taskId': 'vg-1', 'status': 'PENDING'}})
        return httpx.Response(200, json={'code': 200, 'data': {'taskId': 'vg-1', 'status': 'SUCCESS', 'progress': 100, 'resultUrl': 'https://result.example/video.mp4'}})

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common, 'download_result', lambda job, url, ext, recoverable=False: {'id': 'video-asset', 'kind': 'video'})
    worker = Worker()
    worker.halt = NoWait()
    assert hc_atom.generate_video(worker, item, provider())['assets'][0]['id'] == 'video-asset'
    assert calls == [('POST', '/video/generation/tasks'), ('GET', '/video/generation/tasks/vg-1')]


def test_reference_image_uses_async_task_protocol(monkeypatch):
    item = stored_job('image', provider())
    aid = 'hc-ref-' + uuid.uuid4().hex
    path = s.ASSETS / (aid + '.png')
    path.write_bytes(b'png-test')
    with s.db() as db:
        db.execute(
            'INSERT INTO assets(id,project_id,name,kind,path,mime,metadata,created) VALUES(?,?,?,?,?,?,?,?)',
            (aid, item['project_id'], 'reference.png', 'image', path.name, 'image/png', '{}', time.time()),
        )
    item['input']['asset_ids'] = [aid]
    original = httpx.Client

    def handle(request):
        if request.method == 'POST':
            body = json.loads(request.read())
            assert body['input']['images'][0].startswith('data:image/png;base64,')
            return httpx.Response(200, json={'code': 200, 'data': {'taskId': 'ig-1'}})
        return httpx.Response(200, json={'code': 200, 'data': {'status': 'SUCCESS', 'resultUrls': ['https://result.example/image.png']}})

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common, 'download_result', lambda job, url, ext, recoverable=False: {'id': 'image-asset', 'kind': 'image'})
    worker = Worker()
    worker.halt = NoWait()
    assert hc_atom.generate_image(worker, item, provider())['assets'][0]['id'] == 'image-asset'

