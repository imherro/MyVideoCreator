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
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,document TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,document TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,metadata TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,submission_id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),node_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,result TEXT,provider_job_id TEXT,error TEXT,phase TEXT NOT NULL DEFAULT '',progress REAL,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_project_created ON jobs(project_id,created);
        CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status,created);
        CREATE TABLE IF NOT EXISTS job_private(job_id TEXT PRIMARY KEY REFERENCES jobs(id),provider TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS assets_project_created ON assets(project_id,created);
        CREATE INDEX IF NOT EXISTS revisions_project_revision ON revisions(project_id,revision);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT,payload TEXT NOT NULL,created REAL NOT NULL);
        ''')
        columns={row['name'] for row in c.execute('PRAGMA table_info(jobs)')}
        for column,definition in (('started','REAL'),('finished','REAL'),('telemetry','TEXT')):
            if column not in columns:c.execute(f'ALTER TABLE jobs ADD COLUMN {column} {definition}')

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
