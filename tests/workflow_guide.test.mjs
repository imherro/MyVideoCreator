import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveWorkflowGuide} from '../src/app/workflowGuide.ts';

const base={adaptation:{sourceEventCount:0,adaptationPlan:{status:'draft'}},scripts:[],currentProject:{id:'ep1',episode_no:1},document:{shots:[],nodes:[],timeline:[],filmBible:{visual:{cards:{},versions:{}}}},jobs:[]};

test('guide blocks downstream work and recommends source first',()=>{
  const guide=deriveWorkflowGuide(base);
  assert.equal(guide.recommendedStage,'source');
  assert.equal(guide.stages.adaptation.state,'blocked');
  assert.equal(guide.stages.storyboard.state,'blocked');
});

test('guide requires locked primary references before shot images',()=>{
  const document={...base.document,shots:[{id:'s1',assetBindings:{characters:[{versionId:'v1'}],scene:null,props:[]},imageNode:'i1'}],nodes:[{id:'i1',data:{kind:'image'}}],filmBible:{visual:{cards:{c1:{id:'c1'}},versions:{v1:{id:'v1',cardId:'c1',status:'draft',references:[]}}}}};
  const guide=deriveWorkflowGuide({...base,adaptation:{sourceEventCount:2,adaptationPlan:{status:'approved'}},scripts:[{episodeNo:1,projectId:'ep1',script:{status:'approved'}}],document});
  assert.equal(guide.stages.storyboard.state,'complete');
  assert.equal(guide.stages.images.state,'blocked');
  assert.equal(guide.stages.images.action.stage,'art');
});

test('guide asks for asset bindings when a film bible exists',()=>{
  const document={...base.document,shots:[{id:'s1',assetBindings:{characters:[],scene:null,props:[]}}],filmBible:{visual:{cards:{c1:{id:'c1'}},versions:{}}}};
  const guide=deriveWorkflowGuide({...base,adaptation:{sourceEventCount:2,adaptationPlan:{status:'approved'}},scripts:[{episodeNo:1,projectId:'ep1',script:{status:'approved'}}],document});
  assert.equal(guide.stages.storyboard.state,'review');
  assert.equal(guide.stages.art.state,'blocked');
});

test('guide advances from completed images to video',()=>{
  const document={...base.document,shots:[{id:'s1',assetBindings:{characters:[],scene:null,props:[]},imageNode:'i1',videoNode:'v1'}],nodes:[{id:'i1',data:{kind:'image',assetId:'a1'}},{id:'v1',data:{kind:'video'}}]};
  const guide=deriveWorkflowGuide({...base,adaptation:{sourceEventCount:2,adaptationPlan:{status:'approved'}},scripts:[{episodeNo:1,projectId:'ep1',script:{status:'approved'}}],document});
  assert.equal(guide.stages.images.state,'complete');
  assert.equal(guide.stages.video.state,'ready');
});

test('canvas-first script skips optional planning and becomes the recommended formal step',()=>{
  const script={status:'draft',body:'内景 日\n女孩推开门。',metadata:{origin:'canvas'}};
  const guide=deriveWorkflowGuide({...base,scripts:[{episodeNo:1,projectId:'ep1',script}]});
  assert.equal(guide.stages.source.state,'skipped');
  assert.equal(guide.stages.adaptation.state,'skipped');
  assert.equal(guide.stages.script.state,'ready');
  assert.equal(guide.recommendedStage,'script');
});
