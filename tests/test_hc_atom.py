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


def test_legacy_gateway_is_redirected_to_documented_v3_host():
    configured = provider()
    configured['url'] = hc_atom.LEGACY_BASE_URL
    assert hc_atom._root(configured) == hc_atom.DEFAULT_BASE_URL


def test_http_200_business_error_is_not_treated_as_created_task(monkeypatch):
    configured = provider()
    configured['models']['video'] = 'doubao-seedance-2.5'
    item = stored_job('video', configured)
    item['input'].update({'model': 'doubao-seedance-2.5', 'parameters': {'duration': 4}})
    original = httpx.Client

    def handle(request):
        return httpx.Response(200, json={'code': 500, 'msg': '当前用户未分配该模型可用的厂商', 'data': None})

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    worker = Worker()
    worker.halt = NoWait()
    try:
        hc_atom.generate_video(worker, item, configured)
        assert False, 'business errors must fail before polling'
    except ValueError as exc:
        assert str(exc) == '幻场 AI 返回业务错误：当前用户未分配该模型可用的厂商'


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
            {'id': 'wan2.7-i2v'}, {'id': 'happyhorse-1.1-r2v'}, {'id': 'MiniMax-H3'},
            {'id': 'wan2.5-i2i-preview'}, {'id': 'tencent-mps-superres'},
        ]})

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    models = hc_atom.list_models(provider())
    classified = {row['id']: row['kind'] for row in models}
    assert classified == {
        'flux-image': 'image', 'happyhorse-1.1-r2v': 'video', 'kling-video': 'video',
        'MiniMax-H3': 'video', 'qwen-text': 'text', 'wan2.7-i2v': 'video',
        'wan2.5-i2i-preview': 'image',
    }


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


def test_seedance_20_uses_v3_endpoint_and_selected_model(monkeypatch):
    configured = provider()
    configured['models']['video'] = 'doubao-seedance-2.0'
    item = stored_job('video', configured)
    item['input'].update({'model': 'doubao-seedance-2.0', 'parameters': {'duration': 3, 'resolution': '720p'}})
    original = httpx.Client
    calls = []

    def handle(request):
        calls.append((request.method, request.url.path))
        if request.method == 'POST':
            body = json.loads(request.read())
            assert body['model'] == 'doubao-seedance-2.0'
            assert body['duration'] == 4
            assert body['ratio'] == '16:9'
            return httpx.Response(200, json={'id': 'seedance-20-task', 'status': 'queued'})
        return httpx.Response(200, json={
            'id': 'seedance-20-task', 'status': 'succeeded',
            'content': {'video_url': 'https://result.example/seedance-20.mp4'},
        })

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common, 'download_result', lambda *args, **kwargs: {'id': 'seedance-20-video'})
    worker = Worker()
    worker.halt = NoWait()
    assert hc_atom.generate_video(worker, item, configured)['assets'][0]['id'] == 'seedance-20-video'
    assert calls == [('POST', '/v3/video/tasks'), ('GET', '/v3/video/tasks/seedance-20-task')]


