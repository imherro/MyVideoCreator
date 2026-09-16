import test from 'node:test';
import assert from 'node:assert/strict';
import {bindVisualVersion,isVersionBound,isVisualBindingActionDisabled,renameVisualCard,unbindVisualVersion,updateDraftVisualVersion,setVisualVersionStatus} from '../src/filmBible/commands.ts';
import {deriveManagedGraph,filterManagedEdgeRemovals,isManagedVisualEdge,isManagedVisualNode} from '../src/filmBible/managedGraph.ts';

function fixture(){
 const cards={
  c1:{id:'c1',kind:'character',name:'阿明',parentCardId:null,currentVersionId:'v1',status:'active',source:{type:'script_extraction'}},
  c2:{id:'c2',kind:'character',name:'小雨',parentCardId:null,currentVersionId:'v2',status:'active',source:{type:'script_extraction'}},
  c3:{id:'c3',kind:'scene',name:'天台',parentCardId:null,currentVersionId:'v3',status:'active',source:{type:'script_extraction'}},
  c4:{id:'c4',kind:'prop',name:'足球',parentCardId:null,currentVersionId:'v4',status:'active',source:{type:'script_extraction'}},
 };
 const versions=Object.fromEntries(Object.values(cards).map((card,index)=>[`v${index+1}`,{id:`v${index+1}`,cardId:card.id,version:1,parentVersionId:null,status:'draft',spec:{description:card.name,attributes:[]},invariants:[],references:[],createdAt:1,provenance:{}}]));
 return {filmBible:{visual:{cards,versions},continuity:{},style:{},story:{}},shots:[{id:'shot-001',uid:'shot-stable',imageNode:'image-1',assetBindings:{characters:[{role:'阿明',versionId:'v1'},{role:'小雨',versionId:'v2'}],scene:{versionId:'v3'},props:[{role:'足球',versionId:'v4'}]}}],nodes:[{id:'storyboard-1',type:'media',position:{x:400,y:80},data:{kind:'storyboard'}},{id:'image-1',type:'media',position:{x:1110,y:80},data:{kind:'image'}}],edges:[{id:'normal-edge',source:'storyboard-1',target:'image-1'}]};
}

test('four bindings deterministically project to four managed edges and minimal nodes',()=>{
 const first=deriveManagedGraph(fixture());
 assert.equal(first.edges.filter(isManagedVisualEdge).length,4);
 assert.equal(first.nodes.filter(isManagedVisualNode).length,4);
 assert.deepEqual(first.nodes.filter(isManagedVisualNode).map(node=>Object.keys(node.data).sort()),Array(4).fill(['kind','managed','visualVersionId']));
 const second=deriveManagedGraph(structuredClone(first));
 assert.deepEqual(second,first);
});

test('binding changes replace projected edge while preserving dragged visual position',()=>{
 let doc=deriveManagedGraph(fixture());
 const visualNode=doc.nodes.find(node=>node.data?.visualVersionId==='v1');
 visualNode.position={x:923,y:417};
 doc=unbindVisualVersion(doc,'shot-stable','v1');
 doc=deriveManagedGraph(doc);
 assert.equal(doc.edges.filter(isManagedVisualEdge).length,3);
 assert.deepEqual(doc.nodes.find(node=>node.data?.visualVersionId==='v1').position,{x:923,y:417});
 doc=bindVisualVersion(doc,'shot-stable','v1');
 doc=deriveManagedGraph(doc);
 assert.equal(doc.edges.filter(isManagedVisualEdge).length,4);
 assert.deepEqual(doc.nodes.find(node=>node.data?.visualVersionId==='v1').position,{x:923,y:417});
});

