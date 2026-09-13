import test from "node:test";
import assert from "node:assert/strict";
import { deriveVideoProductionRows, selectedVideoNodeIds, validateVideoSubmission, videoSubmissionSummary } from "../src/videoProduction.ts";

const providers = [
  { id: "ark", name: "火山方舟", kind: "video", local: false, type: "volcengine_ark" },
  { id: "local-video", name: "本地视频", kind: "video", local: true },
];
const assets = [
  { id: "frame-a", kind: "image", name: "首帧 A", url: "/a.png" },
  { id: "tail-a", kind: "image", name: "尾帧 A", url: "/tail.png" },
  { id: "clip-a", kind: "video", name: "视频 A", url: "/a.mp4" },
];

function fixture() {
  const shots = [
    { id: "s-ready", uid: "u-ready", scene: "街道", video_prompt: "向前走", pipeline: { imageNodeId: "i-ready", videoNodeId: "v-ready" } },
    { id: "s-generating", uid: "u-generating", pipeline: { imageNodeId: "i-generating", videoNodeId: "v-generating" } },
    { id: "s-failed", uid: "u-failed", pipeline: { imageNodeId: "i-failed", videoNodeId: "v-failed" } },
    { id: "s-stale", uid: "u-stale", pipeline: { imageNodeId: "i-stale", videoNodeId: "v-stale" } },
    { id: "s-complete", uid: "u-complete", pipeline: { imageNodeId: "i-complete", videoNodeId: "v-complete" } },
    { id: "s-blocked", uid: "u-blocked", pipeline: { imageNodeId: "i-blocked", videoNodeId: "v-blocked" } },
    { id: "s-review", uid: "u-review", pipeline: { imageNodeId: "i-review", videoNodeId: "v-review" } },
  ];
  const nodes = shots.flatMap((shot) => {
    const suffix = shot.id.slice(2);
    const frame = suffix === "blocked" ? undefined : "frame-a";
    return [
      { id: `i-${suffix}`, data: { kind: "image", prompt: suffix === "review" ? "室内灯完全熄灭" : "当前画面", assetId: frame, state_reviewed: false } },
      { id: `v-${suffix}`, data: { kind: "video", provider: "ark", model: "seedance-2", prompt: "人物移动", ...(suffix === "failed" ? { assetId: "clip-a" } : {}), ...(suffix === "stale" ? { stale: true, assetId: "clip-a" } : {}), ...(suffix === "complete" ? { assetId: "clip-a", end_asset_id: "tail-a" } : {}) } },
    ];
  });
  const jobs = [
    { node_id: "v-generating", status: "running", created: 3 },
    { node_id: "v-failed", status: "failed", error: "provider error", created: 4 },
  ];
  return { document: { shots, nodes, edges: [] }, jobs };
}

test("video workspace projects canonical shots into all production states", () => {
  const { document, jobs } = fixture();
  const rows = deriveVideoProductionRows(document, assets, jobs, providers);
  assert.deepEqual(rows.map((row) => row.status), ["ready", "generating", "failed", "stale", "complete", "blocked", "blocked"]);
  assert.equal(rows[4].firstFrame.id, "frame-a");
  assert.equal(rows[4].endFrame.id, "tail-a");
  assert.equal(rows[4].videoAsset.id, "clip-a");
  assert.equal(rows[4].endFrameSupported, true);
  assert.match(rows[6].readinessReason, /人工核验/);
});

test("selected submission contains only explicit stable pipeline video nodes", () => {
  const { document, jobs } = fixture();
  const rows = deriveVideoProductionRows(document, assets, jobs, providers);
  assert.deepEqual(selectedVideoNodeIds(rows, ["u-complete", "u-ready"]), ["v-ready", "v-complete"]);
  assert.deepEqual(validateVideoSubmission(rows, ["u-ready"]).map((row) => row.uid), ["u-ready"]);
  assert.throws(() => validateVideoSubmission(rows, ["u-ready", "u-blocked"]), /缺少已生成的首帧/);
  assert.throws(() => validateVideoSubmission(rows, ["u-generating"]), /队列/);
});

test("batch review names count provider model and cloud use before submission", () => {
  const { document, jobs } = fixture();
  const rows = deriveVideoProductionRows(document, assets, jobs, providers);
  const summary = videoSubmissionSummary(rows, ["u-ready", "u-complete"]);
  assert.equal(summary.count, 2);
  assert.equal(summary.cloudCount, 2);
  assert.deepEqual(summary.groups, [{ providerId: "ark", providerName: "火山方舟", modelId: "seedance-2", count: 2, cloud: true }]);
});