def test_seedance_uses_v3_signed_first_frame_and_minimum_duration(monkeypatch):
    configured = provider()
    configured['id'] = 'hc-assets-' + uuid.uuid4().hex
    configured['models']['video'] = 'doubao-seedance-2.5'
    configured['public_base_url'] = 'https://studio.example'
    item = stored_job('video', configured)
    item['input'].update({
        'model': 'doubao-seedance-2.5', 'parameters': {'duration': 3, 'resolution': '480p'},
        'ratio': '16:9',
    })
    aid = 'hc-frame-' + uuid.uuid4().hex
    path = s.ASSETS / (aid + '.png')
    path.write_bytes(b'png-test')
    with s.db() as db:
        db.execute(
            'INSERT INTO assets(id,project_id,name,kind,path,mime,metadata,created) VALUES(?,?,?,?,?,?,?,?)',
            (aid, item['project_id'], 'frame.png', 'image', path.name, 'image/png', '{}', time.time()),
        )
    item['input']['asset_ids'] = [aid]
    original = httpx.Client
    calls = []

    def handle(request):
        calls.append((request.method, request.url.path))
        if request.url.path == '/v3/asset-groups':
            body = json.loads(request.read())
            assert body['name'].startswith('安影 Seedance 虚拟人物素材-')
            assert len(body['name']) <= 32
            return httpx.Response(200, json={'code': 200, 'data': {'groupId': 'group-1'}})
        if request.url.path == '/v3/assets':
            body = json.loads(request.read())
            assert request.headers['group_id'] == 'group-1'
            assert body['assetType'] == 'Image'
            assert body['url'].startswith(f'https://studio.example/api/provider-assets/{aid}?expires=')
            assert 'signature=' in body['url']
            return httpx.Response(200, json={'code': 200, 'data': {'id': 'asset-1', 'status': 'Processing'}})
        if request.url.path == '/v3/assets/detail':
            assert request.headers['group_id'] == 'group-1'
            assert json.loads(request.read()) == {'assetId': 'asset-1'}
            return httpx.Response(200, json={'code': 200, 'data': {'id': 'asset-1', 'status': 'Active'}})
        if request.url.path == '/v3/video/tasks' and request.method == 'POST':
            body = json.loads(request.read())
            assert body['model'] == 'doubao-seedance-2.5'
            assert body['duration'] == 4 and body['ratio'] == 'adaptive'
            assert body['resolution'] == '480p'
            assert body['content'][0] == {'type': 'text', 'text': '电影感镜头'}
            image = body['content'][1]
            assert image['type'] == 'image_url' and image['role'] == 'first_frame'
            assert image['image_url']['url'] == 'asset://asset-1'
            return httpx.Response(200, json={'id': 'cgt-1', 'status': 'queued'})
        assert request.url.path == '/v3/video/tasks/cgt-1'
        return httpx.Response(200, json={
            'id': 'cgt-1', 'status': 'succeeded',
            'content': {'video_url': 'https://result.example/video.mp4'},
        })

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common, 'download_result', lambda job, url, ext, recoverable=False: {'id': 'v3-video', 'kind': 'video'})
    worker = Worker()
    worker.halt = NoWait()
    assert hc_atom.generate_video(worker, item, configured)['assets'][0]['id'] == 'v3-video'
    assert calls == [
        ('POST', '/v3/asset-groups'),
        ('POST', '/v3/assets'),
        ('POST', '/v3/assets/detail'),
        ('POST', '/v3/video/tasks'),
        ('GET', '/v3/video/tasks/cgt-1'),
    ]

    # A retry/re-generation with the same local image reuses the reviewed remote
    # asset and does not create or review a duplicate asset.
    def reject_network(request):
        raise AssertionError('active provider asset should be served from the local mapping cache')

    cached_client = original(transport=httpx.MockTransport(reject_network))
    with s.db() as db:
        local_asset = dict(db.execute('SELECT * FROM assets WHERE id=?', (aid,)).fetchone())
    assert hc_atom._register_seedance_asset(worker, item, cached_client, configured, local_asset) == 'asset://asset-1'


def test_seedance_stops_before_video_submit_when_provider_asset_review_fails(monkeypatch):
    configured = provider()
    configured['id'] = 'hc-assets-failed-' + uuid.uuid4().hex
    configured['models']['video'] = 'doubao-seedance-2.5'
    configured['public_base_url'] = 'https://studio.example'
    item = stored_job('video', configured)
    item['input'].update({'model': 'doubao-seedance-2.5', 'parameters': {'duration': 4}})
    aid = 'hc-sensitive-frame-' + uuid.uuid4().hex
    path = s.ASSETS / (aid + '.png')
    path.write_bytes(b'png-test')
    with s.db() as db:
        db.execute(
            'INSERT INTO assets(id,project_id,name,kind,path,mime,metadata,created) VALUES(?,?,?,?,?,?,?,?)',
            (aid, item['project_id'], 'sensitive.png', 'image', path.name, 'image/png', '{}', time.time()),
        )
    item['input']['asset_ids'] = [aid]
    original = httpx.Client
    calls = []

    def handle(request):
        calls.append(request.url.path)
        if request.url.path == '/v3/asset-groups':
            return httpx.Response(200, json={'code': 200, 'data': {'groupId': 'group-sensitive'}})
        if request.url.path == '/v3/assets':
            return httpx.Response(200, json={'code': 200, 'data': {'id': 'asset-sensitive', 'status': 'Processing'}})
        if request.url.path == '/v3/assets/detail':
            return httpx.Response(200, json={'code': 200, 'data': {
                'id': 'asset-sensitive', 'status': 'Failed', 'failReason': '检测到真人隐私信息',
            }})
        raise AssertionError('video task must not be submitted before the provider asset is active')

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    worker = Worker()
    worker.halt = NoWait()
    try:
        hc_atom.generate_video(worker, item, configured)
        assert False, 'failed provider asset review must block video submission'
    except ValueError as exc:
        assert str(exc) == '幻场虚拟人像素材审核失败：检测到真人隐私信息'
    assert calls == ['/v3/asset-groups', '/v3/assets', '/v3/assets/detail']


