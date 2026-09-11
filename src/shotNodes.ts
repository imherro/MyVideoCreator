import {nodeDefaults} from './nodeDefaults.ts';
import {framesForDuration} from './shotSync.ts';
type Value=Record<string,any>;
export function ensureShotNodes<T extends {nodes:Value[];edges:Value[];shots:Value[]}>(doc:T,providers:Value[],models:Value[],newId:()=>string,selectedIds?:string[]):T{
 const nodes=[...doc.nodes],edges=[...doc.edges];
 const shots=doc.shots.map((shot,index)=>{
  if(selectedIds&&!selectedIds.includes(shot.id))return shot;
  let image=nodes.find(n=>n.id===shot.imageNode&&n.data.kind==='image');
  let video=nodes.find(n=>n.id===shot.videoNode&&n.data.kind==='video');
  if(!image){image={id:newId(),type:'media',position:{x:80,y:80+index*320},data:{kind:'image',label:`${shot.id} · 分镜图`,prompt:shot.image_prompt,...nodeDefaults('image',providers,models)}};nodes.push(image)}
  if(!video){const defaults=nodeDefaults('video',providers,models);video={id:newId(),type:'media',position:{x:470,y:80+index*320},data:{kind:'video',label:`${shot.id} · 视频`,prompt:shot.video_prompt,...defaults,frames:framesForDuration(defaults.model,shot.duration)}};nodes.push(video)}
  if(!edges.some(e=>e.source===image!.id&&e.target===video!.id))edges.push({id:newId(),source:image.id,target:video.id});
  return {...shot,imageNode:image.id,videoNode:video.id};
 });
 return {...doc,nodes,edges,shots};
}
