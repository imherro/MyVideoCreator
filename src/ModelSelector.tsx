import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
type Value=Record<string,any>;
export function ModelSelector({data,providers,localModels,request,onChange}:{data:Value;providers:Value[];localModels:Value[];request:(path:string)=>Promise<any>;onChange:(patch:Value)=>void}){
 const [models,setModels]=useState<Value[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const kind=data.kind==='storyboard'?'text':data.kind,providerId=data.provider||'local';
 const provider=providers.find(p=>p.id===providerId),nativeMinimax=provider?.type==='minimax';
 const suitable=providers.filter(p=>p.kind===kind||!p.kind);
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>|undefined;const deadline=Date.now()+180000;
  setModels([]);setError('');if(providerId==='local'){setLoading(false);return}
  async function refreshModels(){setLoading(true);try{const v=await request('/providers/'+encodeURIComponent(providerId)+'/models');if(!active)return;
   if(v.status==='starting'){if(Date.now()>deadline)throw new Error('推理引擎启动较慢，请在模型与服务中查看状态后刷新');timer=setTimeout(refreshModels,3000);return}setModels(v.models);setLoading(false);
  }catch(e:any){if(active){setError(e.message);setLoading(false)}}}
  void refreshModels();return()=>{active=false;clearTimeout(timer)};
 },[providerId,refresh]);
 const selected=models.find(m=>m.id===data.model),caps=selected?.capabilities;
 return <><label>模型服务<select value={providerId} onChange={e=>{const p=providers.find(p=>p.id===e.target.value);onChange({provider:e.target.value,model:p?.model||localModels[0]?.id||'',model_capabilities:undefined})}}>
 {kind==='text'?<option value="local">本地 · llama.cpp 文本</option>:<option value="local" disabled>请选择图像或视频服务</option>}
 {suitable.map(p=><option key={p.id} value={p.id}>{p.local?'本地':'云端'} · {p.name}</option>)}
 {providerId!=='local'&&!suitable.some(p=>p.id===providerId)&&<option value={providerId} disabled>原服务不适用，请重新选择</option>}
 </select></label>
 {providerId==='local'&&kind==='text'?<label>本地模型<select value={data.model||localModels[0]?.id||''} onChange={e=>onChange({model:e.target.value})}>{!localModels.length&&<option value="">未找到模型，请打开设置</option>}{localModels.map(m=><option key={m.id} value={m.id}>{m.name} · {m.size_gb} GB</option>)}</select></label>:providerId!=='local'&&<>
 <div className="field-heading"><label>服务模型</label><button className="quiet" onClick={()=>{const p=providers.find(p=>p.id===providerId);if(p?.model)onChange({model:p.model,frames:p.model==='minimax_h3'?124:data.frames,resolution:p.model==='minimax_h3'?'864x480':data.resolution,model_capabilities:models.find(m=>m.id===p.model)?.capabilities})}}>使用默认</button><button className="quiet" disabled={loading} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={13}/>刷新</button></div>
 <select aria-label="服务模型" value={data.model||''} onChange={e=>{const m=models.find(m=>m.id===e.target.value);onChange({model:e.target.value,model_capabilities:m?.capabilities})}}><option value="">{loading?'正在读取模型目录':'请选择模型'}</option>{data.model&&!models.some(m=>m.id===data.model)&&<option value={data.model}>{data.model}</option>}{models.map(m=><option key={m.id} value={m.id} disabled={m.installed===false}>{m.name}{m.installed===true?' · 已安装':m.installed===false?' · 未安装':''}</option>)}</select>
 {loading&&<p className="muted">正在读取模型目录；内置引擎首次启动可能需要一些时间。</p>}
 {error&&<p className="error">{error}</p>}
 <details><summary>手动填写模型 ID</summary><input aria-label="手动模型 ID" value={data.model||''} onChange={e=>onChange({model:e.target.value,model_capabilities:undefined})}/></details>
 {caps&&<p className="muted">{caps.image_reference?'支持参考图':'不支持参考图'}{caps.max_references?` · 最多 ${caps.max_references} 张`:''}{caps.audio_output?' · 生成原声':''}{caps.end_frame?' · 支持尾帧':''}</p>}
 </>}
 {nativeMinimax&&<><label>生成时长<select value={data.parameters?.duration??provider?.parameters?.duration??6} onChange={e=>onChange({parameters:{...data.parameters,duration:Number(e.target.value)}})}><option value={6}>6 秒</option><option value={10}>10 秒（768P）</option></select></label><label>云端分辨率<select value={data.parameters?.resolution??provider?.parameters?.resolution??'768P'} onChange={e=>onChange({parameters:{...data.parameters,resolution:e.target.value}})}><option>768P</option><option>1080P</option></select></label><p className="muted">支持文生视频或单首帧图生视频。1080P 仅支持 6 秒，生成参数以上述云端设置为准。</p></>}
 {kind==='video'&&!nativeMinimax&&<label>视频帧数<input type="number" min={caps?.min_frames||17} max={caps?.max_frames||2001} step={caps?.frame_step||1} value={data.frames||121} onChange={e=>onChange({frames:Number(e.target.value)})}/><small>{caps?.fps?`${caps.fps} fps · 预计 ${((data.frames||121)/caps.fps).toFixed(2)} 秒。`:''}{caps?.frame_step?`合法帧数从 ${caps.min_frames||1} 开始，每次增加 ${caps.frame_step}。`:'合法帧数由模型决定。'}</small></label>}
 </>;
}
