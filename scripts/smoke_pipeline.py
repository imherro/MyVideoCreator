"""Continue a validated storyboard through native image -> video -> export.
Usage: python scripts/smoke_pipeline.py /absolute/path/to/storyboard/result.json
Uses isolated storage; no downloads or cloud providers.
"""
import os,sys,tempfile,time,json,argparse
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('storyboard',type=Path)
parser.add_argument('--resume',type=Path,help='Reuse a finished or failed acceptance directory; active jobs are rejected')
parser.add_argument('--all-shots',action='store_true',help='Generate every storyboard shot and concatenate the finished clips')
parser.add_argument('--images-only',action='store_true',help='Generate initial images only; skip video and export stages')
args=parser.parse_args()
source=args.storyboard.resolve()
story=json.loads(source.read_text(encoding='utf-8'))
if args.resume and not (args.resume/'studio.sqlite').is_file():raise ValueError('Resume database does not exist')
os.environ['MVC_DATA_DIR']=str(args.resume.resolve()) if args.resume else tempfile.mkdtemp(prefix='mvc-pipeline-')
from backend import store as s,runtime
from backend.worker import Worker
from backend.prompts import validate_shots
validate_shots(story)
s.init();runtime.bootstrap()
providers=s.get_setting('providers',[])
now=time.time();worker=Worker()
if args.resume:
    with s.db() as c:
        projects=c.execute('SELECT * FROM projects').fetchall()
        if len(projects)!=1 or projects[0]['name']!='Native pipeline acceptance':raise ValueError('Not an isolated pipeline acceptance directory')
        if c.execute("SELECT 1 FROM jobs WHERE status IN ('running','queued','interrupted')").fetchone():raise ValueError('Unresolved job exists: inspect the original process and engine handle before resuming')
        pid=projects[0]['id']
        if json.loads(projects[0]['document'])['shots']!=story['shots']:raise ValueError('Storyboard differs from original acceptance input')
    results=json.loads((s.DATA/'pipeline-result.json').read_text(encoding='utf-8')) if (s.DATA/'pipeline-result.json').exists() else {}
else:
    pid=s.uid('pipeline-')
    with s.db() as c:c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'Native pipeline acceptance',s.dumps({'shots':story['shots']}),now,now))
    results={}
results.update(storyboard_source=str(source),shots=story['shots'])
print('DATA',s.DATA,flush=True)
def run(stage,kind,inp,provider=None):
    if stage in results:
        previous=results[stage]
        with s.db() as c:
            row=c.execute('SELECT status FROM jobs WHERE id=? AND project_id=?',(previous['job_id'],pid)).fetchone()
            asset=previous['result']['assets'][0]
            stored=c.execute('SELECT path FROM assets WHERE id=? AND project_id=?',(asset['id'],pid)).fetchone()
        if not row or row['status']!='succeeded' or not stored or not (s.ASSETS/stored['path']).is_file():raise ValueError('Cached stage is not a verified successful result')
        print('REUSE',stage,previous['job_id'],flush=True)
        return asset
    jid=s.uid('pipeline-job-');started=time.time()
    with s.db() as c:
        c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,jid,kind,'running',s.dumps(inp),started,started))
        if provider:c.execute('INSERT INTO job_private VALUES(?,?)',(jid,s.dumps(provider)))
    job={'id':jid,'submission_id':jid,'project_id':pid,'node_id':jid,'kind':kind,'input':inp}
    print('START',stage,jid,flush=True)
    try:
        value=worker.execute(job)
        assert value.get('assets'),value
        s.job_update(jid,status='succeeded',result=value,progress=100,phase='Pipeline acceptance complete')
        results[stage]={'result':value,'seconds':round(time.time()-started,2),'job_id':jid}
        (s.DATA/'pipeline-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
        print('DONE',stage,results[stage]['seconds'],flush=True)
        return value['assets'][0]
    except Exception as exc:
        s.job_update(jid,status='failed',error=str(exc),phase='Pipeline acceptance failed')
        raise
try:
    image_provider=next(p for p in providers if p.get('local') and p['kind']=='image')
    video_provider=next(p for p in providers if p.get('local') and p['kind']=='video')
    selected=story['shots'] if args.all_shots else story['shots'][:1]
    timeline=[]
    for index,shot in enumerate(selected):
        suffix='' if not args.all_shots else '-'+str(index+1)
        image=run('image'+suffix,'image',{'provider':image_provider['id'],'model':image_provider['model'],'prompt':shot['image_prompt'],'resolution':'864x480','seed':42+index},image_provider)
        if args.images_only:continue
        video=run('video'+suffix,'video',{'provider':video_provider['id'],'model':video_provider['model'],'prompt':shot['video_prompt'],'resolution':'864x480','frames':124,'seed':42+index,'asset_ids':[image['id']]},video_provider)
        timeline.append({'asset_id':video['id'],'start':0,'duration':shot['duration'],'volume':1})
    if args.images_only:
        print('COMPLETE images only',flush=True)
        raise SystemExit(0)
    if args.all_shots:results['acceptance']={'shots':len(selected),'planned_duration':sum(shot['duration'] for shot in selected)}
    film=run('export','export',{'timeline':timeline,'resolution':'1280x720','transition':'cut'})
    print('COMPLETE',json.dumps(film,ensure_ascii=False),flush=True)
finally:runtime.unload()
