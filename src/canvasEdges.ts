import type { Node, Edge } from "@xyflow/react";
import { invalidate } from "./graph.ts";
import { filterManagedEdgeRemovals } from "./filmBible/managedGraph.ts";

type Value = Record<string, any>;

export function removeCanvasEdges<T extends { nodes: Node[]; edges: Edge[] }>(document: T, ids: string[]) {
  const requested = document.edges.filter(edge => ids.includes(edge.id));
  const { allowed, blocked } = filterManagedEdgeRemovals(
    requested.map(edge => ({ type: "remove", id: edge.id })), document.edges,
  );
  const removed = new Set(allowed.map(change => change.id));
  return {
    document: removed.size ? invalidate(
      { ...document, edges: document.edges.filter(edge => !removed.has(edge.id)) },
      requested.filter(edge => removed.has(edge.id)).map(edge => edge.target),
    ) : document,
    removed: [...removed], blocked: blocked.map(change => change.id),
  };
}

export const CANVAS_EDGE_COLORS: Record<string, string> = {
  character: "#d58fbd",
  character_state: "#e4a7cc",
  scene: "#69b89a",
  scene_state: "#82cdb0",
  prop: "#d8ad63",
  text: "#7f9fca",
  storyboard: "#c28f69",
  reference: "#d8ad63",
  image: "#63b3cf",
  video: "#a28bd2",
  default: "#829aa3",
};

function sourceKind(edge: Value, nodes: Value[], visual?: Value) {
  const explicit = String(edge.data?.kind || "");
  if (CANVAS_EDGE_COLORS[explicit]) return explicit;
  const source = nodes.find((node) => node.id === edge.source);
  if (!source) return "default";
  if (source.data?.kind === "visual_asset") {
    const version = visual?.versions?.[source.data.visualVersionId];
    const card = version ? visual?.cards?.[version.cardId] : undefined;
    return String(card?.kind || "default");
  }
  return String(source.data?.kind || "default");
}

export function canvasEdgeColor(edge: Value, nodes: Value[], visual?: Value) {
  const kind = sourceKind(edge, nodes, visual);
  return CANVAS_EDGE_COLORS[kind] || CANVAS_EDGE_COLORS.default;
}
