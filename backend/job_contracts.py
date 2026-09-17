"""Freeze the exact text prompt contract used by a durable job."""
from __future__ import annotations

import copy

IMAGE_SYSTEM_PROMPT = """你是安影的影视分镜美术生成器。严格依据用户提示词、项目视觉风格和按顺序提供的独立参考图生成单张画面。参考图用于锁定角色身份、服装、场景结构和道具外观；只改变镜头明确要求的动作、表情、构图与光线。不要添加提示词未要求的文字、水印或拼贴。"""

VIDEO_SYSTEM_PROMPT = """你是安影的影视镜头生成器。严格依据用户提示词和首帧/尾帧参考生成连续视频，保持人物身份、服装、场景、道具和空间关系稳定。提示词中的对白必须由指定角色按原文说出，声音、开口时机、情绪和口型自然同步，不得改词、漏词或增加额外对白；没有台词的角色保持闭嘴。动作与摄影机运动应符合镜头描述，避免闪烁、形变、身份漂移、额外人物、字幕、文字和水印。"""

AUDIO_SYSTEM_PROMPT = """你是安影的角色对白合成器。严格使用角色 Film Bible 中已选择的固定音色和本次台词参数生成音频，不改变台词内容，不在前后添加说明、音乐或额外对白。"""


def freeze_prompt_contract(kind: str, value: dict, *, origin: str = 'submission') -> dict:
    result = copy.deepcopy(value)
    stage = result.get('stage')
    system_prompt = None
    response_schema = None
    schema_version = None

    if stage == 'script_import_analysis':
        from .script_import import SYSTEM_PROMPT, SCHEMA
        system_prompt, response_schema, schema_version = SYSTEM_PROMPT, SCHEMA, 'script-import/v1'
    elif stage == 'source_analysis':
        from .source_library import EVENT_SCHEMA, SYSTEM_PROMPT
        system_prompt, response_schema, schema_version = SYSTEM_PROMPT, EVENT_SCHEMA, 'source-events/v1'
    elif stage == 'adaptation_generation':
        from .adaptation import ADAPTATION_SCHEMA, ADAPTATION_SYSTEM_PROMPT
        system_prompt, response_schema, schema_version = ADAPTATION_SYSTEM_PROMPT, ADAPTATION_SCHEMA, 'adaptation-plan/v1'
    elif stage == 'adaptation_episode_generation':
        from .adaptation import EPISODE_PLAN_SCHEMA, EPISODE_PLAN_SYSTEM_PROMPT
        system_prompt, response_schema, schema_version = EPISODE_PLAN_SYSTEM_PROMPT, EPISODE_PLAN_SCHEMA, 'episode-plan/v2'
    elif stage == 'script_generation':
        from .adaptation import SCRIPT_SCHEMA, SCRIPT_SYSTEM_PROMPT
        system_prompt, response_schema, schema_version = SCRIPT_SYSTEM_PROMPT, SCRIPT_SCHEMA, 'episode-script/v1'
        if (result.get('episode_script_generation') or {}).get('mode') == 'direct':
            system_prompt = '你是影视编剧。根据用户创作要求、目标时长、项目 Bible 与已有剧本，写可拍摄的本集剧本。无需原著或改编规划。使用场景标题、可见动作与明确角色对白，保持前集人物与情节连续，不编造缺失的前集事实，不输出分析过程。严格遵守目标时长，只生成本集。'
            schema_version = 'direct-episode-script/v1'
    elif kind == 'storyboard' and result.get('film_bible'):
        from .film_bible.reuse import visual_user_prompt
        from .film_bible.models import (
            BOUND_STORYBOARD_SCHEMA, STORYBOARD_DIRECTOR_PROMPT,
            VISUAL_BIBLE_SCHEMA, VISUAL_EXTRACTOR_PROMPT,
        )
        result.setdefault('prompt_stages', [
            {
                'id': 'visual_bible', 'label': '阶段 1 · 提取视觉资产卡',
                'system_prompt': VISUAL_EXTRACTOR_PROMPT,
                'user_prompt': visual_user_prompt(result.get('prompt', '')+('\n\n作品共享设定（仅用于本集出场人物与场景的一致性，不增加其他集剧情）：\n'+result['storyboard_visual_context']['imported_story'] if (result.get('storyboard_visual_context') or {}).get('imported_story') else ''),(result.get('storyboard_visual_context') or {}).get('visual')),
                'response_schema': VISUAL_BIBLE_SCHEMA,
                'schema_version': 'visual-bible/v2' if result.get('storyboard_visual_context') else 'visual-bible/v1',
            },
            {
                'id': 'bound_storyboard', 'label': '阶段 2 · 生成绑定分镜',
                'system_prompt': STORYBOARD_DIRECTOR_PROMPT,
                'user_prompt_template': '剧本：\n{{script}}\n\n只允许引用以下视觉卡：\n{{visual_cards_json}}\n{{duration_constraint}}',
                'response_schema': BOUND_STORYBOARD_SCHEMA,
                'schema_version': 'bound-storyboard/v2',
            },
        ])
        schema_version = 'film-bible-storyboard/v2' if result.get('storyboard_visual_context') else 'film-bible-storyboard/v1'
    elif kind in ('text', 'storyboard'):
        from .prompts import SHOT_SCHEMA, TEMPLATES
        system_prompt = TEMPLATES[kind]
        if kind == 'storyboard':
            response_schema, schema_version = SHOT_SCHEMA, 'storyboard/v1'
    elif kind == 'image':
        system_prompt, schema_version = IMAGE_SYSTEM_PROMPT, 'image-generation/v1'
    elif kind == 'video':
        system_prompt, schema_version = VIDEO_SYSTEM_PROMPT, 'video-generation/v2'
    elif kind == 'audio':
        system_prompt, schema_version = AUDIO_SYSTEM_PROMPT, 'dialogue-tts/v1'

    if system_prompt is not None:
        result.setdefault('system_prompt', system_prompt)
    if response_schema is not None:
        result.setdefault('response_schema', response_schema)
        result.setdefault('schema_version', schema_version)
    if schema_version is not None:
        result.setdefault('schema_version', schema_version)
    if system_prompt is not None or response_schema is not None or result.get('prompt_stages'):
        result.setdefault('prompt_contract_origin', origin)
    return result
