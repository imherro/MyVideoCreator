"""Canonical Production context and Episode document projections."""
from __future__ import annotations

import copy
import json

from .project_schema import empty_film_bible, empty_generation_policy, migrate_document


CONTEXT_SCHEMA_VERSION = 1
SHARED_DOCUMENT_KEYS = ('filmBible', 'generationPolicy', 'style')


def new_production_context(generation_policy=None):
    return {
        'schemaVersion': CONTEXT_SCHEMA_VERSION,
        'filmBible': empty_film_bible(),
        'generationPolicy': copy.deepcopy(
            generation_policy or empty_generation_policy()
        ),
        'style': '电影写实',
    }


def normalize_production_context(value, generation_policy=None):
    source = value if isinstance(value, dict) else {}
    result = new_production_context(generation_policy)
    film_bible = source.get('filmBible')
    if isinstance(film_bible, dict):
        result['filmBible'] = copy.deepcopy(film_bible)
    film_bible = result['filmBible']
    visual = film_bible.setdefault('visual', {})
    visual.setdefault('cards', {})
    visual.setdefault('versions', {})
    for key in ('continuity', 'style', 'story'):
        film_bible.setdefault(key, {})
    film_bible.setdefault('styleVersion', 1)
    policy = source.get('generationPolicy')
    if isinstance(policy, dict):
        result['generationPolicy'] = copy.deepcopy(policy)
    for kind in ('text', 'image', 'video'):
        result['generationPolicy'].setdefault(kind, None)
    if 'style' in source:
        result['style'] = copy.deepcopy(source['style'])
    return result


def production_context_from_document(document, generation_policy=None):
    value = migrate_document(document)
    return normalize_production_context(
        {key: value.get(key) for key in SHARED_DOCUMENT_KEYS},
        generation_policy,
    )


def episode_document_from_document(document):
    value = migrate_document(document)
    for key in SHARED_DOCUMENT_KEYS:
        value.pop(key, None)
    return value


def compose_project_document(episode_document, production_context):
    value = migrate_document(episode_document)
    context = normalize_production_context(production_context)
    for key in SHARED_DOCUMENT_KEYS:
        value[key] = copy.deepcopy(context[key])
    return value


def merge_migration_contexts(documents, generation_policy=None):
    """Merge Phase 1A Episode contexts while preserving every visual ID.

    Phase 1A normally has one populated Episode followed by blank Episodes.
    If separate Episodes contain distinct visual IDs, retain their union. An ID
    collision with different immutable content aborts migration rather than
    silently orphaning an existing Shot binding.
    """
    contexts = [
        production_context_from_document(document, generation_policy)
        for document in documents
    ]
    if not contexts:
        return new_production_context(generation_policy)
    merged = copy.deepcopy(contexts[0])
    target_visual = merged['filmBible']['visual']
    for context in contexts[1:]:
        visual = context['filmBible']['visual']
        for collection in ('cards', 'versions'):
            target = target_visual[collection]
            for item_id, item in visual[collection].items():
                if item_id in target and target[item_id] != item:
                    raise ValueError(
                        f'Production 共享 Film Bible 迁移发现冲突的视觉编号 {item_id}'
                    )
                target.setdefault(item_id, copy.deepcopy(item))
    return merged


def read_project_state(connection, project_id):
    project = connection.execute(
        'SELECT * FROM projects WHERE id=?', (project_id,)
    ).fetchone()
    if not project:
        return None
    production = connection.execute(
        'SELECT * FROM productions WHERE id=?', (project['production_id'],)
    ).fetchone()
    if not production or not production['shared_context']:
        raise ValueError('项目缺少 Production 共享上下文')
    episode_document = json.loads(project['document'])
    context = normalize_production_context(json.loads(production['shared_context']))
    return {
        'project': project,
        'production': production,
        'episode_document': episode_document,
        'production_context': context,
        'document': compose_project_document(episode_document, context),
    }
