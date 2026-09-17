import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveWorkflowGuide} from '../src/app/workflowGuide.ts';

const base={adaptation:{sourceEventCount:0,adaptationPlan:{status:'draft'}},scripts:[],currentProject:{id:'ep1',episode_no:1},document:{shots:[],nodes:[],timeline:[],filmBible:{visual:{cards:{},versions:{}}}},jobs:[]};

test('direct creation starts at an editable script without source or a plan',()=>{
 const input={...base,document:{...base.document,creationMode:'direct'}};
 const guide=deriveWorkflowGuide(input);
 assert.equal(guide.recommendedStage,'script');
 assert.equal(guide.stages.source.state,'skipped');
 assert.equal(guide.stages.adaptation.state,'skipped');
 assert.equal(guide.stages.script.state,'ready');
 const saved=deriveWorkflowGuide({...input,scripts:[{projectId:'ep1',episodeNo:1,script:{status:'draft',body:'已粘贴的本集剧本'}}]});
 assert.equal(saved.recommendedStage,'storyboard');
});

const savedStory = {status:'draft', storyCore:{premise:'故事'}, storyArc:{opening:'开场'}, adaptationStrategy:{tone:'悬疑'}};
const savedPlan = (episodeNo,status='draft') => ({episodeNo,status,sourceChapterRefs:['c1'],logline:'本集',coreConflict:'冲突',hook:'开场',cliffhanger:'悬念'});

test('regenerated EP02 can continue directly while completed EP01 is protected',()=>{
  const adaptation={sourceEventCount:6,adaptationPlan:savedStory,protectedEpisodeNos:[1],episodePlans:[savedPlan(1,'approved'),savedPlan(2,'review')]};
  const guide=deriveWorkflowGuide({...base,adaptation});
  assert.equal(guide.stages.adaptation.state,'complete');
  assert.equal(guide.stages.adaptation.action.stage,'script');
  assert.doesNotMatch(JSON.stringify(guide),/批准|审核/);
});

test('episode-only invalidation names the affected episode and respects running regeneration',()=>{
  const adaptation={sourceEventCount:6,adaptationPlan:savedStory,protectedEpisodeNos:[1],episodePlans:[savedPlan(1,'approved'),savedPlan(2,'stale')]};
  let guide=deriveWorkflowGuide({...base,adaptation});
  assert.equal(guide.stages.adaptation.state,'stale');
  assert.match(guide.stages.adaptation.headline,/EP02/);
  assert.doesNotMatch(guide.stages.adaptation.headline,/EP01/);
  guide=deriveWorkflowGuide({...base,adaptation,jobs:[{status:'running',input:{stage:'adaptation_episode_generation'}}]});
  assert.equal(guide.stages.adaptation.state,'running');
});

test('a genuinely stale shared story is not silently approved by episode regeneration',()=>{
  const adaptation={sourceEventCount:6,adaptationPlan:{status:'stale'},episodePlans:[{episodeNo:2,status:'review'}]};
  const guide=deriveWorkflowGuide({...base,adaptation});
  assert.equal(guide.stages.adaptation.state,'stale');
  assert.match(guide.stages.adaptation.headline,/全剧故事骨架/);
});

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
  assert.equal(guide.stages.script.state,'complete');
  assert.equal(guide.stages.storyboard.state,'ready');
  assert.equal(guide.recommendedStage,'storyboard');
});

for (const status of ['draft','review','approved']) {
  test(`legacy ${status} script with saved body can enter storyboard`,()=>{
    const script={status,body:'角色推开门。'};
    const guide=deriveWorkflowGuide({...base,scripts:[{episodeNo:1,projectId:'ep1',script}]});
    assert.equal(guide.stages.script.state,'complete');
    assert.equal(guide.stages.storyboard.state,'ready');
  });
}

test('empty or stale script cannot start storyboarding merely because of a legacy status',()=>{
  for (const script of [{status:'approved',body:' '},{status:'stale',body:'旧正文'}]) {
    const guide=deriveWorkflowGuide({...base,scripts:[{episodeNo:1,projectId:'ep1',script}]});
    assert.equal(guide.stages.storyboard.state,'blocked');
  }
});

test('incomplete sibling planning does not block generating ready episodes',()=>{
  const adaptation={sourceEventCount:2,adaptationPlan:savedStory,episodePlans:[savedPlan(1),{...savedPlan(2),hook:''}]};
  const guide=deriveWorkflowGuide({...base,adaptation});
  assert.equal(guide.stages.script.state,'ready');
  assert.match(guide.stages.adaptation.headline,/EP02.*待完善/);
});
