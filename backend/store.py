"""Durable single-host studio storage. Model workers never own browser state."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('MVC_DATA_DIR', ROOT / 'data')).resolve()
ASSETS = DATA / 'assets'
for folder in (DATA, ASSETS, DATA / 'logs'):
    folder.mkdir(parents=True, exist_ok=True)

def uid(prefix=''):
    return prefix + uuid.uuid4().hex

def dumps(value):
    return json.dumps(value, ensure_ascii=False)

@contextmanager
def db():
    connection = sqlite3.connect(DATA / 'studio.sqlite', timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

def init():
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS productions(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,shared_context TEXT,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,document TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,production_id TEXT REFERENCES productions(id),episode_no INTEGER,episode_title TEXT);
        CREATE TABLE IF NOT EXISTS production_revisions(id TEXT PRIMARY KEY,production_id TEXT NOT NULL REFERENCES productions(id),revision INTEGER NOT NULL,shared_context TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,document TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,metadata TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,submission_id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),node_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,result TEXT,provider_job_id TEXT,error TEXT,phase TEXT NOT NULL DEFAULT '',progress REAL,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_project_created ON jobs(project_id,created);
        CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status,created);
        CREATE TABLE IF NOT EXISTS job_private(job_id TEXT PRIMARY KEY REFERENCES jobs(id),provider TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS assets_project_created ON assets(project_id,created);
        CREATE INDEX IF NOT EXISTS revisions_project_revision ON revisions(project_id,revision);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT,payload TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS deleted_items(kind TEXT NOT NULL,item_id TEXT NOT NULL,project_id TEXT,deleted_at REAL NOT NULL,PRIMARY KEY(kind,item_id));
        CREATE INDEX IF NOT EXISTS deleted_items_project ON deleted_items(project_id,deleted_at);
        ''')
        columns={row['name'] for row in c.execute('PRAGMA table_info(jobs)')}
        for column,definition in (('started','REAL'),('finished','REAL'),('telemetry','TEXT')):
            if column not in columns:c.execute(f'ALTER TABLE jobs ADD COLUMN {column} {definition}')
        asset_columns={row['name'] for row in c.execute('PRAGMA table_info(assets)')}
        if 'category' not in asset_columns:c.execute("ALTER TABLE assets ADD COLUMN category TEXT NOT NULL DEFAULT 'other'")
        if 'source' not in asset_columns:c.execute("ALTER TABLE assets ADD COLUMN source TEXT NOT NULL DEFAULT 'uploaded'")
        c.execute('CREATE INDEX IF NOT EXISTS assets_project_category_created ON assets(project_id,category,created)')
        project_columns={row['name'] for row in c.execute('PRAGMA table_info(projects)')}
        for column,definition in (
            ('production_id','TEXT'),
            ('episode_no','INTEGER'),
            ('episode_title','TEXT'),
        ):
            if column not in project_columns:c.execute(f'ALTER TABLE projects ADD COLUMN {column} {definition}')
        # Legacy projects become one-production/one-episode wrappers without
        # touching their ids, documents, revisions, assets, jobs, or timestamps.
        legacy_projects=c.execute(
            'SELECT id,name,created,updated FROM projects WHERE production_id IS NULL'
        ).fetchall()
        for project in legacy_projects:
            production_id='production-'+project['id']
            c.execute(
                'INSERT OR IGNORE INTO productions(id,name,created,updated) VALUES(?,?,?,?)',
                (production_id,project['name'],project['created'],project['updated']),
            )
            c.execute(
                'UPDATE projects SET production_id=?,episode_no=1,episode_title=? WHERE id=?',
                (production_id,project['name'],project['id']),
            )
        c.execute("UPDATE projects SET episode_no=1 WHERE episode_no IS NULL")
        c.execute("UPDATE projects SET episode_title=name WHERE episode_title IS NULL OR trim(episode_title)='' ")
        c.execute('CREATE INDEX IF NOT EXISTS projects_production_updated ON projects(production_id,updated)')
        c.execute('CREATE UNIQUE INDEX IF NOT EXISTS projects_production_episode ON projects(production_id,episode_no) WHERE production_id IS NOT NULL')
        production_columns={row['name'] for row in c.execute('PRAGMA table_info(productions)')}
        if 'revision' not in production_columns:
            c.execute('ALTER TABLE productions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
        if 'shared_context' not in production_columns:
            c.execute('ALTER TABLE productions ADD COLUMN shared_context TEXT')
        from .generation_policy import default_ark_policy
        from .production_context import (
            episode_document_from_document,
            merge_migration_contexts,
        )
        provider_row=c.execute("SELECT value FROM settings WHERE key='providers'").fetchone()
        providers=json.loads(provider_row['value']) if provider_row else []
        default_policy=default_ark_policy(providers)
        for production in c.execute(
            'SELECT id,shared_context FROM productions ORDER BY id'
        ).fetchall():
            episodes=c.execute(
                'SELECT id,document FROM projects WHERE production_id=? ORDER BY episode_no,id',
                (production['id'],),
            ).fetchall()
            if not production['shared_context']:
                context=merge_migration_contexts(
                    [json.loads(episode['document']) for episode in episodes],
                    default_policy,
                )
                c.execute(
                    'UPDATE productions SET shared_context=?,revision=COALESCE(revision,1) WHERE id=?',
                    (dumps(context),production['id']),
                )
            for episode in episodes:
                current=json.loads(episode['document'])
                stripped=episode_document_from_document(current)
                if current != stripped:
                    c.execute(
                        'UPDATE projects SET document=? WHERE id=?',
                        (dumps(stripped),episode['id']),
                    )
        c.execute('CREATE INDEX IF NOT EXISTS production_revisions_parent_revision ON production_revisions(production_id,revision)')

def get_setting(key, default=None):
    with db() as c:
        row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return json.loads(row['value']) if row else default

def set_setting(key, value):
    with db() as c:
        c.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,dumps(value)))

def event(project_id, payload):
    with db() as c:
        c.execute('INSERT INTO events(project_id,payload,created) VALUES(?,?,?)',(project_id,dumps(payload),time.time()))

def unpack(row):
    if row is None:
        return None
    data = dict(row)
    for key in ('document','input','result','metadata','payload','telemetry'):
        if key in data and data[key] is not None:
            data[key] = json.loads(data[key])
    return data

def job_update(job_id, **fields):
    allowed = {'status','result','provider_job_id','error','phase','progress','telemetry'}
    assert fields.keys() <= allowed
    if 'result' in fields:
        fields['result'] = dumps(fields['result'])
    if 'telemetry' in fields:fields['telemetry']=dumps(fields['telemetry'])
    if fields.get('status') in ('succeeded','failed','cancelled'):fields['finished']=time.time()
    fields['updated'] = time.time()
    with db() as c:
        # Cancellation wins over late provider completions.
        current = c.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not current or current['status'] in ('cancelled','succeeded'):
            return False
        c.execute('UPDATE jobs SET '+','.join(f'{k}=?' for k in fields)+' WHERE id=?',(*fields.values(),job_id))
    event(current['project_id'], {'type':'job','id':job_id})
    return True

def attach_provider_job_id(job_id, provider_job_id):
    """Persist a paid upstream handle even if cancellation raced its response."""
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        current=c.execute('SELECT project_id,status,provider_job_id FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not current:raise ValueError('任务不存在，无法保存供应商任务编号')
        existing=current['provider_job_id']
        if existing and existing!=provider_job_id:raise ValueError('供应商任务编号冲突，请人工核对')
        if not existing:
            c.execute('UPDATE jobs SET provider_job_id=?,updated=? WHERE id=?',(provider_job_id,time.time(),job_id))
    event(current['project_id'],{'type':'job','id':job_id})
    return current['status']

def cancelled_phase(job_id, phase):
    with db() as c:
        current=c.execute("SELECT project_id FROM jobs WHERE id=? AND status='cancelled'",(job_id,)).fetchone()
        if not current:return False
        c.execute('UPDATE jobs SET phase=?,updated=? WHERE id=?',(phase,time.time(),job_id))
    event(current['project_id'],{'type':'job','id':job_id})
    return True
