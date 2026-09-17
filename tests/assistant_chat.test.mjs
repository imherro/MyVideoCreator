import test from 'node:test';
import assert from 'node:assert/strict';
import {readAssistantStream,assistantContextLabel,assistantRequestId} from '../src/assistantChat.ts';

test('request IDs work without secure-context randomUUID',()=>{
  const original=crypto.randomUUID;crypto.randomUUID=undefined;
  try{assert.match(assistantRequestId(),/^chat-[a-f0-9]{32}$/);assert.notEqual(assistantRequestId(),assistantRequestId());}
  finally{crypto.randomUUID=original;}
});

test('split UTF-8 NDJSON retains Chinese text and completed state',async()=>{
  const bytes=new TextEncoder().encode('{"type":"delta","text":"下一步"}\n{"type":"done"}\n');
  const stream=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.slice(i,i+2));c.close();}});
  const events=[];await readAssistantStream(new Response(stream),e=>events.push(e));
  assert.equal(events[0].text,'下一步');assert.equal(events[1].type,'done');
});
test('interrupted response retains received chunks but surfaces interruption',async()=>{
  const events=[];
  await assert.rejects(readAssistantStream(new Response('{"type":"delta","text":"已收到"}\n'),e=>events.push(e)),/连接已断开/);
  assert.equal(events[0].text,'已收到');
});
test('HTTP error body is read once and reports useful detail',async()=>{
  await assert.rejects(readAssistantStream(new Response('{"detail":"默认模型未配置"}',{status:400}),()=>{}),/默认模型未配置/);
});
test('reply context stays explicit about production and episode',()=>{
  assert.equal(assistantContextLabel({production:'影片',episode:3,page:'视频',selectedNode:{label:'SHOT 02'}}),'影片 · EP03 · 视频 · SHOT 02');
});
