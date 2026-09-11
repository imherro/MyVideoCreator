import test from "node:test";
import assert from "node:assert/strict";
import { planInitialTimeline } from "../src/editor/initialTimeline.ts";

test("AI storyboard produces an ordered Twick V1 with stable source links", () => {
  const shots = [
    { id: "shot-1", videoNode: "video-1", duration: 3 },
    { id: "shot-2", videoNode: "video-2", duration: 5 },
  ];
  const nodes = [
    { id: "video-1", data: { assetId: "asset-1" } },
    { id: "video-2", data: { assetId: "asset-2" } },
  ];
  const assets = [
    { id: "asset-1", name: "一", kind: "video", url: "/a/1", metadata: { duration: 4 } },
    { id: "asset-2", name: "二", kind: "video", url: "/a/2", metadata: { duration: 5.2 } },
  ];
  let next = 0;
  const plan = planInitialTimeline(
    { shots, nodes, assets, resolution: { width: 1280, height: 720 } },
    () => String(++next),
  );

  assert.deepEqual(plan.issues, []);
  assert.equal(plan.clipCount, 2);
  assert.equal(plan.timeline.tracks[0].name, "V1 · AI 初剪");
  assert.deepEqual(
    plan.timeline.tracks[0].elements.map((element) => [element.s, element.e]),
    [[0, 3], [3, 8]],
  );
  assert.deepEqual(
    plan.timeline.tracks[0].elements.map((element) => [element.metadata.shotId, element.metadata.nodeId, element.metadata.assetId]),
    [["shot-1", "video-1", "asset-1"], ["shot-2", "video-2", "asset-2"]],
  );
});

test("initial edit preserves video original audio and adds configured looping music", () => {
  const assets = [
    { id: "video", name: "镜头", kind: "video", url: "/v", metadata: { duration: 5.2 } },
    { id: "music", name: "配乐", kind: "audio", url: "/m", metadata: { duration: 2 } },
  ];
  let next = 0;
  const plan = planInitialTimeline(
    {
      shots: [{ id: "shot", videoNode: "node", duration: 5 }],
      nodes: [{ id: "node", data: { assetId: "video" } }],
      assets,
      resolution: { width: 720, height: 1280 },
      audioId: "music",
      musicVolume: 0.4,
    },
    () => String(++next),
  );
  assert.equal(plan.timeline.tracks[0].elements[0].props.volume, 1);
  assert.equal(plan.timeline.tracks[1].type, "audio");
  assert.equal(plan.timeline.tracks[1].elements[0].props.loop, true);
  assert.equal(plan.timeline.tracks[1].elements[0].props.volume, 0.4);
  assert.equal(plan.timeline.tracks[1].elements[0].e, 5);
});

test("initial edit rejects missing, stale, and overlong shot media", () => {
  const assets = [
    { id: "video", name: "镜头", kind: "video", url: "/v", metadata: { duration: 4 } },
  ];
  const plan = planInitialTimeline(
    {
      shots: [
        { videoNode: "missing", duration: 2 },
        { videoNode: "stale", duration: 2 },
        { videoNode: "long", duration: 5 },
      ],
      nodes: [
        { id: "stale", data: { assetId: "video", stale: true } },
        { id: "long", data: { assetId: "video" } },
      ],
      assets,
      resolution: { width: 1280, height: 720 },
    },
    () => "id",
  );
  assert.equal(plan.clipCount, 0);
  assert.equal(plan.issues.length, 3);
});
