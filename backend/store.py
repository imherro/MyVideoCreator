"""Durable single-host studio storage. Model workers never own browser state."""
import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('MVC_DATA_DIR', ROOT / 'data')).resolve()
ASSETS = DATA / 'assets'
EVENT_RETENTION = 2000
JOB_EVENT_INTERVAL = 5.0
_job_event_times = {}
_job_event_lock = threading.Lock()
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
        CREATE TABLE IF NOT EXISTS assistant_messages(id TEXT PRIMARY KEY,scope TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,context TEXT NOT NULL,actions TEXT NOT NULL,created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS assistant_scope_created ON assistant_messages(scope,created);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS productions(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,shared_context TEXT,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,document TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,production_id TEXT REFERENCES productions(id),episode_no INTEGER,episode_title TEXT);
        CREATE TABLE IF NOT EXISTS production_revisions(id TEXT PRIMARY KEY,production_id TEXT NOT NULL REFERENCES productions(id),revision INTEGER NOT NULL,shared_context TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS source_documents(id TEXT PRIMARY KEY,production_id TEXT NOT NULL REFERENCES productions(id),type TEXT NOT NULL,title TEXT NOT NULL,metadata TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS source_chapters(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES source_documents(id),chapter_no INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,sort_order INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,document TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,metadata TEXT NOT NULL,created REAL NOT NULL,production_id TEXT REFERENCES productions(id));
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,submission_id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),node_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,result TEXT,provider_job_id TEXT,error TEXT,phase TEXT NOT NULL DEFAULT '',progress REAL,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS episode_scripts(project_id TEXT PRIMARY KEY REFERENCES projects(id),revision INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL,title TEXT NOT NULL,synopsis TEXT NOT NULL,source_chapter_refs TEXT NOT NULL,story_goal TEXT NOT NULL,paywall_beat TEXT NOT NULL,body TEXT NOT NULL,estimated_duration REAL NOT NULL,characters TEXT NOT NULL,scenes TEXT NOT NULL,props TEXT NOT NULL,generation_job_id TEXT REFERENCES jobs(id),metadata TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS episode_script_revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,snapshot TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS source_events(id TEXT PRIMARY KEY,production_id TEXT NOT NULL REFERENCES productions(id),chapter_id TEXT NOT NULL REFERENCES source_chapters(id),event_order INTEGER NOT NULL,characters TEXT NOT NULL,summary TEXT NOT NULL,importance TEXT NOT NULL,emotion TEXT NOT NULL,continuity TEXT NOT NULL,extraction_job_id TEXT REFERENCES jobs(id),created REAL NOT NULL,updated REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_project_created ON jobs(project_id,created);
        CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status,created);
        CREATE TABLE IF NOT EXISTS job_private(job_id TEXT PRIMARY KEY REFERENCES jobs(id),provider TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS script_imports(id TEXT PRIMARY KEY,production_id TEXT NOT NULL REFERENCES productions(id),filename TEXT NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,manifest TEXT NOT NULL,analysis_job_id TEXT,status TEXT NOT NULL,result TEXT,created REAL NOT NULL,updated REAL NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX IF NOT EXISTS assets_project_created ON assets(project_id,created);
        CREATE INDEX IF NOT EXISTS revisions_project_revision ON revisions(project_id,revision);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT,payload TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS deleted_items(kind TEXT NOT NULL,item_id TEXT NOT NULL,project_id TEXT,deleted_at REAL NOT NULL,PRIMARY KEY(kind,item_id));
        CREATE INDEX IF NOT EXISTS deleted_items_project ON deleted_items(project_id,deleted_at);
        CREATE TABLE IF NOT EXISTS production_trash_members(production_id TEXT NOT NULL,project_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS provider_asset_groups(
            provider_id TEXT NOT NULL,
            account_hash TEXT NOT NULL,
            remote_group_id TEXT NOT NULL,
            created REAL NOT NULL,
            updated REAL NOT NULL,
            PRIMARY KEY(provider_id,account_hash)
        );
        CREATE TABLE IF NOT EXISTS provider_asset_mappings(
            provider_id TEXT NOT NULL,
            account_hash TEXT NOT NULL,
            local_asset_id TEXT NOT NULL REFERENCES assets(id),
            remote_asset_id TEXT NOT NULL,
            remote_group_id TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            created REAL NOT NULL,
            updated REAL NOT NULL,
            PRIMARY KEY(provider_id,account_hash,local_asset_id)
        );
        CREATE INDEX IF NOT EXISTS provider_asset_mappings_remote ON provider_asset_mappings(provider_id,account_hash,remote_asset_id);
        ''')
        columns={row['name'] for row in c.execute('PRAGMA table_info(jobs)')}
        for column,definition in (
            ('started','REAL'),('finished','REAL'),('telemetry','TEXT'),
            ('scope',"TEXT NOT NULL DEFAULT 'episode'"),('production_id','TEXT'),
        ):
            if column not in columns:c.execute(f'ALTER TABLE jobs ADD COLUMN {column} {definition}')
        c.execute('''UPDATE jobs SET production_id=(SELECT production_id FROM projects WHERE projects.id=jobs.project_id)
            WHERE production_id IS NULL''')
        for job in c.execute("SELECT id,input FROM jobs WHERE scope='episode'").fetchall():
            try: stage=json.loads(job['input']).get('stage')
            except (TypeError,ValueError): stage=None
            if stage in ('source_analysis','adaptation_generation','adaptation_episode_generation'):
                c.execute("UPDATE jobs SET scope='production' WHERE id=?",(job['id'],))
        c.execute('CREATE INDEX IF NOT EXISTS jobs_production_created ON jobs(production_id,created)')
        asset_columns={row['name'] for row in c.execute('PRAGMA table_info(assets)')}
        if 'category' not in asset_columns:c.execute("ALTER TABLE assets ADD COLUMN category TEXT NOT NULL DEFAULT 'other'")
        if 'source' not in asset_columns:c.execute("ALTER TABLE assets ADD COLUMN source TEXT NOT NULL DEFAULT 'uploaded'")
        if 'production_id' not in asset_columns:c.execute('ALTER TABLE assets ADD COLUMN production_id TEXT')
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
        # Physical files stay in place.  Production ownership is added as an
        # indexable sharing boundary while project_id remains the origin Episode.
        c.execute('''UPDATE assets SET production_id=(
            SELECT production_id FROM projects WHERE projects.id=assets.project_id
        ) WHERE production_id IS NULL''')
        c.execute('CREATE INDEX IF NOT EXISTS assets_project_category_created ON assets(project_id,category,created)')
        c.execute('CREATE INDEX IF NOT EXISTS assets_production_created ON assets(production_id,created)')
        c.execute('CREATE INDEX IF NOT EXISTS assets_production_category_created ON assets(production_id,category,created)')
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
        c.execute('CREATE INDEX IF NOT EXISTS source_documents_production ON source_documents(production_id,updated)')
        c.execute('CREATE UNIQUE INDEX IF NOT EXISTS source_chapters_number ON source_chapters(source_id,chapter_no)')
        c.execute('CREATE INDEX IF NOT EXISTS source_chapters_source_order ON source_chapters(source_id,sort_order)')
        c.execute('CREATE INDEX IF NOT EXISTS source_events_production_chapter ON source_events(production_id,chapter_id,event_order)')
        c.execute('CREATE INDEX IF NOT EXISTS episode_scripts_status ON episode_scripts(status,updated)')
        c.execute("UPDATE assistant_messages SET status='interrupted' WHERE status='running'")
        c.execute('CREATE INDEX IF NOT EXISTS episode_script_revisions_parent ON episode_script_revisions(project_id,revision)')
        from .job_contracts import freeze_prompt_contract
        for job in c.execute('SELECT id,kind,input FROM jobs').fetchall():
            try: old_input=json.loads(job['input'])
            except (TypeError,ValueError): continue
            frozen_input=freeze_prompt_contract(job['kind'],old_input,origin='migration')
            if frozen_input!=old_input:
                c.execute('UPDATE jobs SET input=? WHERE id=?',(dumps(frozen_input),job['id']))
        from .adaptation import seed_episode_scripts
        seed_episode_scripts(c)
        if not c.execute("SELECT 1 FROM settings WHERE key='migration_scoped_adaptation_v1'").fetchone():
            from .adaptation import repair_legacy_protected_adaptation
            repaired = repair_legacy_protected_adaptation(c)
            c.execute('INSERT INTO settings VALUES(?,?)', ('migration_scoped_adaptation_v1', dumps({'repaired': repaired})))
        from .model_migrations import enable_seedance_20, migrate_seedance_25
        migrate_seedance_25(c)
        enable_seedance_20(c)

def get_setting(key, default=None):
    with db() as c:
        row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return json.loads(row['value']) if row else default

def set_setting(key, value):
    with db() as c:
        c.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,dumps(value)))

def event(project_id, payload):
    with db() as c:
        inserted = c.execute('INSERT INTO events(project_id,payload,created) VALUES(?,?,?)',(project_id,dumps(payload),time.time()))
        c.execute('DELETE FROM events WHERE id<=?', (max(0, inserted.lastrowid - EVENT_RETENTION),))

def _notify_job(project_id, job_id, *, force=False):
    now = time.monotonic()
    with _job_event_lock:
        previous = _job_event_times.get(job_id, 0)
        if not force and now - previous < JOB_EVENT_INTERVAL:
            return False
        _job_event_times[job_id] = now
        if len(_job_event_times) > EVENT_RETENTION:
            cutoff = now - JOB_EVENT_INTERVAL * 2
            for key, value in list(_job_event_times.items()):
                if value < cutoff:
                    _job_event_times.pop(key, None)
    event(project_id, {'type':'job','id':job_id})
    return True

def unpack(row):
    if row is None:
        return None
    data = dict(row)
    if data.get('error'):
        from .provider_auth import safe_provider_error
        data['error'] = safe_provider_error(data['error'])
    for key in ('document','input','result','metadata','payload','telemetry'):
        if key in data and data[key] is not None:
            data[key] = json.loads(data[key])
    return data

def job_update(job_id, **fields):
    allowed = {'status','result','provider_job_id','error','phase','progress','telemetry'}
    assert fields.keys() <= allowed
    if fields.get('error'):
        from .provider_auth import safe_provider_error
        fields['error'] = safe_provider_error(fields['error'])
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
    force = bool(fields.keys() & {'status','error','provider_job_id'})
    _notify_job(current['project_id'], job_id, force=force)
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
