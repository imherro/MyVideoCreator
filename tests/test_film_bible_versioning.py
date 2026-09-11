import copy
from backend.film_bible.versioning import validate_film_bible_transition


def fixture():
    version = {
        'id': 'hero-v1', 'cardId': 'hero', 'version': 1,
        'parentVersionId': None, 'status': 'locked',
        'spec': {'description': '灰色风衣', 'attributes': []},
        'invariants': ['脸型不变'], 'references': [{'role': 'primary', 'assetId': 'ref'}],
        'createdAt': 1, 'provenance': {'lockedAt': 2},
    }
    return {
        'filmBible': {'visual': {
            'cards': {'hero': {'id': 'hero', 'kind': 'character', 'name': '林岚', 'parentCardId': None, 'currentVersionId': 'hero-v1', 'status': 'active'}},
            'versions': {'hero-v1': version},
        }},
        'shots': [{'uid': 'shot-A', 'assetBindings': {'characters': [{'role': '林岚', 'versionId': 'hero-v1'}], 'scene': None, 'props': []}}],
    }


def test_server_rejects_locked_mutation_and_referenced_hard_delete_but_allows_deprecation():
    old = fixture()
    mutated = copy.deepcopy(old); mutated['filmBible']['visual']['versions']['hero-v1']['spec']['description'] = '金色风衣'
    try:
        validate_film_bible_transition(old, mutated)
        assert False, 'locked mutation should fail'
    except ValueError as exc:
        assert '不可原地修改' in str(exc)
    deleted = copy.deepcopy(old); del deleted['filmBible']['visual']['versions']['hero-v1']
    try:
        validate_film_bible_transition(old, deleted)
        assert False, 'referenced deletion should fail'
    except ValueError as exc:
        assert '仍被分镜引用' in str(exc)
    deprecated = copy.deepcopy(old); deprecated['filmBible']['visual']['versions']['hero-v1']['status'] = 'deprecated'
    assert validate_film_bible_transition(old, deprecated) is deprecated
    assert deprecated['shots'][0]['assetBindings']['characters'][0]['versionId'] == 'hero-v1'
