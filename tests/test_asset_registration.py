import time
import pytest
from backend import store as s
from backend import worker

def test_cancel_during_media_probe_never_publishes_asset(monkeypatch,tmp_path):
    s.init();pid=s.uid();jid=s.uid();now=time.time()
    with s.db() as c:
        c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'race','{}',now,now))
        c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,'n','video','running','{}',now,now))
    source=tmp_path/'result.mp4';source.write_bytes(b'test')
    existing=set(s.ASSETS.iterdir())
    def probe(path):
        s.job_update(jid,status='cancelled')
        return {'duration':1}
    monkeypatch.setattr(worker,'probe',probe)
    with pytest.raises(InterruptedError):worker.register({'id':jid,'project_id':pid,'node_id':'n','input':{}},source)
    with s.db() as c:assert c.execute('SELECT count(*) FROM assets WHERE project_id=?',(pid,)).fetchone()[0]==0
    assert set(s.ASSETS.iterdir())==existing
    assert source.exists()
