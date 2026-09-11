import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureShotNodes,importStoryboardShots} from '../src/shotNodes.ts';
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
test('shot nodes form the script to storyboard to image to video chain',()=>{
 let i=0;const id=()=>String(++i);const providers=[{id:'v',kind:'video',local:true,model:'minimax_h3'}];
 const doc={nodes:[
  {id:'script',data:{kind:'text',text:'故事'}},
  {id:'plan',data:{kind:'storyboard',text:'分镜规划'}}
 ],edges:[],shots:[{id:'s1',duration:5,image_prompt:'首帧',video_prompt:'动作'}]};
 const result=ensureShotNodes(doc,providers,[],id,undefined,'plan');
 const shot=result.shots[0];
 assert.deepEqual(result.edges.map(edge=>[edge.source,edge.target]),[
  ['script','plan'],['plan',shot.imageNode],[shot.imageNode,shot.videoNode]
 ]);
 assert.equal(shot.storyboardNode,'plan');
 assert.equal(ensureShotNodes(result,providers,[],id,undefined,'plan').edges.length,3);
});
test('importing storyboard shots creates the full canvas and preserves existing shot nodes',()=>{
 let i=0;const id=()=>`new-${++i}`;const providers=[{id:'v',kind:'video',local:true,model:'minimax_h3'}];
 const existingImage={id:'image-1',data:{kind:'image',prompt:'保留人工修改'}};
 const existingVideo={id:'video-1',data:{kind:'video',prompt:'保留视频设置'}};
 const doc={nodes:[
  {id:'script',data:{kind:'text',text:'故事'}},
  {id:'plan',data:{kind:'storyboard',text:'分镜规划'}},existingImage,existingVideo
 ],edges:[{id:'old-edge',source:'image-1',target:'video-1'}],shots:[
  {id:'s1',imageNode:'image-1',videoNode:'video-1'}
 ]};
 const result=importStoryboardShots(doc,[
  {id:'s1',duration:3,image_prompt:'新图提示',video_prompt:'新视频提示'},
  {id:'s2',duration:4,image_prompt:'第二图',video_prompt:'第二视频'},
 ],providers,[],id,'plan');
 assert.equal(result.nodes.length,6);
 assert.equal(result.shots[0].imageNode,'image-1');
 assert.equal(result.shots[0].videoNode,'video-1');
 assert.equal(result.nodes.find(node=>node.id==='image-1').data.prompt,'保留人工修改');
 assert.deepEqual(result.edges.map(edge=>[edge.source,edge.target]),[
  ['image-1','video-1'],['script','plan'],['plan','image-1'],
  ['plan',result.shots[1].imageNode],[result.shots[1].imageNode,result.shots[1].videoNode]
 ]);
 const again=importStoryboardShots(result,result.shots,providers,[],id,'plan');
 assert.equal(again.nodes.length,6);assert.equal(again.edges.length,5);
});
