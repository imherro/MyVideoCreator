import {useEffect,useState} from 'react';
import {FileText,LoaderCircle} from 'lucide-react';

export type ImportResume = {id:string;filename:string;target?:{sourceId?:string;sourceName?:string}};
export const importResumeKey=(productionId:string,mode:string)=>`anying-import:${productionId}:${mode}`;
export function rememberImport(productionId:string,mode:string,value:ImportResume){
  try{localStorage.setItem(importResumeKey(productionId,mode),JSON.stringify(value));}catch{/* Storage may be disabled; jobs still retain the preview ID. */}
}
export function forgetImport(productionId:string,mode:string,id:string){
  try{const key=importResumeKey(productionId,mode);if(JSON.parse(localStorage.getItem(key)||'null')?.id===id)localStorage.removeItem(key);}catch{}
}

export function ImportResumeNotice({productionId,mode,jobs,request,onResume}:{
  productionId:string;mode:'source'|'script';jobs:Record<string,any>[];
  request:(path:string,options?:RequestInit)=>Promise<any>;onResume:(record:ImportResume)=>void;
}){
  const [preview,setPreview]=useState<{record:ImportResume;draft:any}|null>(null);
  const latest=jobs.filter(job=>job.input?.script_import_analysis?.productionId===productionId)
    .sort((a,b)=>Number(b.created)-Number(a.created))[0];
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    let record:ImportResume|null=null;
    try{record=JSON.parse(localStorage.getItem(importResumeKey(productionId,mode))||'null');}catch{}
    if(!record?.id&&latest){const marker=latest.input.script_import_analysis;record={id:marker.importId,filename:marker.filename};}
    setPreview(null);
    if(!record?.id)return;
    const selected=record;
    async function load(){
      try{
        const draft=await request(`/productions/${productionId}/script-imports/${encodeURIComponent(selected.id)}`);
        if(stopped)return;
        if(draft.status!=='preview'){forgetImport(productionId,mode,selected.id);setPreview(null);return;}
        setPreview({record:selected,draft});
        if(['queued','running'].includes(draft.job?.status))timer=setTimeout(load,3000);
      }catch{if(!stopped)timer=setTimeout(load,6000);}
    }
    void load();return()=>{stopped=true;clearTimeout(timer);};
  },[productionId,mode,latest?.id,latest?.status]);
  if(!preview)return null;
  const pending=['queued','running'].includes(preview.draft.job?.status);
  return <div className="import-resume-notice" role="status">
    {pending?<LoaderCircle size={16} className="spin"/>:<FileText size={16}/>}
    <span><b title={preview.record.filename}>{preview.record.filename}</b><small>{pending?'AI 正在后台分析，可继续其他工作':preview.draft.job?.error?'分析未完成，原文已保留': '导入预览已保存，等待确认'}</small></span>
    {preview.draft.job?.id&&<a href={`/?task=${encodeURIComponent(preview.draft.job.id)}`} target="_blank" rel="noreferrer">任务详情</a>}
    <button onClick={()=>onResume(preview.record)}>{pending?'查看进度':'继续导入'}</button>
  </div>;
}
