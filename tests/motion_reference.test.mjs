import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVideoProductionRows } from '../src/videoProduction.ts';
import { updateShot } from '../src/shotSync.ts';
import { acceptResult, reconcileCompiledVideoResults } from '../src/graph.ts';
import { videoGenerationMode } from '../src/motionReference.ts';
import { applyVideoOutputSetting, defaultProjectSetupDraft } from '../src/projectSetup.ts';

const provider={id:'ark',type:'volcengine_ark'};
function fixture(){return {videoReferenceMode:'multimodal',shots:[{id:'s',videoNode:'v',imageNode:'i',duration:4}],nodes:[
  {id:'i',data:{kind:'image',assetId:'frame',prompt:'人物行走'}},
  {id:'v',data:{kind:'video',prompt:'走路',provider:'ark',model:'doubao-seedance-2-5-260628',assetId:'old',generation_revision:2}},
  {id:'export',data:{assetId:'movie'}},
],edges:[{source:'i',target:'v'},{source:'v',target:'export'}]};}
const assets=[{id:'frame',kind:'image'},{id:'motion',kind:'video'}];
test('new project defaults to explicit multimodal with one still and no audio/video',()=>{
  assert.equal(defaultProjectSetupDraft([]).videoReferenceMode,'multimodal');
  assert.equal(deriveVideoProductionRows(fixture(),assets,[],[provider])[0].readinessReason,'');
});
test('adding/removing motion does not change mode and invalidates only descendants',()=>{
  const doc=fixture(); doc.shots[0].videoReferenceMode='first_frame';
  const added=updateShot(doc,'s',{motionReference:{assetId:'motion',cameraMode:'follow_reference'}});
  assert.equal(videoGenerationMode(added,added.shots[0]),'first_frame');
  assert.match(deriveVideoProductionRows(added,assets,[],[provider])[0].readinessReason,/多模态/);
  assert.deepEqual(added.nodes[0],doc.nodes[0]);
  assert.equal(added.nodes[1].data.assetId,'old');
  assert.equal(added.nodes[2].data.stale,true);
  const removed=updateShot(added,'s',{motionReference:null});
  assert.equal(videoGenerationMode(removed,removed.shots[0]),'first_frame');
});
test('project mode changes leave explicit shot overrides intact',()=>{
  const doc=fixture();doc.shots[0].videoReferenceMode='multimodal';
  const next=applyVideoOutputSetting(doc,{videoReferenceMode:'first_frame'});
  assert.deepEqual(next.nodes[1],doc.nodes[1]);
});
test('a late multimodal result stays stale after motion reference changes',()=>{
  const doc=updateShot(fixture(),'s',{motionReference:{assetId:'motion',cameraMode:'follow_reference'}});
  const job={id:'job',node_id:'v',kind:'video',status:'succeeded',input:{motion_compiler:{version:'v1'},generation_revision:2,prompt:'compiled'},result:{assets:[{id:'late'}]}};
  const applied=acceptResult(doc,job,[]);
  const reconciled=reconcileCompiledVideoResults(applied,[job]);
  assert.equal(reconciled.nodes[1].data.stale,true);
});
