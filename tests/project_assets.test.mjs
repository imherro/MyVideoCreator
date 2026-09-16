import test from "node:test";
import assert from "node:assert/strict";
import { presentEditorAssets } from "../src/editor/projectAssets.ts";

test("editor asset labels recover shot identity and versions from generated metadata", () => {
  const assets = [
    { id: "old", name: "生成结果.mp4", kind: "video", url: "/old", created: 1, category: "shot", metadata: { node_id: "video-2", duration: 5, input: { label: "shot-002 · 视频", model: "seedance" } } },
    { id: "new", name: "生成结果.mp4", kind: "video", url: "/new", created: 2, category: "shot", metadata: { node_id: "video-2", duration: 4, input: { label: "shot-002 · 视频", model: "seedance" } } },
  ];
  const shots = [{ id: "shot-002", title: "机器人整理柜台", pipeline: { videoNodeId: "video-2" } }];
  const presented = presentEditorAssets(assets, shots);
  assert.equal(presented[0].title, "镜头 02 · 视频");
  assert.equal(presented[0].subtitle, "机器人整理柜台");
  assert.match(presented[0].details, /5\.0 秒 · V1 · 镜头 · seedance/);
  assert.match(presented[1].details, /4\.0 秒 · V2/);
  assert.match(presented[1].searchText, /机器人整理柜台/);
});

test("editor asset labels keep uploaded filenames and expose generated task labels", () => {
  const presented = presentEditorAssets([
    { id: "upload", name: "门店环境.jpg", kind: "image", url: "/image", metadata: {}, source: "uploaded" },
    { id: "generated", name: "Seedream 生成图.png", kind: "image", url: "/generated", metadata: { node_id: "image-6", input: { label: "shot-006 · 分镜图" } } },
  ], []);
  assert.equal(presented[0].title, "门店环境.jpg");
  assert.equal(presented[1].title, "镜头 06 · 分镜图");
});
