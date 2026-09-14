import test from 'node:test';
import assert from 'node:assert/strict';
import { VISUAL_STYLE_PRESETS, visualStylePrompt } from '../src/visualStyles.ts';

test('visual style presets offer distinct common choices and prompt descriptions',()=>{
  assert.ok(VISUAL_STYLE_PRESETS.length >= 10);
  assert.equal(new Set(VISUAL_STYLE_PRESETS.map(item=>item.name)).size,VISUAL_STYLE_PRESETS.length);
  assert.match(visualStylePrompt('水墨动画'),/水墨|宣纸/);
  assert.match(visualStylePrompt('东方仙侠·半写实电影'),/半写实真人风格/);
  assert.match(visualStylePrompt('东方仙侠·半写实电影'),/非卡通/);
  assert.equal(visualStylePrompt('自定义低多边形'),'自定义低多边形');
});
