import test from 'node:test';
import assert from 'node:assert/strict';
import {timelinePosition,timelineDuration,timelinePreviewWindow} from '../src/timeline.ts';
test('playhead crosses cuts and retains source trim offset',()=>{
 const clips=[{id:'a',asset_id:'one',duration:1.5,start:2},{id:'b',asset_id:'two',duration:2,start:5}];
 assert.equal(timelineDuration(clips),3.5);
 assert.equal(timelinePosition(clips,1.49).index,0);
 const cut=timelinePosition(clips,1.5);assert.equal(cut.index,1);assert.equal(cut.offset,0);
 const position=timelinePosition(clips,2);assert.equal(position.clip.start+position.offset,5.5);
 assert.equal(timelinePosition(clips,3.5).offset,2);
 assert.equal(timelinePosition([],0),null);
});

test('preview keeps previous current and next clips in stable ring slots',()=>{
 const clips=[
  {id:'a',asset_id:'a',start:0,duration:2},
  {id:'b',asset_id:'b',start:0,duration:2},
  {id:'c',asset_id:'c',start:0,duration:2},
  {id:'d',asset_id:'d',start:0,duration:2},
 ];
 assert.deepEqual(timelinePreviewWindow(clips,1).map(item=>[item.index,item.slot]),[[0,0],[1,1],[2,2]]);
 assert.deepEqual(timelinePreviewWindow(clips,2).map(item=>[item.index,item.slot]),[[1,1],[2,2],[3,0]]);
});
