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

def migrate_document(document):
    """Return a migrated copy. Calling twice produces the same value."""
    value = copy.deepcopy(document if isinstance(document, dict) else {})
    value['schemaVersion'] = CURRENT_SCHEMA_VERSION
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
    return value

