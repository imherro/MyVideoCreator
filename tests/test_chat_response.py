import json
from contextlib import contextmanager
import pytest
from backend.worker import Worker
from backend import worker as module
from backend.chat_response import ChatResponseError
from backend.text_output import TextOutputTruncated


def event(value):return 'data: '+json.dumps(value)


@pytest.mark.parametrize('lines,category',[
    ([event({'choices':[{'delta':{'content':'正文'},'finish_reason':'stop'}]}),'data: [DONE]'],'success'),
    ([event({'choices':[{'delta':{'reasoning_content':'不能作为正文'},'finish_reason':'stop'}]})],'empty_result'),
    ([event({'error':{'message':'invalid api_key=secret-value'}})],'upstream_error'),
    ([json.dumps({'choices':[{'message':{'content':'正文'},'finish_reason':'stop'}]})],'success'),
    (['data: {broken',''],'parse_error'),
    ([event({'choices':[{'delta':{'content':'半截'},'finish_reason':'length'}]})],'truncated'),
    ([json.dumps({'answer':'不可猜测字段'})],'unsupported_format'),
    (['event: error','data: unavailable',''],'upstream_error'),
    ([event({'choices':[{'delta':{'content':['unsupported']}}]})],'unsupported_format'),
])
@pytest.mark.parametrize('http_status',[200,400])
def test_response_classification_and_persisted_diagnostics(monkeypatch,lines,category,http_status):
    updates=[]
    class Response:
        is_success=http_status==200;status_code=http_status
        headers={'content-type':'text/event-stream','x-request-id':'test-request'}
        def iter_lines(self):return iter(lines)
        def iter_bytes(self):yield b'{"error":{"message":"Bearer secret-value invalid","api_key":"secret-value"}}'
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        @contextmanager
        def stream(self,*args,**kwargs):yield Response()
    monkeypatch.setattr(module.httpx,'Client',Client)
    monkeypatch.setattr(module.s,'job_update',lambda jid,**fields:updates.append(fields))
    monkeypatch.setattr(Worker,'progress',lambda *args:None)
    monkeypatch.setattr(Worker,'cancelled',lambda *args:False)
    job={'id':'test','kind':'text','input':{'provider':'hc'}}
    call=lambda:Worker()._chat_text(job,{'url':'https://example.invalid','api_key':'secret-value'},'system','user')
    if http_status!=200:category='upstream_error'
    if category=='success':assert call()=='正文'
    else:
        with pytest.raises((ChatResponseError,TextOutputTruncated)):call()
    diag=updates[-1]['telemetry']['text_requests'][0]
    assert diag['category']==category
    assert diag['http_status']==http_status and diag['request_id']=='test-request'
    assert 'secret-value' not in json.dumps(diag)
    assert '不能作为正文' not in json.dumps(updates)
