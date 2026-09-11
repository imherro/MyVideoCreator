import {useState} from 'react';
type Value=Record<string,any>;
export function RunWorkflow({nodes,edges,providers,selected,onRun}:{nodes:Value[];edges:Value[];providers:Value[];selected:string|null;onRun:(options:Value)=>Promise<void>}){
 const [scope,setScope]=useState(selected?'branch':'all'),[cloud,setCloud]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const wanted=new Set(scope==='all'?nodes.map(n=>n.id):[selected]);
 if(scope==='branch'){
  let changed=true;while(changed){changed=false;for(const e of edges)if(wanted.has(e.source)&&!wanted.has(e.target)){wanted.add(e.target);changed=true}}
 }
 let changed=true;while(changed){changed=false;for(const e of edges)if(wanted.has(e.target)&&!wanted.has(e.source)){wanted.add(e.source);changed=true}}
 const planned=nodes.filter(n=>wanted.has(n.id)&&['text','storyboard','image','video'].includes(n.data.kind));
 const cloudNodes=planned.filter(n=>n.data.provider&&n.data.provider!=='local'&&!providers.find(p=>p.id===n.data.provider)?.local);
 return <><p className="muted">任务按连线顺序执行。每次运行都会重新生成范围内的节点，包括所需上游；已经生成的历史素材会保留。</p><label>执行范围<select value={scope} onChange={e=>{setScope(e.target.value);setCloud(false)}}><option value="all">整个画布</option>{selected&&<><option value="branch">所选节点及下游分支</option><option value="ancestors">所选节点及所需上游</option></>}</select></label><h3>本次 {planned.length} 个任务</h3>{planned.map(n=><p key={n.id}>{n.data.label||n.data.kind} · {n.data.provider==='local'||!n.data.provider?'本地文本':providers.find(p=>p.id===n.data.provider)?.name||'服务未配置'}</p>)}{cloudNodes.length>0&&<label className="check-label"><input type="checkbox" checked={cloud} onChange={e=>setCloud(e.target.checked)}/>允许本批次的 {cloudNodes.length} 个云端任务，可能产生供应商费用</label>}{error&&<p className="error">{error}</p>}<button className="primary full" disabled={busy||!planned.length||(cloudNodes.length>0&&!cloud)} onClick={async()=>{setBusy(true);setError('');try{await onRun({node_ids:scope==='all'?undefined:[selected],include_descendants:scope==='branch',allow_cloud:cloud})}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>{busy?'提交中':'加入生成队列'}</button></>;
}
