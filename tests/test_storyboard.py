import json,time
import httpx,pytest
from backend import store as s
from backend.worker import Worker
from backend.prompts import validate_shots

def board(duration):
    return {'title':'雨后','shots':[{'id':'1','duration':duration,'scene':'小巷','characters':'橘猫','action':'发现机器人','camera':'中景固定','audio':'雨滴声','image_prompt':'雨后小巷，橘猫与机器人','video_prompt':'橘猫缓缓转头'}]}

def test_duration_and_required_fields_are_checked():
    assert validate_shots(board(5),5)['shots'][0]['id']=='shot-001'
    with pytest.raises(ValueError,match='总时长'):validate_shots(board(5),10)
    missing=board(5);del missing['shots'][0]['camera']
    with pytest.raises(ValueError,match='camera'):validate_shots(missing)

@pytest.mark.parametrize('fixed',[True,False])
def test_repair_is_limited_to_one_additional_request(monkeypatch,fixed):
    s.init();pid=s.uid();jid=s.uid();now=time.time()
    with s.db() as c:
        c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'repair','{}',now,now))
        c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,'n','storyboard','running','{}',now,now))
    job={'id':jid,'project_id':pid,'node_id':'n','kind':'storyboard','input':{'prompt':'写分镜','target_duration':10}}
    requests=[]
    def respond(request):
        requests.append(json.loads(request.content))
        content=json.dumps(board(10 if fixed and len(requests)==2 else 5),ensure_ascii=False)
        return httpx.Response(200,text='data: '+json.dumps({'choices':[{'delta':{'content':content}}]})+'\n\ndata: [DONE]\n\n')
    original=httpx.Client
    monkeypatch.setattr(httpx,'Client',lambda **kw:original(**kw,transport=httpx.MockTransport(respond)))
    if fixed:
        result=Worker().text(job,{'url':'http://test/v1','local':True})
        assert result['repair_count']==1
        assert result['shots'][0]['duration']==10
    else:
        with pytest.raises(ValueError,match='修正后仍'):Worker().text(job,{'url':'http://test/v1','local':True})
    assert len(requests)==2
    assert '上次结果未通过校验' in requests[1]['messages'][1]['content']
