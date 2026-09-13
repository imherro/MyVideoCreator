import test from 'node:test';
import assert from 'node:assert/strict';
import {createEpisodePlans,normalizeEpisodeSelection,splitList} from '../src/adaptation.ts';

test('episode planner creates sixty stable plans and preserves existing edits',()=>{
  const plans=createEpisodePlans(60,60);
  plans[11].hook='门外响起脚步声';
  const resized=createEpisodePlans(62,75,plans);
  assert.equal(resized.length,62);
  assert.equal(resized[11].hook,'门外响起脚步声');
  assert.equal(resized[60].targetDuration,75);
});

test('batch script generation includes only valid unique selected episodes',()=>{
  assert.deepEqual(normalizeEpisodeSelection([12,5,8,5,0,61],60),[5,8,12]);
});

test('production lists are trimmed and deduplicated',()=>{
  assert.deepEqual(splitList('阿青，老周\n阿青, 密使'),['阿青','老周','密使']);
});
