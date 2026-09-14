import test from 'node:test';
import assert from 'node:assert/strict';
import { episodeSourceReferences, setEpisodeSourceReference } from '../src/sourceReferences.ts';

test('episode source references update only the selected episode plan',()=>{
  const adaptation={revision:2,episodePlans:[{episodeNo:1,sourceChapterRefs:['a']},{episodeNo:2,sourceChapterRefs:['b']}],adaptationPlan:{},monetizationPlan:{}};
  const added=setEpisodeSourceReference(adaptation,1,'c',true);
  assert.deepEqual(episodeSourceReferences(added,1),['a','c']);
  assert.deepEqual(episodeSourceReferences(added,2),['b']);
  assert.deepEqual(episodeSourceReferences(setEpisodeSourceReference(added,1,'a',false),1),['c']);
  assert.deepEqual(adaptation.episodePlans[0].sourceChapterRefs,['a']);
});
