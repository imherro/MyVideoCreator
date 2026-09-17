import test from 'node:test';
import assert from 'node:assert/strict';
import {importAnalysisCompletions,importResultStage} from '../src/importNotifications.ts';

const job=(status,id='job-1')=>({
  id,status,input:{stage:'script_import_analysis',script_import_analysis:{
    productionId:'production-1',importId:'import-1',filename:'长篇原著.docx',
  }},
});

test('background import only notifies after a task observed active becomes terminal',()=>{
  const observed=new Map();
  assert.deepEqual(importAnalysisCompletions(observed,[job('running')]),[]);
  assert.deepEqual(importAnalysisCompletions(observed,[job('succeeded')]),[{
    id:'job-1',status:'succeeded',productionId:'production-1',importId:'import-1',filename:'长篇原著.docx',
  }]);
  assert.deepEqual(importAnalysisCompletions(observed,[job('succeeded')]),[]);
  assert.deepEqual(importAnalysisCompletions(new Map(),[job('succeeded')]),[]);
});

test('notification opens the import workflow that owns the resumable draft',()=>{
  const storage={getItem:key=>key.endsWith(':script')?JSON.stringify({id:'import-1'}):null};
  assert.equal(importResultStage('production-1','import-1',storage),'script');
  assert.equal(importResultStage('production-1','missing',storage),'source');
});
