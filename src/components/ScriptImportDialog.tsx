import {useEffect,useRef,useState} from 'react';
import {Sparkles,Upload,X,Minimize2,LoaderCircle,FileText} from 'lucide-react';
import {rememberImport,forgetImport} from './ImportResumeNotice';

type Value=Record<string,any>;
export function ScriptImportDialog({file,resumeId,sourceTarget,productionId,projectId,defaultTarget,request,onJobsSubmitted,onClose,onImported,onSourceImport}:{
  file?:File;resumeId?:string;sourceTarget?:{sourceId?:string;sourceName?:string};productionId:string;projectId:string;defaultTarget?:Value;
  request:(path:string,options?:RequestInit)=>Promise<any>;onJobsSubmitted:(jobs:any[])=>void;
  onClose:()=>void;onImported:(result:any)=>Promise<void>;onSourceImport?:(draftId:string,episodeNos:number[],originalOnly?:boolean)=>Promise<void>;
}){
  const [draft,setDraft]=useState<Value|null>(null),[selected,setSelected]=useState<number[]>([]),[shared,setShared]=useState(true);
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  const [destination,setDestination]=useState<'source'|'script'>(onSourceImport?'source':'script');
  const [minimized,setMinimized]=useState(false);
  const resumeMode=onSourceImport?'source':'script';
  const alive=useRef(true),selectionKey=useRef('');
  const base=`/productions/${productionId}/script-imports`;
  const pending=draft?.job && ['queued','running'].includes(draft.job.status);
  const rows=draft?.manifest?.episodes || [];
  const canSelect=(ep:Value)=>destination==='source'||!ep.conflict;
  function accept(value:Value){
    setDraft(value);
    if(value.status==='preview')rememberImport(productionId,resumeMode,{id:value.id,filename:value.filename||file?.name||'文档',target:sourceTarget});
    const key=JSON.stringify([value.id,value.manifest.method,value.manifest.episodes.map((ep:Value)=>[ep.episodeNo,ep.startLine,ep.endLine])]);
    if(key!==selectionKey.current){setSelected(value.manifest.episodes.filter(canSelect).map((ep:Value)=>ep.episodeNo));selectionKey.current=key;}
  }
  async function submitAnalysis(id:string){
    const result=await request(`${base}/${id}/analyze`,{method:'POST',body:JSON.stringify({project_id:projectId,submission_id:crypto.randomUUID()})});
    onJobsSubmitted(result.jobs);
    const value=await request(`${base}/${id}`);
    if(alive.current)accept(value);
  }
  useEffect(()=>{
    alive.current=true;
    let cancelled=false;
    void (async()=>{
      let value:Value;
      if(resumeId)value=await request(`${base}/${encodeURIComponent(resumeId)}`);
      else{
        if(!file)throw new Error('请选择导入文件');
        const body=new FormData();body.append('file',file);
        value=await request(`${base}/upload`,{method:'POST',body});
      }
      if(cancelled||!alive.current)return;
      accept(value);
      // Only unstructured documents need automatic AI segmentation. Existing
      // headings remain available immediately without an unnecessary AI call.
      if(!resumeId&&!value.manifest.episodes.length&&!value.job&&defaultTarget?.providerId)await submitAnalysis(value.id);
    })().catch(e=>{if(alive.current)setError(e.message);}).finally(()=>{if(alive.current)setBusy(false);});
    return()=>{cancelled=true;alive.current=false;};
  },[file,resumeId,productionId]);
  useEffect(()=>{if(pending)setMinimized(true);},[pending]);
  useEffect(()=>{
    if(!pending||!draft)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const value=await request(`${base}/${draft.id}`);if(stopped)return;accept(value);setError('');if(value.job&&['queued','running'].includes(value.job.status))timer=setTimeout(poll,2000);}catch(e:any){if(!stopped){setError(`刷新识别结果失败，将重试：${e.message}`);timer=setTimeout(poll,4000);}}};
    timer=setTimeout(poll,1200);return()=>{stopped=true;clearTimeout(timer);};
  },[draft?.id,pending]);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e:any){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
  async function analyze(){
    await submitAnalysis(draft!.id);
  }
  async function confirm(){
    if(destination==='source'&&onSourceImport){await onSourceImport(draft!.id,selected);forgetImport(productionId,resumeMode,draft!.id);onClose();return;}
    const result=await request(`${base}/${draft!.id}/confirm`,{method:'POST',body:JSON.stringify({episode_nos:selected,include_shared:shared})});
    await onImported(result);forgetImport(productionId,resumeMode,draft!.id);onClose();
  }
  if(minimized)return <aside className="import-background-card" aria-label="文档后台导入" role="status">
    <div>{pending||busy?<LoaderCircle size={17} className="spin"/>:<FileText size={17}/>}<b title={draft?.filename||file?.name}>{draft?.filename||file?.name||'文档导入'}</b><button className="icon-button" aria-label="收起导入状态条" disabled={busy} onClick={onClose}><X size={15}/></button></div>
    <p>{error||draft?.job?.error?'处理未完成，原文已保留':pending?'AI 正在后台分析，你可以继续其他工作':busy?'正在读取文档…':`分集预览已就绪 · ${rows.length} 集`}</p>
    <div>{draft?.job?.id&&<a href={`/?task=${encodeURIComponent(draft.job.id)}`} target="_blank" rel="noreferrer">任务详情</a>}<button onClick={()=>setMinimized(false)}>{pending?'展开进度':'查看结果'}</button></div>
  </aside>;
  return <div className="modal-overlay"><section className="script-import-dialog" role="dialog" aria-modal="true" aria-labelledby="script-import-title">
    <header><div><h2 id="script-import-title">{onSourceImport?'导入原著 / 剧本':'智能导入剧本'}</h2><small>{draft?.filename||file?.name}</small></div><div className="settings-actions"><button onClick={()=>setMinimized(true)}><Minimize2 size={15}/>收起，继续工作</button><button className="icon-button" aria-label="关闭导入预览" disabled={busy} onClick={onClose}><X size={18}/></button></div></header>
    <div className="script-import-content">
      {error&&<p className="error">{error}</p>}
      {!draft&&<p>{busy?'正在提取文档正文并识别章节 / 分集…':'文件未能读取，请关闭后重新选择。'}</p>}
      {draft&&<>
        <div className="script-import-summary"><div><b>{draft.manifest.title}</b><p>发现 {rows.length} 集{draft.manifest.declaredEpisodes?` · 原稿声明 ${draft.manifest.declaredEpisodes} 集`:''} · {pending?'AI 正在判断分集':draft.manifest.method==='ai'?'AI 已识别与检查':'标题识别预览（尚未调用 AI）'}</p></div>
          <button disabled={busy||pending||!defaultTarget?.providerId} onClick={()=>void run(analyze)}><Sparkles size={15}/>{pending?'AI 识别中…':draft.manifest.method==='ai'?'重新 AI 检查':'AI 智能识别与检查'}</button></div>
        {onSourceImport&&<div className="script-import-select script-import-destination"><label><input type="radio" name="import-destination" checked={destination==='source'} disabled={busy||pending} onChange={()=>{setDestination('source');setSelected(rows.map((ep:Value)=>ep.episodeNo));}}/>导入原著资料库</label><label><input type="radio" name="import-destination" checked={destination==='script'} disabled={busy||pending} onChange={()=>{setDestination('script');setSelected(rows.filter((ep:Value)=>!ep.conflict).map((ep:Value)=>ep.episodeNo));}}/>直接建立分集剧本</label></div>}
        <small>使用项目默认文本模型：{defaultTarget?.modelId || '请先配置默认文本模型'}。无章节标题时自动按单集目标时长判断是否拆分；AI 只返回分界和检查结果，正文从文件提取文本中截取。</small>
        {pending&&<p className="notice">{draft.job.phase || '任务已提交，完成后自动刷新预览'}<a href={`/?task=${draft.job.id}`} target="_blank" rel="noreferrer">任务详情</a></p>}
        {draft.job?.error&&<p className="error">AI 识别未完成：{draft.job.error}。原文和已有标题识别结果仍保留。</p>}
        {!!draft.missingEpisodes.length&&<p className="notice">未提供正文：{draft.missingEpisodes.map((n:number)=>`EP${String(n).padStart(2,'0')}`).join('、')}。不会自动补写或建立空集。</p>}
        {!!draft.manifest.warnings.length&&<ul className="script-import-warnings">{draft.manifest.warnings.map((warning:string,i:number)=><li key={i}>{warning}</li>)}</ul>}
        {draft.sharedText&&<details><summary>项目与人物共享设定 · {draft.sharedText.length} 字</summary><pre>{draft.sharedText}</pre></details>}
        {!!rows.length&&<div className="script-import-select"><label><input type="checkbox" disabled={pending||busy} checked={rows.some(canSelect)&&rows.filter(canSelect).every((ep:Value)=>selected.includes(ep.episodeNo))} onChange={e=>setSelected(e.target.checked?rows.filter(canSelect).map((ep:Value)=>ep.episodeNo):[])}/>选择可导入分集</label><span>已选 {selected.length} 集</span></div>}
        {rows.map((ep:Value)=><article key={ep.episodeNo} className="script-import-episode"><label><input type="checkbox" checked={selected.includes(ep.episodeNo)} disabled={busy||pending||!canSelect(ep)} onChange={e=>setSelected(current=>e.target.checked?[...current,ep.episodeNo]:current.filter(n=>n!==ep.episodeNo))}/><b>EP{String(ep.episodeNo).padStart(2,'0')} · {ep.title}</b><small>{ep.durationSeconds?`${ep.durationSeconds} 秒`:'时长沿用项目'} · {ep.charactersCount} 字</small></label>
          {destination==='script'&&ep.conflict&&<p className="error">该集已有内容、活动任务或在回收站，不能覆盖。可取消选择，或导入到新作品。</p>}
          {ep.incomplete&&<p className="notice">正文疑似不完整，导入后需补全。</p>}
          {ep.warnings.map((warning:string,i:number)=><small className="script-import-warning" key={i}>{warning}</small>)}
          <details><summary>查看原文{ep.characters.length?` · ${ep.characters.join('、')}`:''}</summary><pre>{ep.body}</pre></details></article>)}
      </>}
    </div>
    <footer><div>{destination==='script'&&draft?.sharedText&&<label><input type="checkbox" checked={shared} onChange={e=>setShared(e.target.checked)} disabled={busy||pending}/>共享设定追加到项目 Bible</label>}<small>{destination==='source'?'确认后保存为原著章节，保留已有项目与剧本。':'确认后直接进入剧本；原文同时保留在资料库。'}</small></div><div className="settings-actions">{onSourceImport&&draft&&<button disabled={busy||pending} onClick={()=>void run(async()=>{await onSourceImport(draft.id,[],true);forgetImport(productionId,resumeMode,draft.id);onClose();})}>按原文结构导入</button>}<button className="primary" disabled={busy||pending||!selected.length} onClick={()=>void run(confirm)}><Upload size={15}/>{busy?'处理中…':`确认导入 ${selected.length} 集${destination==='source'?'原著':'剧本'}`}</button></div></footer>
  </section></div>;
}
