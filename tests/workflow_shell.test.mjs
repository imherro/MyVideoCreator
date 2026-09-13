import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_STAGES,
  defaultViewForStage,
  parseWorkflowStage,
  workflowStageUrl,
} from '../src/app/workflow.ts';
import {planGlobalPanelAction} from '../src/app/globalNavigation.ts';

test('workflow shell exposes the production stages in order',()=>{
  assert.deepEqual(WORKFLOW_STAGES.map(stage=>stage.label),[
    '概览','原著','改编策划','剧本','塑角造景','分镜','视频','剪辑','高级画布',
  ]);
});

test('workflow stage URL survives refresh and rejects unknown stages',()=>{
  assert.equal(parseWorkflowStage('?stage=storyboard'),'storyboard');
  assert.equal(parseWorkflowStage('?stage=unknown'),'overview');
  assert.equal(parseWorkflowStage(''),'overview');
  assert.equal(
    workflowStageUrl('http://localhost:7868/?project=x#focus','editor'),
    '/?project=x&stage=editor#focus',
  );
});

test('workflow stages mount the existing workspace views',()=>{
  assert.equal(defaultViewForStage('overview'),'stage');
  assert.equal(defaultViewForStage('art'),'stage');
  assert.equal(defaultViewForStage('storyboard'),'shots');
  assert.equal(defaultViewForStage('editor'),'editor');
  assert.equal(defaultViewForStage('canvas'),'canvas');
});

test('global trash navigation requests fresh server state before display',()=>{
  assert.deepEqual(planGlobalPanelAction(null,'trash'),{
    panel:'trash',
    loadTrash:true,
  });
  assert.deepEqual(planGlobalPanelAction('trash','trash'),{
    panel:null,
    loadTrash:false,
  });
  assert.deepEqual(planGlobalPanelAction(null,'assets'),{
    panel:'assets',
    loadTrash:false,
  });
});
