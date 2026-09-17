import test from "node:test";
import assert from "node:assert/strict";
import { CANVAS_EDGE_COLORS, canvasEdgeColor, removeCanvasEdges } from "../src/canvasEdges.ts";

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

test("disconnect preserves cards and outputs and marks only downstream results stale", () => {
  const graph = {
    nodes: ["script", "image", "video", "other"].map(id => ({id, position:{x:0,y:0},data:{assetId:"asset-"+id,resultJob:"job-"+id}})),
    edges: [{id:"manual",source:"script",target:"image"},{id:"next",source:"image",target:"video"}],
    timeline: [{asset_id:"asset-video"}],
  };
  const result = removeCanvasEdges(graph, ["manual"]);
  assert.deepEqual(result.removed, ["manual"]);
  assert.deepEqual(result.document.edges.map(edge=>edge.id), ["next"]);
  assert.equal(result.document.nodes.length, 4);
  assert.deepEqual(result.document.nodes.map(node=>node.data.assetId),graph.nodes.map(node=>node.data.assetId));
  assert.deepEqual(result.document.nodes.map(node=>!!node.data.stale),[false,true,true,false]);
  assert.equal(result.document.timeline,graph.timeline);
  assert.equal(graph.edges.length,2);
});

test("binding and lineage wires cannot be deleted alongside a manual edge", () => {
  const graph={nodes:[],edges:[
    {id:"binding",source:"asset",target:"image",data:{managed:true,origin:"visual_binding"}},
    {id:"lineage",source:"base",target:"state",data:{managed:true,origin:"visual_lineage"}},
    {id:"manual",source:"script",target:"image"},
  ]};
  const protectedResult=removeCanvasEdges(graph,["binding","lineage","missing"]);
  assert.equal(protectedResult.document,graph);
  assert.deepEqual(protectedResult.blocked,["binding","lineage"]);
  const mixed=removeCanvasEdges(graph,["binding","lineage","manual"]);
  assert.deepEqual(mixed.removed,["manual"]);
  assert.deepEqual(mixed.document.edges.map(edge=>edge.id),["binding","lineage"]);
});
