import type {
  FilmBibleDocument,
  ShotAssetBindings,
  VisualVersion,
} from "./types.ts";
import { visualBibleOf } from "./types.ts";

export type VersionDraft = Pick<VisualVersion, "spec" | "invariants">;
export type ImpactedShot = {
  shotUid: string;
  shotId: string;
  scene: string;
  sequence: string;
  fromVersionId: string;
  toVersionId: string;
};
export type UpgradeScope =
  | { shotUids: string[] }
  | { scene: string }
  | { sequence: string };

function identity(shot: Record<string, any>) {
  return String(shot.uid || shot.id || "");
}

function bindingsOf(shot: Record<string, any>): ShotAssetBindings {
  const value = shot.assetBindings || {};
  return {
    characters: Array.isArray(value.characters) ? value.characters : [],
    scene: value.scene?.versionId ? value.scene : null,
    props: Array.isArray(value.props) ? value.props : [],
  };
}

function normalizeDraft(draft: VersionDraft): VersionDraft {
  const description = draft.spec.description.trim();
  if (!description) throw new Error("视觉描述不能为空");
  return {
    spec: {
      description,
      attributes: draft.spec.attributes
        .map((item) => ({ name: item.name.trim(), value: item.value.trim() }))
        .filter((item) => item.name && item.value),
    },
    invariants: draft.invariants.map((item) => item.trim()).filter(Boolean),
  };
}