def test_seedance_retries_transport_reset_with_same_idempotency_key(monkeypatch):
    configured = provider()
    configured['models']['video'] = 'doubao-seedance-2.5'
    item = stored_job('video', configured)
    item['input'].update({'model': 'doubao-seedance-2.5', 'parameters': {'duration': 4}})
    original = httpx.Client
    posts = []

    def handle(request):
        if request.method == 'POST':
            posts.append(request.headers['idempotency-key'])
            if len(posts) == 1:
                raise httpx.ReadError('reset', request=request)
            return httpx.Response(200, json={'id': 'cgt-retry'})
        return httpx.Response(200, json={
            'id': 'cgt-retry', 'status': 'succeeded',
            'content': {'video_url': 'https://result.example/video.mp4'},
        })

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common, 'download_result', lambda *args, **kwargs: {'id': 'retry-video'})
    worker = Worker()
    worker.halt = NoWait()
    assert hc_atom.generate_video(worker, item, configured)['assets'][0]['id'] == 'retry-video'
    assert posts == [item['submission_id'], item['submission_id']]


def test_reference_image_uses_async_task_protocol(monkeypatch):
    item = stored_job('image', provider())
    item['input']['size'] = '2048x1152'
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
            assert body['parameters']['size'] == '2048x1152'
            return httpx.Response(200, json={'code': 200, 'data': {'taskId': 'ig-1'}})
        return httpx.Response(200, json={'code': 200, 'data': {'status': 'SUCCESS', 'resultUrls': ['https://result.example/image.png']}})

    monkeypatch.setattr(hc_atom.httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common, 'download_result', lambda job, url, ext, recoverable=False: {'id': 'image-asset', 'kind': 'image'})
    worker = Worker()
    worker.halt = NoWait()
    assert hc_atom.generate_image(worker, item, provider())['assets'][0]['id'] == 'image-asset'


def test_multimodal_seedance_keeps_single_image_role_and_all_media(monkeypatch):
    from backend import motion_references, voice_samples, provider_assets
    for model in ['doubao-seedance-2.0', 'doubao-seedance-2.5']:
        configured = provider()
        configured['models']['video'] = model
        for with_media in [False, True]:
            item = stored_job('video', configured)
            item['input'].update(model=model, generation_mode={'requested':'multimodal'}, parameters={'duration':4}, ratio='16:9')
            if with_media: item['input'].update(motion_reference={'assetId':'motion'},voice_samples=[{'assetId':'voice'}])
            monkeypatch.setattr(common,'assets_for',lambda job:[{'id':'image','kind':'image'}])
            monkeypatch.setattr(hc_atom,'_register_seedance_asset',lambda *args:'asset://image')
            monkeypatch.setattr(motion_references,'silent_motion_asset',lambda job:{'id':'silent'})
            monkeypatch.setattr(provider_assets,'public_asset_url',lambda provider,aid:'https://media.example/'+aid)
            monkeypatch.setattr(voice_samples,'submission_assets',lambda job:[{'id':'voice'}])
            monkeypatch.setattr(voice_samples,'sample_data_uri',lambda asset:'data:audio/wav;base64,AAAA')
            monkeypatch.setattr(hc_atom,'_wait_seedance_v3',lambda *args:{'assets':[]})
            bodies=[]
            monkeypatch.setattr(hc_atom,'_post_task',lambda worker,job,client,path,body:(bodies.append(body) or {'id':'remote'}))
            hc_atom.generate_video(Worker(),item,configured)
            body=bodies[0]
            assert body['ratio']=='16:9'
            assert [c['role'] for c in body['content'][1:]] == (['reference_image','reference_video','reference_audio'] if with_media else ['reference_image'])
            assert ('omni_reference_task_type' in body)==('2.5' in model)
            assert 'data:' not in json.dumps(body)
            if with_media:
                assert body['content'][2]['video_url']['url'].endswith('/silent')
                assert body['content'][3]['audio_url']['url'] == 'https://media.example/voice'
            item['provider_job_id']='remote'
            hc_atom.generate_video(Worker(),item,configured)
            assert len(bodies)==1


