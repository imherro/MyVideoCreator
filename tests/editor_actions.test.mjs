import test from "node:test";
import assert from "node:assert/strict";
import { AudioElement, VideoElement } from "@twick/timeline";
import {
  getElementFade,
  moveElement,
  parseVolumeAutomation,
  setElementDuration,
  setElementFade,
  setElementVolume,
  setMediaSourceIn,
} from "../src/editor/editorActions.ts";

function fakeEditor(element) {
  const updates = [];
  return {
    updates,
    getTimelineData: () => ({
      tracks: [{
        getElementById: (id) => (id === element.getId() ? element : undefined),
        getElements: () => [element],
      }],
    }),
    updateElements: (value) => {
      updates.push(...value);
      const next = value[0].updates;
      if (next.s !== undefined) element.setStart(next.s);
      if (next.e !== undefined) element.setEnd(next.e);
    },
    trimElement: (item, start, end) => {
      item.setStart(start).setEnd(end);
      return true;
    },
    updateElement: (item) => item,
  };
}

test("domain actions move and trim media without losing the source in point", () => {
  const element = new VideoElement("/video", { width: 1280, height: 720 })
    .setId("e-video")
    .setStart(2)
    .setEnd(7)
    .setMediaDuration(12)
    .setStartAt(3);
  const editor = fakeEditor(element);
  moveElement(editor, element.getId(), 8);
  assert.deepEqual([element.getStart(), element.getEnd(), element.getStartAt()], [8, 13, 3]);
  setElementDuration(editor, element.getId(), 4);
  assert.deepEqual([element.getStart(), element.getEnd(), element.getStartAt()], [8, 12, 3]);
});

test("volume automation parser creates ordered local keyframes", () => {
  assert.deepEqual(parseVolumeAutomation("0:30, 2.5:80%, 5:40", 5), [
    { time: 0, value: .3 },
    { time: 2.5, value: .8 },
    { time: 5, value: .4 },
  ]);
  assert.throws(() => parseVolumeAutomation("6:50", 5), /必须位于片段内/);
  assert.throws(() => parseVolumeAutomation("2:50, 2:80", 5), /不能重复/);
});

test("domain actions validate source bounds and clamp media volume", () => {
  const element = new AudioElement("/audio")
    .setId("e-audio")
    .setStart(0)
    .setEnd(4)
    .setMediaDuration(6);
  const editor = fakeEditor(element);
  setMediaSourceIn(editor, element.getId(), 2);
  assert.equal(element.getStartAt(), 2);
  assert.throws(() => setMediaSourceIn(editor, element.getId(), 3), /素材入点过晚/);
  setElementVolume(editor, element.getId(), 5);
  assert.equal(element.getVolume(), 2);
  setElementFade(editor, element.getId(), { audioIn: 0.5, audioOut: 9 });
  assert.deepEqual(getElementFade(element), {
    videoIn: 0,
    videoOut: 0,
    audioIn: 0.5,
    audioOut: 2,
  });
});
