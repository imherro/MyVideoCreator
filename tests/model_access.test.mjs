import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProjectModelPool,effectiveProjectTargets,enabledModelIds,projectProviders} from '../src/modelAccess.ts';

const providers=[
  {id:'ark',name:'Ark',type:'volcengine_ark',models:{text:'text-default',image:'image-default',video:'video-default'},enabled_models:{text:['text-default','text-fast'],image:['image-default'],video:[]}},
  {id:'speech',name:'Speech',type:'volcengine_speech',kind:'audio',resource_id:'seed-tts-2.0'},
];

test('system model library uses explicit multi-select and respects an explicit empty list',()=>{
  assert.deepEqual(enabledModelIds(providers[0],'text'),['text-default','text-fast']);
  assert.deepEqual(enabledModelIds(providers[0],'video'),[]);
  assert.deepEqual(enabledModelIds(providers[1],'audio'),['seed-tts-2.0']);
});

test('legacy projects inherit the system library while explicit project pools filter it',()=>{
  const inherited=effectiveProjectTargets(undefined,providers,'text');
  assert.equal(inherited.length,2);
  const pool={text:[{providerId:'ark',modelId:'text-fast'},{providerId:'ark',modelId:'not-enabled'}]};
  assert.deepEqual(effectiveProjectTargets(pool,providers,'text'),[{providerId:'ark',modelId:'text-fast'}]);
  assert.deepEqual(projectProviders(pool,providers,'text').map(item=>item.id),['ark']);
});

test('new project pool includes enabled cloud and local models by kind',()=>{
  const pool=defaultProjectModelPool(providers,[{id:'qwen',name:'Qwen'}]);
  assert.deepEqual(pool.text.map(item=>item.modelId),['qwen','text-default','text-fast']);
  assert.equal(pool.video.length,0);
  assert.deepEqual(pool.audio,[{providerId:'speech',modelId:'seed-tts-2.0'}]);
});
