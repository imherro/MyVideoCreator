import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverImpactedShots,
  forkLockedVisualVersion,
  hardDeleteVisualVersion,
  setProjectVisualStyle,
  upgradeVisualBindings,
} from '../src/filmBible/versioning.ts';
import {setVisualVersionStatus} from '../src/filmBible/commands.ts';

function fixture(){
  const v1={id:'hero-v1',cardId:'hero',version:1,parentVersionId:null,status:'locked',spec:{description:'灰色风衣',attributes:[{name:'发型',value:'短发'}]},invariants:['脸型不变'],references:[{role:'primary',assetId:'old-reference'}],createdAt:1,provenance:{lockedAt:2}};
  return {
    filmBible:{visual:{cards:{hero:{id:'hero',kind:'character',name:'林岚',parentCardId:null,currentVersionId:'hero-v1',status:'active',source:{type:'script_extraction'}}},versions:{'hero-v1':v1}},style:{palette:'cold'},styleVersion:3,continuity:{},story:{}},
    shots:[
      {id:'A',uid:'shot-A',scene:'雨巷',sequence:'seq-1',imageNode:'image-A',assetBindings:{characters:[{role:'林岚',versionId:'hero-v1'}],scene:null,props:[]}},
      {id:'B',uid:'shot-B',scene:'雨巷',sequence:'seq-1',imageNode:'image-B',assetBindings:{characters:[{role:'林岚',versionId:'hero-v1'}],scene:null,props:[]}},
      {id:'C',uid:'shot-C',scene:'室内',sequence:'seq-2',imageNode:'image-C',assetBindings:{characters:[{role:'林岚',versionId:'hero-v1'}],scene:null,props:[]}},
    ],
    nodes:['A','B','C'].map(id=>({id:`image-${id}`,data:{kind:'image',assetId:`frame-${id}`,resultJob:`job-${id}`,generationFingerprint:{hash:'old'}}})),
    edges:[],jobs:[],assets:['old-reference','frame-A','frame-B','frame-C'],
  };
}

function forked(){
  const source=fixture();
  const original=structuredClone(source.filmBible.visual.versions['hero-v1']);
  const document=forkLockedVisualVersion(source,'hero-v1',{
    spec:{description:'蓝色风衣',attributes:[{name:'发型',value:'短发'}]},
    invariants:['脸型不变'],
  },{id:'hero-v2',createdAt:10});
  return {source,original,document};
}

test('locked v1 forks immutable v2 without upgrading old shots or creating work',()=>{
  const {source,original,document}=forked();
  assert.deepEqual(document.filmBible.visual.versions['hero-v1'],original);
  assert.deepEqual(document.filmBible.visual.versions['hero-v2'],{
    id:'hero-v2',cardId:'hero',version:2,parentVersionId:'hero-v1',status:'draft',
    spec:{description:'蓝色风衣',attributes:[{name:'发型',value:'短发'}]},
    invariants:['脸型不变'],references:[],createdAt:10,provenance:{forkedFromVersionId:'hero-v1'},
  });
  assert.equal(document.filmBible.visual.cards.hero.currentVersionId,'hero-v2');
  assert.deepEqual(document.shots,source.shots);
  assert.deepEqual(document.jobs,[]);
  assert.deepEqual(document.assets,source.assets);
});

test('impacted discovery is exact and selected upgrade preserves old media as stale',()=>{
  let {document}=forked();
  document=setVisualVersionStatus(document,'hero-v2','pending_reference');
  document=setVisualVersionStatus(document,'hero-v2','draft');
  // Reference acceptance is covered separately; make the new immutable target.
  document.filmBible.visual.versions['hero-v2'].status='locked';
  assert.deepEqual(discoverImpactedShots(document,'hero').map(item=>item.shotUid),['shot-A','shot-B','shot-C']);
  const upgraded=upgradeVisualBindings(document,'hero','hero-v2',{shotUids:['shot-A']});
  assert.equal(upgraded.shots[0].assetBindings.characters[0].versionId,'hero-v2');
  assert.equal(upgraded.shots[1].assetBindings.characters[0].versionId,'hero-v1');
  assert.deepEqual(discoverImpactedShots(upgraded,'hero').map(item=>item.shotUid),['shot-B','shot-C']);
  assert.equal(upgraded.nodes[0].data.assetId,'frame-A');
  assert.equal(upgraded.nodes[0].data.stale,true);
  assert.equal(upgraded.nodes[0].data.staleReason,'visual-version-upgraded');
  assert.equal(upgraded.nodes[1].data.stale,undefined);
  assert.deepEqual(upgraded.jobs,[]);
  assert.deepEqual(upgraded.assets,document.assets);
});

test('scene and sequence upgrades do not affect shots outside the explicit scope',()=>{
  let {document}=forked();
  document.filmBible.visual.versions['hero-v2'].status='locked';
  const scene=upgradeVisualBindings(document,'hero','hero-v2',{scene:'雨巷'});
  assert.deepEqual(scene.shots.map(s=>s.assetBindings.characters[0].versionId),['hero-v2','hero-v2','hero-v1']);
  const sequence=upgradeVisualBindings(document,'hero','hero-v2',{sequence:'seq-2'});
  assert.deepEqual(sequence.shots.map(s=>s.assetBindings.characters[0].versionId),['hero-v1','hero-v1','hero-v2']);
});

test('referenced and immutable versions cannot be hard deleted; deprecated stays resolvable',()=>{
  let doc=fixture();
  assert.throws(()=>hardDeleteVisualVersion(doc,'hero-v1'),/仍被分镜引用/);
  doc=setVisualVersionStatus(doc,'hero-v1','deprecated');
  assert.equal(doc.shots[0].assetBindings.characters[0].versionId,'hero-v1');
  assert.equal(doc.filmBible.visual.versions['hero-v1'].status,'deprecated');
  assert.throws(()=>hardDeleteVisualVersion(doc,'hero-v1'),/仍被分镜引用/);
});

test('style version changes mark generated shots stale without removing media',()=>{
  const doc=fixture();
  const changed=setProjectVisualStyle(doc,'水彩动画');
  assert.equal(changed.filmBible.styleVersion,4);
  assert.ok(changed.nodes.every(node=>node.data.stale&&node.data.assetId));
  assert.deepEqual(changed.assets,doc.assets);
  assert.equal(setProjectVisualStyle(changed,'水彩动画'),changed);
});
