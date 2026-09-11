import type {
  FilmBibleDocument,
  ShotAssetBindings,
  VisualBible,
  VisualVersion,
  VisualVersionStatus,
} from "./types.ts";
import { visualBibleOf } from "./types.ts";

type VersionPatch = Pick<VisualVersion, "spec" | "invariants">;

function requireVisual(document: FilmBibleDocument, versionId: string) {
  const visual = visualBibleOf(document);
  const version = visual.versions[versionId];
  const card = version ? visual.cards[version.cardId] : undefined;
  if (!version || !card) throw new Error("视觉版本不存在或所属卡片已丢失");
  return { visual, version, card };
}

function withVisual<T extends FilmBibleDocument>(
  document: T,
  visual: VisualBible,
): T {
  return {
    ...document,
    filmBible: {
      ...(document.filmBible || {}),
      visual,
    },
  } as T;
}

export function renameVisualCard<T extends FilmBibleDocument>(
  document: T,
  cardId: string,
  name: string,
): T {
  const visual = visualBibleOf(document);
  const card = visual.cards[cardId];
  const nextName = name.trim();
  if (!card) throw new Error("视觉卡不存在");
  if (!nextName) throw new Error("视觉卡名称不能为空");
  const current = visual.versions[card.currentVersionId];
  if (current && !["draft", "pending_reference"].includes(current.status))
    throw new Error("已锁定或已弃用视觉卡的名称不可修改");
  if (
    Object.values(visual.cards).some(
      (item) =>
        item.id !== cardId &&
        item.kind === card.kind &&
        item.name.trim().toLocaleLowerCase() === nextName.toLocaleLowerCase(),
    )
  )
    throw new Error("同类型视觉卡名称不能重复");
  if (card.name === nextName) return document;
  const versionIds = new Set(
    Object.values(visual.versions)
      .filter((item) => item.cardId === cardId)
      .map((item) => item.id),
  );
  const renamed = withVisual(document, {
    ...visual,
    cards: { ...visual.cards, [cardId]: { ...card, name: nextName } },
  });
  return {
    ...renamed,
    shots: renamed.shots.map((shot) => {
      const bindings = bindingsOf(shot);
      return {
        ...shot,
        assetBindings: {
          ...bindings,
          characters: bindings.characters.map((item) =>
            versionIds.has(item.versionId) ? { ...item, role: nextName } : item,
          ),
          props: bindings.props.map((item) =>
            versionIds.has(item.versionId) ? { ...item, role: nextName } : item,
          ),
        },
      };
    }),
  } as T;
}

export function updateDraftVisualVersion<T extends FilmBibleDocument>(
  document: T,
  versionId: string,
  patch: VersionPatch,
): T {
  const { visual, version } = requireVisual(document, versionId);
  if (!['draft', 'pending_reference'].includes(version.status))
    throw new Error("已锁定或已弃用的视觉版本不可修改");
  const description = patch.spec.description.trim();
  if (!description) throw new Error("视觉描述不能为空");
  const attributes = patch.spec.attributes
    .map((item) => ({ name: item.name.trim(), value: item.value.trim() }))
    .filter((item) => item.name && item.value);
  const invariants = patch.invariants.map((item) => item.trim()).filter(Boolean);
  const next: VisualVersion = {
    ...version,
    spec: { description, attributes },
    invariants,
  };
  return withVisual(document, {
    ...visual,
    versions: { ...visual.versions, [versionId]: next },
  });
}

export function setVisualVersionStatus<T extends FilmBibleDocument>(
  document: T,
  versionId: string,
  status: VisualVersionStatus,
): T {
  const { visual, version } = requireVisual(document, versionId);
  if (version.status === status) return document;
  const allowed: Record<VisualVersionStatus, VisualVersionStatus[]> = {
    draft: ["pending_reference", "deprecated"],
    pending_reference: ["draft", "deprecated"],
    locked: ["deprecated"],
    deprecated: [],
  };
  if (!allowed[version.status].includes(status))
    throw new Error("该视觉版本状态不能直接切换");
  return withVisual(document, {
    ...visual,
    versions: {
      ...visual.versions,
      [versionId]: { ...version, status },
    },
  });
}

function shotIdentity(shot: Record<string, any>) {
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

function rootCardId(visual: VisualBible, versionId: string) {
  const version = visual.versions[versionId];
  const card = version ? visual.cards[version.cardId] : undefined;
  return card?.parentCardId || card?.id || "";
}

function replaceEntityBinding(
  values: Array<{ role: string; versionId: string }>,
  visual: VisualBible,
  role: string,
  versionId: string,
) {
  const root = rootCardId(visual, versionId);
  const index = values.findIndex(
    (item) => rootCardId(visual, item.versionId) === root,
  );
  const next = values.filter((item) => item.versionId !== versionId);
  const binding = { role, versionId };
  if (index < 0) return [...next, binding];
  const replaced = values.map((item, itemIndex) =>
    itemIndex === index ? binding : item,
  );
  return replaced.filter(
    (item, itemIndex) =>
      item.versionId !== versionId ||
      replaced.findIndex((candidate) => candidate.versionId === versionId) ===
        itemIndex,
  );
}

export function bindVisualVersion<T extends FilmBibleDocument>(
  document: T,
  shotUid: string,
  versionId: string,
): T {
  const { visual, version, card } = requireVisual(document, versionId);
  if (version.status === "deprecated" || card.status === "deprecated")
    throw new Error("已弃用的视觉版本不能建立新绑定");
  let found = false;
  const shots = document.shots.map((shot) => {
    if (shotIdentity(shot) !== shotUid) return shot;
    found = true;
    const bindings = bindingsOf(shot);
    if (card.kind === "character" || card.kind === "character_state") {
      bindings.characters = replaceEntityBinding(
        bindings.characters,
        visual,
        card.name,
        versionId,
      );
    } else if (card.kind === "scene" || card.kind === "scene_state") {
      bindings.scene = { versionId };
    } else {
      bindings.props = replaceEntityBinding(
        bindings.props,
        visual,
        card.name,
        versionId,
      );
    }
    return { ...shot, assetBindings: bindings };
  });
  if (!found) throw new Error("目标分镜不存在");
  return { ...document, shots };
}

export function unbindVisualVersion<T extends FilmBibleDocument>(
  document: T,
  shotUid: string,
  versionId: string,
): T {
  let found = false;
  const shots = document.shots.map((shot) => {
    if (shotIdentity(shot) !== shotUid) return shot;
    found = true;
    const bindings = bindingsOf(shot);
    return {
      ...shot,
      assetBindings: {
        characters: bindings.characters.filter(
          (item) => item.versionId !== versionId,
        ),
        scene:
          bindings.scene?.versionId === versionId ? null : bindings.scene,
        props: bindings.props.filter((item) => item.versionId !== versionId),
      },
    };
  });
  if (!found) throw new Error("目标分镜不存在");
  return { ...document, shots };
}

export function isVersionBound(
  shot: Record<string, any> | undefined,
  versionId: string,
) {
  if (!shot) return false;
  const bindings = bindingsOf(shot);
  return (
    bindings.scene?.versionId === versionId ||
    bindings.characters.some((item) => item.versionId === versionId) ||
    bindings.props.some((item) => item.versionId === versionId)
  );
}
