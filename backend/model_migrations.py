"""One-time migrations for provider and project model selections."""
from __future__ import annotations

import json

TARGET_SEEDANCE = 'doubao-seedance-2-5-260628'


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
