import os,sys,tempfile,time,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['MVC_DATA_DIR']=tempfile.mkdtemp(prefix='mvc-storyboard-smoke-')
from backend import store as s,runtime
from backend.worker import Worker
s.init();runtime.bootstrap();s.set_setting('llama_context',4096)
pid=s.uid();jid=s.uid();now=time.time()
inp={'provider':'local','model':runtime.discover()[0]['id'],'target_duration':10,'max_tokens':1800,'prompt':'写两个镜头，每镜5秒，总共10秒。雨后小巷，一只橘猫发现纸箱中的小机器人，伸爪轻触，机器人胸灯亮起。无对白，电影写实。'}
with s.db() as c:
    c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'Storyboard smoke','{}',now,now))
    c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,'n1','storyboard','running',s.dumps(inp),now,now))
print('DATA',s.DATA,flush=True)
print('MODEL',inp['model'],flush=True)
try:
    result=Worker().execute({'id':jid,'submission_id':jid,'project_id':pid,'node_id':'n1','kind':'storyboard','input':inp})
    print(json.dumps(result,ensure_ascii=False),flush=True)
    assert len(result['shots'])==2,result
    assert sum(s['duration'] for s in result['shots'])==10,result
    (s.DATA/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    s.job_update(jid,status='succeeded',result=result,progress=100,phase='分镜验收完成')
    print('SECONDS',round(time.time()-now,1),flush=True)
except Exception as exc:
    s.job_update(jid,status='failed',error=str(exc),phase='分镜验收失败')
    raise
finally:runtime.unload()
