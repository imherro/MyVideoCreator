import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionData,frameRatio,setCompositionOutput,panoramaSource,patchCompositionNode} from '../src/compositionNodes.ts';

test('each 3D helper owns a separate scene and preserves legacy scene on import',()=>{
  const a=compositionData('director'),b=compositionData('director');
  a.composition.stage.camera.yaw=90;
  assert.equal(b.composition.stage.camera.yaw,25);
  const restored=compositionData('director',a.composition.stage);
  restored.composition.stage.camera.yaw=45;
  assert.equal(a.composition.stage.camera.yaw,90);
  assert.equal(frameRatio('9:16'),9/16);
  assert.equal(frameRatio('invalid'),16/9);
});
test('saving reuses output node, preserves existing connections, invalidates only dependent results',()=>{
  let sequence=0;const id=()=>`id-${++sequence}`;
  const owner={id:'helper',type:'media',position:{x:20,y:40},data:compositionData('director')};
  const graph={nodes:[owner,{id:'shot',position:{x:900,y:0},data:{kind:'image',assetId:'old'}}],edges:[]};
  const first=setCompositionOutput(graph,'helper','crop1',id);
  const output=first.nodes.find(n=>n.data.referencePurpose==='composition');
  assert.equal(first.nodes.length,3);assert.equal(output.data.assetId,'crop1');
  first.edges.push({id:'connected',source:output.id,target:'shot'});
  const second=setCompositionOutput(first,'helper','crop2',id);
  assert.equal(second.nodes.length,3);assert.equal(second.edges.length,2);
  assert.equal(second.nodes.find(n=>n.id===output.id).data.assetId,'crop2');
  assert.equal(second.nodes.find(n=>n.id==='shot').data.stale,true);
  assert.equal(second.nodes.find(n=>n.id===output.id).data.stale,false);
  assert.equal(graph.nodes.length,2);
  const late=setCompositionOutput(first,'helper','late',id,'outdated-snapshot');
  assert.equal(late.nodes.find(n=>n.id===output.id).data.stale,true);
});
test('panorama original source is separate from its perspective output',()=>{
  const owner={data:{...compositionData('panorama'),composition:{sourceNodeId:'source'},previewAssetId:'crop'}};
  assert.equal(panoramaSource({nodes:[{id:'source',data:{assetId:'panorama'}}]},owner),'panorama');
  owner.data.composition.sourceAssetId='uploaded';
  assert.equal(panoramaSource({nodes:[]},owner),'uploaded');
});
test('editing helper invalidates its saved output even after its internal edge was removed',()=>{
  const graph={nodes:[{id:'helper',data:{...compositionData('panorama'),outputNodeId:'output'}},{id:'output',data:{assetId:'crop'}},{id:'image',data:{assetId:'result'}}],edges:[{source:'output',target:'image'}]};
  const next=patchCompositionNode(graph,'helper',{composition:{yaw:80}});
  assert.equal(next.nodes[1].data.stale,true);
  assert.equal(next.nodes[2].data.stale,true);
  assert.equal(patchCompositionNode(graph,'helper',{label:'rename'}).nodes[1].data.stale,undefined);
});
