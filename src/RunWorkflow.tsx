import {useEffect,useRef,useState} from 'react';
type Value=Record<string,any>;
export function RunWorkflow({nodes,edges,providers,selected,onRun,onPreview}:{nodes:Value[];edges:Value[];providers:Value[];selected:string|null;onRun:(options:Value)=>Promise<void>;onPreview:(options:Value)=>Promise<Value>}) {
 const selection=nodes.some(n=>n.id===selected&&['text','storyboard','image','video'].includes(n.data?.kind))?selected:null;
 const [scope,setScope]=useState(selection?'branch':'all'),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[plan,setPlan]=useState<Value|null>(null);
 const effectiveScope=selection?scope:'all';
 const options={node_ids:effectiveScope==='all'?undefined:[selection],include_descendants:effectiveScope==='branch'};
 const signature=JSON.stringify([nodes,edges,options]);
 const previewRef=useRef(onPreview);previewRef.current=onPreview;
 useEffect(()=>{let active=true;setPlan(null);setError('');setLoading(true);const timer=setTimeout(()=>{void previewRef.current(options).then(p=>{if(active)setPlan(p)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})},250);return()=>{active=false;clearTimeout(timer)}},[signature]);
 const tasks=plan?.tasks||[];
 return <><p className="muted">重新生成本次范围内的节点，包括所需上游；历史素材保留。下游等待上游完成，资产卡片仅作为参考使用。</p><label>执行范围<select disabled={busy} value={effectiveScope} onChange={e=>setScope(e.target.value)}><option value="all">整个画布</option>{selection&&<><option value="branch">所选节点及下游分支</option><option value="ancestors">所选节点及所需上游</option></>}</select></label><h3>{loading?'正在核对执行范围…':`本次 ${tasks.length} 个任务`}</h3>{tasks.map((n:Value)=><p key={n.id}>{n.label} · {providers.find(p=>p.id===n.provider)?.name||(n.provider==='local'?'本地文本':'服务未配置')}</p>)}{error&&<p className="error">{error}</p>}<button className="primary full" disabled={busy||loading||!plan||!tasks.length} onClick={async()=>{setBusy(true);setError('');try{await onRun({...options,expected_revision:plan?.revision})}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>{busy?'提交中':'加入生成队列'}</button></>;
}
