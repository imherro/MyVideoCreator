type Value=Record<string,any>;
export type GenerationKind='text'|'image'|'video';
export type GenerationTarget={providerId:string;modelId:string};
export type GenerationPolicy=Record<GenerationKind,GenerationTarget|null>;

export const emptyGenerationPolicy=():GenerationPolicy=>({text:null,image:null,video:null});

export function resolveGenerationTarget(kind:GenerationKind,override:Value|undefined,policy:GenerationPolicy|undefined,providers:Value[],localModels:Value[]=[]){
 let target:GenerationTarget|undefined,source:'override'|'project'|'system'='system';
 if(override?.mode==='override'){target={providerId:override.providerId,modelId:override.modelId||''};source='override'}
 else if(policy?.[kind]){target=policy[kind]||undefined;source='project'}
 if(target){
  if(target.providerId==='local'&&kind==='text')return {...target,source};
  const provider=providers.find(p=>p.id===target!.providerId);
  if(!provider)throw new Error(`${source==='project'?'项目默认':'节点自定义'}模型服务已不存在，请重新选择；系统不会自动切换到其他服务`);
  if(provider.kind&&provider.kind!==kind)throw new Error(`所选模型服务不支持${kind}`);
  return {providerId:provider.id,modelId:target.modelId||provider.models?.[kind]||provider.model||'',source};
 }
 const cloud=providers.find(p=>!p.local&&(!p.kind||p.kind===kind));
 if(cloud)return {providerId:cloud.id,modelId:cloud.models?.[kind]||cloud.model||'',source};
 if(kind==='text')return {providerId:'local',modelId:localModels[0]?.id||'',source};
 const provider=providers.find(p=>p.kind===kind);
 return {providerId:provider?.id||'',modelId:provider?.models?.[kind]||provider?.model||'',source};
}
