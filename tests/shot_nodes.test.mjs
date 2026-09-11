import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureShotNodes} from '../src/shotNodes.ts';
test('batch preparation repairs missing nodes without duplicating existing work',()=>{
 let i=0;const id=()=>String(++i);const providers=[{id:'v',kind:'video',local:true,model:'minimax_h3'}];
 const image={id:'existing',data:{kind:'image',prompt:'manually edited'}};
 const doc={nodes:[image],edges:[],shots:[{id:'s1',imageNode:'existing',duration:5},{id:'s2',duration:8}]};
 const result=ensureShotNodes(doc,providers,[],id);
 assert.equal(result.nodes.length,4);assert.equal(result.nodes[0],image);assert.equal(result.edges.length,2);
 assert.equal(result.nodes.find(n=>n.id===result.shots[1].videoNode).data.frames,192);
 const again=ensureShotNodes(result,providers,[],id);assert.equal(again.nodes.length,4);assert.equal(again.edges.length,2);
 assert.equal(doc.nodes.length,1);
});
