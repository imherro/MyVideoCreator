import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyGenerationPolicy,resolveGenerationTarget} from '../src/generationPolicy.ts';

const providers=[
 {id:'ark',type:'volcengine_ark',models:{text:'doubao',image:'seedream',video:'seedance'},local:false},
 {id:'local-image',kind:'image',model:'flux',local:true},
];

test('generation target resolves override then project then system fallback',()=>{
 const policy={...emptyGenerationPolicy(),image:{providerId:'ark',modelId:'seedream-custom'}};
 assert.deepEqual(resolveGenerationTarget('image',undefined,policy,providers),{providerId:'ark',modelId:'seedream-custom',source:'project'});
 assert.deepEqual(resolveGenerationTarget('image',{mode:'override',providerId:'local-image',modelId:'flux-special'},policy,providers),{providerId:'local-image',modelId:'flux-special',source:'override'});
 assert.deepEqual(resolveGenerationTarget('image',undefined,emptyGenerationPolicy(),providers),{providerId:'ark',modelId:'seedream',source:'system'});
});

test('deleted project provider is invalid and never falls back silently',()=>{
 const policy={...emptyGenerationPolicy(),video:{providerId:'deleted',modelId:'paid'}};
 assert.throws(()=>resolveGenerationTarget('video',undefined,policy,providers),/不会自动切换/);
});
