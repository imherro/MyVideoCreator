export type VisualKind =
  | "character"
  | "character_state"
  | "scene"
  | "scene_state"
  | "prop";

export type VisualVersionStatus =
  | "draft"
  | "pending_reference"
  | "locked"
  | "deprecated";

export type VisualAttribute = { name: string; value: string };

export type VisualGenerationOverride =
  | { mode: "inherit" }
  | { mode: "override"; providerId: string; modelId: string };

export type VisualReference = {
  role: "primary";
  assetId: string;
  source: "uploaded" | "generated";
  createdAt: number;
  provenance: {
    jobId?: string;
    submissionId?: string;
    providerId?: string;
    modelId?: string;
    targetSource?: "override" | "project" | "system";
    prompt?: string;
    parentVersionId?: string;
    parentReferenceAssetId?: string;
    filename?: string;
  };
};

export type VisualCard = {
  id: string;
  kind: VisualKind;
  name: string;
  parentCardId: string | null;
  currentVersionId: string;
  status: "active" | "deprecated";
  deletedAt?: number;
  source: { type: "script_extraction" };
  generation?: { image?: VisualGenerationOverride };
};

export type VisualVersion = {
  id: string;
  cardId: string;
  version: number;
  parentVersionId: string | null;
  status: VisualVersionStatus;
  spec: {
    description: string;
    attributes: VisualAttribute[];
  };
  invariants: string[];
  references: VisualReference[];
  createdAt: number;
  provenance: Record<string, unknown>;
};

export type VisualBible = {
  cards: Record<string, VisualCard>;
  versions: Record<string, VisualVersion>;
};

export type ShotAssetBindings = {
  characters: Array<{ role: string; versionId: string }>;
  scene: { versionId: string } | null;
  props: Array<{ role: string; versionId: string }>;
};

export type FilmBibleDocument = {
  filmBible?: { visual?: VisualBible; styleVersion?: number | string; [key: string]: unknown };
  shots: Array<Record<string, any>>;
  nodes: Array<Record<string, any>>;
  edges: Array<Record<string, any>>;
  [key: string]: unknown;
};

export const visualKindLabels: Record<VisualKind, string> = {
  character: "角色",
  character_state: "角色状态",
  scene: "场景",
  scene_state: "场景状态",
  prop: "道具",
};

export const visualStatusLabels: Record<VisualVersionStatus, string> = {
  draft: "草稿",
  pending_reference: "待参考图",
  locked: "已锁定",
  deprecated: "已弃用",
};

export function emptyVisualBible(): VisualBible {
  return { cards: {}, versions: {} };
}

export function visualBibleOf(document: FilmBibleDocument): VisualBible {
  const value = document.filmBible?.visual;
  return value && value.cards && value.versions ? value : emptyVisualBible();
}
