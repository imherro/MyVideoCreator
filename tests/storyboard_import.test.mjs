import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeStoryboardResult} from '../src/filmBible/storyboardImport.ts';

function asset(id,kind,name,parent=null){
 return {card:{id,kind,name,parentCardId:parent,currentVersionId:id+'v',status:'active'},version:{id:id+'v',cardId:id,version:1,parentVersionId:parent?parent+'v':null,status:'locked',references:[{assetId:id+'-ref'}],spec:{description:name}}};
}
function visual(...items){return {cards:Object.fromEntries(items.map(x=>[x.card.id,x.card])),versions:Object.fromEntries(items.map(x=>[x.version.id,x.version]))};}
function fixture(){
 const doc={filmBible:{visual:visual(asset('hero','character','林岚'),asset('wet','character_state','淋湿','hero'),asset('room','scene','房间')),voices:{profiles:{hero:{referenceAssetId:'voice',status:'locked'}}},style:{palette:'blue'}},shots:[],nodes:[],edges:[]};
 const result={filmBible:{visual:visual(asset('newhero','character','林岚'),asset('newwet','character_state','淋湿','newhero'),asset('hurt','character_state','受伤','newhero'))},shots:[{id:'s1',assetBindings:{characters:[{role:'林岚',versionId:'newwetv'}],scene:null,props:[]},dialogues:[{characterCardId:'newhero',characterName:'林岚',text:'你好'}]}]};
 return {doc,result};
}
test('legacy completed job reuses base and state and remaps dialogue voice identity',()=>{
 const {doc,result}=fixture(), before=structuredClone(doc);
 const merged=mergeStoryboardResult(doc,result);
 assert.deepEqual(Object.keys(merged.document.filmBible.visual.cards),['hero','wet','room','hurt']);
 assert.equal(merged.shots[0].assetBindings.characters[0].versionId,'wetv');
 assert.equal(merged.shots[0].dialogues[0].characterCardId,'hero');
 assert.equal(merged.document.filmBible.visual.versions.hurtv.parentVersionId,'herov');
 assert.equal(merged.document.filmBible.visual.cards.hurt.parentCardId,'hero');
 assert.deepEqual(merged.document.filmBible.voices,doc.filmBible.voices);
 assert.deepEqual(merged.document.filmBible.visual.versions.herov,doc.filmBible.visual.versions.herov);
 assert.deepEqual(doc,before);
 assert.deepEqual(mergeStoryboardResult(merged.document,result),merged);
});
test('late task snapshot cannot overwrite latest approved references or shared style',()=>{
 const {doc}=fixture();const result={filmBible:structuredClone(doc.filmBible),shots:[]};
 result.filmBible.visual.versions.herov.references=[];
 result.filmBible.style.palette='red';
 const merged=mergeStoryboardResult(doc,result);
 assert.deepEqual(merged.document,doc);
});
test('same state name under a different character is not merged',()=>{
 const {doc,result}=fixture();result.filmBible.visual.cards.newhero.name='另一位角色';
 const merged=mergeStoryboardResult(doc,result);
 assert.equal(merged.shots[0].assetBindings.characters[0].versionId,'newwetv');
 assert.equal(merged.shots[0].dialogues[0].characterCardId,'newhero');
});
test('confirmed alias reuses identity and does not create duplicate voices or cards',()=>{
 const {doc,result}=fixture();doc.filmBible.visual.cards.hero.aliases=['小林'];result.filmBible.visual.cards.newhero.name='小林';
 const merged=mergeStoryboardResult(doc,result);
 assert.equal(merged.shots[0].dialogues[0].characterCardId,'hero');
 assert.equal(merged.shots[0].dialogues[0].characterName,'林岚');
 assert.equal(merged.document.filmBible.visual.cards.newhero,undefined);
});
