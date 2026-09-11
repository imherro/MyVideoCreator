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
 let next={...document,shots:document.shots.map(s=>s.id===id?{...s,...patch}:s)};
 if('image_prompt' in patch&&shot.imageNode)next=patchNode(next,shot.imageNode,{prompt:patch.image_prompt});
 if('video_prompt' in patch&&shot.videoNode)next=patchNode(next,shot.videoNode,{prompt:patch.video_prompt});
 if('duration' in patch&&shot.videoNode){
  const node=next.nodes.find(n=>n.id===shot.videoNode);
  if(node)next=patchNode(next,node.id,{frames:framesForDuration(String(node.data.model||''),patch.duration,node.data.model_capabilities as Value||{})});
 }
 if('action' in patch&&patch.action!==shot.action){
  next=invalidate(next,[shot.imageNode,shot.videoNode].filter(Boolean));
  next={...next,shots:next.shots.map(s=>s.id===id?{...s,prompts_need_review:true}:s)};
 }
 return next;
}