test('binding a state version replaces its parent entity edge instead of duplicating the scene',()=>{
 let doc=fixture();
 doc.filmBible.visual.cards.c5={id:'c5',kind:'scene_state',name:'雨夜天台',parentCardId:'c3',currentVersionId:'v5',status:'active',source:{type:'script_extraction'}};
 doc.filmBible.visual.versions.v5={id:'v5',cardId:'c5',version:1,parentVersionId:'v3',status:'draft',spec:{description:'雨夜状态',attributes:[]},invariants:[],references:[],createdAt:2,provenance:{}};
 doc=deriveManagedGraph(bindVisualVersion(doc,'shot-stable','v5'));
 const managed=doc.edges.filter(edge=>isManagedVisualEdge(edge)&&edge.data.origin==='visual_binding');
 assert.equal(managed.length,4);
 assert.ok(managed.some(edge=>edge.source==='visual-version:v5'&&edge.data.kind==='scene'));
 assert.ok(!managed.some(edge=>edge.source==='visual-version:v3'));
 assert.ok(doc.edges.some(edge=>edge.data?.origin==='visual_lineage'&&edge.source==='visual-version:v3'&&edge.target==='visual-version:v5'));
 assert.equal(doc.shots[0].assetBindings.scene.versionId,'v5');
});

test('renaming an editable card keeps binding role labels synchronized',()=>{
 const doc=renameVisualCard(fixture(),'c1','阿明（少年）');
 assert.equal(doc.filmBible.visual.cards.c1.name,'阿明（少年）');
 assert.equal(doc.shots[0].assetBindings.characters[0].role,'阿明（少年）');
});

test('managed edge deletion is repaired from assetBindings',()=>{
 const projected=deriveManagedGraph(fixture());
 const managed=projected.edges.find(isManagedVisualEdge);
 const normal=projected.edges.find(edge=>!isManagedVisualEdge(edge));
 const filtered=filterManagedEdgeRemovals([{type:'remove',id:managed.id},{type:'remove',id:normal.id}],projected.edges);
 assert.deepEqual(filtered.allowed,[{type:'remove',id:normal.id}]);
 assert.deepEqual(filtered.blocked,[{type:'remove',id:managed.id}]);
 const withoutEdge={...projected,edges:projected.edges.filter(edge=>edge.id!==projected.edges.find(isManagedVisualEdge).id)};
 assert.equal(deriveManagedGraph(withoutEdge).edges.filter(isManagedVisualEdge).length,4);
});

test('locked and deprecated versions are immutable and deprecated versions cannot bind',()=>{
 let doc=fixture();
 doc=setVisualVersionStatus(doc,'v1','pending_reference');
 doc=setVisualVersionStatus(doc,'v1','draft');
 doc=setVisualVersionStatus(doc,'v1','deprecated');
 assert.throws(()=>updateDraftVisualVersion(doc,'v1',{spec:{description:'改写',attributes:[]},invariants:[]}),/不可修改/);
 assert.throws(()=>bindVisualVersion(doc,'shot-stable','v1'),/不能建立新绑定/);
 const locked=fixture();locked.filmBible.visual.versions.v1.status='locked';
 assert.throws(()=>updateDraftVisualVersion(locked,'v1',{spec:{description:'改写',attributes:[]},invariants:[]}),/不可修改/);
});

test('a bound deprecated version can be explicitly unbound but cannot bind again',()=>{
 let doc=fixture();
 doc=setVisualVersionStatus(doc,'v1','deprecated');
 assert.equal(isVersionBound(doc.shots[0],'v1'),true);
 assert.equal(isVisualBindingActionDisabled('deprecated','active',true),false);

 doc=unbindVisualVersion(doc,'shot-stable','v1');
 assert.equal(isVersionBound(doc.shots[0],'v1'),false);
 assert.ok(!doc.shots[0].assetBindings.characters.some(binding=>binding.versionId==='v1'));
 doc=deriveManagedGraph(doc);
 assert.ok(!doc.edges.some(edge=>isManagedVisualEdge(edge)&&edge.source==='visual-version:v1'));

 assert.equal(isVisualBindingActionDisabled('deprecated','active',false),true);
 assert.equal(isVisualBindingActionDisabled('draft','deprecated',false),true);
 assert.equal(isVisualBindingActionDisabled('locked','active',false),false);
 assert.throws(()=>bindVisualVersion(doc,'shot-stable','v1'),/不能建立新绑定/);
});
