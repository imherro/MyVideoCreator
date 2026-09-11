import test from "node:test";
import assert from "node:assert/strict";
import {
  attachAssetReferences,
  editorResolution,
  readEditorTimeline,
} from "../src/editor/editorDocument.ts";

test("missing editor state starts as a fresh Twick project", () => {
  const first = readEditorTimeline();
  const second = readEditorTimeline();
  assert.deepEqual(first.tracks, []);
  assert.equal(first.version, 1);
  first.tracks.push({ id: "changed", name: "changed", elements: [] });
  assert.deepEqual(second.tracks, []);
});

test("persisted Twick media keeps the canonical MyVideoCreator asset id", () => {
  const timeline = {
    version: 3,
    tracks: [
      {
        id: "t-v1",
        name: "V1",
        elements: [
          {
            id: "e-shot-1",
            type: "video",
            s: 0,
            e: 5,
            props: { src: "/api/assets/asset-video/file", time: 1 },
          },
        ],
      },
    ],
  };
  const assets = [
    {
      id: "asset-video",
      name: "镜头 1",
      kind: "video",
      url: "/api/assets/asset-video/file",
      metadata: { duration: 6.5, width: 1280, height: 720 },
    },
  ];

  const persisted = attachAssetReferences(timeline, assets);
  const element = persisted.tracks[0].elements[0];
  assert.equal(element.metadata.assetId, "asset-video");
  assert.equal(element.props.srcAssetId, "asset-video");
  assert.equal(persisted.assets["asset-video"].duration, 6500);
  assert.equal(timeline.tracks[0].elements[0].metadata, undefined);
});

test("editor resolution follows the project aspect ratio", () => {
  assert.deepEqual(editorResolution("16:9"), { width: 1280, height: 720 });
  assert.deepEqual(editorResolution("9:16"), { width: 720, height: 1280 });
  assert.deepEqual(editorResolution("1:1"), { width: 1080, height: 1080 });
});
