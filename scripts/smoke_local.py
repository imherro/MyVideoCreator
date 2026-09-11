"""Real local text smoke test, isolated from the user's studio account/database."""
import os
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['MVC_DATA_DIR']=tempfile.mkdtemp(prefix='mvc-local-smoke-')
from backend import store as s, runtime
from backend.worker import Worker
s.init()
s.set_setting('llama_context',4096)
models=runtime.discover()
if not models: raise SystemExit('No local GGUF models found')
model=models[0]
pid=s.uid('smoke-project-');jid=s.uid('smoke-job-');now=time.time()
inp={'provider':'local','model':model['id'],'prompt':'写一句不超过二十字的中文电影开场：雨后，一只橘猫发现小机器人。','max_tokens':128}
with s.db() as c:
    c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'Local smoke','{}',now,now))
    c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,'n1','text','running',s.dumps(inp),now,now))
job={'id':jid,'submission_id':jid,'project_id':pid,'node_id':'n1','kind':'text','input':inp}
print('MODEL',model['name'],flush=True)
try:
    result=Worker().execute(job)
    assert result.get('text'),result
    print('RESULT',result['text'],flush=True)
    print('ELAPSED_SECONDS',round(time.time()-now,2),flush=True)
finally:
    runtime.unload()
