import type {GenerationKind,GenerationPolicy} from './generationPolicy';
type Value=Record<string,any>;
const labels:Record<GenerationKind,string>={text:'默认文本模型',image:'默认图片模型',video:'默认视频模型'};
export function GenerationPolicyPanel({value,providers,localModels,onChange}:{value:GenerationPolicy|undefined;providers:Value[];localModels:Value[];onChange:(next:GenerationPolicy)=>void}){
 const policy=value||{text:null,image:null,video:null};
 const patch=(kind:GenerationKind,target:any)=>onChange({...policy,[kind]:target});
 const ark=providers.find(p=>p.type==='volcengine_ark');
 return <section className="generation-policy"><div className="field-heading"><h3>项目默认模型</h3>{ark&&<button className="quiet" onClick={()=>onChange({text:{providerId:ark.id,modelId:ark.models?.text||''},image:{providerId:ark.id,modelId:ark.models?.image||''},video:{providerId:ark.id,modelId:ark.models?.video||''}})}>全部使用火山方舟</button>}</div><p className="muted">新建资产和后续生成节点可以继承这里的设置；节点显式选择始终优先。项目只保存服务与模型 ID，不保存 Key。</p>
 {(['text','image','video'] as GenerationKind[]).map(kind=>{const target=policy[kind],provider=providers.find(p=>p.id===target?.providerId),missing=target&&!provider&&target.providerId!=='local';const suitable=providers.filter(p=>!p.kind||p.kind===kind);return <div className="policy-row" key={kind}><label>{labels[kind]}<select value={target?.providerId||''} onChange={e=>{const id=e.target.value;if(!id)return patch(kind,null);if(id==='local')return patch(kind,{providerId:'local',modelId:localModels[0]?.id||''});const selected=providers.find(p=>p.id===id);patch(kind,{providerId:id,modelId:selected?.models?.[kind]||selected?.model||''})}}><option value="">跟随系统默认</option>{kind==='text'&&<option value="local">本地 llama.cpp</option>}{suitable.map(p=><option key={p.id} value={p.id}>{p.local?'本地':'云端'} · {p.name}</option>)}{missing&&<option value={target!.providerId}>原服务已删除</option>}</select></label><label>模型 ID<input value={target?.modelId||''} disabled={!target} placeholder="由服务默认值决定" onChange={e=>patch(kind,{...target!,modelId:e.target.value})}/></label>{missing&&<small className="danger">配置失效：服务已不存在，不会自动切换。</small>}</div>})}
 </section>
}
