import {useState, useEffect} from 'react';
import {RefreshCw} from 'lucide-react';
type Value=Record<string,any>;
export function CanvasVideoReferences({document,nodeId,assets,onCompile}:{document:Value;nodeId:string;assets:Value[];onCompile:()=>Promise<Value>}) {
 const [preview,setPreview]=useState<Value|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const visual=document.filmBible?.visual||{};
 const sources=[...new Set<string>((document.edges||[]).filter((e:Value)=>e.target===nodeId).map((e:Value)=>e.source))];
 const rows=sources.map(source=>{
  const data=document.nodes.find((n:Value)=>n.id===source)?.data||{};
  const version=visual.versions?.[data.visualVersionId],card=visual.cards?.[version?.cardId];
  const aid=version?.references?.find((r:Value)=>r.role==='primary')?.assetId||data.assetId;
  return {id:source,name:card?.name||data.label||data.title||'图片参考',asset:assets.find(a=>a.id===aid),ready:version?version.status==='locked'&&!!aid:!!aid};
 });
 const signature=JSON.stringify([document.nodes.find((n:Value)=>n.id===nodeId)?.data,document.edges,visual,document.videoDuration,document.videoReferenceMode]);
 useEffect(()=>{setPreview(null);setError('')},[signature]);
 async function refresh(){setBusy(true);setError('');try{setPreview(await onCompile())}catch(e:any){setPreview(null);setError(e.message)}finally{setBusy(false)}}
 return <section><strong>已连接参考</strong>{rows.length?rows.map(row=><div key={row.id} style={{display:'flex',gap:8,alignItems:'center',marginTop:6}}>{row.asset?.url&&<a href={row.asset.url} target="_blank" rel="noreferrer"><img src={row.asset.url} alt={row.name} style={{width:40,height:40,objectFit:'contain'}}/></a>}<span>{row.name}{!row.ready?' · 请确认主参考图':''}</span></div>):<p className="muted">将角色、状态、场景或道具连入本节点，使用其已确认的参考图。</p>}
 <details><summary>最终提交与参考清单</summary><button type="button" className="quiet" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={14}/>{busy?'正在核对…':'核对提交内容'}</button>{error&&<p className="error">{error}</p>}{preview&&<><p>实际提交：{preview.shot_duration} 秒 · {preview.generation_mode?.actual==='multimodal'?'多模态参考':preview.generation_mode?.actual}</p>{(preview.reference_manifest||[]).map((r:Value)=><p key={r.kind+':'+r.index}>{r.kind==='image'?'图片':'素材'}{r.index} · {r.name}</p>)}<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{preview.prompt}</p></>}</details></section>;
}
