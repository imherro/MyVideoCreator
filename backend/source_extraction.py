"""Extract long chapters in bounded parts; persist only the complete result."""
import json
import time

from .source_library import EVENT_SCHEMA, SYSTEM_PROMPT, validate_events, replace_events
from .text_output import TextOutputTruncated
from . import store as s


def split_input(text, limit=6000):
    parts=[]
    while len(text)>limit:
        end=max(text.rfind('\n',limit//2,limit),text.rfind('。',limit//2,limit))
        end=end+1 if end>=0 else limit
        parts.append(text[:end]);text=text[end:]
    if text:parts.append(text)
    return parts or ['']


def extract(worker, job, provider):
    inp=job['input'];parts=split_input(inp['prompt']);stages=[];rows=[]
    def publish():s.job_update(job['id'],telemetry={'prompt_stages':stages})
    for index,part in enumerate(parts,1):
        system=inp.get('system_prompt') or SYSTEM_PROMPT
        user=(f'本章第 {index}/{len(parts)} 段。只提取本段明确发生的事件，按顺序，摘要精炼，不逐句复述，不补写段外情节。\n'+part)
        stage={'id':f'source_events_{index}','phase':f'提取原著事件 {index}/{len(parts)}','system_prompt':system,'user_prompt':user,'response_schema':inp.get('response_schema') or EVENT_SCHEMA,'status':'running','started':time.time()}
        stages.append(stage);publish()
        stage_job={**job,'_text_stage':stage['id'],'_text_trace':stage,'_publish_trace':publish}
        try:
            for attempt in range(2):
                try:
                    raw=worker._chat_text({**stage_job,'_text_expanded':bool(attempt)},provider,system,user,stage['response_schema'],stage['phase'])
                    parsed=validate_events(json.loads(raw.strip()))
                    break
                except (TextOutputTruncated,json.JSONDecodeError,ValueError) as exc:
                    if attempt:raise ValueError(f'事件提取结果校验失败（第 {index}/{len(parts)} 段）：{exc}；已有事件未覆盖') from exc
                    stage['recovery']='结果未完整通过校验，扩大额度并精简输出重试一次'
                    stage['validation_error']=str(exc);publish()
                    user+='\n上次结果未通过校验：'+str(exc)+'\n请重新提取本段，摘要简洁，严格输出完整闭合 JSON；不要解释或 Markdown。'
                    stage['user_prompt']=user
            rows.extend(parsed)
            stage.update(status='validated',event_count=len(parsed))
        except Exception as exc:
            stage.update(status='request_failed',error=str(exc));raise
        finally:
            stage['finished']=time.time();publish()
    rows=replace_events(job,rows)
    return {'text':s.dumps({'events':rows}),'events':rows}
