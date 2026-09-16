import copy
import pytest
from backend.voice_resolution import resolved_voice
from backend.voice_samples import bind_voice_samples
from backend.motion_references import invalidate_motion_changes


def fixture():
    doc = {'filmBible': {'visual': {'cards': {'hero': {'kind': 'character'}, 'female': {'kind': 'character_state', 'parentCardId': 'hero'}}, 'versions': {'female-v1': {'cardId': 'female'}}}, 'voices': {'profiles': {'hero': {'status': 'locked', 'version': 1, 'voiceType': 'male', 'referenceAssetId': 'm', 'referenceVersion': 1}}}}, 'nodes': [{'id': 'v', 'data': {'assetId': 'old'}}], 'edges': []}
    shot = {'id': 's', 'videoNode': 'v', 'assetBindings': {'characters': [{'versionId': 'female-v1'}]}, 'dialogues': [{'id': 'line', 'characterCardId': 'hero', 'text': '你好'}]}
    doc['shots'] = [shot]
    return doc, shot


def test_state_inherits_then_overrides_without_affecting_base():
    doc, shot = fixture()
    assert resolved_voice(doc, shot, shot['dialogues'][0])[0] == 'hero'
    before = copy.deepcopy(doc)
    doc['filmBible']['voices']['profiles']['female'] = {'status': 'locked', 'version': 1, 'voiceType': 'female', 'referenceAssetId': 'f', 'referenceVersion': 1}
    assert resolved_voice(doc, shot, shot['dialogues'][0])[0] == 'female'
    normal = {**shot, 'assetBindings': {}}
    assert resolved_voice(doc, normal, shot['dialogues'][0])[0] == 'hero'
    result = bind_voice_samples(doc, shot, {}, [{'id': 'f', 'kind': 'audio'}])
    assert result['voice_samples'][0]['assetId'] == 'f'
    assert result['voice_samples'][0]['voiceCardId'] == 'female'
    assert invalidate_motion_changes(before, doc)['nodes'][0]['data']['stale']
    del doc['filmBible']['voices']['profiles']['female']
    assert resolved_voice(doc, shot, shot['dialogues'][0])[0] == 'hero'


def test_unlocked_override_never_silently_uses_male_voice():
    doc, shot = fixture()
    doc['filmBible']['voices']['profiles']['female'] = {'status': 'draft', 'version': 1}
    with pytest.raises(ValueError, match='尚未确认'):
        bind_voice_samples(doc, shot, {}, [{'id': 'm', 'kind': 'audio'}])


def test_full_dialogue_does_not_reuse_base_audio_with_same_version_number():
    from backend.video_dialogue import bind_fixed_dialogue_audio
    doc, shot = fixture()
    doc['filmBible']['voices']['profiles']['female'] = {'status': 'locked', 'version': 1, 'voiceType': 'female'}
    assets = [{'id': 'old', 'kind': 'audio', 'metadata': {'duration': 2, 'input': {'dialogue': {'id': 'line', 'characterCardId': 'hero', 'voiceVersion': 1}}}}]
    with pytest.raises(ValueError, match='尚未使用当前固定音色生成'):
        bind_fixed_dialogue_audio(doc, 'v', 'video', {}, assets)


def test_default_voice_remains_pinned_while_new_draft_is_created():
    doc, shot = fixture()
    male = dict(doc['filmBible']['voices']['profiles']['hero'])
    doc['filmBible']['voices']['profiles']['hero'] = {'status': 'draft', 'version': 2, 'defaultVersion': 1, 'lockedVersions': {'1': male}}
    assert resolved_voice(doc, shot, shot['dialogues'][0])[1]['voiceType'] == 'male'
