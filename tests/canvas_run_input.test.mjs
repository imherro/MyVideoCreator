import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasRunInput} from '../src/canvasRunInput.ts';
import {acceptResult} from '../src/graph.ts';

const script={id:'script',data:{kind:'text',text:'机器人推开门。',prompt:'写一段故事'}};
const board={id:'board',data:{kind:'storyboard',prompt:''}};
const doc={nodes:[script,board],edges:[{source:'script',target:'board'}]};

test('manual connected storyboard can run with an empty description',()=>{
  assert.equal(canvasRunInput(doc,board).ready,true);
  assert.equal(canvasRunInput(doc,board).scriptCount,1);
  assert.equal(canvasRunInput({...doc,edges:[]},board).ready,false);
  assert.equal(canvasRunInput({nodes:[],edges:[]},{...board,data:{...board.data,prompt:'自行拆解此故事'}}).ready,true);
});
test('unfinished, outdated or running upstream scripts give an actionable blocker',()=>{
  assert.match(canvasRunInput(doc,board,[{node_id:'script',status:'running'}]).reason,/正在生成/);
  for(const data of [{...script.data,text:''},{...script.data,stale:true}]) {
    assert.equal(canvasRunInput({...doc,nodes:[{...script,data},board]},board).ready,false);
  }
  assert.equal(canvasRunInput(doc,{id:'image',data:{kind:'image',prompt:''}}).ready,false);
});

test('compiled connected script result is fresh unless the actual script or instruction changed',()=>{
  const job={id:'job-board',node_id:'board',status:'succeeded',input:{prompt:'编译后的剧本正文',canvas_script_instruction:'',canvas_script_sources:[{nodeId:'script',text:script.data.text}]},result:{text:'生成的分镜'}};
  const accepted=acceptResult(doc,job,[]);
  assert.equal(accepted.nodes.find(n=>n.id==='board').data.stale,false);
  const edited={...doc,nodes:[{...script,data:{...script.data,text:'改了剧情'}},board]};
  assert.equal(acceptResult(edited,job,[]).nodes.find(n=>n.id==='board').data.stale,true);
  assert.equal(acceptResult({...doc,edges:[]},job,[]).nodes.find(n=>n.id==='board').data.stale,true);
});
