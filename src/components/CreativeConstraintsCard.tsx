import {useEffect,useRef,useState} from 'react';
import {ChevronDown, ChevronUp, Sparkles} from 'lucide-react';
import {bibleFields, type ProjectBibleFields} from '../projectSetup';
type Value=Record<string,any>;
const labels:Record<keyof ProjectBibleFields,string>={summary:'故事方向、叙事与改编边界',worldEra:'人物与世界规则',visualTone:'视觉基调',colorLighting:'色彩与光线',cameraLanguage:'镜头语言',characterSceneConsistency:'跨集一致性',avoidItems:'避免项（每行一项）'};
export function CreativeConstraintsCard({document,productionId,projectId,jobs,request,onPrepare,onApply,onJob,notify,report}:{document:Value;productionId:string;projectId:string;jobs:Value[];request:(path:string,options?:RequestInit)=>Promise<any>;onPrepare:()=>Promise<void>;onApply:(fields:ProjectBibleFields)=>Promise<void>;onJob:(jobs:Value[])=>void;notify:(message:string)=>void;report:(error:unknown)=>void}){
 const fields=bibleFields(document);
 const [expanded,setExpanded]=useState(false),[draft,setDraft]=useState<ProjectBibleFields|null>(null),[busy,setBusy]=useState(false),[task,setTask]=useState<Value|null>(null),[error,setError]=useState('');
 const base=useRef(''),seen=useRef('');
 const latest=jobs.filter(j=>j.node_id==='creative-constraints').sort((a,b)=>b.created-a.created)[0];
 useEffect(()=>{if(latest&&latest.id!==seen.current){seen.current=latest.id;setTask(latest);}},[latest?.id]);
 useEffect(()=>{
  if(!task)return;
  let alive=true;let timer:ReturnType<typeof setTimeout>;
  async function poll(){try{const next=await request('/jobs/'+task!.id);if(!alive)return;setTask(next);
    if(['queued','running'].includes(next.status)){timer=setTimeout(poll,2500);return;}
    if(next.status==='succeeded'&&next.result?.creativeConstraints&&sessionStorage.getItem('constraints-reviewed-'+productionId)!==next.id){setDraft(next.result.creativeConstraints);base.current=JSON.stringify(bibleFields({filmBible:next.input?.bible_snapshot||{}}));setExpanded(true);notify('创作约束草稿已生成，请检查后应用');}
    else if(next.status!=='succeeded')setError(next.error||'创作约束任务未完成，请在任务中心查看');
   }catch(e){if(alive){setError('暂时无法读取起草任务，正在重试');timer=setTimeout(poll,5000);}}}
  void poll();return()=>{alive=false;clearTimeout(timer);};
 },[task?.id,productionId]);
 const running=busy||!!task&&['queued','running'].includes(task.status);
 async function generate(){if(draft&&!window.confirm("重新起草会替换当前未应用草稿，已保存约束保持不变。继续？"))return;setBusy(true);setError('');try{await onPrepare();const job=await request(`/projects/${projectId}/creative-constraints/draft`,{method:'POST',body:JSON.stringify({submission_id:'constraints-'+Date.now()})});seen.current=job.id;setTask(job);onJob([job]);notify('创作约束正在后台起草，可继续编辑剧本');}catch(e){report(e);}finally{setBusy(false);}}
 async function apply(){if(!draft)return;if(base.current!==JSON.stringify(fields)){setError('创作约束已在其他入口更新，请先查看当前内容，再决定是否重新起草或手动合并。');return;}setBusy(true);try{await onApply(draft);if(task)sessionStorage.setItem('constraints-reviewed-'+productionId,task.id);setDraft(null);setExpanded(false);notify('创作约束已应用，后续生成使用新约束；已有内容不会自动重写');}catch(e){report(e);}finally{setBusy(false);}}
 const hasContent=Object.values(fields).some(Boolean);
 return <article className="domain-card creative-constraints-card"><header><div><b>创作约束</b><small>全作品通用</small></div><div className="settings-actions"><button disabled={running} onClick={()=>void generate()}><Sparkles size={14}/>{running?'AI 起草中…':hasContent?'AI 补充建议':'AI 起草创作约束'}</button><button disabled={running} onClick={()=>{if(!draft){setDraft(fields);base.current=JSON.stringify(fields);}setExpanded(!expanded);}}>{expanded?'收起':hasContent?'编辑 / 展开':'手动填写'}{expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</button></div></header>
 {!expanded&&<p className="constraints-summary">{Object.values(fields).filter(Boolean).join(' · ')||'尚未设置创作约束，可根据已有资料由 AI 起草，或直接编写。'}</p>}
 {error&&<p role="alert">{error}</p>}
 {expanded&&draft&&<><div className="domain-fields">{(Object.keys(labels) as (keyof ProjectBibleFields)[]).map(key=><label key={key}>{labels[key]}<textarea disabled={running} rows={key==='summary'?4:2} maxLength={6000} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div><details><summary>对照当前已保存约束</summary><p style={{whiteSpace:"pre-wrap"}}>{Object.values(fields).filter(Boolean).join("\n\n")||"尚未填写"}</p></details><footer><small>后续生成使用新约束，已生成内容不会自动重写。</small><button disabled={busy} onClick={()=>{setDraft(fields);base.current=JSON.stringify(fields);setError('');}}>查看当前已保存内容</button><button className="primary" disabled={running} onClick={()=>void apply()}>应用创作约束</button></footer></>}
 </article>;
}
