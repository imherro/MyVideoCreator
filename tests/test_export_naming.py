import re
import time

from backend import store as s
from backend.worker import Worker


def test_export_name_uses_production_title_and_timestamp():
    s.init()
    production_id = s.uid('production-')
    project_id = s.uid('project-')
    now = time.time()
    with s.db() as connection:
        connection.execute(
            'INSERT INTO productions(id,name,created,updated) VALUES(?,?,?,?)',
            (production_id, '花信未迟', now, now),
        )
        connection.execute(
            '''INSERT INTO projects(id,name,revision,document,created,updated,production_id,episode_no,episode_title)
               VALUES(?,?,1,?,?,?,?,1,?)''',
            (project_id, '第 01 集', '{}', now, now, production_id, '第 01 集'),
        )
    named = Worker().export_named_job({
        'id': s.uid('job-'),
        'project_id': project_id,
        'input': {},
    })
    assert re.fullmatch(r'花信未迟-\d{8}-\d{6}', named['input']['output_name'])


def test_explicit_export_name_is_preserved():
    named = Worker().export_named_job({
        'id': 'job-explicit',
        'project_id': 'unused',
        'input': {'output_name': '自定义样片'},
    })
    assert named['input']['output_name'] == '自定义样片'
