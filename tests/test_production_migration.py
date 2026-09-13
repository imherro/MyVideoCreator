import json
import sqlite3
import pytest

from backend import store as s
from backend.generation_fingerprint import build_generation_fingerprint
from backend.production_context import merge_migration_contexts
from backend.project_schema import new_document
from backend.reference_compiler import compile_shot_image_input


def test_legacy_projects_are_wrapped_and_shared_context_is_extracted(monkeypatch, tmp_path):
    data = tmp_path / 'legacy-production-data'
    assets = data / 'assets'
    assets.mkdir(parents=True)
    media = assets / 'legacy.png'
    media.write_bytes(b'unchanged-media')
    database = data / 'studio.sqlite'
    document = '{"nodes":[{"id":"legacy-node"}],"shots":[]}'
    with sqlite3.connect(database) as connection:
        connection.executescript('''
            CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,document TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
            CREATE TABLE revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,document TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,metadata TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE jobs(id TEXT PRIMARY KEY,submission_id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),node_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,result TEXT,provider_job_id TEXT,error TEXT,phase TEXT NOT NULL DEFAULT '',progress REAL,created REAL NOT NULL,updated REAL NOT NULL);
            CREATE TABLE deleted_items(kind TEXT NOT NULL,item_id TEXT NOT NULL,project_id TEXT,deleted_at REAL NOT NULL,PRIMARY KEY(kind,item_id));
        ''')
        connection.execute(
            'INSERT INTO projects VALUES(?,?,?,?,?,?)',
            ('project-legacy', '旧单片', 7, document, 10.0, 20.0),
        )
        connection.execute(
            'INSERT INTO revisions VALUES(?,?,?,?,?)',
            ('revision-legacy', 'project-legacy', 6, document, 15.0),
        )
        connection.execute(
            'INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',
            ('asset-legacy', 'project-legacy', '旧素材', 'image', media.name, 'image/png', '{"kept":true}', 16.0),
        )
        connection.execute(
            'INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ('job-legacy', 'submission-legacy', 'project-legacy', 'legacy-node', 'image', 'succeeded', '{}', '{}', None, '', 'done', 100.0, 17.0, 18.0),
        )
        connection.execute(
            "INSERT INTO deleted_items(kind,item_id,project_id,deleted_at) VALUES('project',?,?,?)",
            ('project-legacy', 'project-legacy', 19.0),
        )

    monkeypatch.setattr(s, 'DATA', data)
    monkeypatch.setattr(s, 'ASSETS', assets)
    s.init()
    s.init()  # migration is idempotent

    with s.db() as connection:
        project = connection.execute('SELECT * FROM projects WHERE id=?', ('project-legacy',)).fetchone()
        production = connection.execute('SELECT * FROM productions').fetchall()
        revision = connection.execute('SELECT * FROM revisions WHERE id=?', ('revision-legacy',)).fetchone()
        asset = connection.execute('SELECT * FROM assets WHERE id=?', ('asset-legacy',)).fetchone()
        job = connection.execute('SELECT * FROM jobs WHERE id=?', ('job-legacy',)).fetchone()

    assert len(production) == 1
    assert production[0]['id'] == 'production-project-legacy'
    assert production[0]['name'] == '旧单片'
    assert project['id'] == 'project-legacy'
    assert project['revision'] == 7
    current_document = json.loads(project['document'])
    assert current_document['nodes'] == [{'id': 'legacy-node'}]
    assert current_document['shots'] == []
    assert 'filmBible' not in current_document
    assert 'generationPolicy' not in current_document
    assert 'style' not in current_document
    assert project['created'] == 10.0 and project['updated'] == 20.0
    assert project['production_id'] == production[0]['id']
    assert project['episode_no'] == 1 and project['episode_title'] == '旧单片'
    assert revision['project_id'] == project['id'] and revision['document'] == document
    assert asset['project_id'] == project['id'] and asset['metadata'] == '{"kept":true}'
    assert job['project_id'] == project['id'] and job['status'] == 'succeeded'
    assert media.read_bytes() == b'unchanged-media'

    from backend.app import productions, restore_deleted_item, trash

    assert all(item['id'] != production[0]['id'] for item in productions())
    assert [item['id'] for item in trash()['projects']] == ['project-legacy']
    restore_deleted_item('project', 'project-legacy')
    visible = {item['id']: item for item in productions()}
    assert visible[production[0]['id']]['episode_count'] == 1


