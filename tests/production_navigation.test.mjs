import test from 'node:test';
import assert from 'node:assert/strict';
import {episodeLabel,episodesForProduction} from '../src/app/production.ts';

const episodes=[
  {id:'ep-2',production_id:'series-a',episode_no:2,episode_title:'回响',name:'回响'},
  {id:'other',production_id:'series-b',episode_no:1,episode_title:'别集',name:'别集'},
  {id:'ep-1',production_id:'series-a',episode_no:1,episode_title:'觉醒',name:'觉醒'},
];

test('production library groups and orders episode projects without duplicating state',()=>{
  assert.deepEqual(episodesForProduction(episodes,'series-a').map(item=>item.id),['ep-1','ep-2']);
  assert.equal(episodeLabel(episodes[2]),'EP01 · 觉醒');
});
