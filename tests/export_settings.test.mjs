import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultExportResolution,
  exportResolutionOptions,
  projectExportRatio,
} from '../src/exportSettings.ts';

test('sample export defaults to the project video specification', () => {
  assert.equal(defaultExportResolution({videoResolution:'480p',videoRatio:'16:9'}), '854x480');
  assert.equal(defaultExportResolution({videoResolution:'720p',videoRatio:'9:16'}), '720x1280');
  assert.equal(defaultExportResolution({videoResolution:'1080p',videoRatio:'4:3'}), '1440x1080');
});

test('adaptive export ratio follows the project picture ratio', () => {
  const document={videoResolution:'480p',videoRatio:'adaptive',ratio:'1:1'};
  assert.equal(projectExportRatio(document), '1:1');
  assert.equal(defaultExportResolution(document), '480x480');
  assert.deepEqual(exportResolutionOptions(document).map(option=>option.value), ['480x480','720x720','1080x1080','768x768','1440x1440']);
});

test('an explicit export resolution remains stable', () => {
  assert.equal(defaultExportResolution({videoResolution:'480p',videoRatio:'16:9',export_resolution:'1280x720'}), '1280x720');
  assert.equal(exportResolutionOptions({videoResolution:'480p',videoRatio:'9:16',export_resolution:'1280x720'})[0].label, '当前自定义 · 1280×720');
});
