import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeDefaults} from '../src/nodeDefaults.ts';
test('creation paths prefer configured cloud models and never send media to text runtime',()=>{
 const providers=[{id:'cloud',kind:'video',model:'remote'}, {id:'native-video',kind:'video',local:true,model:'minimax_h3'}, {id:'native-image',kind:'image',local:true,model:'flux2_klein_base_9b'}];
 assert.equal(nodeDefaults('video',providers,[]).provider,'cloud');
 assert.equal(nodeDefaults('video',providers,[]).resolution,'832x480');
 assert.equal(nodeDefaults('video',providers,[]).frames,121);
 assert.equal(nodeDefaults('image',providers,[]).provider,'native-image');
 assert.equal(nodeDefaults('storyboard',providers,[{id:'qwen'}]).model,'qwen');
 assert.equal(nodeDefaults('video',[],[]).provider,'');
 const policy={text:{providerId:'ark',modelId:'doubao-seed'},image:{providerId:'native-image',modelId:'flux-cloud'},video:null};
 const withArk=[...providers,{id:'ark',type:'volcengine_ark',local:false,models:{text:'doubao-seed'}}];
 assert.deepEqual(nodeDefaults('storyboard',withArk,[{id:'qwen'}],policy),{
  provider:'ark',model:'doubao-seed',resolution:'832x480',frames:121,seed:-1,
 });
 assert.equal(nodeDefaults('image',withArk,[],policy).model,'flux-cloud');
});
