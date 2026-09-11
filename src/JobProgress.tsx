import {useEffect,useState} from 'react';
export function JobProgress({job}:{job:Record<string,any>}){
 const [now,setNow]=useState(Date.now()/1000);
 const active=['running','queued'].includes(job.status);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()/1000),1000);return()=>clearInterval(timer)},[active]);
 const format=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));return s>=60?`${Math.floor(s/60)} 分 ${s%60} 秒`:`${s} 秒`};
 const data=job.telemetry||{},elapsed=(job.finished||(active?now:job.updated)||job.created)-(job.started||job.created);
 const progress=Number.isFinite(job.progress)?Math.max(0,Math.min(100,job.progress)):null;
 return <div className="job-progress-detail"><small>{job.started?'运行':'提交后'} {format(elapsed)}{job.started&&job.started>job.created+1?` · 排队 ${format(job.started-job.created)}`:''}</small>
 {job.status==='running'&&<><progress aria-label="生成进度" max="100" value={progress??undefined}/><small>{data.total_steps>0?`步骤 ${data.step||0} / ${data.total_steps}`:job.phase||'等待引擎进度'}{progress!==null?` · ${progress.toFixed(0)}%`:''}</small>{typeof data.generation_eta_seconds==='number'&&data.generation_eta_seconds>0&&<small>引擎估计剩余约 {format(data.generation_eta_seconds)}，随运行更新</small>}{data.total_windows>1&&<small>窗口 {data.current_window} / {data.total_windows}</small>}</>}
 </div>;
}
