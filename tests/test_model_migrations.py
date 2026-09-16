import json
import sqlite3

from backend.model_migrations import (
    ARK_SEEDANCE_MODELS,
    HC_SEEDANCE_MODELS,
    TARGET_SEEDANCE,
    enable_seedance_20,
    migrate_seedance_25,
)


def test_seedance_migration_updates_live_configuration_but_not_job_history():
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    connection.executescript('''
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE projects(id TEXT PRIMARY KEY,document TEXT,revision INTEGER NOT NULL);
      CREATE TABLE productions(id TEXT PRIMARY KEY,shared_context TEXT,revision INTEGER NOT NULL);
      CREATE TABLE jobs(id TEXT PRIMARY KEY,input TEXT);
    ''')
    providers = [{'id': 'ark', 'type': 'volcengine_ark', 'models': {'video': 'doubao-seedance-2-0-260128'}}]
    document = {'generationPolicy': {'video': {'providerId': 'ark', 'modelId': 'doubao-seedance-2-0-260128'}}}
    connection.execute('INSERT INTO settings VALUES(?,?)', ('providers', json.dumps(providers)))
    connection.execute('INSERT INTO projects VALUES(?,?,1)', ('p1', json.dumps(document)))
    connection.execute('INSERT INTO productions VALUES(?,?,1)', ('prod1', json.dumps(document)))
    connection.execute('INSERT INTO jobs VALUES(?,?)', ('j1', json.dumps({'model': 'doubao-seedance-2-0-260128'})))

    migrate_seedance_25(connection)
    migrate_seedance_25(connection)

    migrated_providers = json.loads(connection.execute("SELECT value FROM settings WHERE key='providers'").fetchone()['value'])
    assert migrated_providers[0]['models']['video'] == TARGET_SEEDANCE
    assert TARGET_SEEDANCE in connection.execute("SELECT document FROM projects WHERE id='p1'").fetchone()['document']
    assert TARGET_SEEDANCE in connection.execute("SELECT shared_context FROM productions WHERE id='prod1'").fetchone()['shared_context']
    assert connection.execute("SELECT revision FROM projects WHERE id='p1'").fetchone()['revision'] == 2
    assert 'doubao-seedance-2-0-260128' in connection.execute("SELECT input FROM jobs WHERE id='j1'").fetchone()['input']


def test_seedance_20_is_enabled_for_both_providers_and_explicit_project_pools():
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    connection.executescript('''
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE projects(id TEXT PRIMARY KEY,document TEXT,revision INTEGER NOT NULL);
      CREATE TABLE productions(id TEXT PRIMARY KEY,shared_context TEXT,revision INTEGER NOT NULL);
    ''')
    providers = [
        {'id': 'ark', 'type': 'volcengine_ark', 'models': {'video': ARK_SEEDANCE_MODELS[0]}},
        {'id': 'hc', 'type': 'hc_atom', 'models': {'video': HC_SEEDANCE_MODELS[0]}, 'enabled_models': {'video': ['legacy-video']}},
    ]
    document = {
        'modelPool': {
            'text': [], 'image': [], 'audio': [],
            'video': [{'providerId': 'ark', 'modelId': ARK_SEEDANCE_MODELS[0]}],
        },
    }
    connection.execute('INSERT INTO settings VALUES(?,?)', ('providers', json.dumps(providers)))
    connection.execute('INSERT INTO projects VALUES(?,?,1)', ('p1', json.dumps(document)))
    connection.execute('INSERT INTO productions VALUES(?,?,1)', ('prod1', json.dumps(document)))

    enable_seedance_20(connection)
    enable_seedance_20(connection)

    migrated = json.loads(connection.execute("SELECT value FROM settings WHERE key='providers'").fetchone()['value'])
    assert migrated[0]['enabled_models']['video'] == list(ARK_SEEDANCE_MODELS)
    assert migrated[1]['enabled_models']['video'] == ['legacy-video', *HC_SEEDANCE_MODELS]
    project = json.loads(connection.execute("SELECT document FROM projects WHERE id='p1'").fetchone()['document'])
    assert {'providerId': 'ark', 'modelId': ARK_SEEDANCE_MODELS[1]} in project['modelPool']['video']
    assert {'providerId': 'hc', 'modelId': HC_SEEDANCE_MODELS[1]} in project['modelPool']['video']
    assert connection.execute("SELECT revision FROM projects WHERE id='p1'").fetchone()['revision'] == 2
    assert connection.execute("SELECT revision FROM productions WHERE id='prod1'").fetchone()['revision'] == 2
