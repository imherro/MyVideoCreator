import {patchNode,invalidate} from './graph.ts';
import type {Node,Edge} from '@xyflow/react';
type Value=Record<string,any>;
export function framesForDuration(model:string,duration:number,caps:Value={}){
 const fps=caps.fps||(model==='minimax_h3'?24:model.startsWith('ltx2')?25:24);
 const min=caps.min_frames||(model==='minimax_h3'?124:17);
 const step=caps.frame_step||(model==='minimax_h3'?17:model.startsWith('ltx2')?8:1);
 const max=caps.max_frames||(model==='minimax_h3'?345:2001);
 return Math.min(min+Math.floor((max-min)/step)*step,Math.max(min,min+Math.round((duration*fps-min)/step)*step));
}
export function updateShot<T extends {shots:Value[];nodes:Node[];edges:Edge[]}>(document:T,id:string,patch:Value):T{
 const shot=document.shots.find(s=>s.id===id);if(!shot)return document;
 const imageNodeId=shot.imageNode||shot.pipeline?.imageNodeId;
 const videoNodeId=shot.videoNode||shot.pipeline?.videoNodeId;
 let next={...document,shots:document.shots.map(s=>s.id===id?{...s,...patch}:s)};
 if('image_prompt' in patch&&imageNodeId)next=patchNode(next,imageNodeId,{prompt:patch.image_prompt});
 if('video_prompt' in patch&&videoNodeId)next=patchNode(next,videoNodeId,{prompt:patch.video_prompt});
 if('duration' in patch&&videoNodeId){
  const node=next.nodes.find(n=>n.id===videoNodeId);
  if(node)next=patchNode(next,node.id,{frames:framesForDuration(String(node.data.model||''),patch.duration,node.data.model_capabilities as Value||{})});
 }
 const semanticChanged=['scene','characters','action','emotion','camera'].some(
  field=>field in patch&&JSON.stringify(patch[field])!==JSON.stringify(shot[field])
 );
 if(semanticChanged){
  next=invalidate(next,[imageNodeId,videoNodeId].filter(Boolean));
  next={...next,shots:next.shots.map(s=>s.id===id?{...s,prompts_need_review:true}:s)};
 }
 const audioChanged='audio' in patch&&patch.audio!==shot.audio;
 if(audioChanged){
  next=invalidate(next,[videoNodeId].filter(Boolean));
  next={...next,shots:next.shots.map(s=>s.id===id?{...s,prompts_need_review:true}:s)};
 }
 return next;
}
