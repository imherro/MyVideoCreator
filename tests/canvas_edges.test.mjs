import test from "node:test";
import assert from "node:assert/strict";
import { CANVAS_EDGE_COLORS, canvasEdgeColor } from "../src/canvasEdges.ts";

test("canvas wires use the source asset type color", () => {
  const nodes = [
    { id: "script", data: { kind: "text" } },
    { id: "image", data: { kind: "image" } },
    { id: "asset", data: { kind: "visual_asset", visualVersionId: "v1" } },
  ];
  const visual = { versions: { v1: { cardId: "c1" } }, cards: { c1: { kind: "scene" } } };
  assert.equal(canvasEdgeColor({ source: "script" }, nodes, visual), CANVAS_EDGE_COLORS.text);
  assert.equal(canvasEdgeColor({ source: "image" }, nodes, visual), CANVAS_EDGE_COLORS.image);
  assert.equal(canvasEdgeColor({ source: "asset" }, nodes, visual), CANVAS_EDGE_COLORS.scene);
  assert.equal(canvasEdgeColor({ source: "asset", data: { kind: "prop" } }, nodes, visual), CANVAS_EDGE_COLORS.prop);
});
