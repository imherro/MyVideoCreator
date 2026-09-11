import test from 'node:test';
import assert from 'node:assert/strict';
import {planShotTimeline} from '../src/shotTimeline.ts';
test('ordered clips use planned duration and flag incomplete or stale shots',()=>{
 const shots=[{videoNode:'b',duration:3},{videoNode:'a',duration:5}];
 const nodes=[{id:'a',data:{assetId:'aa'}},{id:'b',data:{assetId:'bb'}}];
 const assets=['aa','bb'].map(id=>({id,kind:'video',metadata:{duration:5.17}}));let i=0;
 const plan=planShotTimeline(shots,nodes,assets,()=>String(++i));
 assert.deepEqual(plan.clips.map(c=>[c.asset_id,c.duration]),[['bb',3],['aa',5]]);assert.equal(plan.issues.length,0);
 nodes[0].data.stale=true;assert.equal(planShotTimeline(shots,nodes,assets,()=>String(++i)).issues.length,1);
 assert.equal(planShotTimeline([{videoNode:'b',duration:6}],nodes,assets,()=>String(++i)).issues.length,1);
});
