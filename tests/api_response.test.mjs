import test from 'node:test';
import assert from 'node:assert/strict';
import {readApiErrorMessage} from '../src/apiResponse.ts';

test('API errors read a structured JSON body exactly once',async()=>{
  const response=new Response(JSON.stringify({detail:[{loc:['body','name'],msg:'required'}]}),{status:422,headers:{'content-type':'application/json'}});
  assert.equal(await readApiErrorMessage(response),'[{"loc":["body","name"],"msg":"required"}]');
  assert.equal(response.bodyUsed,true);
});

test('API errors preserve plain text without attempting to read the stream again',async()=>{
  const response=new Response('upstream gateway unavailable',{status:502,headers:{'content-type':'text/plain'}});
  assert.equal(await readApiErrorMessage(response),'upstream gateway unavailable');
  assert.equal(response.bodyUsed,true);
});

test('empty API errors include the HTTP status',async()=>{
  const response=new Response(null,{status:503});
  assert.equal(await readApiErrorMessage(response),'API 请求失败（HTTP 503）');
});
