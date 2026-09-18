import {useEffect,useRef,useState} from 'react';
import {Sparkles,Undo2} from 'lucide-react';
type Value=Record<string,any>;
export function VideoPromptAdvice({projectId,nodeId,prompt,shot,jobs,disabled,request,prepare,onApply,onJob}:{projectId:string;nodeId:string;prompt:string;shot:Value;jobs:Value[];disabled:boolean;request:(path:string,options?:RequestInit)=>Promise<any>;prepare:()=>Promise<void>;onApply:(text:string)=>void;onJob:(job:Value)=>void}){
 const [job,setJob]=useState<Value|null>(null),[suggestion,setSuggestion]=useState<Value|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[undo,setUndo]=useState<{before:string;after:string}|null>(null);
 const seen=useRef('');
 const latest=jobs.filter(j=>j.node_id==='video-prompt-advice:'+nodeId).sort((a,b)=>b.created-a.created)[0];
 useEffect(()=>{if(latest&&latest.id!==seen.current){seen.current=latest.id;setJob(latest);}},[latest?.id]);
 useEffect(()=>{if(!job)return;let alive=true;let timer:ReturnType<typeof setTimeout>;
  async function poll(){try{const next=await request('/jobs/'+job!.id);if(!alive)return;setJob(next);
   if(['queued','running'].includes(next.status)){timer=setTimeout(poll,2500);return;}
   if(next.status==='succeeded'&&next.result?.videoPromptAdvice){if(sessionStorage.getItem('video-advice-reviewed-'+projectId+'-'+nodeId)!==next.id)setSuggestion(next.result.videoPromptAdvice);}
   else setError(next.error||'优化未完成，请在任务中心查看');
  }catch{if(alive){setError('读取优化任务失败，正在重试');timer=setTimeout(poll,5000);}}}
  void poll();return()=>{alive=false;clearTimeout(timer);};
 },[job?.id]);
 const running=busy||!!job&&['queued','running'].includes(job.status);
 async function generate(){setBusy(true);setError('');try{await prepare();const next=await request(`/projects/${projectId}/video-prompt-advice/${encodeURIComponent(nodeId)}`,{method:'POST',body:JSON.stringify({submission_id:'video-advice-'+Date.now()})});seen.current=next.id;setJob(next);setSuggestion(null);onJob(next);}catch(e:any){setError(e.message||String(e));}finally{setBusy(false);}}
 function dismiss(){if(job)sessionStorage.setItem('video-advice-reviewed-'+projectId+'-'+nodeId,job.id);setSuggestion(null);}
 function apply(){if(prompt!==(job?.input?.original_prompt||'')||['duration','dialogues','assetBindings','videoReferenceMode','dialogueMode','motionReference','action','camera'].some(key=>JSON.stringify(shot[key])!==JSON.stringify(job?.input?.shot_snapshot?.[key]))){setError('当前镜头内容或参考设置已修改，请重新优化，避免应用过期建议。');return;}setUndo({before:prompt,after:suggestion!.prompt});onApply(suggestion!.prompt);dismiss();}
 return <div className="video-prompt-advice"><div className="video-prompt-advice-actions"><button className="quiet" disabled={disabled||running} onClick={()=>void generate()}><Sparkles size={14}/>{running?'AI 优化中…':'AI 优化'}</button>{undo&&<button className="quiet" disabled={disabled||prompt!==undo.after} title="仅撤销这次 AI 替换" onClick={()=>{onApply(undo.before);setUndo(null);}}><Undo2 size={14}/>撤销替换</button>}</div>
 {error&&<p role="alert" className="error">{error}</p>}
 {suggestion&&<section className="video-prompt-suggestion"><b>优化建议 · 尚未应用</b><textarea aria-label="优化后提示词" rows={5} value={suggestion.prompt} onChange={e=>setSuggestion({...suggestion,prompt:e.target.value})}/>{suggestion.changes.length>0&&<><small>调整说明</small><ul>{suggestion.changes.map((x:string,i:number)=><li key={i}>{x}</li>)}</ul></>}{suggestion.warnings.length>0&&<><small>需要你决定</small><ul>{suggestion.warnings.map((x:string,i:number)=><li key={i}>{x}</li>)}</ul></>}<div className="settings-actions"><button onClick={dismiss}>取消</button><button className="primary" disabled={disabled||running||!suggestion.prompt.trim()} onClick={apply}>应用提示词</button></div></section>}
 </div>;
}
