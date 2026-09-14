"""Freeze the exact text prompt contract used by a durable job."""
from __future__ import annotations

import copy


def freeze_prompt_contract(kind: str, value: dict, *, origin: str = 'submission') -> dict:
    result = copy.deepcopy(value)
    stage = result.get('stage')
    system_prompt = None
    response_schema = None
    schema_version = None

    if stage == 'source_analysis':
        from .source_library import EVENT_SCHEMA, SYSTEM_PROMPT
        system_prompt, response_schema, schema_version = SYSTEM_PROMPT, EVENT_SCHEMA, 'source-events/v1'
    elif stage == 'adaptation_generation':
        from .adaptation import ADAPTATION_SCHEMA, ADAPTATION_SYSTEM_PROMPT
        system_prompt, response_schema, schema_version = ADAPTATION_SYSTEM_PROMPT, ADAPTATION_SCHEMA, 'adaptation-plan/v1'
    elif stage == 'script_generation':
        from .adaptation import SCRIPT_SCHEMA, SCRIPT_SYSTEM_PROMPT
        system_prompt, response_schema, schema_version = SCRIPT_SYSTEM_PROMPT, SCRIPT_SCHEMA, 'episode-script/v1'
    elif kind in ('text', 'storyboard') and not result.get('film_bible'):
        from .prompts import SHOT_SCHEMA, TEMPLATES
        system_prompt = TEMPLATES[kind]
        if kind == 'storyboard':
            response_schema, schema_version = SHOT_SCHEMA, 'storyboard/v1'

    if system_prompt is not None:
        result.setdefault('system_prompt', system_prompt)
    if response_schema is not None:
        result.setdefault('response_schema', response_schema)
        result.setdefault('schema_version', schema_version)
    if system_prompt is not None or response_schema is not None:
        result.setdefault('prompt_contract_origin', origin)
    return result
