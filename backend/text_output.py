"""Bounded output budgets and explicit handling of incomplete model responses."""
import math


class TextOutputTruncated(ValueError):
    pass


def commercial_text_budget(provider, model, stage):
    """Application output allowance, not a claim about a model's maximum context."""
    if provider=='local':return {'script_import_analysis':12000,'adaptation_episode_generation':4000}.get(stage,12000)
    if 'doubao' not in str(model).lower():
        return {'script_import_analysis':16000,'adaptation_episode_generation':4000}.get(stage,12000)
    return {'script_import_analysis':32768,'adaptation_generation':32768,
            'adaptation_episode_generation':8192,'script_generation':24576}.get(stage,16384)


def output_budget(inp, *, local=False, stage_id='', expanded=False):
    cap = 12000 if local else 32768
    if inp.get('max_tokens') is not None:
        budget = max(1, int(inp['max_tokens']))
    elif inp.get('source_event_extraction'):
        budget = 12000
    elif inp.get('kind') == 'storyboard' or inp.get('film_bible'):
        duration = max(1, float(inp.get('target_duration') or 120))
        budget = 8192 if stage_id.startswith('visual_bible') else max(8192, math.ceil(duration / 8) * 1000 + 2000)
    elif not local and inp.get('prompt_policy_version'):
        budget = commercial_text_budget(inp.get('provider','cloud'), inp.get('model',''), inp.get('stage',''))
    else:
        model=str(inp.get('model') or '').lower()
        budget = 16384 if not local and 'doubao' in model else 4096
    if expanded or stage_id.endswith('_repair'):
        budget *= 2
    return min(budget, cap)
