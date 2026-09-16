import copy
import json
import math
import struct
import time
import wave

import httpx
import pytest

from backend import store as s
from backend.motion_references import compile_motion_input, invalidate_motion_changes
from backend.project_schema import new_document, migrate_document
from backend.providers import common, runninghub, volcengine_ark as ark
from backend.video_dialogue import bind_fixed_dialogue_audio, compile_shot_video_input
from backend.worker import Worker
from test_motion_references import fixture, sample_video


def voice_fixture(sample_video, provider_type='volcengine_ark', duration=3):
    doc, provider, job = fixture(sample_video, provider_type, motion=False)
    assets = []
    profiles = {}
    for cid, freq in [('robot', 440), ('girl', 660)]:
        aid = s.uid('voice-sample-')
        path = s.ASSETS / (aid + '.wav')
        with wave.open(str(path), 'wb') as out:
            out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            out.writeframes(b''.join(struct.pack('<h', int(1500 * math.sin(2 * math.pi * freq * i / 16000))) for i in range(int(duration * 16000))))
        metadata = {'duration': duration}
        with s.db() as c:
            c.execute('INSERT INTO assets(id,project_id,name,kind,path,mime,metadata,created) VALUES(?,?,?,?,?,?,?,?)',
                      (aid, job['project_id'], cid + '声音样本', 'audio', path.name, 'audio/wav', s.dumps(metadata), time.time()))
        assets.append({'id': aid, 'kind': 'audio', 'name': cid, 'metadata': metadata})
        profiles[cid] = {'status': 'locked', 'version': 2, 'voiceType': cid, 'previewAssetId': 'new-unconfirmed-preview',
                         'referenceAssetId': aid, 'referenceVersion': 2}
    doc['dialogueMode'] = 'voice_sample'
    doc['filmBible']['voices'] = {'profiles': profiles}
    doc['shots'][0]['duration'] = 4
    doc['shots'][0]['dialogues'] = [
        {'id': 'a', 'characterCardId': 'robot', 'characterName': '机器人', 'text': '我们走吧', 'emotion': '坚定'},
        {'id': 'b', 'characterCardId': 'girl', 'characterName': '女孩', 'text': '等一下', 'emotion': '焦急'},
        {'id': 'c', 'characterCardId': 'robot', 'characterName': '机器人', 'text': '好的', 'emotion': '平静'},
    ]
    return doc, provider, job, assets


def compile_voice(doc, provider, job, assets):
    data = compile_shot_video_input(doc, 'v', 'video', job['input'])
    data = bind_fixed_dialogue_audio(doc, 'v', 'video', data, assets)
    return compile_motion_input(doc, 'v', 'video', data, job['project_id'], provider)


def test_defaults_preserve_old_dialogue_workflow():
    assert new_document()['dialogueMode'] == 'voice_sample'
    assert migrate_document({'schemaVersion': 7})['dialogueMode'] == 'full_dialogue'


def test_samples_are_pinned_deduplicated_and_never_drive_timing(sample_video):
    doc, provider, job, assets = voice_fixture(sample_video, duration=8)
    job['input']['prompt'] = '我们走吧，等一下，好的'  # Emotion must still be compiled.
    data = compile_voice(doc, provider, job, assets)
    assert len(data['voice_samples']) == 2
    assert data['voice_samples'][0]['assetId'] == assets[0]['id']
    assert data['parameters']['duration'] == data['shot_duration'] == 4
    assert 'dialogue_audio' not in data and 'duration_adjustment' not in data
    assert '[固定对白音轨时序]' not in data['prompt']
    assert '机器人（坚定）说' in data['prompt'] and '女孩（焦急）说' in data['prompt']
    assert '仅参考@音频1' in data['prompt'] and '仅参考@音频2' in data['prompt']
    assert '不要复述' in data['prompt']
    assert [x['kind'] for x in data['reference_manifest']] == ['image', 'audio', 'audio']
    job['input'] = data
    assert compile_voice(doc, provider, job, assets) == data
    doc['shots'][0]['dialogues'] = []
    empty = compile_voice(doc, provider, job, assets)
    assert 'voice_samples' not in empty and '@音频' not in empty['prompt']


