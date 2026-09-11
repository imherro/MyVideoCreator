"""Pure Project.document migrations. Database history is never rewritten here."""
from __future__ import annotations

import copy

CURRENT_SCHEMA_VERSION = 1

def empty_film_bible():
    return {
        'visual': {'cards': {}, 'versions': {}},
        'continuity': {},
        'style': {},
        'story': {},
    }

def empty_generation_policy():
    return {'text': None, 'image': None, 'video': None}

def new_document(generation_policy=None):
    return {
        'schemaVersion': CURRENT_SCHEMA_VERSION,
        'filmBible': empty_film_bible(),
        'generationPolicy': copy.deepcopy(generation_policy or empty_generation_policy()),
        'nodes': [], 'edges': [], 'shots': [], 'timeline': [], 'characters': [],
        'brief': '', 'style': '电影写实', 'ratio': '16:9', 'duration': 15,
    }

def _migrate_v0_to_v1(value):
    film = value.setdefault('filmBible', {})
    visual = film.setdefault('visual', {})
    visual.setdefault('cards', {})
    visual.setdefault('versions', {})
    film.setdefault('continuity', {})
    film.setdefault('style', {})
    film.setdefault('story', {})
    policy = value.setdefault('generationPolicy', empty_generation_policy())
    for kind in ('text', 'image', 'video'):
        policy.setdefault(kind, None)
    # Phase 0 only adds schema foundations; all legacy product fields survive.
    for key, default in (('nodes', []), ('edges', []), ('shots', []), ('timeline', []), ('characters', [])):
        value.setdefault(key, copy.deepcopy(default))
    value['schemaVersion'] = 1
    return value

def migrate_document(document):
    """Return a migrated copy. Reject future schemas rather than downgrading."""
    source = document if isinstance(document, dict) else {}
    version = source.get('schemaVersion', 0)
    if isinstance(version, bool) or not isinstance(version, int) or version < 0:
        raise ValueError('项目 Schema 版本无效')
    if version > CURRENT_SCHEMA_VERSION:
        raise ValueError('此项目由更新版本的 MyVideoCreator 创建，请升级程序后再打开')
    value = copy.deepcopy(source)
    while version < CURRENT_SCHEMA_VERSION:
        if version == 0:
            value = _migrate_v0_to_v1(value)
            version = 1
        else:
            raise ValueError(f'缺少项目 Schema v{version} 的迁移程序')
    return value
