import { compositionEdge } from './shotComposition.ts';
import type {Node, Edge} from '@xyflow/react';
import {canvasScriptInputMatches} from './canvasRunInput.ts';

type Graph = {nodes:Node[];edges:Edge[]};

/**
 * A generated opening frame can contradict a storyboard's required initial
 * state (for example, a lamp that must still be off). These phrases describe
 * a visible pre-action condition, so the image needs a human check before it
 * becomes a video start frame.
 */
export function requiresInitialStateReview(prompt:unknown):boolean{
  const text=String(prompt||'');
  return /(完全熄灭|熄灭|无任何发光|无光晕|未接触|尚未接触|保持明确距离|门关闭|尚未开启|未开启)/.test(text);
}

export function setInitialStateReviewed<T extends Graph>(graph:T,nodeId:string):T{
  return {...graph,nodes:graph.nodes.map(node=>node.id===nodeId?{
    ...node,data:{...node.data,state_reviewed:true}
  }:node)};
}
export function descendants(graph:Graph, roots:string[]):Set<string>{
  const found=new Set(roots),pending=[...roots];
  while(pending.length){
    const source=pending.pop();
    for(const edge of graph.edges){
      if(edge.source===source&&!found.has(edge.target)&&!compositionEdge(graph,edge.source,edge.target)){
        found.add(edge.target);pending.push(edge.target);
      }
    }
  }
  return found;
}

export function invalidate<T extends Graph>(graph:T,roots:string[],exclude=new Set<string>()):T{
  const affected=descendants(graph,roots);
  return {...graph,nodes:graph.nodes.map(node=>affected.has(node.id)&&!exclude.has(node.id)?{
    ...node,data:{...node.data,generation_revision:Number(node.data.generation_revision||0)+1,
      stale:!!(node.data.resultJob||node.data.assetId||node.data.text)}
  }:node)};
}

export function patchNode<T extends Graph>(graph:T,id:string,patch:Record<string,unknown>):T{
  const old=graph.nodes.find(n=>n.id===id);
  if(!old)return graph;
  const changed=Object.keys(patch).some(k=>k!=='label'&&JSON.stringify(old.data[k])!==JSON.stringify(patch[k]));
  const next=changed?invalidate(graph,[id]):graph;
  const promptChanged='prompt' in patch&&String(old.data.prompt||'')!==String(patch.prompt||'');
  return {...next,nodes:next.nodes.map(n=>n.id===id?{...n,data:{...n.data,...patch,
    ...(promptChanged?{state_reviewed:false}:{})
  }}:n)};
}

export function removeReference<T extends Graph>(graph:T,nodeId:string,assetId:string):T{
  const node=graph.nodes.find(n=>n.id===nodeId);
  if(!node)return graph;
  const next={...graph,edges:graph.edges.filter(e=>!(e.target===nodeId&&graph.nodes.find(n=>n.id===e.source)?.data.assetId===assetId)),
    nodes:graph.nodes.map(n=>n.id===nodeId?{...n,data:{...n.data,asset_ids:((n.data.asset_ids||[]) as string[]).filter(id=>id!==assetId)}}:n)};
  return invalidate(next,[nodeId]);
}

/**
 * MiniMax accepts one optional initial image. Selecting one in the inspector
 * turns it into an explicit node setting and removes only image-bearing
 * inbound edges; text/storyboard context remains connected.
 */
export function setSingleImageReference<T extends Graph>(graph:T,nodeId:string,assetId:string):T{
  const target=graph.nodes.find(node=>node.id===nodeId);
  if(!target)return graph;
  const next={...graph,
    edges:graph.edges.filter(edge=>{
      if(edge.target!==nodeId)return true;
      const source=graph.nodes.find(node=>node.id===edge.source);
      return !['image','reference'].includes(String(source?.data.kind||''));
    }),
    nodes:graph.nodes.map(node=>node.id===nodeId?{...node,data:{...node.data,asset_ids:assetId?[assetId]:[],end_asset_id:''}}:node)
  };
  return invalidate(next,[nodeId]);
}

type ResultJob={id:string;node_id:string;status:string;input:Record<string,any>;result:Record<string,any>};
export function acceptResult<T extends Graph>(graph:T,job:ResultJob,jobs:ResultJob[]):T{
  // Batch descendants expecting this exact job consume its new output normally.
  const expectedJobs=new Set([job.id]),expectedNodes=new Set([job.node_id]);
  let grew=true;
  while(grew){
    grew=false;
    for(const candidate of jobs){
      if(expectedJobs.has(candidate.id)||!['queued','running','succeeded','interrupted'].includes(candidate.status))continue;
      if((candidate.input.upstream_job_ids||[]).some((id:string)=>expectedJobs.has(id))){
        expectedJobs.add(candidate.id);expectedNodes.add(candidate.node_id);grew=true;
      }
    }
  }
  const next=invalidate(graph,[job.node_id],expectedNodes);
  const compiledPrompt=Boolean(
    job.input.reference_compiler||job.input.shot_video_projection||job.input.dialogue_projection||job.input.motion_compiler||job.input.canvas_script_sources||job.input.composition_references
  );
  return {...next,nodes:next.nodes.map(node=>node.id!==job.node_id?node:{...node,data:{...node.data,
    text:job.result.text||node.data.text,assetId:job.result.assets?.[0]?.id||node.data.assetId,resultJob:job.id,
    generationFingerprint:job.result.assets?.[0]?.generationFingerprint||job.input.generation_fingerprint||node.data.generationFingerprint,
    stale:(
      !compiledPrompt&&node.data.prompt!==job.input.prompt
    )||!canvasScriptInputMatches(graph,node,job.input)||Number(node.data.generation_revision||0)!==Number(job.input.generation_revision||0),
    ...(node.data.kind==='image'&&job.result.assets?.[0]?{state_reviewed:false}:{})
  }})};
}

export function reconcileCompiledVideoResults<T extends Graph>(graph:T,jobs:ResultJob[]):T{
  const byId=new Map(jobs.map(job=>[job.id,job]));
  let changed=false;
  const nodes=graph.nodes.map(node=>{
    if(!node.data.stale||node.data.kind!=='video'||!node.data.resultJob)return node;
    const job=byId.get(String(node.data.resultJob));
    // planned_shot_duration repairs results submitted before
    // shot_video_projection was introduced; those jobs already contain the
    // canonical duration marker and are safe when revision and asset match.
    const compiled=job?.input?.shot_video_projection||job?.input?.dialogue_projection||job?.input?.motion_compiler||
      job?.input?.planned_shot_duration!=null;
    const sameTake=job?.status==='succeeded'&&compiled&&
      job.result?.assets?.[0]?.id===node.data.assetId&&
      Number(node.data.generation_revision||0)===Number(job.input.generation_revision||0);
    if(!sameTake)return node;
    changed=true;
    return {...node,data:{...node.data,stale:false}};
  });
  return changed?{...graph,nodes}:graph;
}
