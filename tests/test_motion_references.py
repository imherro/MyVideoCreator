import copy
import json
import subprocess
import time
import uuid

import httpx
import pytest
from PIL import Image

from backend import store as s
from backend.media import ffmpeg_executable, probe
from backend.motion_references import (
    START, capability, compile_motion_input, inspect_motion,
    invalidate_motion_changes, silent_motion_asset,
)
from backend.project_schema import new_document, migrate_document
from backend.providers import common, runninghub, volcengine_ark as ark
from backend.video_dialogue import compile_shot_video_input
from backend.worker import Worker

s.init()


@pytest.fixture(scope='module')
def sample_video():
    path = s.ASSETS / ('sample-motion-' + uuid.uuid4().hex + '.mp4')
    subprocess.run([ffmpeg_executable(), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=960x540:r=24',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', str(path)], check=True, capture_output=True)
    return path


def fixture(sample_video, provider_type='runninghub', motion=True):
    pid, jid = s.uid('motion-project-'), s.uid('motion-job-')
    model = 'bytedance/seedance-2.5-token' if provider_type == 'runninghub' else 'doubao-seedance-2-5-260628'
    provider = {'id': 'test-motion', 'type': provider_type, 'url': 'https://provider.test/api/v3',
                'models': {'video': model}, 'api_key': 'test', 'public_base_url': 'https://studio.test'}
    image_id, video_id = s.uid('frame-'), s.uid('motion-')
    image_path = s.ASSETS / (image_id + '.png')
    Image.new('RGB', (960, 540), 'red').save(image_path)
    shot = {'id': 's', 'uid': 's', 'videoNode': 'v', 'imageNode': 'i', 'duration': 5, 'camera': '固定机位',
            'video_prompt': '机器人转身', 'assetBindings': {'characters': [], 'props': []}}
    if motion:
        shot['motionReference'] = {'assetId': video_id, 'cameraMode': 'use_shot_camera'}
    node = {'id': 'v', 'data': {'kind': 'video', 'model': model, 'provider': provider['id'], 'prompt': '机器人转身'}}
    doc = {**new_document(), 'shots': [shot], 'nodes': [{'id': 'i', 'data': {'kind': 'image', 'assetId': image_id}}, node],
           'edges': [{'source': 'i', 'target': 'v'}]}
    now = time.time()
    with s.db() as c:
        c.execute('INSERT INTO projects(id,name,revision,document,created,updated) VALUES(?,?,1,?,?,?)', (pid, 'test', s.dumps(doc), now, now))
        for aid, path, kind, mime in [(image_id, image_path, 'image', 'image/png'), (video_id, sample_video, 'video', 'video/mp4')]:
            c.execute('INSERT INTO assets(id,project_id,name,kind,path,mime,metadata,created) VALUES(?,?,?,?,?,?,?,?)',
                      (aid, pid, path.name, kind, path.name, mime, '{}', now))
        c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',
                  (jid, s.uid(), pid, 'v', 'video', 'running', '{}', now, now))
    return doc, provider, {'id': jid, 'project_id': pid, 'node_id': 'v', 'kind': 'video', 'status': 'running', 'input': node['data'].copy()}


def compile_fixture(doc, provider, job):
    value = compile_shot_video_input(doc, 'v', 'video', job['input'])
    return compile_motion_input(doc, 'v', 'video', value, job['project_id'], provider)


def test_defaults_do_not_change_legacy_semantics():
    assert new_document()['videoReferenceMode'] == 'multimodal'
    old = {'schemaVersion': 7, 'shots': [], 'nodes': []}
    assert migrate_document(old)['videoReferenceMode'] == 'legacy'
    assert 'videoReferenceMode' not in old


