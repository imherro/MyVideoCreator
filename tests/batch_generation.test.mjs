import test from 'node:test';
import assert from 'node:assert/strict';
import {planBatchGeneration,assetBatchFeedback} from '../src/batchGeneration.ts';

const providers=[
  {id:'ark',name:'Ark',kind:'image',local:false,models:{image:'seedream'}},
  {id:'video-local',name:'Video',kind:'video',local:true,model:'wan'},
];

test('asset batch queues missing roots and waits for parent approval before states',()=>{
  const document={
    nodes:[],shots:[],
    generationPolicy:{text:null,image:{providerId:'ark',modelId:'seedream'},video:null},
    filmBible:{visual:{
      cards:{
        hero:{id:'hero',kind:'character',name:'主角',parentCardId:null,currentVersionId:'hero-v1',status:'active'},
        wet:{id:'wet',kind:'character_state',name:'淋雨状态',parentCardId:'hero',currentVersionId:'wet-v1',status:'active'},
      },
      versions:{
        'hero-v1':{id:'hero-v1',cardId:'hero',status:'draft',references:[]},
        'wet-v1':{id:'wet-v1',cardId:'wet',status:'draft',parentVersionId:'hero-v1',references:[]},
      },
    }},
  };
  const plan=planBatchGeneration(document,[],providers,[],'assets');
  assert.deepEqual(plan.readyIds,['hero-v1']);
  assert.equal(plan.cloudCount,1);
  assert.equal(plan.blocked.length,0);
  assert.equal(plan.waiting[0].parentVersionId,'hero-v1');
  assert.match(plan.waiting[0].reason,/锁定基础图/);
  assert.equal(assetBatchFeedback(plan,1).error,'');

  // Base generation is not sufficient: wait for the explicit visual approval.
  const base=document.filmBible.visual.versions['hero-v1'];
  base.status='pending_reference';base.references=[{role:'primary',assetId:'base-image'}];
  const awaiting=planBatchGeneration(document,[],providers,[],'assets');
  assert.deepEqual(awaiting.readyIds,[]);
  assert.match(awaiting.waiting[0].reason,/确认并锁定/);
  assert.equal(assetBatchFeedback(awaiting,0).error,'');
  assert.match(assetBatchFeedback(awaiting,0).notice,/再次点击/);

  base.status='locked';
  const approved=planBatchGeneration(document,[],providers,[],'assets');
  assert.deepEqual(approved.readyIds,['wet-v1']);
  assert.equal(approved.waiting.length,0);
  const queued=planBatchGeneration(document,[{node_id:'visual-version:wet-v1',status:'queued'}],providers,[],'assets');
  assert.deepEqual(queued.readyIds,[]);
  assert.equal(queued.skipped.length,2);
  document.filmBible.visual.versions['wet-v1'].references=[{role:'primary',assetId:'state-image'}];
  const completed=planBatchGeneration(document,[],providers,[],'assets');
  assert.deepEqual(completed.readyIds,[]);
  assert.equal(assetBatchFeedback(completed,0).error,'');
});

test('shot batches are incremental and video waits for a reviewed current frame',()=>{
  const document={
    filmBible:{visual:{cards:{},versions:{}}},generationPolicy:{text:null,image:null,video:null},
    shots:[
      {id:'S1',imageNode:'image-1',videoNode:'video-1'},
      {id:'S2',imageNode:'image-2',videoNode:'video-2'},
    ],
    nodes:[
      {id:'image-1',data:{kind:'image',prompt:'灯完全熄灭',provider:'ark',assetId:'frame-1',stale:false,state_reviewed:false}},
      {id:'video-1',data:{kind:'video',prompt:'灯亮起',provider:'video-local'}},
      {id:'image-2',data:{kind:'image',prompt:'街景',provider:'ark',assetId:'old-frame',stale:true}},
      {id:'video-2',data:{kind:'video',prompt:'推进镜头',provider:'video-local'}},
    ],
  };
  const images=planBatchGeneration(document,[],providers,[],'shot_images');
  assert.deepEqual(images.readyIds,['image-2']);
  assert.equal(images.skipped[0].id,'image-1');
  const videos=planBatchGeneration(document,[],providers,[],'shot_videos');
  assert.deepEqual(videos.readyIds,[]);
  assert.match(videos.blocked[0].reason,/核验首帧/);
  assert.match(videos.blocked[1].reason,/过期/);
});

