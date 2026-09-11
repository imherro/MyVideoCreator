import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptVisualReferenceResult,
  attachUploadedPrimaryReference,
  lockVisualVersion,
  planVisualReferenceGeneration,
  primaryReference,
  resolveVisualGenerationTarget,
  setVisualCardImageOverride,
  startVisualReferenceGeneration,
} from '../src/filmBible/references.ts';
import {updateDraftVisualVersion} from '../src/filmBible/commands.ts';

const providers=[
  {id:'ark',name:'Ark',type:'volcengine_ark',local:false,models:{image:'seedream'}},
  {id:'maestro-image',name:'Maestro',type:'maestro',kind:'image',local:true,model:'flux'},
];

function fixture(){
  return {
    generationPolicy:{text:null,image:{providerId:'ark',modelId:'seedream-project'},video:null},
    filmBible:{visual:{cards:{
      hero:{id:'hero',kind:'character',name:'林岚',parentCardId:null,currentVersionId:'hero-v1',status:'active',source:{type:'script_extraction'}},
      wet:{id:'wet',kind:'character_state',name:'雨中的林岚',parentCardId:'hero',currentVersionId:'wet-v1',status:'active',source:{type:'script_extraction'}},
    },versions:{
      'hero-v1':{id:'hero-v1',cardId:'hero',version:1,parentVersionId:null,status:'draft',spec:{description:'灰色风衣，短发',attributes:[{name:'外套',value:'灰色风衣'}]},invariants:['脸型不变'],references:[],createdAt:1,provenance:{}},
      'wet-v1':{id:'wet-v1',cardId:'wet',version:1,parentVersionId:'hero-v1',status:'draft',spec:{description:'衣服被雨淋湿',attributes:[]},invariants:['仍是灰色风衣'],references:[],createdAt:2,provenance:{}},
    }},continuity:{},style:{},story:{}},shots:[],nodes:[],edges:[],timeline:[],characters:[],brief:'',style:'电影写实',ratio:'16:9',duration:15,
  };
}

test('visual card override wins over the project image policy and inherit restores it',()=>{
  let doc=fixture();
  let card=doc.filmBible.visual.cards.hero;
  assert.deepEqual(resolveVisualGenerationTarget(card,doc.generationPolicy,providers),{
    providerId:'ark',modelId:'seedream-project',source:'project',
  });
  doc=setVisualCardImageOverride(doc,'hero',{mode:'override',providerId:'maestro-image',modelId:'flux-special'});
  card=doc.filmBible.visual.cards.hero;
  assert.deepEqual(resolveVisualGenerationTarget(card,doc.generationPolicy,providers),{
    providerId:'maestro-image',modelId:'flux-special',source:'override',
  });
  doc=setVisualCardImageOverride(doc,'hero',{mode:'inherit'});
  assert.equal(resolveVisualGenerationTarget(doc.filmBible.visual.cards.hero,doc.generationPolicy,providers).source,'project');
});

test('uploaded primary reference requires human locking and locked versions are immutable',()=>{
  let doc=fixture();
  assert.throws(()=>lockVisualVersion(doc,'hero-v1'),/只有待确认参考图/);
  doc=attachUploadedPrimaryReference(doc,'hero-v1',{id:'asset-uploaded',name:'hero.png'},10);
  assert.equal(doc.filmBible.visual.versions['hero-v1'].status,'pending_reference');
  assert.deepEqual(primaryReference(doc.filmBible.visual.versions['hero-v1']),{
    role:'primary',assetId:'asset-uploaded',source:'uploaded',createdAt:10,provenance:{filename:'hero.png'},
  });
  doc=lockVisualVersion(doc,'hero-v1',11);
  assert.equal(doc.filmBible.visual.versions['hero-v1'].status,'locked');
  assert.equal(doc.filmBible.visual.versions['hero-v1'].provenance.lockedAt,11);
  assert.throws(()=>attachUploadedPrimaryReference(doc,'hero-v1',{id:'replacement'}),/不能替换/);
  assert.throws(()=>updateDraftVisualVersion(doc,'hero-v1',{spec:{description:'改写',attributes:[]},invariants:[]}),/不可修改/);
});

test('state generation requires and sends the locked parent reference',()=>{
  const target={providerId:'ark',modelId:'seedream',source:'project'};
  let doc=fixture();
  assert.throws(()=>planVisualReferenceGeneration(doc,'wet-v1',target,{image_reference:true}),/先确认并锁定父版本/);
  doc=lockVisualVersion(attachUploadedPrimaryReference(doc,'hero-v1',{id:'asset-parent'}),'hero-v1');
  assert.throws(()=>planVisualReferenceGeneration(doc,'wet-v1',target,{image_reference:false}),/纯文生图生成会破坏身份一致性/);
  assert.throws(()=>planVisualReferenceGeneration(doc,'wet-v1',target,undefined),/未明确支持参考图/);
  const plan=planVisualReferenceGeneration(doc,'wet-v1',target,{image_reference:true});
  assert.deepEqual(plan.assetIds,['asset-parent']);
  assert.equal(plan.parentVersionId,'hero-v1');
  assert.equal(plan.parentReferenceAssetId,'asset-parent');
  assert.match(plan.prompt,/必须以输入参考图中的身份/);
});

test('generated primary reference preserves immutable job and parent provenance',()=>{
  let doc=fixture();
  doc=lockVisualVersion(attachUploadedPrimaryReference(doc,'hero-v1',{id:'asset-parent'}),'hero-v1');
  const plan=planVisualReferenceGeneration(doc,'wet-v1',{providerId:'ark',modelId:'seedream',source:'override'},{image_reference:true});
  doc=startVisualReferenceGeneration(doc,plan,'job-reference-1',20);
  assert.equal(doc.filmBible.visual.versions['wet-v1'].status,'pending_reference');
  doc=acceptVisualReferenceResult(doc,{
    id:'job-reference-1',node_id:'visual-version:wet-v1',result:{assets:[{id:'asset-generated'}]},
  },21);
  const reference=primaryReference(doc.filmBible.visual.versions['wet-v1']);
  assert.equal(reference.assetId,'asset-generated');
  assert.equal(reference.source,'generated');
  assert.equal(reference.provenance.jobId,'job-reference-1');
  assert.equal(reference.provenance.providerId,'ark');
  assert.equal(reference.provenance.modelId,'seedream');
  assert.equal(reference.provenance.targetSource,'override');
  assert.equal(reference.provenance.parentVersionId,'hero-v1');
  assert.equal(reference.provenance.parentReferenceAssetId,'asset-parent');
  assert.equal(reference.provenance.prompt,plan.prompt);
});
