import test from 'node:test';
import assert from 'node:assert/strict';
import { setVoiceLocked, acceptVoiceResult } from '../src/filmBible/voices.ts';
import { dialogueMode } from '../src/dialogueMode.ts';
import { deriveVideoProductionRows } from '../src/videoProduction.ts';
import { defaultProjectSetupDraft, applyVideoOutputSetting } from '../src/projectSetup.ts';
import { updateShot } from '../src/shotSync.ts';

function fixture() {return {dialogueMode:'voice_sample',videoReferenceMode:'multimodal',filmBible:{voices:{profiles:{robot:{cardId:'robot',status:'draft',version:1,voiceType:'robot',previewAssetId:'sample'}}}},
  shots:[{id:'s',videoNode:'v',imageNode:'i',duration:4,dialogues:[{characterCardId:'robot',characterName:'机器人',text:'你好'}]}],
  nodes:[{id:'i',data:{kind:'image',assetId:'image'}},{id:'v',data:{kind:'video',prompt:'你好',provider:'ark',model:'doubao-seedance-2-5-260628',assetId:'old',generation_revision:1}}],edges:[{source:'i',target:'v'}]};}
test('new defaults use samples while old documents retain full dialogue',()=>{
  assert.equal(defaultProjectSetupDraft([]).dialogueMode,'voice_sample');
  assert.equal(dialogueMode({},{}),'full_dialogue');
  assert.equal(dialogueMode({dialogueMode:'voice_sample'},{dialogueMode:'full_dialogue'}),'full_dialogue');
});
test('confirm pins a sample and subsequent preview cannot replace it',()=>{
  const locked=setVoiceLocked(fixture(),'robot',true);
  assert.equal(locked.filmBible.voices.profiles.robot.referenceAssetId,'sample');
  assert.equal(locked.nodes[1].data.stale,true);
  const preview=acceptVoiceResult(locked,{id:'new',input:{voice_profile:{cardId:'robot',version:1}},result:{assets:[{id:'new-sample',kind:'audio'}]}});
  assert.equal(preview.filmBible.voices.profiles.robot.previewAssetId,'new-sample');
  assert.equal(preview.filmBible.voices.profiles.robot.referenceAssetId,'sample');
  const unlocked=setVoiceLocked(preview,'robot',false);
  assert.equal(unlocked.filmBible.voices.profiles.robot.referenceAssetId,undefined);
});
test('ready samples replace the TTS prerequisite without extending shot timing',()=>{
  const doc=setVoiceLocked(fixture(),'robot',true);
  const rows=deriveVideoProductionRows(doc,[{id:'image',kind:'image'},{id:'sample',kind:'audio',metadata:{duration:12}}],[],[{id:'ark',type:'volcengine_ark'}]);
  assert.equal(rows[0].readinessReason,'');
  assert.equal(rows[0].effectiveDuration,4);
  assert.equal(rows[0].dialogueAudioAssets.length,0);
});
test('dialogue mode changes preserve explicit overrides and stale only video',()=>{
  const doc=fixture();doc.shots[0].dialogueMode='voice_sample';
  assert.deepEqual(applyVideoOutputSetting(doc,{dialogueMode:'full_dialogue'}).nodes,doc.nodes);
  const changed=updateShot(doc,'s',{dialogueMode:'full_dialogue'});
  assert.deepEqual(changed.nodes[0],doc.nodes[0]);
  assert.equal(changed.nodes[1].data.stale,true);
});
