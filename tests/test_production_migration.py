import json
import sqlite3

from backend import store as s
from backend.project_schema import new_document


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
    first['filmBible']['visual'] = {
        'cards': {'hero': {'id': 'hero', 'kind': 'character', 'name': '主角', 'currentVersionId': 'hero-v1'}},
        'versions': {'hero-v1': {'id': 'hero-v1', 'cardId': 'hero', 'version': 1, 'status': 'locked'}},
    }
    second['filmBible']['visual'] = {
        'cards': {'station': {'id': 'station', 'kind': 'scene', 'name': '车站', 'currentVersionId': 'station-v1'}},
        'versions': {'station-v1': {'id': 'station-v1', 'cardId': 'station', 'version': 1, 'status': 'draft'}},
    }
    second['shots'] = [{'id': 'shot-2', 'uid': 'shot-2', 'assetBindings': {
        'characters': [{'role': '主角', 'versionId': 'hero-v1'}],
        'scene': {'versionId': 'station-v1'}, 'props': [],
    }}]
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
    assert [(row['id'], row['revision']) for row in episodes] == [('episode-1', 4), ('episode-2', 7)]
    assert json.loads(episodes[1]['document'])['shots'][0]['assetBindings']['characters'][0]['versionId'] == 'hero-v1'
    assert all('filmBible' not in json.loads(row['document']) for row in episodes)
    assert snapshot['document'] == historical
