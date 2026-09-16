import test from 'node:test';
import assert from 'node:assert/strict';
import {appendEpisodeForChapter,createEpisodePlans,normalizeEpisodeSelection,resolvePlanningEpisode,splitList} from '../src/adaptation.ts';

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

test('an unassigned source chapter can create the next episode plan',()=>{
  const original=createEpisodePlans(1,15);
  original[0].sourceChapterRefs=['chapter-1'];
  const plans=appendEpisodeForChapter(original,15,'chapter-2');
  assert.equal(plans.length,2);
  assert.deepEqual(plans[0].sourceChapterRefs,['chapter-1']);
  assert.deepEqual(plans[1].sourceChapterRefs,['chapter-2']);
});

test('production lists are trimmed and deduplicated',()=>{
  assert.deepEqual(splitList('阿青，老周\n阿青, 密使'),['阿青','老周','密使']);
});

test('planning initially focuses the unfinished episode instead of the last production episode',()=>{
  const plans=[{episodeNo:1,status:'approved'},{episodeNo:2,status:'approved'},{episodeNo:3,status:'review'}];
  assert.equal(resolvePlanningEpisode(plans,undefined,[1,2]),3);
});

test('EP03 planning focus survives approval and return from the script room',()=>{
  const plans=[{episodeNo:1,status:'approved'},{episodeNo:2,status:'approved'},{episodeNo:3,status:'approved'},{episodeNo:4,status:'review'}];
  assert.equal(resolvePlanningEpisode(plans,3,[1,2]),3);
  assert.equal(resolvePlanningEpisode(plans,2,[1,2]),2);
});

test('invalid remembered focus falls back to an available plan without creating an episode',()=>{
  const plans=[{episodeNo:1,status:'approved'},{episodeNo:2,status:'review'}];
  assert.equal(resolvePlanningEpisode(plans,99,[1]),2);
  assert.equal(resolvePlanningEpisode([],3),0);
});
