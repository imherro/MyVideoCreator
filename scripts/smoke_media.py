"""Real local media smoke using the existing engine; isolated studio storage."""
import os,sys,tempfile,time,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['MVC_DATA_DIR']=tempfile.mkdtemp(prefix='mvc-media-smoke-')
from backend import store as s,runtime
from backend.worker import Worker,register
s.init();runtime.bootstrap()
pid=s.uid('smoke-project-');now=time.time()
with s.db() as c:c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'Media smoke','{}',now,now))
kind=sys.argv[1] if len(sys.argv)>1 else 'image'
provider=next(p for p in s.get_setting('providers',[]) if p['kind']==kind)
jid=s.uid('smoke-job-')
inp={'provider':provider['id'],'model':provider['model'],'prompt':'电影写实中景，雨后的小巷里，一只橘猫坐在纸箱旁，纸箱里有巴掌大小的圆头金属机器人。柔和自然光，湿润石板反光，安静温暖，无文字。','resolution':'864x480' if kind=='video' and provider['model']=='minimax_h3' else '512x512','seed':42,'frames':124 if provider['model']=='minimax_h3' else 49}
with s.db() as c:
    c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,'n1',kind,'running',s.dumps(inp),now,now))
    c.execute('INSERT INTO job_private VALUES(?,?)',(jid,s.dumps(provider)))
job={'id':jid,'submission_id':jid,'project_id':pid,'node_id':'n1','kind':kind,'input':inp}
if len(sys.argv)>2:
    reference=register(job,Path(sys.argv[2]),'首帧.jpg')
    inp['asset_ids']=[reference['id']]
    inp['prompt']='橘猫轻轻转头看向纸箱里的小机器人，机器人微微抬头，胸前灯光渐亮。镜头保持稳定，动作轻柔，保持首帧外观与场景，无对白。'
    with s.db() as c:c.execute('UPDATE jobs SET input=? WHERE id=?',(s.dumps(inp),jid))
print('DATA',s.DATA,flush=True);print('MODEL',provider['model'],flush=True)
try:
    result=Worker().execute(job)
    assert result['assets'] and all(a['kind']==kind for a in result['assets']),result
    s.job_update(jid,status='succeeded',result=result,progress=100,phase='测试完成')
    print('RESULT',json.dumps(result,ensure_ascii=False),flush=True)
    print('SECONDS',round(time.time()-now,1),flush=True)
except Exception as exc:
    s.job_update(jid,status='failed',error=str(exc),phase='媒体验收失败')
    raise
finally:runtime.unload()