@pytest.mark.parametrize('change,message', [
    ('unconfirmed','尚未确认'),('version','尚未确认'),('missing','丢失'),
    ('strict','多模态'),('provider','尚未实现'),('short','有效纯音频'),('total','总时长'),
])
def test_invalid_voice_references_block_before_generation(sample_video, change, message):
    doc, provider, job, assets = voice_fixture(sample_video, duration=1 if change == 'short' else 16 if change == 'total' else 3)
    profile = doc['filmBible']['voices']['profiles']['robot']
    if change == 'unconfirmed': profile.pop('referenceAssetId')
    if change == 'version': profile['referenceVersion'] = 1
    if change == 'missing': assets = []
    if change == 'strict': doc['videoReferenceMode'] = 'first_frame'
    if change == 'provider': provider['type'] = 'hc_atom'
    with pytest.raises(ValueError, match=message):
        compile_voice(doc, provider, job, assets)


@pytest.mark.parametrize('provider_type', ['volcengine_ark','runninghub'])
def test_each_speaker_is_sent_separately_and_resume_never_uploads(monkeypatch, sample_video, provider_type):
    doc, provider, job, assets = voice_fixture(sample_video, provider_type)
    job['input'] = compile_voice(doc, provider, job, assets)
    requests = []
    original = httpx.Client
    def handle(request):
        requests.append(request)
        if 'upload/binary' in request.url.path:
            return httpx.Response(200, json={'code':0,'data':{'download_url':f'https://sample.test/{len(requests)}'}})
        if request.method == 'POST':
            data = json.loads(request.read())
            if provider_type == 'runninghub':
                assert request.url.path.endswith('/multimodal-video')
                assert len(set(data['audioUrls'])) == 2
                assert data['generateAudio'] and data['duration'] == '4'
                return httpx.Response(200, json={'taskId':'remote'})
            audio = [x for x in data['content'] if x.get('role') == 'reference_audio']
            assert len(audio) == 2 and audio[0]['audio_url']['url'] != audio[1]['audio_url']['url']
            assert data['generate_audio'] and data['duration'] == 4
            return httpx.Response(200,json={'id':'remote'})
        return httpx.Response(200,json={'status':'succeeded','content':{'video_url':'https://result.test/video.mp4'}})
    monkeypatch.setattr(httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(common,'download_result',lambda *_args,**_kw:{'id':'result'})
    monkeypatch.setattr(runninghub,'_wait_task',lambda *_args:{'assets':[{'id':'result'}]})
    worker = Worker(); worker.halt = type('NoWait',(),{'wait':lambda *_:False,'is_set':lambda *_:False})()
    adapter = ark if provider_type == 'volcengine_ark' else runninghub
    assert adapter.generate_video(worker,job,provider)['assets'][0]['id'] == 'result'
    job['provider_job_id'] = 'remote'; requests.clear()
    monkeypatch.setattr('backend.voice_samples.submission_assets',lambda *_:pytest.fail('resume must not reload voice samples'))
    adapter.generate_video(worker,job,provider)
    assert not any(r.method == 'POST' for r in requests)


def test_sample_change_invalidates_only_speaking_video_and_downstream(sample_video):
    doc, _, _, _ = voice_fixture(sample_video)
    doc['nodes'][1]['data'].update(assetId='old-video',generation_revision=2)
    doc['nodes'].extend([{'id':'other','data':{'kind':'video','assetId':'other-result'}},{'id':'export','data':{'assetId':'old-export'}}])
    doc['edges'].append({'source':'v','target':'export'})
    updated = copy.deepcopy(doc)
    updated['filmBible']['voices']['profiles']['robot']['referenceAssetId'] = 'replacement'
    revised = invalidate_motion_changes(doc,updated)
    assert revised['nodes'][0] == doc['nodes'][0]
    assert revised['nodes'][1]['data']['generation_revision'] == 3
    assert revised['nodes'][2] == doc['nodes'][2]
    assert revised['nodes'][3]['data']['stale'] is True


def test_api_preview_single_batch_and_shared_voice_invalidation(sample_video):
    from fastapi.testclient import TestClient
    from backend.app import app
    doc, provider, fixture_job, _ = voice_fixture(sample_video)
    previous_providers = s.get_setting('providers', [])
    with TestClient(app) as client:
        app.state.worker.stop()
        endpoint = '/api/auth/login' if client.get('/api/auth/status').json()['configured'] else '/api/auth/setup'
        assert client.post(endpoint, json={'password':'integration-test-only'}).status_code == 200
        s.set_setting('providers', [provider])
        try:
            created = client.post('/api/projects', json={'name':'音色参考接口验证'}).json()
            pid = created['id']
            assert created['document']['dialogueMode'] == 'voice_sample'
            with s.db() as c:
                c.execute('UPDATE assets SET project_id=?,production_id=? WHERE project_id=?',
                          (pid, created['production_id'], fixture_job['project_id']))
            doc.update(generationPolicy=created['document']['generationPolicy'], modelPool=created['document'].get('modelPool'))
            def save(project, document):
                response = client.put('/api/projects/' + project['id'], json={'name':project['name'],
                    'revision':project['revision'],'production_revision':project['production_revision'],'document':document})
                assert response.status_code == 200, response.text
            save(created, doc)
            preview = client.get(f'/api/projects/{pid}/nodes/v/video-preview')
            assert preview.status_code == 200, preview.text
            single = client.post(f'/api/projects/{pid}/jobs', json={'node_id':'v','kind':'video',
                'submission_id':s.uid(),'input':fixture_job['input']})
            assert single.status_code == 200, single.text
            batch = client.post(f'/api/projects/{pid}/run', json={'node_ids':['v'],'exact':True,'submission_id':s.uid()})
            assert batch.status_code == 200, batch.text
            snapshot = client.get('/api/jobs/' + batch.json()['job_ids'][0]).json()['input']
            for key in ('prompt','dialogue_mode','voice_samples','reference_manifest','motion_compiler'):
                assert preview.json()[key] == single.json()['input'][key] == snapshot[key], key
            second = client.post(f'/api/productions/{created["production_id"]}/episodes', json={'title':'共享音色第二集'}).json()
            other_doc = copy.deepcopy(doc)
            other_doc['nodes'][1]['data']['assetId'] = 'old-result'
            save(second, other_doc)
            second = client.get('/api/projects/' + second['id']).json()
            current = client.get('/api/projects/' + pid).json()
            # Merely re-generating a preview does not change the confirmed sample.
            current['document']['filmBible']['voices']['profiles']['robot']['previewAssetId'] = 'new-preview'
            save(current, current['document'])
            assert client.get('/api/projects/' + second['id']).json()['revision'] == second['revision']
            current = client.get('/api/projects/' + pid).json()
            profile = current['document']['filmBible']['voices']['profiles']['robot']
            profile.update(version=3,status='draft',referenceAssetId=None,referenceVersion=None)
            save(current, current['document'])
            refreshed = client.get('/api/projects/' + second['id']).json()
            assert refreshed['revision'] == second['revision'] + 1
            assert refreshed['document']['nodes'][1]['data']['generation_revision'] == second['document']['nodes'][1]['data'].get('generation_revision', 0) + 1
            assert refreshed['document']['nodes'][1]['data']['stale'] is True
            assert refreshed['document']['nodes'][0] == second['document']['nodes'][0]
            # Already queued jobs retain the old confirmed voice snapshot.
            assert client.get('/api/jobs/' + single.json()['id']).json()['input']['voice_samples'][0]['voiceVersion'] == 2
        finally:
            s.set_setting('providers', previous_providers)
