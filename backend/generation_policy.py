"""Provider-neutral generation target selection."""
from __future__ import annotations

KINDS = ('text', 'image', 'video')
MODEL_POOL_KINDS = KINDS + ('audio',)

def _configured_model(provider, kind):
    if kind == 'audio' and provider.get('type') == 'volcengine_speech':
        return str(provider.get('resource_id') or 'seed-tts-2.0')
    return str((provider.get('models') or {}).get(kind) or provider.get('model') or '')

def enabled_models(provider, kind):
    if provider.get('kind') and provider.get('kind') != kind:
        return []
    configured=(provider.get('enabled_models') or {}).get(kind)
    if isinstance(configured,list):
        values=[str(value).strip() for value in configured if str(value).strip()]
        if values:return list(dict.fromkeys(values))
        if kind in (provider.get('enabled_models') or {}):return []
    fallback=_configured_model(provider,kind)
    return [fallback] if fallback else []

def default_model_pool(providers):
    result={kind:[] for kind in MODEL_POOL_KINDS}
    for provider in providers:
        for kind in MODEL_POOL_KINDS:
            result[kind].extend({'providerId':provider['id'],'modelId':model} for model in enabled_models(provider,kind))
    return result

def default_new_project_model_pool(providers):
    """New projects include every model enabled in the system library."""
    return default_model_pool(providers)

def validate_model_pool(pool,providers,allow_missing=False):
    if pool is None:return None
    if not isinstance(pool,dict):raise ValueError('项目模型池必须是对象')
    configured={provider.get('id'):provider for provider in providers}
    result={}
    for kind in MODEL_POOL_KINDS:
        values=pool.get(kind,[])
        if not isinstance(values,list):raise ValueError(f'项目可用{kind}模型必须是数组')
        targets=[];seen=set()
        for target in values:
            if not isinstance(target,dict) or not target.get('providerId') or not isinstance(target.get('modelId'),str):
                raise ValueError(f'项目可用{kind}模型配置无效')
            provider_id=target['providerId'];model_id=target['modelId'].strip();key=(provider_id,model_id)
            if not model_id or key in seen:continue
            if provider_id=='local' and kind=='text':
                targets.append({'providerId':'local','modelId':model_id});seen.add(key);continue
            provider=configured.get(provider_id)
            if not provider and allow_missing:
                targets.append({'providerId':provider_id,'modelId':model_id});seen.add(key);continue
            if not provider:raise ValueError(f'项目可用{kind}模型所用服务已不存在')
            if provider.get('kind') and provider['kind']!=kind:raise ValueError(f'项目可用{kind}模型与服务用途不匹配')
            if model_id not in enabled_models(provider,kind) and not allow_missing:raise ValueError(f'{provider.get("name",provider_id)} 未在系统模型库启用 {model_id}')
            targets.append({'providerId':provider_id,'modelId':model_id});seen.add(key)
        result[kind]=targets
    return result

def validate_policy_in_pool(policy,pool):
    if pool is None:return
    for kind in KINDS:
        target=policy.get(kind)
        if target is not None and target not in pool.get(kind,[]):
            raise ValueError(f'项目默认{kind}模型必须先加入项目可用模型')

def default_ark_policy(providers):
    preferences = {
        'text': ('volcengine_ark', 'doubao-seed-2-1-pro'),
        'image': ('volcengine_ark', 'doubao-seedream-5-0-pro'),
        'video': ('hc_atom', 'doubao-seedance-2.5'),
    }
    result = {}
    for kind in KINDS:
        provider_type, model_prefix = preferences[kind]
        preferred = next((provider for provider in providers
            if provider.get('type') == provider_type
            and any(model.startswith(model_prefix) for model in enabled_models(provider, kind))), None)
        fallback = next((provider for provider in providers
            if provider.get('type') in ('volcengine_ark', 'hc_atom')
            and enabled_models(provider, kind)), None)
        provider = preferred or fallback
        if not provider:
            result[kind] = None
            continue
        models = enabled_models(provider, kind)
        model = next((candidate for candidate in models if candidate.startswith(model_prefix)), models[0])
        result[kind] = {'providerId': provider['id'], 'modelId': model}
    return result

def validate_generation_policy(policy, providers, allow_missing=False):
    if not isinstance(policy, dict):
        raise ValueError('项目生成策略必须是对象')
    configured = {p.get('id'): p for p in providers}
    result = {}
    for kind in KINDS:
        target = policy.get(kind)
        if target is None:
            result[kind] = None
            continue
        if not isinstance(target, dict) or not target.get('providerId'):
            raise ValueError(f'项目默认{kind}模型配置无效')
        if kind == 'text' and target['providerId'] == 'local':
            result[kind] = {'providerId': 'local', 'modelId': str(target.get('modelId', ''))}
            continue
        provider = configured.get(target['providerId'])
        if not provider and allow_missing:
            result[kind] = {'providerId': target['providerId'], 'modelId': str(target.get('modelId', ''))}
            continue
        if not provider:
            raise ValueError(f'项目默认{kind}模型所用服务已不存在，请重新选择')
        provider_kind = provider.get('kind')
        if provider_kind and provider_kind != kind:
            raise ValueError(f'项目默认{kind}模型与服务用途不匹配')
        result[kind] = {'providerId': target['providerId'], 'modelId': str(target.get('modelId', ''))}
    return result

def resolve_generation_target(kind, override, project_policy, providers, local_models=None):
    if kind not in KINDS:
        raise ValueError('不支持的生成类型')
    configured = {p.get('id'): p for p in providers}
    candidate = None
    source = 'system'
    if isinstance(override, dict) and override.get('mode') == 'override':
        candidate = {'providerId': override.get('providerId'), 'modelId': override.get('modelId', '')}
        source = 'override'
    elif isinstance(project_policy, dict) and project_policy.get(kind) is not None:
        candidate = project_policy[kind]
        source = 'project'
    if candidate:
        provider_id = candidate.get('providerId')
        if provider_id == 'local' and kind == 'text':
            return {'providerId': 'local', 'modelId': candidate.get('modelId', ''), 'source': source}
        provider = configured.get(provider_id)
        if not provider:
            raise ValueError(f'{source} 配置的模型服务已不存在，请重新选择；未自动切换其他服务')
        if provider.get('kind') and provider['kind'] != kind:
            raise ValueError(f'{source} 配置的模型服务不支持 {kind}')
        model = candidate.get('modelId') or (provider.get('models') or {}).get(kind) or provider.get('model', '')
        return {'providerId': provider_id, 'modelId': model, 'source': source}
    provider = next((p for p in providers if not p.get('local') and (not p.get('kind') or p.get('kind') == kind)), None)
    if provider:
        return {'providerId': provider['id'], 'modelId': (provider.get('models') or {}).get(kind) or provider.get('model', ''), 'source': 'system'}
    if kind == 'text':
        model = (local_models or [{}])[0].get('id', '') if local_models else ''
        return {'providerId': 'local', 'modelId': model, 'source': 'system'}
    provider = next((p for p in providers if p.get('kind') == kind), None)
    if not provider:
        return {'providerId': '', 'modelId': '', 'source': 'system'}
    return {'providerId': provider['id'], 'modelId': (provider.get('models') or {}).get(kind) or provider.get('model', ''), 'source': 'system'}
