import type { FilmBibleDocument, VisualKind } from "./types.ts";
import { visualBibleOf } from "./types.ts";

export const VISUAL_NODE_TYPE = "visualAsset";

export function isManagedVisualNode(node: Record<string, any>) {
  return (
    node?.type === VISUAL_NODE_TYPE &&
    node?.data?.kind === "visual_asset" &&
    node?.data?.managed === true
  );
}

export function isManagedVisualEdge(edge: Record<string, any>) {
  return edge?.data?.managed === true && edge?.data?.origin === "visual_binding";
}

export function visualVersionIdFromNode(node: Record<string, any>) {
  return isManagedVisualNode(node) ? String(node.data.visualVersionId || "") : "";
}

export function filterManagedEdgeRemovals<
  T extends { type: string; id?: string },
>(changes: T[], edges: Array<Record<string, any>>) {
  const managedIds = new Set(
    edges.filter(isManagedVisualEdge).map((edge) => String(edge.id)),
  );
  const blocked = changes.filter(
    (change) =>
      change.type === "remove" &&
      typeof change.id === "string" &&
      managedIds.has(change.id),
  );
  return {
    allowed: changes.filter(
      (change) =>
        !(
          change.type === "remove" &&
          typeof change.id === "string" &&
          managedIds.has(change.id)
        ),
    ),
    blocked,
  };
}

function orderedVersions(document: FilmBibleDocument) {
  const visual = visualBibleOf(document);
  const cards = Object.values(visual.cards)
    .sort((a, b) =>
      `${a.kind}:${a.name}:${a.id}`.localeCompare(`${b.kind}:${b.name}:${b.id}`),
    );
  return cards.flatMap((card) =>
    Object.values(visual.versions)
      .filter((version) => version.cardId === card.id)
      .sort((a, b) => a.version - b.version || a.id.localeCompare(b.id)),
  );
}

function stableNodeId(versionId: string) {
  return `visual-version:${versionId}`;
}

function edgeId(
  shotUid: string,
  kind: string,
  index: number,
  versionId: string,
) {
  return `visual-binding:${shotUid}:${kind}:${index}:${versionId}`;
}

function bindingRows(shot: Record<string, any>) {
  const binding = shot.assetBindings || {};
  const rows: Array<{ kind: VisualKind; versionId: string; index: number }> = [];
  (Array.isArray(binding.characters) ? binding.characters : []).forEach(
    (item: Record<string, any>, index: number) => {
      if (item?.versionId)
        rows.push({ kind: "character", versionId: item.versionId, index });
    },
  );
  if (binding.scene?.versionId)
    rows.push({ kind: "scene", versionId: binding.scene.versionId, index: 0 });
  (Array.isArray(binding.props) ? binding.props : []).forEach(
    (item: Record<string, any>, index: number) => {
      if (item?.versionId)
        rows.push({ kind: "prop", versionId: item.versionId, index });
    },
  );
  return rows;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function deriveManagedGraph<T extends FilmBibleDocument>(document: T): T {
  const visual = visualBibleOf(document);
  const versions = orderedVersions(document);
  const existingByVersion = new Map(
    document.nodes
      .filter(isManagedVisualNode)
      .map((node) => [String(node.data.visualVersionId), node]),
  );
  const managedNodes = versions.map((version, index) => {
    const previous = existingByVersion.get(version.id);
    const card = visual.cards[version.cardId];
    return {
      id: previous?.id || stableNodeId(version.id),
      type: VISUAL_NODE_TYPE,
      position: previous?.position || { x: 770, y: 80 + index * 190 },
      hidden: Boolean(card?.deletedAt),
      data: {
        kind: "visual_asset",
        visualVersionId: version.id,
        managed: true,
      },
    };
  });
  const nodeIdByVersion = new Map(
    managedNodes.map((node) => [node.data.visualVersionId, node.id]),
  );
  const managedEdges = document.shots.flatMap((shot) => {
    const shotUid = String(shot.uid || shot.id || "");
    const target = shot.imageNode || shot.pipeline?.imageNodeId;
    if (!shotUid || !target) return [];
    return bindingRows(shot).flatMap((binding) => {
      const version = visual.versions[binding.versionId];
      const card = version ? visual.cards[version.cardId] : undefined;
      const source = nodeIdByVersion.get(binding.versionId);
      if (!source || !card || card.deletedAt) return [];
      const kind =
        card.kind === "character_state"
          ? "character"
          : card.kind === "scene_state"
            ? "scene"
            : card.kind;
      return [
        {
          id: edgeId(shotUid, kind, binding.index, binding.versionId),
          source,
          target,
          type: "smoothstep",
          data: { managed: true, origin: "visual_binding", kind },
        },
      ];
    });
  });
  const nodes = [
    ...document.nodes.filter((node) => !isManagedVisualNode(node)),
    ...managedNodes,
  ];
  const edges = [
    ...document.edges.filter((edge) => !isManagedVisualEdge(edge)),
    ...managedEdges,
  ];
  if (same(nodes, document.nodes) && same(edges, document.edges)) return document;
  return { ...document, nodes, edges };
}
