"""One-time migrations for provider and project model selections."""
from __future__ import annotations

import json

TARGET_SEEDANCE = 'doubao-seedance-2-5-260628'
ARK_SEEDANCE_MODELS = ('doubao-seedance-2-5-260628', 'doubao-seedance-2-0-260128')
HC_SEEDANCE_MODELS = ('doubao-seedance-2.5', 'doubao-seedance-2.0')


def _replace(value):
    if isinstance(value, str) and value.lower().startswith('doubao-seedance-2-0'):
        return TARGET_SEEDANCE
    if isinstance(value, list):
        return [_replace(item) for item in value]
    if isinstance(value, dict):
        return {key: _replace(item) for key, item in value.items()}
    return value


def migrate_seedance_25(connection):
    marker = connection.execute("SELECT value FROM settings WHERE key='seedance_25_migration'").fetchone()
    if marker:
        return
    row = connection.execute("SELECT value FROM settings WHERE key='providers'").fetchone()
    providers = json.loads(row['value']) if row else []
    changed = False
    for provider in providers:
        if provider.get('type') != 'volcengine_ark':
            continue
        models = provider.setdefault('models', {})
        old = str(models.get('video') or '')
        if not old or old.lower().startswith('doubao-seedance-2-0'):
            models['video'] = TARGET_SEEDANCE
            changed = True
    if changed:
        connection.execute(
            "INSERT INTO settings(key,value) VALUES('providers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(providers, ensure_ascii=False, separators=(',', ':')),),
        )
    for table, id_column, document_column in (
        ('projects', 'id', 'document'),
        ('productions', 'id', 'shared_context'),
    ):
        for item in connection.execute(f'SELECT {id_column},{document_column} FROM {table} WHERE {document_column} IS NOT NULL').fetchall():
            original = json.loads(item[document_column])
            migrated = _replace(original)
            if migrated == original:
                continue
            connection.execute(
                f'UPDATE {table} SET {document_column}=?,revision=revision+1 WHERE {id_column}=?',
                (json.dumps(migrated, ensure_ascii=False, separators=(',', ':')), item[id_column]),
            )
    connection.execute(
        "INSERT INTO settings(key,value) VALUES('seedance_25_migration','1') ON CONFLICT(key) DO UPDATE SET value='1'"
    )


def _append_unique(values, additions):
    result = list(values) if isinstance(values, list) else []
    for value in additions:
        if value not in result:
            result.append(value)
    return result


def _enable_in_document(document, targets):
    """Add Seedance 2.0 to an explicit project pool without narrowing it."""
    pool = document.get('modelPool')
    if not isinstance(pool, dict):
        return False
    video = pool.get('video')
    if not isinstance(video, list):
        return False
    before = list(video)
    for provider_id, model_ids in targets:
        for model_id in model_ids:
            target = {'providerId': provider_id, 'modelId': model_id}
            if target not in video:
                video.append(target)
    return video != before


def enable_seedance_20(connection):
    """Expose Seedance 2.0 beside 2.5 for Ark and HC providers/projects."""
    marker = connection.execute("SELECT value FROM settings WHERE key='seedance_20_enabled'").fetchone()
    if marker:
        return
    row = connection.execute("SELECT value FROM settings WHERE key='providers'").fetchone()
    providers = json.loads(row['value']) if row else []
    changed = False
    targets = []
    for provider in providers:
        provider_type = provider.get('type')
        model_ids = ARK_SEEDANCE_MODELS if provider_type == 'volcengine_ark' else HC_SEEDANCE_MODELS if provider_type == 'hc_atom' else None
        if not model_ids:
            continue
        models = provider.setdefault('models', {})
        if not models.get('video'):
            models['video'] = model_ids[0]
            changed = True
        enabled = provider.setdefault('enabled_models', {})
        video = _append_unique(enabled.get('video'), model_ids)
        if video != enabled.get('video'):
            enabled['video'] = video
            changed = True
        targets.append((str(provider.get('id') or ''), model_ids))
    if changed:
        connection.execute(
            "INSERT INTO settings(key,value) VALUES('providers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(providers, ensure_ascii=False, separators=(',', ':')),),
        )
    for table, id_column, document_column in (
        ('projects', 'id', 'document'),
        ('productions', 'id', 'shared_context'),
    ):
        for item in connection.execute(f'SELECT {id_column},{document_column} FROM {table} WHERE {document_column} IS NOT NULL').fetchall():
            document = json.loads(item[document_column])
            if not _enable_in_document(document, targets):
                continue
            connection.execute(
                f'UPDATE {table} SET {document_column}=?,revision=revision+1 WHERE {id_column}=?',
                (json.dumps(document, ensure_ascii=False, separators=(',', ':')), item[id_column]),
            )
    connection.execute(
        "INSERT INTO settings(key,value) VALUES('seedance_20_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'"
    )
