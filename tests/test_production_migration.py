import sqlite3

from backend import store as s


def test_legacy_projects_are_wrapped_without_rewriting_episode_data(monkeypatch, tmp_path):
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
    assert project['document'] == document
    assert project['created'] == 10.0 and project['updated'] == 20.0
    assert project['production_id'] == production[0]['id']
    assert project['episode_no'] == 1 and project['episode_title'] == '旧单片'
    assert revision['project_id'] == project['id'] and revision['document'] == document
    assert asset['project_id'] == project['id'] and asset['metadata'] == '{"kept":true}'
    assert job['project_id'] == project['id'] and job['status'] == 'succeeded'
    assert media.read_bytes() == b'unchanged-media'
