import test from 'node:test';
import assert from 'node:assert/strict';
import { needsComposition } from '../src/shotComposition.ts';
import { deriveWorkflowGuide } from '../src/app/workflowGuide.ts';
import { deriveVideoProductionRows } from '../src/videoProduction.ts';
import { invalidate } from '../src/graph.ts';
import { importStoryboardShots } from '../src/shotNodes.ts';

function fixture() {
  return {videoReferenceMode:'multimodal',shots:[{id:'s',videoNode:'v',imageNode:'i',duration:5,compositionMode:'direct'}],
    nodes:[{id:'i',data:{kind:'image',assetId:'old',stale:true}}, {id:'v',data:{kind:'video',provider:'rh',model:'alibaba/wan-3.0',prompt:'转身',assetId:'clip'}}],edges:[{source:'i',target:'v'}]};
}
test('direct shots ignore obsolete optional images in readiness, guide and invalidation',()=>{
  const doc=fixture();
  assert.equal(needsComposition(doc,doc.shots[0]),false);
  const row=deriveVideoProductionRows(doc,[],[],[{id:'rh',type:'runninghub'}])[0];
  assert.equal(row.readinessReason,''); assert.equal(row.firstFrame,undefined);
  const guide=deriveWorkflowGuide({document:doc});
  assert.equal(guide.stages.images.state,'skipped');
  assert.notEqual(guide.stages.video.state,'blocked');
  assert.notEqual(invalidate(doc,['i']).nodes[1].data.stale,true);
});
test('mixed episode requires composition only for opted-in shots; strict frames still require image',()=>{
  const doc=fixture(); doc.shots.push({id:'s2',imageNode:'i2',compositionMode:'preview'});
  const guide=deriveWorkflowGuide({document:doc});
  assert.equal(guide.stages.video.state,'blocked');
  assert.match(guide.stages.video.reasons[0],/0\/1/);
  doc.shots[0].videoReferenceMode='first_frame';
  assert.equal(needsComposition(doc,doc.shots[0]),true);
});
test('new imports default direct while existing composition intent and media survive',()=>{
  const doc=fixture();doc.shots[0].compositionMode='preview';
  let n=0;
  const result=importStoryboardShots(doc,[{id:'s',duration:5},{id:'new',duration:5}],[],[],()=>String(++n));
  assert.equal(result.shots[0].compositionMode,'preview');
  assert.equal(result.shots[1].compositionMode,'direct');
  assert.equal(result.nodes.find(x=>x.id==='i').data.assetId,'old');
  delete doc.shots[0].compositionMode;
  assert.equal(needsComposition(doc,doc.shots[0]),true);
});
