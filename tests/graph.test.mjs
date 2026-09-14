import test from 'node:test';
import assert from 'node:assert/strict';
import {patchNode,removeReference,setSingleImageReference,acceptResult} from '../src/graph.ts';
const graph=()=>({nodes:['a','b','c','other'].map(id=>({id,position:{x:0,y:0},data:{prompt:'old',resultJob:'job-'+id,assetId:'asset-'+id}})),edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}]});
test('input edit invalidates all dependent results, preserves independent branch',()=>{
 const original=graph(),next=patchNode(original,'a',{prompt:'new'});
 assert.deepEqual(next.nodes.map(n=>!!n.data.stale),[true,true,true,false]);
 assert.equal(next.nodes[2].data.generation_revision,1);
 assert.equal(original.nodes[0].data.prompt,'old');
 assert.equal(patchNode(original,'a',{label:'Rename'}).nodes[0].data.generation_revision,undefined);
});
test('new outputs invalidate previous downstream takes but preserve awaiting batch dependencies',()=>{
 const job={id:'new-a',node_id:'a',status:'succeeded',input:{prompt:'old'},result:{assets:[{id:'new-image'}]}};
 const next=acceptResult(graph(),job,[]);
 assert.deepEqual(next.nodes.map(n=>!!n.data.stale),[false,true,true,false]);
 const batch=[{id:'new-b',node_id:'b',status:'running',input:{upstream_job_ids:['new-a']},result:{}},{id:'new-c',node_id:'c',status:'queued',input:{upstream_job_ids:['new-b']},result:{}}];
 const expected=acceptResult(graph(),job,batch);
 assert.deepEqual(expected.nodes.map(n=>!!n.data.stale),[false,false,false,false]);
 assert.equal(expected.nodes[1].data.generation_revision,undefined);
});
test('compiled Film Bible prompt does not make its fresh image stale',()=>{
 const original=graph();
 const job={
  id:'compiled-image',node_id:'a',status:'succeeded',
  input:{prompt:'完整编译提示词',reference_compiler:{version:1},generation_fingerprint:{hash:'current'}},
  result:{assets:[{id:'new-image'}]},
 };
 const next=acceptResult(original,job,[]);
 assert.equal(next.nodes[0].data.prompt,'old');
 assert.equal(next.nodes[0].data.stale,false);
 assert.deepEqual(next.nodes[0].data.generationFingerprint,{hash:'current'});
});
test('removing an image reference removes its duplicate manual and edge sources',()=>{
 const original=graph();original.nodes[1].data.asset_ids=['asset-a','independent-image'];
 const next=removeReference(original,'b','asset-a');
 assert.deepEqual(next.edges.map(e=>e.id),['bc']);
 assert.deepEqual(next.nodes[1].data.asset_ids,['independent-image']);
 assert.deepEqual(next.nodes.map(n=>!!n.data.stale),[false,true,true,false]);
});
test('selecting a MiniMax first frame keeps narrative edges and invalidates the video branch',()=>{
 const original={nodes:[
  {id:'story',data:{kind:'text',text:'故事'}},{id:'image',data:{kind:'image',assetId:'generated-frame'}},
  {id:'reference',data:{kind:'reference',assetId:'reference-frame'}},{id:'video',data:{kind:'video',assetId:'old-video',resultJob:'old-job',end_asset_id:'tail'}},
  {id:'downstream',data:{kind:'video',assetId:'old-downstream',resultJob:'old-downstream-job'}}
 ],edges:[{id:'story-video',source:'story',target:'video'},{id:'image-video',source:'image',target:'video'},{id:'reference-video',source:'reference',target:'video'},{id:'video-next',source:'video',target:'downstream'}]};
 const next=setSingleImageReference(original,'video','reference-frame');
 assert.deepEqual(next.edges.map(e=>e.id),['story-video','video-next']);
 assert.deepEqual(next.nodes[3].data.asset_ids,['reference-frame']);
 assert.equal(next.nodes[3].data.end_asset_id,'');
 assert.equal(next.nodes[3].data.stale,true);
 assert.equal(next.nodes[4].data.stale,true);
 assert.deepEqual(original.nodes[3].data.asset_ids,undefined);
});
