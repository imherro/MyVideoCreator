import test from 'node:test';
import assert from 'node:assert/strict';
import {requestId} from '../src/requestId.ts';

test('request IDs do not depend on secure-context randomUUID',()=>{
  const original=crypto.randomUUID;
  crypto.randomUUID=undefined;
  try{
    assert.match(requestId('script-import-'),/^script-import-[a-f0-9]{32}$/);
    assert.notEqual(requestId(),requestId());
  }finally{crypto.randomUUID=original;}
});
