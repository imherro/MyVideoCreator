import {defaultStage,describeStage} from './directorScene.ts';
import {invalidate,patchNode} from './graph.ts';
type Value = Record<string, any>;
export type CompositionKind = 'panorama' | 'director';
export function frameRatio(value: string) {
  const [a,b]=String(value).split(':').map(Number);
  return a>0 && b>0 && Number.isFinite(a/b) ? a/b : 16/9;
}
export function compositionData(kind: CompositionKind, legacyStage?: Value) {
  return {kind:'reference',label:kind==='panorama'?'全景场景':'3D 构图',compositionType:kind,
    composition:kind==='director'?{stage:structuredClone(legacyStage || defaultStage())}:{sourceAssetId:'',yaw:0,pitch:0,fov:90}};
}
export function panoramaSource(document: Value,node: Value) {
  const config=node.data.composition || {};
  return config.sourceAssetId || document.nodes.find((item:Value)=>item.id===config.sourceNodeId)?.data.assetId || '';
}
export function patchCompositionNode<T extends {nodes:any[];edges:any[]}>(document:T,nodeId:string,patch:Value):T {
  const owner=document.nodes.find(node=>node.id===nodeId);
  const next=patchNode(document,nodeId,patch);
  const changed=owner && Object.keys(patch).some(key=>key!=='label' && JSON.stringify(owner.data[key])!==JSON.stringify(patch[key]));
  // The saved output still belongs to this helper if its visual edge was removed.
  return changed && owner.data.outputNodeId && !document.edges.some(edge=>edge.source===nodeId && edge.target===owner.data.outputNodeId)
    ? invalidate(next,[owner.data.outputNodeId]) : next;
}
export function setCompositionOutput<T extends {nodes:any[];edges:any[]}>(document:T,nodeId:string,assetId:string,newId:()=>string,snapshot?:string):T {
  const owner=document.nodes.find(node=>node.id===nodeId);
  if(!owner)return document;
  const existing=document.nodes.find(node=>node.id===owner.data.outputNodeId);
  const outputId=existing?.id || newId();
  const stale=snapshot!==undefined && JSON.stringify(owner.data.composition)!==snapshot;
  const description=owner.data.compositionType==='director'?describeStage(owner.data.composition.stage):'从全景场景取出的透视构图，用于背景布局和视角参考。';
  const output={...(existing || {id:outputId,type:'media',position:{x:owner.position.x+390,y:owner.position.y}}),data:{...existing?.data,kind:'reference',label:`${owner.data.label} · 构图参考`,assetId,compositionOwner:nodeId,referencePurpose:'composition',compositionDescription:description,stale}};
  const next={...document,nodes:[...document.nodes.filter(n=>n.id!==outputId).map(n=>n.id===nodeId?{...n,data:{...n.data,previewAssetId:assetId,outputNodeId:outputId}}:n),output],edges:document.edges.some(e=>e.source===nodeId&&e.target===outputId)?document.edges:[...document.edges,{id:newId(),source:nodeId,target:outputId,data:{origin:'composition_output'}}]};
  return invalidate(next,[outputId],new Set([outputId]));
}
