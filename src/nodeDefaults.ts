type Value=Record<string,any>;
/** Shared by canvas, storyboard and browser tools. Never route media to the text engine. */
export function nodeDefaults(kind:string,providers:Value[],models:Value[]){
 const media=kind==='image'||kind==='video';
 const provider=media?(providers.find(p=>p.local&&p.kind===kind)||providers.find(p=>p.kind===kind)):undefined;
 const model=media?(provider?.model||''):(models[0]?.id||'');
 return {provider:media?(provider?.id||''):'local',model,resolution:model==='minimax_h3'?'864x480':'832x480',frames:model==='minimax_h3'?124:121,seed:-1};
}
