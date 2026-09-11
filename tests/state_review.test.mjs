import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptResult,patchNode,requiresInitialStateReview,setInitialStateReviewed} from '../src/graph.ts';

const graph={nodes:[
  {id:'image',data:{kind:'image',prompt:'机器人胸灯完全熄灭，无任何发光、无光晕',assetId:'old',state_reviewed:true}},
  {id:'video',data:{kind:'video',prompt:'镜头开始后胸灯亮起'}}
],edges:[{id:'edge',source:'image',target:'video'}]};

test('visible pre-action states require an image review',()=>{
  assert.equal(requiresInitialStateReview(graph.nodes[0].data.prompt),true);
  assert.equal(requiresInitialStateReview('雨后小巷的橘猫看向机器人'),false);
  const edited=patchNode(graph,'image',{prompt:'机器人与宝箱保持明确距离，尚未接触'});
  assert.equal(edited.nodes[0].data.state_reviewed,false);
  assert.equal(setInitialStateReviewed(edited,'image').nodes[0].data.state_reviewed,true);
});

test('a new sensitive image take always needs a fresh review',()=>{
  const next=acceptResult(graph,{id:'new-take',node_id:'image',status:'succeeded',input:{prompt:graph.nodes[0].data.prompt},result:{assets:[{id:'new'}]}},[]);
  assert.equal(next.nodes[0].data.assetId,'new');
  assert.equal(next.nodes[0].data.state_reviewed,false);
});