def test_full_dialogue_reference_is_persisted_before_signed_url(monkeypatch, tmp_path):
    from backend.providers import volcengine_ark as ark
    from backend import provider_assets
    source = s.ASSETS / ('test-audio-' + uuid.uuid4().hex + '.wav')
    source.write_bytes(b'audio')
    monkeypatch.setattr(common, 'assets_by_ids', lambda *args: [{'kind':'audio', 'path':source.name}])
    def render(command, **kwargs):
        from pathlib import Path
        Path(command[-1]).write_bytes(b'mp3-rendered')
        return type('Result', (), {'returncode':0})()
    monkeypatch.setattr(ark.subprocess, 'run', render)
    def register(job, path, **kwargs):
        assert path.read_bytes() == b'mp3-rendered'
        assert kwargs['asset_source'] == 'derived'
        return {'id':'persisted-dialogue'}
    monkeypatch.setattr(common, 'register', register)
    monkeypatch.setattr(provider_assets, 'public_asset_url', lambda provider, aid: 'https://media.example/' + aid)
    try:
        result = ark._dialogue_reference_audio({'input':{'dialogue_audio':[{'assetId':'a','start':0}]}}, 4, public_provider=provider())
        assert result == 'https://media.example/persisted-dialogue'
    finally:
        source.unlink(missing_ok=True)


def test_asset_groups_are_unique_across_independent_installations_and_reused(monkeypatch, tmp_path):
    import sqlite3
    from contextlib import contextmanager

    configured = provider()
    # Same provider id and API key on both computers; only their databases differ.
    host_path = tmp_path / 'host-a.sqlite'
    @contextmanager
    def host_db():
        connection = sqlite3.connect(host_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("""CREATE TABLE IF NOT EXISTS provider_asset_groups(
                provider_id TEXT, account_hash TEXT, remote_group_id TEXT,
                created REAL, updated REAL, PRIMARY KEY(provider_id,account_hash))""")
            yield connection
            connection.commit()
        finally:
            connection.close()

    monkeypatch.setattr(s, 'db', host_db)
    remote_groups = {'安影 Seedance 虚拟人物素材': 'legacy-remote-group'}
    calls = []
    def handle(request):
        assert request.method == 'POST' and request.url.path == '/v3/asset-groups'
        name = json.loads(request.read())['name']
        calls.append(name)
        if name in remote_groups:
            return httpx.Response(200, json={'code': 500, 'msg': '同名分组已存在: ' + name})
        remote_groups[name] = f'group-{len(remote_groups)}'
        return httpx.Response(200, json={'code': 200, 'data': {'groupId': remote_groups[name]}})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        first = hc_atom._asset_group(client, configured)
        assert hc_atom._asset_group(client, configured) == first
        host_path = tmp_path / 'host-b.sqlite'
        second = hc_atom._asset_group(client, configured)
        assert hc_atom._asset_group(client, configured) == second
        host_path = tmp_path / 'host-a.sqlite'
        assert hc_atom._asset_group(client, configured) == first
    assert first != second
    assert len(calls) == 2 and len(set(calls)) == 2
    assert remote_groups['安影 Seedance 虚拟人物素材'] == 'legacy-remote-group'
    assert all(configured['api_key'] not in name for name in calls)


def test_asset_group_keeps_existing_cache_and_explicit_group_id():
    configured = provider()
    configured['id'] = 'hc-existing-group-' + uuid.uuid4().hex
    with s.db() as db:
        db.execute('INSERT INTO provider_asset_groups VALUES(?,?,?,?,?)',
                   (configured['id'], hc_atom._asset_account_hash(configured), 'existing-group', time.time(), time.time()))
    def no_network(request):
        raise AssertionError('existing groups must be reused without remote calls')
    with httpx.Client(transport=httpx.MockTransport(no_network)) as client:
        assert hc_atom._asset_group(client, configured) == 'existing-group'
        configured['parameters']['video']['asset_group_id'] = 'explicit-shared-group'
        assert hc_atom._asset_group(client, configured) == 'explicit-shared-group'