def test_motion_compiler_idempotence_order_duration_and_removal(sample_video):
    doc, provider, job = fixture(sample_video)
    first = compile_fixture(doc, provider, job)
    second = compile_motion_input(doc, 'v', 'video', first, job['project_id'], provider)
    assert first == second
    assert first['prompt'].count(START) == 1
    assert first['parameters']['duration'] == 5
    assert first['motion_reference']['media']['duration'] == 2
    assert first['motion_warnings']
    assert [x['kind'] for x in first['reference_manifest']] == ['image', 'video']
    assert '固定机位' in first['prompt'] and '@视频1' in first['prompt']
    doc['shots'][0]['motionReference'] = None
    removed = compile_motion_input(doc, 'v', 'video', first, job['project_id'], provider)
    assert '@视频1' not in removed['prompt']
    assert removed['generation_mode']['actual'] == 'multimodal'
    assert removed['motion_reference'] is None


@pytest.mark.parametrize('provider_type', ['volcengine_ark', 'runninghub'])
@pytest.mark.parametrize('motion', [False, True])
@pytest.mark.parametrize('dialogue', [False, True])
def test_real_http_shape_single_image_never_downgrades(monkeypatch, sample_video, provider_type, motion, dialogue):
    doc, provider, job = fixture(sample_video, provider_type, motion)
    if dialogue:
        # An additional, distinct image and voice must survive alongside motion.
        other_doc, _, other_job = fixture(sample_video)
        other_id = other_doc['nodes'][0]['data']['assetId']
        with s.db() as c:
            c.execute('UPDATE assets SET project_id=? WHERE id=?', (job['project_id'], other_id))
        job['input']['asset_ids'] = [other_id]
        job['input'].update(dialogue_audio=[{'id': 'voice'}], dialogue_audio_asset_ids=['voice'], dialogue_audio_mode='seedance_reference')
        monkeypatch.setattr(ark, '_dialogue_reference_audio', lambda *_: 'data:audio/mpeg;base64,dGVzdC1hdWRpbw==')
    job['input'] = compile_fixture(doc, provider, job)
    calls = []
    original = httpx.Client
    def handle(request):
        calls.append((request.method, request.url.path))
        if 'upload/binary' in request.url.path:
            assert b'filename=' in request.read()
            return httpx.Response(200, json={'code': 0, 'data': {'download_url': 'https://uploaded.test/ref'}})
        if provider_type == 'runninghub':
            assert request.url.path.endswith('/multimodal-video')
            body = json.loads(request.read())
            assert len(body['imageUrls']) == 1 + int(dialogue) and 'firstFrameUrl' not in body
            assert bool(body.get('videoUrls')) == motion
            assert bool(body.get('audioUrls')) == dialogue
            assert body['omniReferenceTaskType'] == 'reference'
            if dialogue: assert body['audioUrls'][0].startswith('https://uploaded.test/')
            assert body['generateAudio'] is True
            return httpx.Response(200, json={'taskId': 'remote'})
        if request.method == 'POST':
            body = json.loads(request.read())
            assert request.url.path.endswith('/contents/generations/tasks')
            assert body['content'][1]['role'] == 'reference_image'
            assert sum(x.get('role') == 'reference_image' for x in body['content']) == 1 + int(dialogue)
            assert sum(x.get('role') == 'reference_audio' for x in body['content']) == int(dialogue)
            assert body['omni_reference_task_type'] == 'reference'
            assert body['duration'] == 5
            assert sum(x.get('role') == 'reference_video' for x in body['content']) == int(motion)
            assert body['generate_audio'] is True
            return httpx.Response(200, json={'id': 'remote'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://result.test/v.mp4'}})
    monkeypatch.setattr(httpx, 'Client', lambda **kw: original(**kw, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(runninghub, '_wait_task', lambda *args: {'assets': [{'id': 'result'}]})
    monkeypatch.setattr(common, 'download_result', lambda *args, **kwargs: {'id': 'result'})
    worker = Worker()
    worker.halt = type('NoWait', (), {'wait': lambda *_: False, 'is_set': lambda *_: False})()
    adapter = runninghub if provider_type == 'runninghub' else ark
    assert adapter.generate_video(worker, job, provider)['assets'][0]['id'] == 'result'
    calls.clear()
    job['provider_job_id'] = 'remote'
    monkeypatch.setattr('backend.motion_references.silent_motion_asset', lambda *_: pytest.fail('resume must not re-upload'))
    assert adapter.generate_video(worker, job, provider)['assets'][0]['id'] == 'result'
    assert all(method != 'POST' for method, _ in calls)


def test_silent_derivative_cache_and_original_intact(sample_video):
    doc, provider, job = fixture(sample_video)
    job['input'] = compile_fixture(doc, provider, job)
    original = sample_video.read_bytes()
    first = silent_motion_asset(job)
    again = silent_motion_asset(job)
    assert first['id'] == again['id']
    assert probe(s.ASSETS / first['path'])['has_audio'] is False
    assert probe(sample_video)['has_audio'] is True
    assert sample_video.read_bytes() == original
    assert first['metadata']['motionDerivedFrom'] == doc['shots'][0]['motionReference']['assetId']


def test_character_mapping_keeps_all_visuals_and_dialogue_timing(sample_video):
    doc, provider, job = fixture(sample_video)
    frame = doc['nodes'][0]['data']['assetId']
    visual = {'cards': {}, 'versions': {}}
    for name, kind in [('robot', 'character'), ('room', 'scene'), ('cup', 'prop')]:
        visual['cards'][name] = {'id': name, 'kind': kind, 'name': name}
        visual['versions'][name] = {'id': name, 'cardId': name, 'status': 'locked', 'references': [{'role': 'primary', 'assetId': frame}]}
    doc['filmBible']['visual'] = visual
    doc['shots'][0]['assetBindings'] = {'characters': [{'versionId': 'robot'}], 'scene': {'versionId': 'room'}, 'props': [{'versionId': 'cup'}]}
    doc['shots'][0]['motionReference']['characterCardId'] = 'robot'
    data = compile_shot_video_input(doc, 'v', 'video', job['input'])
    data.update(dialogue_audio=[{'id': 'audio'}], dialogue_audio_asset_ids=['audio'])
    data['prompt'] += '\n\n[固定对白音轨时序]\n机器人在 1 秒说：你好'
    value = compile_motion_input(doc, 'v', 'video', data, job['project_id'], provider)
    assert all(x in value['prompt'] for x in ('robot', 'room', 'cup', '@图片1中的角色', '@音频1', '机器人在 1 秒说：你好'))
    assert [x['kind'] for x in value['reference_manifest']] == ['image', 'video', 'audio']
    assert len(value['asset_ids']) == 1  # same physical file, several semantic roles
    doc['shots'][0]['motionReference']['characterCardId'] = 'other'
    with pytest.raises(ValueError, match='已绑定'):
        compile_fixture(doc, provider, job)


@pytest.mark.parametrize('change,match', [
    ('provider', '尚未核实'), ('first_frame', '确认切换'),
    ('missing', '丢失'), ('foreign', '丢失'), ('duration', '超出'),
])
def test_invalid_combinations_block_before_submission(sample_video, change, match):
    doc, provider, job = fixture(sample_video)
    if change == 'provider': provider['type'] = 'hc_atom'
    if change == 'first_frame': doc['shots'][0]['videoReferenceMode'] = 'first_frame'
    if change == 'missing': doc['shots'][0]['motionReference']['assetId'] = 'missing'
    if change == 'foreign': job['project_id'] = fixture(sample_video)[2]['project_id']
    if change == 'duration': doc['shots'][0]['duration'] = 32
    with pytest.raises(ValueError, match=match):
        compile_fixture(doc, provider, job)


def test_bad_mp4_rejected_and_limits_checked(monkeypatch, sample_video):
    doc, provider, job = fixture(sample_video)
    asset = common.assets_by_ids(job, [doc['shots'][0]['motionReference']['assetId']])[0]
    caps = capability(provider, provider['models']['video'])
    bad = s.ASSETS / 'fake-motion.mp4'; bad.write_bytes(b'not a video')
    with pytest.raises(ValueError, match='真实 MP4'):
        inspect_motion({**asset, 'path': bad.name}, caps)
    monkeypatch.setattr('backend.motion_references.probe', lambda _: {'width': 960, 'height': 540, 'fps': 24, 'duration': 45})
    with pytest.raises(ValueError, match='时长'):
        inspect_motion(asset, caps)


@pytest.mark.parametrize('patch,message', [
    ({'fps': 12}, '帧率'), ({'width': 200}, '尺寸'),
    ({'video_codec': 'vp9'}, '编码'), ({'duration': float('nan')}, '有效|可读取'),
])
def test_provider_media_limits(monkeypatch, sample_video, patch, message):
    doc, provider, job = fixture(sample_video)
    asset = common.assets_by_ids(job, [doc['shots'][0]['motionReference']['assetId']])[0]
    metadata = {**probe(sample_video), **patch}
    monkeypatch.setattr('backend.motion_references.probe', lambda _: metadata)
    with pytest.raises(ValueError, match=message):
        inspect_motion(asset, capability(provider, provider['models']['video']))


def test_damaged_video_decode_is_rejected(monkeypatch, sample_video):
    doc, provider, job = fixture(sample_video)
    asset = common.assets_by_ids(job, [doc['shots'][0]['motionReference']['assetId']])[0]
    damaged = s.ASSETS / 'damaged-motion.mp4'
    damaged.write_bytes(b'\x00\x00\x00\x18ftypmp42' + b'damaged-payload')
    metadata = probe(sample_video)
    monkeypatch.setattr('backend.motion_references.probe', lambda _: metadata)
    with pytest.raises(ValueError, match='完整解码'):
        inspect_motion({**asset, 'path': damaged.name}, capability(provider, provider['models']['video']))


def test_strict_mode_does_not_silently_drop_visual_bindings(sample_video):
    doc, provider, job = fixture(sample_video, motion=False)
    doc['shots'][0]['videoReferenceMode'] = 'first_frame'
    doc['shots'][0]['assetBindings']['characters'] = [{'versionId': 'actor-version'}]
    with pytest.raises(ValueError, match='不会静默丢弃'):
        compile_fixture(doc, provider, job)


def test_ark_20_rejects_audio_only_but_25_accepts(sample_video):
    doc, provider, job = fixture(sample_video, 'volcengine_ark', motion=False)
    doc['nodes'] = [doc['nodes'][1]]
    doc['edges'] = []
    job['input'].update(dialogue_audio=[{'id': 'voice'}], dialogue_audio_asset_ids=['voice'], model='doubao-seedance-2-0-260128')
    with pytest.raises(ValueError, match='仅音频'):
        compile_fixture(doc, provider, job)
    job['input']['model'] = 'doubao-seedance-2-5-260628'
    value = compile_fixture(doc, provider, job)
    assert [item['kind'] for item in value['reference_manifest']] == ['audio']


def test_motion_edit_invalidates_only_video_descendants_and_preserves_results(sample_video):
    doc, _, _ = fixture(sample_video)
    doc['nodes'][1]['data'].update(assetId='old-result', generation_revision=3)
    doc['nodes'].append({'id': 'export', 'data': {'assetId': 'old-movie'}})
    doc['edges'].append({'source': 'v', 'target': 'export'})
    updated = copy.deepcopy(doc)
    updated['shots'][0]['motionReference']['cameraMode'] = 'follow_reference'
    changed = invalidate_motion_changes(doc, updated)
    assert changed['nodes'][0] == doc['nodes'][0]
    assert changed['nodes'][1]['data']['generation_revision'] == 4
    assert changed['nodes'][1]['data']['assetId'] == 'old-result'
    assert changed['nodes'][2]['data']['stale']


def test_single_batch_and_preview_share_canonical_contract(sample_video):
    from fastapi.testclient import TestClient
    from backend.app import app
    doc, provider, fixture_job = fixture(sample_video)
    # Two static visual inputs catch the old Ark batch-only single-frame guard.
    provider['type'] = 'volcengine_ark'
    provider['models']['video'] = 'doubao-seedance-2-5-260628'
    doc['nodes'][1]['data']['model'] = provider['models']['video']
    fixture_job['input']['model'] = provider['models']['video']
    other_doc, _, _ = fixture(sample_video)
    other_id = other_doc['nodes'][0]['data']['assetId']
    with s.db() as c:
        c.execute('UPDATE assets SET project_id=? WHERE id=?', (fixture_job['project_id'], other_id))
    doc['nodes'][1]['data']['asset_ids'] = [other_id]
    fixture_job['input']['asset_ids'] = [other_id]
    old_providers = s.get_setting('providers', [])
    with TestClient(app) as client:
        app.state.worker.stop()
        endpoint = '/api/auth/login' if client.get('/api/auth/status').json()['configured'] else '/api/auth/setup'
        assert client.post(endpoint, json={'password': 'integration-test-only'}).status_code == 200
        s.set_setting('providers', [provider])
        try:
            created = client.post('/api/projects', json={'name': '动作参考集成测试'}).json()
            pid = created['id']
            assert created['document']['videoReferenceMode'] == 'multimodal'
            with s.db() as c:
                c.execute('UPDATE assets SET project_id=?,production_id=? WHERE project_id=?',
                          (pid, created['production_id'], fixture_job['project_id']))
            doc.update(generationPolicy=created['document']['generationPolicy'], modelPool=created['document'].get('modelPool'))
            saved = client.put('/api/projects/' + pid, json={'name': created['name'], 'revision': created['revision'],
                               'production_revision': created['production_revision'], 'document': doc})
            assert saved.status_code == 200, saved.text
            preview = client.get(f'/api/projects/{pid}/nodes/v/video-preview')
            assert preview.status_code == 200, preview.text
            single = client.post(f'/api/projects/{pid}/jobs', json={'node_id': 'v', 'kind': 'video',
                                 'submission_id': s.uid('single-'), 'input': fixture_job['input']})
            assert single.status_code == 200, single.text
            batch = client.post(f'/api/projects/{pid}/run', json={'node_ids': ['v'], 'exact': True, 'submission_id': s.uid('batch-')})
            assert batch.status_code == 200, batch.text
            batched = client.get('/api/jobs/' + batch.json()['job_ids'][0]).json()['input']
            for key in ('prompt', 'generation_mode', 'reference_manifest', 'motion_reference', 'motion_compiler'):
                assert preview.json()[key] == single.json()['input'][key] == batched[key], key
            assert client.get('/api/projects/' + pid).json()['document']['shots'][0]['motionReference'] == doc['shots'][0]['motionReference']
        finally:
            s.set_setting('providers', old_providers)


def test_explicit_mode_changes_tail_role_without_dropping_it(sample_video):
    doc, provider, job = fixture(sample_video, motion=False)
    other_doc, _, _ = fixture(sample_video)
    tail = other_doc['nodes'][0]['data']['assetId']
    with s.db() as c:
        c.execute('UPDATE assets SET project_id=? WHERE id=?', (job['project_id'], tail))
    doc['nodes'][1]['data']['end_asset_id'] = tail
    job['input']['end_asset_id'] = tail
    doc['shots'][0].update(videoReferenceMode='first_last_frame', duration=2)
    strict = compile_fixture(doc, provider, job)
    assert strict['generation_mode']['actual'] == 'first_last_frame'
    assert strict['parameters']['duration'] == 4
    assert strict['planned_shot_duration'] == 2
    assert strict['end_asset_id'] == tail
    doc['shots'][0]['videoReferenceMode'] = 'multimodal'
    reference = compile_fixture(doc, provider, job)
    assert reference['asset_ids'] == [doc['nodes'][0]['data']['assetId'], tail]
    assert 'end_asset_id' not in reference
    assert reference['reference_manifest'][1]['purpose'] == '结束构图参考（非硬尾帧）'
    assert compile_motion_input(doc, 'v', 'video', reference, job['project_id'], provider) == reference


@pytest.mark.parametrize('provider_type,model', [('hc_atom','wan3.0-video'),('hc_atom','MiniMax-H3'),('runninghub','alibaba/wan-3.0'),('runninghub','minimax/hailuo-h3')])
def test_wan_h3_compiler_keeps_explicit_mode_when_motion_added_or_removed(sample_video,provider_type,model):
    doc,provider,job=fixture(sample_video,provider_type,motion=False)
    provider['models']['video']=model
    job['input'].update(model=model,parameters={'resolution':'2k' if 'h3' in model.lower() else '720p'})
    first=compile_fixture(doc,provider,job)
    assert first['generation_mode']['actual']=='multimodal'
    assert len(first['asset_ids'])==1 and not first.get('voice_samples')
    assert compile_motion_input(doc,'v','video',first,job['project_id'],provider)==first
    with s.db() as c:
        aid=c.execute("SELECT id FROM assets WHERE project_id=? AND kind='video'",(job['project_id'],)).fetchone()['id']
    doc['shots'][0]['motionReference']={'assetId':aid,'cameraMode':'use_shot_camera'}
    with_motion=compile_fixture(doc,provider,job)
    assert with_motion['generation_mode']==first['generation_mode']
    assert with_motion['asset_ids']==first['asset_ids']
    assert with_motion['motion_reference']['assetId']==aid


def test_direct_composition_skips_frame_but_keeps_bound_assets(sample_video):
    from backend.workflows import execution_plan
    doc, provider, job = fixture(sample_video, motion=False)
    frame_id = doc['nodes'][0]['data']['assetId']
    shot = doc['shots'][0]
    shot['compositionMode'] = 'direct'
    shot['assetBindings']['characters'] = [{'versionId': 'cv'}]
    doc['filmBible']['visual'] = {
        'cards': {'c': {'id': 'c', 'name': '角色', 'kind': 'character'}},
        'versions': {'cv': {'id': 'cv', 'cardId': 'c', 'status': 'locked', 'invariants':['没有手臂'],
                          'references': [{'role': 'primary', 'assetId': frame_id}]}}}
    # The asset may be the same file as an obsolete composition: its explicit
    # character binding must still survive without inheriting composition role.
    doc['nodes'][0]['data']['stale'] = True
    result = compile_fixture(doc, provider, job)
    assert result['composition_mode'] == 'direct'
    assert result['asset_ids'] == [frame_id]
    assert result['reference_manifest'][0]['purpose'] == 'character'
    assert '没有手臂' in result['prompt']
    assert '不复制参考图的姿态' in result['prompt']
    assert result['generation_mode']['actual'] == 'multimodal'
    assert [n['id'] for n, _ in execution_plan(doc, ['v'])] == ['v']
    assert [n['id'] for n, _ in execution_plan(doc)] == ['v']
    assert [n['id'] for n, _ in execution_plan(doc, ['i'])] == ['i']
    shot['compositionMode'] = 'preview'
    with pytest.raises(ValueError, match='先看构图'):
        compile_fixture(doc, provider, job)
    doc['nodes'][0]['data']['stale'] = False
    assert compile_fixture(doc, provider, job)['reference_manifest'][0]['purpose'] == '构图参考（非硬首帧）'


def test_direct_without_references_is_not_text_only_fallback(sample_video):
    doc, provider, job = fixture(sample_video, motion=False)
    doc['shots'][0]['compositionMode'] = 'direct'
    with pytest.raises(ValueError, match='至少需要'):
        compile_fixture(doc, provider, job)


def test_composition_mode_change_invalidates_only_video_and_preserves_media():
    doc={'videoReferenceMode':'multimodal','shots':[{'id':'s','imageNode':'i','videoNode':'v','compositionMode':'preview'}],
         'nodes':[{'id':'i','data':{'kind':'image','assetId':'img'}},{'id':'v','data':{'kind':'video','assetId':'vid'}}], 'edges':[]}
    after=copy.deepcopy(doc);after['shots'][0]['compositionMode']='direct'
    result=invalidate_motion_changes(doc,after)
    assert result['nodes'][1]['data']['stale']
    assert result['nodes'][1]['data']['assetId']=='vid'
    assert not result['nodes'][0]['data'].get('stale')


def standalone_visual_fixture(sample_video):
    doc, provider, job = fixture(sample_video, motion=False)
    aid = doc['nodes'][0]['data']['assetId']
    doc['shots'] = []
    doc['filmBible']['visual'] = {
        'cards': {'robot': {'id':'robot','name':'无臂机器人','kind':'character'}},
        'versions': {'rv': {'id':'rv','cardId':'robot','status':'locked','invariants':['没有手臂'],
                            'references':[{'role':'primary','assetId':aid}]}}}
    doc['nodes'].append({'id':'role','type':'visualAsset','data':{'kind':'visual_asset','managed':True,'visualVersionId':'rv'}})
    doc['edges'] = [{'source':'role','target':'v'}]
    return doc, provider, job, aid


def test_standalone_visual_edge_compiles_locked_reference_and_constraints(sample_video):
    doc, provider, job, aid = standalone_visual_fixture(sample_video)
    before = copy.deepcopy(doc)
    result = compile_fixture(doc, provider, job)
    assert result['asset_ids'] == [aid]
    assert result['reference_manifest'][0]['versionId'] == 'rv'
    assert '无臂机器人' in result['prompt'] and '没有手臂' in result['prompt']
    assert result['generation_mode']['actual'] == 'multimodal'
    assert doc == before
    assert compile_motion_input(doc, 'v', 'video', result, job['project_id'], provider) == result
    from backend.workflows import execution_plan
    assert [n['id'] for n, _ in execution_plan(doc, ['v'])] == ['v']
    doc['edges'] = []
    with pytest.raises(ValueError, match='至少需要'):
        compile_fixture(doc, provider, job)


@pytest.mark.parametrize('status', ['draft','deprecated'])
def test_standalone_visual_requires_confirmed_version(sample_video, status):
    doc, provider, job, aid = standalone_visual_fixture(sample_video)
    doc['filmBible']['visual']['versions']['rv']['status'] = status
    with pytest.raises(ValueError, match='无臂机器人'):
        compile_fixture(doc, provider, job)


def test_standalone_visual_does_not_silently_switch_strict_mode(sample_video):
    doc, provider, job, aid = standalone_visual_fixture(sample_video)
    doc['videoReferenceMode'] = 'first_frame'
    with pytest.raises(ValueError, match='多模态参考模式'):
        compile_fixture(doc, provider, job)


def test_standalone_visual_changes_invalidate_existing_video(sample_video):
    doc, provider, job, aid = standalone_visual_fixture(sample_video)
    doc['nodes'][1]['data']['assetId'] = 'existing-video'
    changed = copy.deepcopy(doc)
    changed['edges'] = []
    result = invalidate_motion_changes(doc, changed)
    assert result['nodes'][1]['data']['stale']
    assert result['nodes'][1]['data']['generation_revision'] == 1


def test_adopting_unchanged_canvas_video_does_not_mark_result_stale(sample_video):
    from backend.motion_references import canvas_reference_shot
    doc, provider, job, aid = standalone_visual_fixture(sample_video)
    doc['nodes'][1]['data']['assetId']='finished-video'
    incoming=copy.deepcopy(doc)
    linked=canvas_reference_shot(doc,'v',job['input'])
    incoming['shots']=[{**linked,'id':'adopted','uid':'adopted','videoNode':'v','canvasSourceNodeId':'v',
                       'video_prompt':job['input']['prompt']}]
    result=invalidate_motion_changes(doc,incoming)
    assert not result['nodes'][1]['data'].get('stale')
    before=compile_fixture(doc,provider,job)
    from backend.video_dialogue import bind_fixed_dialogue_audio
    prepared=compile_shot_video_input(result,'v','video',job['input'])
    prepared=bind_fixed_dialogue_audio(result,'v','video',prepared,[])
    after=compile_motion_input(result,'v','video',prepared,job['project_id'],provider)
    assert before['asset_ids']==after['asset_ids']
    assert before['motion_compiler']['fingerprint']==after['motion_compiler']['fingerprint']
