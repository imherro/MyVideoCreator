import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {targetKey} from './modelAccess.ts';
import type {GenerationTarget} from './generationPolicy.ts';
type Value=Record<string,any>;
export function ModelSelector({data,providers,localModels,allowedTargets,request,onChange}:{data:Value;providers:Value[];localModels:Value[];allowedTargets?:GenerationTarget[];request:(path:string)=>Promise<any>;onChange:(patch:Value)=>void}){
 const [models,setModels]=useState<Value[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const kind=data.kind==='storyboard'?'text':data.kind,providerId=data.provider||'local';
 const provider=providers.find(p=>p.id===providerId),nativeMinimax=provider?.type==='minimax';
 const allowedProviderIds=allowedTargets?new Set(allowedTargets.map(target=>target.providerId)):null;
 const allowedForProvider=allowedTargets?.filter(target=>target.providerId===providerId).map(target=>target.modelId);
 const suitable=providers.filter(p=>(p.kind===kind||!p.kind)&&(!allowedProviderIds||allowedProviderIds.has(p.id)));
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>|undefined;const deadline=Date.now()+180000;
  setModels([]);setError('');if(providerId==='local'){setLoading(false);return}
  async function refreshModels(){setLoading(true);try{const v=await request('/providers/'+encodeURIComponent(providerId)+'/models?kind='+encodeURIComponent(kind));if(!active)return;
   if(v.status==='starting'){if(Date.now()>deadline)throw new Error('推理引擎启动较慢，请在模型与服务中查看状态后刷新');timer=setTimeout(refreshModels,3000);return}setModels(allowedForProvider?v.models.filter((model:Value)=>allowedForProvider.includes(model.id)):v.models);setLoading(false);
  }catch(e:any){if(active){setError(e.message);setLoading(false)}}}
  void refreshModels();return()=>{active=false;clearTimeout(timer)};
 },[providerId,kind,refresh,allowedTargets?.map(targetKey).join('|')]);
 const configuredDefault=provider?.models?.[kind]||provider?.model||'';
 const defaultModel=allowedForProvider?.includes(configuredDefault)?configuredDefault:allowedForProvider?.[0]||configuredDefault;
 const selected=models.find(m=>m.id===data.model),caps=selected?.capabilities;
 const allowedLocalIds=allowedTargets?.filter(target=>target.providerId==='local').map(target=>target.modelId);
 const visibleLocalModels=allowedLocalIds?localModels.filter(model=>allowedLocalIds.includes(model.id)):localModels;
 return <><label>模型服务<select value={providerId} onChange={e=>{const p=providers.find(p=>p.id===e.target.value);const first=allowedTargets?.find(target=>target.providerId===e.target.value)?.modelId;onChange({provider:e.target.value,model:first||p?.models?.[kind]||p?.model||visibleLocalModels[0]?.id||'',model_capabilities:undefined})}}>
 {kind==='text'&&(!allowedProviderIds||allowedProviderIds.has('local'))?<option value="local">本地 · llama.cpp 文本</option>:<option value="local" disabled>请选择已授权的模型服务</option>}
 {suitable.map(p=><option key={p.id} value={p.id}>{p.local?'本地':'云端'} · {p.name}</option>)}
 {providerId!=='local'&&!suitable.some(p=>p.id===providerId)&&<option value={providerId} disabled>原服务不适用，请重新选择</option>}
 </select></label>
 {providerId==='local'&&kind==='text'?<label>本地模型<select value={data.model||visibleLocalModels[0]?.id||''} onChange={e=>onChange({model:e.target.value})}>{!visibleLocalModels.length&&<option value="">项目未启用本地文本模型</option>}{visibleLocalModels.map(m=><option key={m.id} value={m.id}>{m.name} · {m.size_gb} GB</option>)}</select></label>:providerId!=='local'&&<>
 <div className="field-heading"><label>服务模型</label><button className="quiet" onClick={()=>{if(defaultModel)onChange({model:defaultModel,frames:defaultModel==='minimax_h3'?124:data.frames,resolution:defaultModel==='minimax_h3'?'864x480':data.resolution,model_capabilities:models.find(m=>m.id===defaultModel)?.capabilities})}}>使用默认</button><button className="quiet" disabled={loading} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={13}/>刷新</button></div>
 <select aria-label="服务模型" value={data.model||''} onChange={e=>{const m=models.find(m=>m.id===e.target.value);onChange({model:e.target.value,model_capabilities:m?.capabilities})}}><option value="">{loading?'正在读取模型目录':'请选择模型'}</option>{data.model&&!models.some(m=>m.id===data.model)&&<option value={data.model}>{data.model}</option>}{models.map(m=><option key={m.id} value={m.id} disabled={m.installed===false}>{m.name}{m.installed===true?' · 已安装':m.installed===false?' · 未安装':''}</option>)}</select>
 {loading&&<p className="muted">正在读取模型目录；内置引擎首次启动可能需要一些时间。</p>}
 {error&&<p className="error">{error}</p>}
 {!allowedTargets&&<details><summary>手动填写模型 ID</summary><input aria-label="手动模型 ID" value={data.model||''} onChange={e=>onChange({model:e.target.value,model_capabilities:undefined})}/></details>}
 {allowedTargets&&data.model&&!allowedForProvider?.includes(data.model)&&<p className="warning-text">当前节点使用的模型不在项目可用模型中，请重新选择。</p>}
 {caps&&<p className="muted">{caps.image_reference?'支持参考图':'不支持参考图'}{caps.max_references?` · 最多 ${caps.max_references} 张`:''}{caps.audio_output?' · 生成原声':''}{caps.end_frame?' · 支持尾帧':''}</p>}
 </>}
 {nativeMinimax&&<><label>生成时长<select value={data.parameters?.duration??provider?.parameters?.duration??6} onChange={e=>onChange({parameters:{...data.parameters,duration:Number(e.target.value)}})}><option value={6}>6 秒</option><option value={10}>10 秒（768P）</option></select></label><label>云端分辨率<select value={data.parameters?.resolution??provider?.parameters?.resolution??'768P'} onChange={e=>onChange({parameters:{...data.parameters,resolution:e.target.value}})}><option>768P</option><option>1080P</option></select></label><p className="muted">支持文生视频或单首帧图生视频。1080P 仅支持 6 秒，生成参数以上述云端设置为准。</p></>}
 {kind==='video'&&!nativeMinimax&&<p className="muted">视频时长与规格继承项目设置；实际提交时长按分镜和固定音色对白自动计算。</p>}
 </>;
}
