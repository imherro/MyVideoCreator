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
    { shots, nodes, assets, resolution: { width: 1280, height: 720 }, targetDuration: 15 },
    () => String(++next),
  );

  assert.deepEqual(plan.issues, []);
  assert.equal(plan.clipCount, 2);
  assert.equal(plan.timeline.tracks[0].name, "V1 · AI 初剪");
  assert.equal(plan.timeline.metadata.custom.timelineDuration, 15);
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

test("initial edit accepts historical shots that only store pipeline video node ids", () => {
  const plan = planInitialTimeline(
    {
      shots: [{ uid: "shot-pipeline", pipeline: { videoNodeId: "video-pipeline" }, duration: 2 }],
      nodes: [{ id: "video-pipeline", data: { assetId: "asset-pipeline" } }],
      assets: [{ id: "asset-pipeline", name: "历史镜头", kind: "video", url: "/history", metadata: { duration: 2 } }],
      resolution: { width: 1280, height: 720 },
    },
    () => "pipeline",
  );
  assert.equal(plan.clipCount, 1);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.timeline.tracks[0].elements[0].metadata.nodeId, "video-pipeline");
  assert.equal(plan.timeline.tracks[0].elements[0].metadata.assetId, "asset-pipeline");
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

test("fixed character dialogue becomes an audio track and replaces generated video audio", () => {
  const plan = planInitialTimeline(
    {
      shots: [{ id: "shot-1", uid: "shot-uid-1", videoNode: "video-node", duration: 5 }],
      nodes: [{ id: "video-node", data: { assetId: "video" } }],
      assets: [
        { id: "video", name: "镜头", kind: "video", url: "/video", metadata: { duration: 5 } },
        { id: "voice", name: "角色对白", kind: "audio", url: "/voice", metadata: {
          duration: 2.4,
          input: { dialogue: { id: "dialogue-1", shotUid: "shot-uid-1", characterCardId: "card-1", voiceVersion: 2 } },
        } },
      ],
      resolution: { width: 1280, height: 720 },
    },
    (() => { let id = 0; return () => String(++id); })(),
  );
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.timeline.tracks[0].elements[0].props.volume, 0);
  assert.equal(plan.timeline.tracks[1].name, "A1 · 角色对白");
  assert.equal(plan.timeline.tracks[1].elements[0].metadata.assetId, "voice");
  assert.equal(plan.timeline.tracks[1].elements[0].s, 0);
  assert.equal(plan.timeline.tracks[1].elements[0].e, 2.4);
});

test("initial edit uses only the latest take when dialogue is regenerated", () => {
  const plan = planInitialTimeline(
    {
      shots: [{ id: "shot-1", uid: "shot-uid", videoNode: "video-node", duration: 5, dialogues: [{ id: "dialogue-1" }] }],
      nodes: [{ id: "video-node", data: { assetId: "video" } }],
      assets: [
        { id: "video", name: "镜头", kind: "video", url: "/video", created: 1, metadata: { duration: 5 } },
        { id: "old-take", name: "旧对白", kind: "audio", url: "/old", created: 2, metadata: { duration: 1, input: { dialogue: { id: "dialogue-1", shotUid: "shot-uid" } } } },
        { id: "new-take", name: "新对白", kind: "audio", url: "/new", created: 3, metadata: { duration: 1.2, input: { dialogue: { id: "dialogue-1", shotUid: "shot-uid" } } } },
      ],
      resolution: { width: 1280, height: 720 },
    },
    () => "id",
  );
  assert.equal(plan.timeline.tracks[1].elements.length, 1);
  assert.equal(plan.timeline.tracks[1].elements[0].metadata.assetId, "new-take");
});
