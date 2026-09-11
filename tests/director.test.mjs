import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {defaultStage,cameraPosition,describeStage} from '../src/directorScene.ts';
test('orbit camera preserves distance and centers look target',()=>{
 for(const yaw of [-180,-90,0,90,180])for(const pitch of [-10,0,40,80]){
  const settings={...defaultStage().camera,yaw,pitch};const p=cameraPosition(settings);
  assert.ok(Math.abs(Math.hypot(p.x,p.y-settings.targetHeight,p.z)-settings.distance)<1e-9);
  const camera=new PerspectiveCamera(settings.fov,16/9,.1,200);camera.position.set(p.x,p.y,p.z);camera.lookAt(0,settings.targetHeight,0);camera.updateMatrixWorld();
  const target=new Vector3(0,settings.targetHeight,0).project(camera);
  assert.ok(Math.abs(target.x)<1e-9&&Math.abs(target.y)<1e-9);
 }
});
test('saved scene round trip preserves camera and prompting information',()=>{
 const stage=defaultStage();stage.objects.push({id:'actor',name:'主角',shape:'actor',x:1,z:-2,width:.6,height:1.8,depth:.6,color:'#aabbcc',rotation:30});stage.views.push({id:'view',name:'机位一',camera:{...stage.camera}});
 const restored=JSON.parse(JSON.stringify(stage));assert.deepEqual(restored,stage);
 assert.match(describeStage(restored),/主角：位置 \(1, -2\)/);
 restored.camera.yaw=100;assert.equal(restored.views[0].camera.yaw,25);
});