def test_phase1a_multi_episode_context_migration_preserves_ids_and_history(monkeypatch, tmp_path):
    data = tmp_path / 'phase1a-production-data'
    assets = data / 'assets'
    assets.mkdir(parents=True)
    database = data / 'studio.sqlite'
    first = new_document()
    second = new_document()
    hero_card = {'id': 'hero', 'kind': 'character', 'name': '主角', 'currentVersionId': 'hero-v1'}
    hero_version = {
        'id': 'hero-v1', 'cardId': 'hero', 'version': 1, 'status': 'locked',
        'spec': {'description': '固定蓝衣', 'attributes': []}, 'invariants': ['蓝衣不变'],
        'references': [{'role': 'primary', 'assetId': 'asset-hero'}],
    }
    first['filmBible']['visual'] = {
        'cards': {'hero': hero_card}, 'versions': {'hero-v1': hero_version},
    }
    station_card = {'id': 'station', 'kind': 'scene', 'name': '车站', 'currentVersionId': 'station-v1'}
    station_version = {
        'id': 'station-v1', 'cardId': 'station', 'version': 1, 'status': 'locked',
        'spec': {'description': '水墨车站', 'attributes': []}, 'invariants': ['站台结构不变'],
        'references': [{'role': 'primary', 'assetId': 'asset-station'}],
    }
    second['filmBible']['visual'] = {
        'cards': {'hero': hero_card, 'station': station_card},
        'versions': {'hero-v1': hero_version, 'station-v1': station_version},
    }
    second['style'] = '水墨动画'
    second['generationPolicy']['image'] = {'providerId': 'image-provider', 'modelId': 'image-model'}
    second['filmBible'].update({
        'style': {'palette': '水墨'}, 'styleVersion': 4,
        'story': {'theme': '归途'}, 'continuity': {'weather': '雨'},
    })
    second['shots'] = [{'id': 'shot-2', 'uid': 'shot-2', 'imageNode': 'image-node', 'assetBindings': {
        'characters': [{'role': '主角', 'versionId': 'hero-v1'}],
        'scene': {'versionId': 'station-v1'}, 'props': [],
    }}]
    provider = [{'id': 'image-provider', 'kind': 'image', 'model': 'image-model', 'local': True}]
    generation_input = {'provider': 'image-provider', 'model': 'image-model', 'prompt': '主角抵达车站'}
    capabilities = lambda provider, model: {'image_reference': True, 'max_references': 8}
    compiled_before = compile_shot_image_input(
        second, 'image-node', 'image', generation_input, provider, capabilities,
    )
    fingerprint_before = build_generation_fingerprint(
        second, second['shots'][0], 'image-provider', 'image-model', 1,
    )
    encoded_first = s.dumps(first)
    encoded_second = s.dumps(second)
    historical = s.dumps({'legacySnapshot': True, 'filmBible': first['filmBible']})
    with sqlite3.connect(database) as connection:
        connection.executescript('''
            CREATE TABLE productions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
            CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,document TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,production_id TEXT REFERENCES productions(id),episode_no INTEGER,episode_title TEXT);
            CREATE TABLE revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,document TEXT NOT NULL,created REAL NOT NULL);
        ''')
        connection.execute('INSERT INTO productions VALUES(?,?,?,?)',('production-series','系列',1.0,2.0))
        connection.execute('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?,?)',(
            'episode-1','第一集',4,encoded_first,1.0,2.0,'production-series',1,'第一集',
        ))
        connection.execute('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?,?)',(
            'episode-2','第二集',7,encoded_second,1.0,3.0,'production-series',2,'第二集',
        ))
        connection.execute('INSERT INTO revisions VALUES(?,?,?,?,?)',(
            'historical-2','episode-2',6,historical,2.5,
        ))

    monkeypatch.setattr(s, 'DATA', data)
    monkeypatch.setattr(s, 'ASSETS', assets)
    s.init()
    s.init()

    with s.db() as connection:
        production = connection.execute('SELECT * FROM productions WHERE id=?',('production-series',)).fetchone()
        episodes = connection.execute('SELECT * FROM projects ORDER BY episode_no').fetchall()
        snapshot = connection.execute('SELECT document FROM revisions WHERE id=?',('historical-2',)).fetchone()
    context = json.loads(production['shared_context'])
    assert production['revision'] == 1
    assert set(context['filmBible']['visual']['cards']) == {'hero', 'station'}
    assert set(context['filmBible']['visual']['versions']) == {'hero-v1', 'station-v1'}
    assert context['style'] == '水墨动画'
    assert context['generationPolicy']['image']['modelId'] == 'image-model'
    assert context['filmBible']['style'] == {'palette': '水墨'}
    assert context['filmBible']['styleVersion'] == 4
    assert context['filmBible']['story'] == {'theme': '归途'}
    assert context['filmBible']['continuity'] == {'weather': '雨'}
    assert [(row['id'], row['revision']) for row in episodes] == [('episode-1', 4), ('episode-2', 7)]
    assert json.loads(episodes[1]['document'])['shots'][0]['assetBindings']['characters'][0]['versionId'] == 'hero-v1'
    assert all('filmBible' not in json.loads(row['document']) for row in episodes)
    assert snapshot['document'] == historical
    episode_document = json.loads(episodes[1]['document'])
    assert compile_shot_image_input(
        episode_document, 'image-node', 'image', generation_input, provider, capabilities,
        production_context=context,
    ) == compiled_before
    assert build_generation_fingerprint(
        episode_document, episode_document['shots'][0], 'image-provider', 'image-model', 1,
        production_context=context,
    ) == fingerprint_before