export function forkLockedVisualVersion<T extends FilmBibleDocument>(
  document: T,
  sourceVersionId: string,
  draft: VersionDraft,
  options: { id?: string; createdAt?: number } = {},
): T {
  const visual = visualBibleOf(document);
  const source = visual.versions[sourceVersionId];
  const card = source ? visual.cards[source.cardId] : undefined;
  if (!source || !card) throw new Error("视觉版本不存在或所属卡片已丢失");
  if (source.status !== "locked") throw new Error("只有已锁定版本才能派生新版");
  if (card.status === "deprecated") throw new Error("已弃用视觉卡不能创建新版");
  const patch = normalizeDraft(draft);
  const nextNumber =
    Math.max(
      0,
      ...Object.values(visual.versions)
        .filter((item) => item.cardId === card.id)
        .map((item) => Number(item.version) || 0),
    ) + 1;
  const versionId =
    options.id ||
    `${card.id}-v${nextNumber}-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  if (visual.versions[versionId]) throw new Error("新视觉版本编号已存在");
  const version: VisualVersion = {
    id: versionId,
    cardId: card.id,
    version: nextNumber,
    parentVersionId: source.id,
    status: "draft",
    ...patch,
    references: [],
    createdAt: options.createdAt ?? Date.now() / 1000,
    provenance: { forkedFromVersionId: source.id },
  };
  return {
    ...document,
    filmBible: {
      ...(document.filmBible || {}),
      visual: {
        ...visual,
        cards: {
          ...visual.cards,
          [card.id]: { ...card, currentVersionId: versionId },
        },
        versions: { ...visual.versions, [versionId]: version },
      },
    },
  } as T;
}

function matchingBindings(
  visual: ReturnType<typeof visualBibleOf>,
  shot: Record<string, any>,
  cardId: string,
) {
  const bindings = bindingsOf(shot);
  const rows = [
    ...bindings.characters.map((item) => ({ group: "characters", item })),
    ...(bindings.scene ? [{ group: "scene", item: bindings.scene }] : []),
    ...bindings.props.map((item) => ({ group: "props", item })),
  ];
  return rows.filter(
    ({ item }) => visual.versions[item.versionId]?.cardId === cardId,
  );
}

export function discoverImpactedShots(
  document: FilmBibleDocument,
  cardId: string,
  targetVersionId?: string,
): ImpactedShot[] {
  const visual = visualBibleOf(document);
  const card = visual.cards[cardId];
  const target = targetVersionId || card?.currentVersionId;
  if (!card || !target || visual.versions[target]?.cardId !== cardId)
    throw new Error("目标视觉卡或当前版本无效");
  return document.shots.flatMap((shot) =>
    matchingBindings(visual, shot, cardId)
      .filter(({ item }) => item.versionId !== target)
      .map(({ item }) => ({
        shotUid: identity(shot),
        shotId: String(shot.id || identity(shot)),
        scene: String(shot.scene || ""),
        sequence: String(shot.sequence || shot.sequenceId || ""),
        fromVersionId: item.versionId,
        toVersionId: target,
      })),
  );
}

function inScope(shot: Record<string, any>, scope: UpgradeScope) {
  if ("shotUids" in scope) return new Set(scope.shotUids).has(identity(shot));
  if ("scene" in scope) return String(shot.scene || "") === scope.scene;
  return String(shot.sequence || shot.sequenceId || "") === scope.sequence;
}

function staleGeneratedOutputs<T extends FilmBibleDocument>(
  document: T,
  roots: Set<string>,
  reason: string,
): T["nodes"] {
  const affected = new Set(roots);
  const pending = [...roots];
  while (pending.length) {
    const source = pending.pop();
    for (const edge of document.edges) {
      if (edge.source === source && !affected.has(edge.target)) {
        affected.add(edge.target);
        pending.push(edge.target);
      }
    }
  }
  return document.nodes.map((node) =>
    affected.has(node.id) &&
    (node.data?.assetId || node.data?.resultJob || node.data?.generationFingerprint)
      ? { ...node, data: { ...node.data, stale: true, staleReason: reason } }
      : node,
  );
}

export function upgradeVisualBindings<T extends FilmBibleDocument>(
  document: T,
  cardId: string,
  targetVersionId: string,
  scope: UpgradeScope,
): T {
  const visual = visualBibleOf(document);
  const target = visual.versions[targetVersionId];
  if (!target || target.cardId !== cardId)
    throw new Error("升级目标必须属于同一视觉卡");
  if (target.status !== "locked") throw new Error("分镜只能升级到已锁定版本");
  const affectedNodeIds = new Set<string>();
  const shots = document.shots.map((shot) => {
    if (!inScope(shot, scope) || !matchingBindings(visual, shot, cardId).length)
      return shot;
    const bindings = bindingsOf(shot);
    const replace = (item: { role?: string; versionId: string }) =>
      visual.versions[item.versionId]?.cardId === cardId
        ? { ...item, versionId: targetVersionId }
        : item;
    const next = {
      ...shot,
      assetBindings: {
        characters: bindings.characters.map(replace),
        scene: bindings.scene ? replace(bindings.scene) : null,
        props: bindings.props.map(replace),
      },
    };
    if (JSON.stringify(next.assetBindings) !== JSON.stringify(bindings)) {
      const imageNodeId = shot.imageNode || shot.pipeline?.imageNodeId;
      const videoNodeId = shot.videoNode || shot.pipeline?.videoNodeId;
      if (imageNodeId) affectedNodeIds.add(imageNodeId);
      if (videoNodeId) affectedNodeIds.add(videoNodeId);
    }
    return next;
  });
  return {
    ...document,
    shots,
    nodes: staleGeneratedOutputs(document, affectedNodeIds, "visual-version-upgraded"),
  } as T;
}

export function hardDeleteVisualVersion<T extends FilmBibleDocument>(
  document: T,
  versionId: string,
): T {
  const visual = visualBibleOf(document);
  const version = visual.versions[versionId];
  const card = version ? visual.cards[version.cardId] : undefined;
  if (!version || !card) throw new Error("视觉版本不存在");
  if (document.shots.some((shot) => matchingBindings(visual, shot, card.id)
    .some(({ item }) => item.versionId === versionId)))
    throw new Error("仍被分镜引用的视觉版本不能永久删除；请改为弃用");
  if (["locked", "deprecated"].includes(version.status))
    throw new Error("已锁定或已弃用的视觉版本必须作为历史保留");
  if (card.currentVersionId === versionId)
    throw new Error("当前视觉版本不能永久删除");
  const versions = { ...visual.versions };
  delete versions[versionId];
  return {
    ...document,
    filmBible: {
      ...(document.filmBible || {}),
      visual: { ...visual, versions },
    },
  } as T;
}

export function setProjectVisualStyle<T extends FilmBibleDocument>(
  document: T,
  style: string,
): T {
  if (String(document.style || "") === style) return document;
  const shotNodes = new Set<string>();
  for (const shot of document.shots) {
    const image = shot.imageNode || shot.pipeline?.imageNodeId;
    const video = shot.videoNode || shot.pipeline?.videoNodeId;
    if (image) shotNodes.add(image);
    if (video) shotNodes.add(video);
  }
  const previous = Number(document.filmBible?.styleVersion || 1);
  return {
    ...document,
    style,
    filmBible: {
      ...(document.filmBible || {}),
      styleVersion: Number.isFinite(previous) ? previous + 1 : 2,
    },
    nodes: staleGeneratedOutputs(document, shotNodes, "style-version-changed"),
  } as T;
}
