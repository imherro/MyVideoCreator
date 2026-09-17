import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultVoiceProfile,saveVoiceProfile,setVoiceLocked,acceptVoiceResult,effectiveVoiceProfile,chooseVoiceVersion,voiceIdentity,requireTtsVoice} from '../src/filmBible/voices.ts';
const doc=()=>({filmBible:{visual:{cards:{hero:{kind:'character'}}},voices:{profiles:{}}},shots:[],nodes:[],edges:[]});
const upload=(aid)=>({...defaultVoiceProfile('hero'),providerId:'',voiceType:'',previewText:'',source:{type:'uploaded',originalAssetId:aid,authorizedAt:'2026-09-16'}});
test('upload without TTS configuration locks one immutable sample and preserves active version',()=>{
 let d=saveVoiceProfile(doc(),'hero',upload('audio-a')); d=setVoiceLocked(d,'hero',true);
 assert.equal(effectiveVoiceProfile(d.filmBible.voices.profiles.hero).referenceAssetId,'audio-a');
 d=saveVoiceProfile(d,'hero',upload('audio-b'));
 assert.equal(d.filmBible.voices.profiles.hero.version,2);
 assert.equal(d.filmBible.voices.profiles.hero.status,'draft');
 assert.equal(effectiveVoiceProfile(d.filmBible.voices.profiles.hero).referenceAssetId,'audio-a');
 d=setVoiceLocked(d,'hero',true);d=chooseVoiceVersion(d,'hero',2);
 assert.equal(effectiveVoiceProfile(d.filmBible.voices.profiles.hero).referenceAssetId,'audio-b');
 assert.throws(()=>requireTtsVoice(d.filmBible.voices.profiles.hero),/不能自动逐句合成/);
});
test('old TTS completion cannot overwrite an uploaded revision or different config',()=>{
 let p={...defaultVoiceProfile('hero','speech'),voiceType:'speaker',previewText:'本集的测试对白。'};
 let d=saveVoiceProfile(doc(),'hero',p);
 const job={id:'old',input:{voice_profile:{cardId:'hero',version:1,identity:voiceIdentity(p)}},result:{assets:[{id:'tts',kind:'audio'}]}};
 d=saveVoiceProfile(d,'hero',{...p,parameters:{speechRate:25,emotion:'开心'}});
 assert.equal(acceptVoiceResult(d,job),d);
 d=saveVoiceProfile(d,'hero',upload('audio'));
 assert.equal(acceptVoiceResult(d,job),d);
 assert.equal(d.filmBible.voices.profiles.hero.previewAssetId,'audio');
});
test('TTS requirements and upload declaration stay separate; label edits keep revision',()=>{
 assert.throws(()=>saveVoiceProfile(doc(),'hero',defaultVoiceProfile('hero')),/请选择豆包/);
 assert.throws(()=>saveVoiceProfile(doc(),'hero',{...upload('a'),source:{type:'uploaded',originalAssetId:'a',authorizedAt:''}}),/使用权/);
 let d=saveVoiceProfile(doc(),'hero',upload('a'));
 d=saveVoiceProfile(d,'hero',{...d.filmBible.voices.profiles.hero,name:'新名称'});
 assert.equal(d.filmBible.voices.profiles.hero.version,1);
});
