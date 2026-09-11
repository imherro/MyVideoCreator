import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeDefaults} from '../src/nodeDefaults.ts';
test('all creation paths prefer local models and never send media to text runtime',()=>{
 const providers=[{id:'cloud',kind:'video',model:'remote'}, {id:'native-video',kind:'video',local:true,model:'minimax_h3'}, {id:'native-image',kind:'image',local:true,model:'flux2_klein_base_9b'}];
 assert.equal(nodeDefaults('video',providers,[]).provider,'native-video');
 assert.equal(nodeDefaults('video',providers,[]).resolution,'864x480');
 assert.equal(nodeDefaults('video',providers,[]).frames,124);
 assert.equal(nodeDefaults('image',providers,[]).provider,'native-image');
 assert.equal(nodeDefaults('storyboard',providers,[{id:'qwen'}]).model,'qwen');
 assert.equal(nodeDefaults('video',[],[]).provider,'');
});
