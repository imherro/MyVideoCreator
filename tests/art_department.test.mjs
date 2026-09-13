import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveArtStatus,usageLabels} from '../src/artDepartment.ts';

const card={id:'hero',kind:'character',name:'主角',parentCardId:null,currentVersionId:'v2',status:'active',source:{type:'script_extraction'}};
const version=(id,number,status,references=[])=>({id,cardId:'hero',version:number,parentVersionId:number>1?'v1':null,status,spec:{description:'固定蓝衣',attributes:[]},invariants:['服装不变'],references,createdAt:number,provenance:{}});

test('art statuses are projections of canonical cards, versions, and references',()=>{
  const v1=version('v1',1,'locked');
  const v2=version('v2',2,'pending_reference');
  assert.equal(deriveArtStatus(card,v1,[v1,v2]),'有新版');
  assert.equal(deriveArtStatus(card,v2,[v1,v2]),'待参考');
  const withReference={...v2,references:[{role:'primary',assetId:'asset',source:'uploaded',createdAt:1,provenance:{}}]};
  assert.equal(deriveArtStatus(card,withReference,[v1,withReference]),'待确认');
  assert.equal(deriveArtStatus(card,{...withReference,status:'locked'},[v1,{...withReference,status:'locked'}]),'已锁定');
  assert.equal(deriveArtStatus({...card,status:'deprecated'},v2,[v1,v2]),'已弃用');
});

test('production usage is presented as stable episode labels',()=>{
  assert.deepEqual(usageLabels([{episode_no:1},{episode_no:12}]),['EP01','EP12']);
});
