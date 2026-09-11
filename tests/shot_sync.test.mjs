import test from 'node:test';
import assert from 'node:assert/strict';
import {updateShot,framesForDuration} from '../src/shotSync.ts';
test('shot prompt edits update linked inputs and invalidate descendants',()=>{
 const doc={shots:[{id:'s',imageNode:'i',videoNode:'v'}],nodes:['i','v'].map(id=>({id,position:{x:0,y:0},data:{prompt:'old',resultJob:'old-job',model:'minimax_h3'}})),edges:[{id:'e',source:'i',target:'v'}]};
 const updated=updateShot(doc,'s',{image_prompt:'new'});
 assert.equal(updated.nodes[0].data.prompt,'new');assert.equal(updated.nodes[1].data.prompt,'old');
 assert.ok(updated.nodes.every(n=>n.data.stale));assert.equal(doc.nodes[0].data.prompt,'old');
 const duration=updateShot(doc,'s',{duration:8});assert.equal(duration.nodes[1].data.frames,192);
});
test('frame conversion respects different model lattices',()=>{
 assert.equal(framesForDuration('minimax_h3',1),124);
 assert.equal(framesForDuration('minimax_h3',30),345);
 assert.equal((framesForDuration('ltx2_22B',5)-17)%8,0);
 assert.equal(framesForDuration('custom',3,{fps:30,min_frames:10,frame_step:10,max_frames:100}),90);
});
