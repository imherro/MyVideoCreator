import test from 'node:test';
import assert from 'node:assert/strict';
import {panoramaUV,projectPanorama} from '../src/panorama.ts';
test('panorama orientation maps center and poles correctly',()=>{
 assert.deepEqual(panoramaUV(0,0,16/9,90,0,0),{u:.5,v:.5});
 assert.equal(panoramaUV(0,0,1,90,90,0).u,.75);
 assert.equal(panoramaUV(0,0,1,90,180,0).u,0);
 assert.ok(panoramaUV(0,0,1,90,0,85).v<.03);
});
test('bilinear sampling wraps panorama seam without black borders',()=>{
 const source={width:4,height:2,data:new Uint8ClampedArray(32)};
 for(let i=0;i<8;i++)source.data.set([255,30,40,255],i*4);
 const projected=projectPanorama(source,8,4,110,180,70);
 for(let i=0;i<32;i++)assert.deepEqual([...projected.slice(i*4,i*4+4)],[255,30,40,255]);
});
