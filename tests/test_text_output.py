import json
from contextlib import contextmanager

import pytest

from backend.text_output import output_budget, TextOutputTruncated
from backend.worker import Worker


def test_storyboard_budget_scales_and_repair_grows():
    inp={'kind':'storyboard','target_duration':120}
    assert output_budget(inp)==17000
    assert output_budget(inp,stage_id='visual_bible')==8192
    assert output_budget(inp,stage_id='bound_storyboard_repair')==32768
    assert output_budget(inp,local=True)==12000
    assert output_budget({'kind':'storyboard','target_duration':3600})==32768
    assert output_budget({'kind':'text'})==4096


@pytest.mark.parametrize('reason', ['stop','length'])
def test_stream_records_finish_reason_and_final_text(monkeypatch, reason):
    from backend import worker as module
    updates=[];sent=[]
    class Response:
        is_success=True
        def iter_lines(self):
            for packet in [
                {'choices':[{'delta':{'content':'{"shots": []}'}}]},
                {'choices':[{'delta':{},'finish_reason':reason}]},
                {'choices':[],'usage':{'completion_tokens':17}},
            ]:yield 'data: '+json.dumps(packet)
            yield 'data: [DONE]'
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        @contextmanager
        def stream(self,*args,**kwargs):
            sent.append(kwargs['json']);yield Response()
    monkeypatch.setattr(module.httpx,'Client',Client)
    monkeypatch.setattr(module.s,'job_update',lambda jid,**fields:updates.append(fields))
    monkeypatch.setattr(Worker,'progress',lambda *args:None)
    monkeypatch.setattr(Worker,'cancelled',lambda *args:False)
    trace={}
    job={'id':'test','kind':'storyboard','input':{'provider':'cloud','target_duration':120},'_text_trace':trace,'_publish_trace':lambda:None}
    call=lambda:Worker()._chat_text(job,{'url':'https://example.invalid','model':'test'},'system','user')
    if reason=='length':
        with pytest.raises(TextOutputTruncated,match='截断'):call()
    else:assert call()=='{"shots": []}'
    assert sent[0]['max_tokens']==17000
    assert trace['attempts'][0]['finish_reason']==reason
    assert trace['attempts'][0]['usage']['completion_tokens']==17
    assert updates[-1]['result']['text']=='{"shots": []}'


def test_film_bible_truncation_retries_only_failed_stage_once(monkeypatch):
    from backend import worker as module
    from backend import film_bible
    calls=[]
    monkeypatch.setattr(module.s,'job_update',lambda *args,**kwargs:None)
    def chat(self,job,*args):
        calls.append((job['_text_stage'],job.get('_text_expanded',False)))
        raise TextOutputTruncated('输出截断')
    def extract(*args,**kwargs):
        return args[4]('system','user',{},'拆解分镜','bound_storyboard')
    monkeypatch.setattr(Worker,'_chat_text',chat)
    monkeypatch.setattr(film_bible,'extract_storyboard',extract)
    job={'id':'test','kind':'storyboard','input':{'provider':'cloud','film_bible':True,'prompt':'剧本','target_duration':120}}
    with pytest.raises(TextOutputTruncated):Worker().text(job,{'model':'test'})
    assert calls==[('bound_storyboard',False),('bound_storyboard',True)]
