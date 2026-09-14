import test from 'node:test';
import assert from 'node:assert/strict';
import {filmBibleJobStages} from '../src/filmBibleJobProgress.ts';

test('film bible task progress explains automatic binding repair',()=>{
 const running=filmBibleJobStages({kind:'storyboard',status:'running',phase:'修正分镜视觉绑定',input:{film_bible:true},telemetry:{prompt_stages:[{id:'bound_storyboard',validation_error:'scene_key 不存在'}]}});
 assert.equal(running[0].status,'succeeded');
 assert.equal(running[1].status,'running');
 assert.match(running[1].detail,/正在自动修正/);
 assert.equal(running[1].attempts,2);
 assert.equal(running[1].validationError,'scene_key 不存在');
});

test('completed film bible task reports repair counts from durable result',()=>{
 const stages=filmBibleJobStages({kind:'storyboard',status:'succeeded',phase:'已完成',input:{film_bible:true},result:{visual_repair_count:0,storyboard_repair_count:1}});
 assert.equal(stages[0].detail,'首次结果通过严格校验');
 assert.match(stages[1].detail,/自动修正 1 次后完成/);
 assert.equal(stages[1].attempts,2);
});
