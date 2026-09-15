import test from 'node:test';
import assert from 'node:assert/strict';
import {autoLayoutCanvas} from '../src/canvasLayout.ts';

function fixture(){
  const nodes=[
    {id:'video-2',type:'media',position:{x:0,y:0},data:{kind:'video',assetId:'clip-2'}},
    {id:'visual-hero',type:'visualAsset',position:{x:0,y:0},data:{kind:'visual_asset',managed:true,visualVersionId:'hero-v1'}},
    {id:'image-1',type:'media',position:{x:0,y:0},data:{kind:'image',assetId:'frame-1'}},
    {id:'script',type:'media',position:{x:0,y:0},data:{kind:'text',text:'剧本'}},
    {id:'image-2',type:'media',position:{x:0,y:0},data:{kind:'image',assetId:'frame-2'}},
    {id:'storyboard',type:'media',position:{x:0,y:0},data:{kind:'storyboard',text:'分镜'}},
    {id:'visual-scene',type:'visualAsset',position:{x:0,y:0},data:{kind:'visual_asset',managed:true,visualVersionId:'scene-v1'}},
    {id:'video-1',type:'media',position:{x:0,y:0},data:{kind:'video',assetId:'clip-1'}},
  ];
  return {nodes,filmBible:{visual:{cards:{hero:{id:'hero',kind:'character'},scene:{id:'scene',kind:'scene'}},versions:{'hero-v1':{id:'hero-v1',cardId:'hero'},'scene-v1':{id:'scene-v1',cardId:'scene'}}}},edges:[{id:'a',source:'script',target:'storyboard'},{id:'b',source:'storyboard',target:'image-1'},{id:'c',source:'image-1',target:'video-1'}],shots:[
    {id:'shot-2',uid:'s2',order:2,imageNode:'image-2',videoNode:'video-2'},
    {id:'shot-1',uid:'s1',order:1,imageNode:'image-1',videoNode:'video-1'},
  ]};
}

test('auto layout separates dependency lanes and orders shot image/video rows',()=>{
  const source=fixture();
  const result=autoLayoutCanvas(source);
  const at=id=>result.nodes.find(node=>node.id===id).position;
  assert.ok(at('script').x<at('storyboard').x);
  assert.ok(at('storyboard').x<at('visual-hero').x);
  assert.ok(at('visual-hero').x<at('image-1').x);
  assert.ok(at('image-1').x<at('video-1').x);
  assert.ok(at('image-1').x-(at('visual-hero').x+260)>=200);
  assert.ok(at('video-1').x-(at('image-1').x+300)>=150);
  assert.equal(at('image-1').y,at('video-1').y);
  assert.equal(at('image-2').y,at('video-2').y);
  assert.ok(at('image-1').y<at('image-2').y);
  assert.notDeepEqual(at('visual-hero'),at('visual-scene'));
  assert.ok(at('visual-hero').x < at('visual-scene').x);
});

test('auto layout is deterministic and preserves graph/content fields',()=>{
  const source=fixture();
  const first=autoLayoutCanvas(source);
  const second=autoLayoutCanvas(first);
  assert.deepEqual(second,first);
  assert.deepEqual(first.edges,source.edges);
  assert.deepEqual(first.shots,source.shots);
  assert.deepEqual(first.nodes.map(node=>node.data),source.nodes.map(node=>node.data));
});
