import {useEffect,useRef,useState} from 'react';
import {Sparkles,Upload,X} from 'lucide-react';

type Value=Record<string,any>;
export function ScriptImportDialog({file,productionId,projectId,defaultTarget,request,onJobsSubmitted,onClose,onImported,onSourceImport}:{
  file:File;productionId:string;projectId:string;defaultTarget?:Value;
  request:(path:string,options?:RequestInit)=>Promise<any>;onJobsSubmitted:(jobs:any[])=>void;
  onClose:()=>void;onImported:(result:any)=>Promise<void>;onSourceImport?:()=>Promise<void>;
}){
  const [draft,setDraft]=useState<Value|null>(null),[selected,setSelected]=useState<number[]>([]),[shared,setShared]=useState(true);
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  const alive=useRef(true),selectedOnce=useRef(false);
  const base=`/productions/${productionId}/script-imports`;
  const pending=draft?.job && ['queued','running'].includes(draft.job.status);
  const rows=draft?.manifest?.episodes || [];
  function accept(value:Value){setDraft(value);if(!selectedOnce.current){setSelected(value.manifest.episodes.filter((ep:Value)=>!ep.conflict).map((ep:Value)=>ep.episodeNo));selectedOnce.current=true;}}
  useEffect(()=>{
    alive.current=true;
    void (async()=>{
      const bytes=await file.arrayBuffer();let content:string;
      try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{content=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}
      const value=await request(base,{method:'POST',body:JSON.stringify({filename:file.name,content})});
      if(alive.current)accept(value);
    })().catch(e=>{if(alive.current)setError(e.message);}).finally(()=>{if(alive.current)setBusy(false);});
    return()=>{alive.current=false;};
  },[file,productionId]);
  useEffect(()=>{
    if(!pending||!draft)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const value=await request(`${base}/${draft.id}`);if(stopped)return;accept(value);setError('');if(value.job&&['queued','running'].includes(value.job.status))timer=setTimeout(poll,2000);else if(value.manifest.method==='ai')setSelected(current=>draft.manifest.episodes.length ? current.filter(n=>value.manifest.episodes.some((ep:Value)=>ep.episodeNo===n&&!ep.conflict)) : value.manifest.episodes.filter((ep:Value)=>!ep.conflict).map((ep:Value)=>ep.episodeNo));}catch(e:any){if(!stopped){setError(`刷新识别结果失败，将重试：${e.message}`);timer=setTimeout(poll,4000);}}};
    timer=setTimeout(poll,1200);return()=>{stopped=true;clearTimeout(timer);};
  },[draft?.id,pending]);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e:any){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
  async function analyze(){
    const result=await request(`${base}/${draft!.id}/analyze`,{method:'POST',body:JSON.stringify({project_id:projectId,submission_id:crypto.randomUUID()})});
    onJobsSubmitted(result.jobs);accept(await request(`${base}/${draft!.id}`));
  }
  async function confirm(){
    const result=await request(`${base}/${draft!.id}/confirm`,{method:'POST',body:JSON.stringify({episode_nos:selected,include_shared:shared})});
    await onImported(result);onClose();
  }
  return <div className="modal-overlay"><section className="script-import-dialog" role="dialog" aria-modal="true" aria-labelledby="script-import-title">
    <header><div><h2 id="script-import-title">智能导入剧本</h2><small>{file.name}</small></div><button className="icon-button" aria-label="关闭导入预览" disabled={busy} onClick={onClose}><X size={18}/></button></header>
    <div className="script-import-content">
      {error&&<p className="error">{error}</p>}
      {!draft&&<p>{busy?'正在读取文件并识别分集标题…':'文件未能读取，请关闭后重新选择。'}</p>}
      {draft&&<>
        <div className="script-import-summary"><div><b>{draft.manifest.title}</b><p>发现 {rows.length} 集{draft.manifest.declaredEpisodes?` · 原稿声明 ${draft.manifest.declaredEpisodes} 集`:''} · {pending?'标题识别完成，AI 检查中':draft.manifest.method==='ai'?'AI 已识别与检查':'标题识别预览（尚未调用 AI）'}</p></div>
          <button disabled={busy||pending||!defaultTarget?.providerId} onClick={()=>void run(analyze)}><Sparkles size={15}/>{pending?'AI 识别中…':draft.manifest.method==='ai'?'重新 AI 检查':'AI 智能识别与检查'}</button></div>
        <small>使用项目默认文本模型：{defaultTarget?.modelId || '请先配置默认文本模型'}。AI 只返回结构与检查结果，正文从原文件截取。</small>
        {pending&&<p className="notice">{draft.job.phase || '任务已提交，完成后自动刷新预览'}<a href={`/?task=${draft.job.id}`} target="_blank" rel="noreferrer">任务详情</a></p>}
        {draft.job?.error&&<p className="error">AI 识别未完成：{draft.job.error}。原文和已有标题识别结果仍保留。</p>}
        {!!draft.missingEpisodes.length&&<p className="notice">未提供正文：{draft.missingEpisodes.map((n:number)=>`EP${String(n).padStart(2,'0')}`).join('、')}。不会自动补写或建立空集。</p>}
        {!!draft.manifest.warnings.length&&<ul className="script-import-warnings">{draft.manifest.warnings.map((warning:string,i:number)=><li key={i}>{warning}</li>)}</ul>}
        {draft.sharedText&&<details><summary>项目与人物共享设定 · {draft.sharedText.length} 字</summary><pre>{draft.sharedText}</pre></details>}
        {!!rows.length&&<div className="script-import-select"><label><input type="checkbox" disabled={pending||busy} checked={rows.some((ep:Value)=>!ep.conflict)&&rows.filter((ep:Value)=>!ep.conflict).every((ep:Value)=>selected.includes(ep.episodeNo))} onChange={e=>setSelected(e.target.checked?rows.filter((ep:Value)=>!ep.conflict).map((ep:Value)=>ep.episodeNo):[])}/>选择可导入分集</label><span>已选 {selected.length} 集</span></div>}
        {rows.map((ep:Value)=><article key={ep.episodeNo} className="script-import-episode"><label><input type="checkbox" checked={selected.includes(ep.episodeNo)} disabled={busy||pending||ep.conflict} onChange={e=>setSelected(current=>e.target.checked?[...current,ep.episodeNo]:current.filter(n=>n!==ep.episodeNo))}/><b>EP{String(ep.episodeNo).padStart(2,'0')} · {ep.title}</b><small>{ep.durationSeconds?`${ep.durationSeconds} 秒`:'时长沿用项目'} · {ep.charactersCount} 字</small></label>
          {ep.conflict&&<p className="error">该集已有内容、活动任务或在回收站，不能覆盖。可取消选择，或导入到新作品。</p>}
          {ep.incomplete&&<p className="notice">正文疑似不完整，导入后需补全。</p>}
          {ep.warnings.map((warning:string,i:number)=><small className="script-import-warning" key={i}>{warning}</small>)}
          <details><summary>查看原文{ep.characters.length?` · ${ep.characters.join('、')}`:''}</summary><pre>{ep.body}</pre></details></article>)}
      </>}
    </div>
    <footer><div>{draft?.sharedText&&<label><input type="checkbox" checked={shared} onChange={e=>setShared(e.target.checked)} disabled={busy||pending}/>共享设定追加到项目 Bible</label>}<small>确认后直接进入剧本；原文件同时保留在资料库。</small></div><div className="settings-actions">{onSourceImport&&<button disabled={busy||pending} onClick={()=>void run(async()=>{await onSourceImport();onClose();})}>仅作为原著导入</button>}<button className="primary" disabled={busy||pending||!selected.length} onClick={()=>void run(confirm)}><Upload size={15}/>{busy?'处理中…':`确认导入 ${selected.length} 集剧本`}</button></div></footer>
  </section></div>;
}