def test_migration_merges_identical_custom_shared_context_and_rejects_conflicts():
    custom = new_document()
    custom['style'] = '定格动画'
    custom['generationPolicy']['image'] = {'providerId': 'ark', 'modelId': 'seedream'}
    custom['filmBible'].update({
        'style': {'palette': '暖色'}, 'styleVersion': 3,
        'story': {'theme': '成长'}, 'continuity': {'season': '秋'},
    })
    merged = merge_migration_contexts([new_document(), custom, json.loads(s.dumps(custom))])
    assert merged['style'] == custom['style']
    assert merged['generationPolicy'] == custom['generationPolicy']
    for key in ('style', 'styleVersion', 'story', 'continuity'):
        assert merged['filmBible'][key] == custom['filmBible'][key]

    conflict_cases = [
        ('style', lambda value: value.__setitem__('style', '另一风格')),
        ('generationPolicy', lambda value: value['generationPolicy'].__setitem__('image', {'providerId': 'other', 'modelId': 'other'})),
        ('filmBible.style', lambda value: value['filmBible'].__setitem__('style', {'palette': '冷色'})),
        ('filmBible.styleVersion', lambda value: value['filmBible'].__setitem__('styleVersion', 9)),
        ('filmBible.story', lambda value: value['filmBible'].__setitem__('story', {'theme': '复仇'})),
        ('filmBible.continuity', lambda value: value['filmBible'].__setitem__('continuity', {'season': '冬'})),
    ]
    for label, mutate in conflict_cases:
        other = json.loads(s.dumps(custom))
        mutate(other)
        with pytest.raises(ValueError, match=label.replace('.', r'\.')):
            merge_migration_contexts([custom, other])