test('running work is skipped to prevent duplicate batch submissions',()=>{
  const document={
    filmBible:{visual:{cards:{},versions:{}}},generationPolicy:{text:null,image:null,video:null},
    shots:[{id:'S1',imageNode:'image-1'}],
    nodes:[{id:'image-1',data:{kind:'image',prompt:'画面',provider:'ark'}}],
  };
  const jobs=[{node_id:'image-1',status:'queued'}];
  const plan=planBatchGeneration(document,jobs,providers,[],'shot_images');
  assert.deepEqual(plan.readyIds,[]);
  assert.match(plan.skipped[0].reason,/队列/);
});

test('shot image batch blocks missing or unapproved film bible bindings',()=>{
  const document={filmBible:{visual:{cards:{hero:{id:'hero',status:'active'}},versions:{'hero-v1':{id:'hero-v1',cardId:'hero',status:'draft',references:[]}}}},shots:[{id:'S1',imageNode:'image-1',assetBindings:{characters:[],scene:null,props:[]}}],nodes:[{id:'image-1',data:{kind:'image',prompt:'主角入场',provider:'ark'}}]};
  const missing=planBatchGeneration(document,[],providers,[],'shot_images');
  assert.match(missing.blocked[0].reason,/尚未绑定/);
  document.shots[0].assetBindings.characters=[{versionId:'hero-v1'}];
  const unlocked=planBatchGeneration(document,[],providers,[],'shot_images');
  assert.match(unlocked.blocked[0].reason,/尚未锁定/);
});

function assetDocument(){return {generationPolicy:{image:{providerId:'ark',modelId:'seedream'}},filmBible:{visual:{cards:{
 state:{id:'state',name:'夜景',kind:'scene_state',parentCardId:'base',currentVersionId:'state-v1',status:'active'},
 base:{id:'base',name:'庭院',kind:'scene',currentVersionId:'base-v2',status:'active'},
 deleted:{id:'deleted',name:'已删除',kind:'prop',deletedAt:1,currentVersionId:'deleted-v1',status:'active'},
},versions:{
 'base-v1':{id:'base-v1',cardId:'base',version:1,status:'draft',references:[]},
 'base-v2':{id:'base-v2',cardId:'base',version:2,status:'draft',references:[]},
 'state-v1':{id:'state-v1',cardId:'state',status:'draft',parentVersionId:'base-v1',references:[]},
 'deleted-v1':{id:'deleted-v1',cardId:'deleted',status:'draft',references:[]},
}}}};}

test('waiting uses the frozen parent version and shows queued/failed parent states',()=>{
 const document=assetDocument();
 for(const [status,reason] of [['running',/正在生成/],['failed',/生成失败/]]){
  const plan=planBatchGeneration(document,[{node_id:'visual-version:base-v1',status}],providers,[],'assets');
  assert.deepEqual(plan.readyIds,['base-v2']); // soft-deleted assets never submit
  assert.equal(plan.waiting[0].parentLabel,'庭院 · V1');
  assert.match(plan.waiting[0].reason,reason);
 }
 document.filmBible.visual.versions['base-v2'].status='locked';
 document.filmBible.visual.versions['base-v2'].references=[{role:'primary',assetId:'new'}];
 assert.equal(planBatchGeneration(document,[],providers,[],'assets').waiting.length,1);
 document.filmBible.visual.versions['base-v1'].status='locked';
 document.filmBible.visual.versions['base-v1'].references=[{role:'primary',assetId:'old'}];
 assert.deepEqual(planBatchGeneration(document,[],providers,[],'assets').readyIds,['state-v1']);
});

test('broken parent relationships remain real errors, without blocking independent roots',()=>{
 const document=assetDocument();delete document.filmBible.visual.versions['base-v1'];
 const plan=planBatchGeneration(document,[],providers,[],'assets');
 assert.deepEqual(plan.readyIds,['base-v2']);
 assert.equal(plan.waiting.length,0);
 assert.equal(plan.blocked.length,1);
 assert.match(assetBatchFeedback(plan,1).error,/基础版本不存在/);
 assert.match(assetBatchFeedback({...plan,blocked:[]},0,['庭院：服务不可用']).error,/庭院：服务不可用/);
});
