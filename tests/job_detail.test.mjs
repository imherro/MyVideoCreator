import test from 'node:test';
import assert from 'node:assert/strict';
import { jobDebugParameters, jobElapsedSeconds, redactDebugValue, taskDetailHref } from '../src/jobDetail.ts';

test('task debug data removes secrets and separates prompts from parameters',()=>{
  const input={prompt:'生成一只猫',system_prompt:'导演',model:'seedream',parameters:{api_key:'secret',duration:5},token:'hidden'};
  assert.deepEqual(jobDebugParameters(input),{model:'seedream',parameters:{api_key:'••••••',duration:5},token:'••••••'});
  assert.equal(redactDebugValue({Authorization:'Bearer secret'}).Authorization,'••••••');
});

test('task detail helpers create a new-window URL and stable elapsed time',()=>{
  assert.equal(taskDetailHref('job/a b'),'/?task=job%2Fa%20b');
  assert.equal(jobElapsedSeconds({status:'running',started:10},25),15);
  assert.equal(jobElapsedSeconds({status:'succeeded',started:10,finished:22},99),12);
});
