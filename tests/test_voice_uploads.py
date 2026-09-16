import io
import wave
import copy
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import store as s
from backend.voice_reference_uploads import validate_file, validate_transition
from test_voice_samples import voice_fixture, compile_voice
from test_motion_references import sample_video


def wav_bytes():
    buf=io.BytesIO()
    with wave.open(buf,'wb') as out:
        out.setparams((1,2,16000,0,'NONE','not compressed'))
        out.writeframes(b'\x00\x01'*48000)
    return buf.getvalue()


def test_upload_admission_and_lock_without_speech_provider(tmp_path):
    with TestClient(app) as client:
        app.state.worker.stop()
        endpoint='/api/auth/login' if client.get('/api/auth/status').json()['configured'] else '/api/auth/setup'
        assert client.post(endpoint,json={'password':'integration-test-only'}).status_code==200
        project=client.post('/api/projects',json={'name':'声音上传测试'}).json();pid=project['id']
        bad=client.post(f'/api/projects/{pid}/assets?voice_reference=true',files={'file':('bad.wav',b'not wave','audio/wav')})
        assert bad.status_code==400
        response=client.post(f'/api/projects/{pid}/assets?category=voice&voice_reference=true',files={'file':('sample.wav',wav_bytes(),'audio/wav')})
        assert response.status_code==200,response.text
        asset=response.json();aid=asset['id']
        assert client.post(f'/api/projects/{pid}/assets/{aid}/voice-reference',json={'authorized':False}).status_code==400
        admitted=client.post(f'/api/projects/{pid}/assets/{aid}/voice-reference',json={'authorized':True})
        assert admitted.status_code==200,admitted.text
        stamp=admitted.json()['metadata']['voice_reference']['authorized_at']
        assert client.post(f'/api/projects/{pid}/assets/{aid}/voice-reference',json={'authorized':True}).json()['metadata']['voice_reference']['authorized_at']==stamp
        source={'type':'uploaded','originalAssetId':aid,'authorizedAt':stamp}
        profile={'cardId':'hero','source':source,'version':1,'status':'locked','previewAssetId':aid,'referenceAssetId':aid,'referenceVersion':1}
        doc={'filmBible':{'visual':{'cards':{'hero':{'kind':'character'}}},'voices':{'profiles':{'hero':profile}}}}
        with s.db() as c: validate_transition(c,pid,{},doc)
        state_before=copy.deepcopy(doc)
        state_before['filmBible']['visual']['cards']['hero']['kind']='character_state'
        state_before['filmBible']['voices']['profiles']['hero']['sourceVoiceVersion']=1
        state_after=copy.deepcopy(state_before)
        state_after['filmBible']['voices']['profiles']['hero'].update(version=2,referenceVersion=2,sourceVoiceVersion=2)
        with s.db() as c: validate_transition(c,pid,state_before,state_after)
        forged=copy.deepcopy(doc);forged['filmBible']['voices']['profiles']['hero']['referenceAssetId']='other'
        with s.db() as c,pytest.raises(ValueError,match='版本不可|不一致'):
            validate_transition(c,pid,doc,forged)
        other=client.post('/api/projects',json={'name':'其他作品'}).json()
        assert client.post(f'/api/projects/{other["id"]}/assets/{aid}/voice-reference',json={'authorized':True}).status_code==400
        second=client.post(f'/api/productions/{project["production_id"]}/episodes',json={'title':'共享声音第二集'}).json()
        assert client.post(f'/api/projects/{second["id"]}/assets/{aid}/voice-reference',json={'authorized':True}).status_code==200
        with s.db() as c: validate_transition(c,second['id'],{},doc)

        from test_film_bible_versioning import fixture as visual_fixture
        saved=client.get(f'/api/projects/{pid}').json()
        document=saved['document']
        document['filmBible']['visual']=visual_fixture()['filmBible']['visual']
        visual=document['filmBible']['visual']['versions']['hero-v1']
        visual.update(status='draft',references=[])
        document['filmBible']['voices']={'profiles':{'hero':profile}}
        response=client.put(f'/api/projects/{pid}',json={'name':saved['name'],'revision':saved['revision'],'production_revision':saved['production_revision'],'document':document})
        assert response.status_code==200,response.text
        reread=client.get(f'/api/projects/{second["id"]}').json()
        assert reread['document']['filmBible']['voices']['profiles']['hero']==profile
        forbidden=client.post(f'/api/projects/{pid}/jobs',json={'node_id':'voice-profile:hero','kind':'audio','submission_id':s.uid(),'input':{'prompt':'试听','provider':'missing','voice_profile':{'cardId':'hero','version':1}}})
        assert forbidden.status_code==400 and '上传声音' in forbidden.text


def test_uploaded_samples_compile_without_tts_and_preserve_timing(sample_video):
    doc,provider,job,assets=voice_fixture(sample_video)
    for profile in doc['filmBible']['voices']['profiles'].values():
        profile['source']={'type':'uploaded','originalAssetId':profile['referenceAssetId'],'authorizedAt':'test'}
        profile.pop('voiceType')
    data=compile_voice(doc,provider,job,assets)
    assert len(data['voice_samples'])==2
    assert data['voice_samples'][0]['source']=='uploaded'
    assert data['shot_duration']==4 and 'dialogue_audio' not in data
    doc['dialogueMode']='full_dialogue'
    with pytest.raises(ValueError,match='上传声音不能自动逐句合成'): compile_voice(doc,provider,job,assets)


def test_forged_extension_and_size_are_rejected(tmp_path):
    wrong=tmp_path/'wrong.mp3';wrong.write_bytes(wav_bytes())
    with pytest.raises(ValueError,match='真实格式'):validate_file(wrong)
    empty=tmp_path/'empty.wav';empty.write_bytes(b'')
    with pytest.raises(ValueError,match='大小'):validate_file(empty)
