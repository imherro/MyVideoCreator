import {useState} from 'react';
import {Download,ArrowUpRight} from 'lucide-react';
type Value=Record<string,any>;
export function StoryboardGrid({shots,nodes,assets,onOpen,onExport}:{shots:Value[];nodes:Value[];assets:Value[];onOpen:(shot:Value,index:number)=>void;onExport:(columns:number,page:number)=>Promise<void>}){
 const [columns,setColumns]=useState(3),[page,setPage]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pages=Math.max(1,Math.ceil(shots.length/9)),current=Math.min(page,pages);
 return <section className="shot-view"><div className="section-title"><div><span className="eyebrow">STORYBOARD GRID</span><h2>检查镜头连续性</h2></div><label>布局<select value={columns} onChange={e=>setColumns(Number(e.target.value))}><option value="3">三列宫格</option><option value="2">两列图板</option></select></label><button disabled={!shots.length||busy} onClick={async()=>{setBusy(true);setError('');try{await onExport(columns,current)}catch(e:any){setError(e.message)}finally{setBusy(false)}}}><Download size={16}/>下载当前页 PNG</button></div>
 {error&&<p className="error">{error}</p>}{!shots.length&&<div className="empty-state"><h3>还没有分镜</h3><p>先生成分镜，再为每镜建立图像节点。</p></div>}
 <div className="storyboard-grid" style={{gridTemplateColumns:`repeat(${columns},minmax(0,1fr))`}}>{shots.slice((current-1)*9,current*9).map((shot,i)=>{const index=(current-1)*9+i,node=nodes.find(n=>n.id===shot.imageNode),asset=assets.find(a=>a.id===node?.data.assetId);return <article key={shot.id} className="storyboard-tile"><div className="storyboard-picture">{asset?<img src={asset.url} alt={shot.scene||`镜头 ${index+1}`}/>:<span>等待分镜图</span>}</div><div><b>{String(index+1).padStart(2,'0')} · {shot.duration} 秒</b>{node?.data.stale&&<small className="danger">输入已更改</small>}<p>{shot.action}</p><small>{shot.camera}</small><button className="quiet" onClick={()=>onOpen(shot,index)}>{node?'编辑镜头':'建立生成节点'}<ArrowUpRight size={14}/></button></div></article>})}</div>
 {pages>1&&<div className="settings-actions"><button disabled={current===1} onClick={()=>setPage(current-1)}>上一页</button><span>{current} / {pages}</span><button disabled={current===pages} onClick={()=>setPage(current+1)}>下一页</button></div>}
 </section>;
}
