import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveTaskCenterRows,
  filterTaskCenterRows,
  taskShotLabel,
  activeTaskCount,
  activeScriptEpisodes,
  mergeTaskSnapshots,
} from "../src/taskCenter.ts";

test("activity spans episodes and completed snapshots release script generation locks", () => {
  const job = { id: "script-2", project_id: "ep-2", status: "queued", input: {
    stage: "script_generation", episode_script_generation: { productionId: "prod", episodeNo: 2 },
  } };
  const jobs = [job, { id: "old", project_id: "ep-1", status: "succeeded" }];
  assert.equal(activeTaskCount(jobs), 1);
  assert.equal(activeTaskCount([...jobs, job]), 1);
  assert.equal(activeScriptEpisodes(jobs, "prod").get(2), "queued");
  assert.equal(activeScriptEpisodes(jobs, "prod").has(1), false);
  assert.equal(activeScriptEpisodes(jobs, "other").size, 0);
  for (const status of ["succeeded", "failed", "cancelled", "interrupted"]) {
    const updated = mergeTaskSnapshots(jobs, [{ ...job, status }]);
    assert.equal(activeTaskCount(updated), 0);
    assert.equal(activeScriptEpisodes(updated, "prod").size, 0);
  }
  assert.equal(activeScriptEpisodes([{ ...job, status: "running" }], "prod").get(2), "running");
});

const episodes = [
  { id: "ep-1", production_id: "prod", episode_no: 1, episode_title: "第一集", name: "第一集" },
  { id: "ep-2", production_id: "prod", episode_no: 2, episode_title: "第二集", name: "第二集" },
];
const documents = {
  "ep-1": {
    nodes: [{ id: "video-1", data: { provider: "ark", model: "video-model" } }],
    shots: [{ uid: "shot-1", shot_id: "001", pipeline: { videoNodeId: "video-1" } }],
  },
  "ep-2": {
    nodes: [{ id: "image-2", data: { provider: "local", model: "image-model" } }],
    shots: [{ uid: "shot-2", shot_id: "002", imageNode: "image-2" }],
  },
};

test("task center projects durable jobs across episodes with ownership and model context", () => {
  const jobs = [
    { id: "old", project_id: "ep-1", node_id: "video-1", kind: "video", status: "succeeded", created: 1, input: {} },
    { id: "new", project_id: "ep-2", node_id: "image-2", kind: "image", status: "failed", created: 2, input: {} },
    { id: "export", project_id: "ep-1", node_id: "export", kind: "export", status: "interrupted", created: 1.5, input: {} },
  ];
  const rows = deriveTaskCenterRows(jobs, episodes, documents, [
    { id: "ark", name: "火山方舟" },
    { id: "local", name: "本地图片" },
  ]);

  assert.deepEqual(rows.map((row) => row.job.id), ["new", "export", "old"]);
  assert.equal(rows[0].episode.episode_no, 2);
  assert.equal(rows[0].providerName, "本地图片");
  assert.equal(rows[0].modelName, "image-model");
  assert.equal(taskShotLabel(rows[0]), "SHOT 002");
  assert.equal(rows[1].providerName, "本机导出");
  assert.equal(rows[1].modelName, "FFmpeg");
});

test("task center filters reuse the six persisted job states", () => {
  const statuses = ["queued", "running", "succeeded", "failed", "interrupted", "cancelled"];
  const jobs = statuses.map((status, index) => ({
    id: status,
    project_id: index % 2 ? "ep-2" : "ep-1",
    node_id: index % 2 ? "image-2" : "video-1",
    kind: index % 2 ? "image" : "video",
    status,
    created: index,
    input: {},
  }));
  const rows = deriveTaskCenterRows(jobs, episodes, documents, []);
  assert.deepEqual(new Set(rows.map((row) => row.job.status)), new Set(statuses));
  assert.deepEqual(
    filterTaskCenterRows(rows, { episodeId: "ep-2", kind: "image", status: "failed" }).map((row) => row.job.id),
    ["failed"],
  );
});

test("production jobs are labelled and filtered independently from their storage episode", () => {
  const jobs = [{
    id: "source", project_id: "ep-2", node_id: "source-chapter:c1", kind: "text",
    status: "succeeded", created: 3, scope: "production",
    input: { stage: "source_analysis", prompt: "章节标题：第五章\n\n原文：内容" },
  }];
  const rows = deriveTaskCenterRows(jobs, episodes, documents, []);
  assert.equal(rows[0].scope, "production");
  assert.equal(taskShotLabel(rows[0]), "原著事件提取 · 第五章");
  assert.deepEqual(filterTaskCenterRows(rows, { episodeId: "production", kind: "", status: "" }).length, 1);
  assert.deepEqual(filterTaskCenterRows(rows, { episodeId: "ep-2", kind: "", status: "" }).length, 0);
});
