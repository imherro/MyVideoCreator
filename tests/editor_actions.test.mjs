import test from "node:test";
import assert from "node:assert/strict";
import { AudioElement, VideoElement } from "@twick/timeline";
import {
  moveElement,
  setElementDuration,
  setElementVolume,
  setMediaSourceIn,
} from "../src/editor/editorActions.ts";

function fakeEditor(element) {
  const updates = [];
  return {
    updates,
    getTimelineData: () => ({
      tracks: [{ getElementById: (id) => (id === element.getId() ? element : undefined) }],
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
});
