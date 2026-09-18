import json
import pytest
from backend import source_extraction as module
from backend.text_output import TextOutputTruncated, output_budget


def test_split_preserves_every_character_and_bounds_chunks():
    text=('第一段。\n第二段没有句号'*1200)+'结束'
    parts=module.split_input(text)
    assert ''.join(parts)==text
    assert len(parts)>1 and all(0<len(part)<=6000 for part in parts)
    assert output_budget({'source_event_extraction':{'chapterId':'x'}})==12000


@pytest.mark.parametrize('fail_second',[False,True])
def test_all_chunks_must_validate_before_single_write(monkeypatch,fail_second):
    saved=[];calls=[]
    monkeypatch.setattr(module.s,'job_update',lambda *args,**kwargs:None)
    monkeypatch.setattr(module,'replace_events',lambda job,rows:saved.append(rows) or rows)
    class Worker:
        def _chat_text(self,job,*args):
            stage=job['_text_stage'];calls.append(stage)
            if fail_second and stage=='source_events_2':raise TextOutputTruncated('截断')
            return json.dumps({'events':[{'characters':['甲'],'summary':stage,'importance':'high','emotion':'平静','continuity':{}}]})
    job={'id':'test','input':{'prompt':'甲'*7000,'source_event_extraction':{'chapterId':'x'}}}
    if fail_second:
        with pytest.raises(ValueError,match='已有事件未覆盖'):module.extract(Worker(),job,{})
        assert saved==[] and calls==['source_events_1','source_events_2','source_events_2']
    else:
        result=module.extract(Worker(),job,{})
        assert len(saved)==1 and len(result['events'])==2
        assert [r['summary'] for r in saved[0]]==['source_events_1','source_events_2']
