import test from "node:test";
import assert from "node:assert/strict";
import {
  timelineContentDuration,
  timelineWorkspaceDuration,
  withTimelineWorkspaceDuration,
} from "../src/editor/timelineDuration.ts";

const timeline = {
  version: 1,
  tracks: [{ id: "v1", name: "V1", type: "element", elements: [
    { id: "one", trackId: "v1", type: "video", s: 0, e: 5, props: {} },
  ] }],
  metadata: { custom: { host: "my-video-creator" } },
};

test("timeline workspace uses the film target instead of stopping at one clip", () => {
  assert.equal(timelineContentDuration(timeline), 5);
  assert.equal(timelineWorkspaceDuration(timeline, 15), 15);
});

test("timeline workspace can be extended and never cuts off existing clips", () => {
  const extended = withTimelineWorkspaceDuration(timeline, 24, 15);
  assert.equal(extended.metadata.custom.timelineDuration, 24);
  assert.equal(timelineWorkspaceDuration(extended, 15), 24);
  const shorter = withTimelineWorkspaceDuration(extended, 3, 15);
  assert.equal(shorter.metadata.custom.timelineDuration, 15);
});
