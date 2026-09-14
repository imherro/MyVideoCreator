import type { GenerationPolicy } from "./generationPolicy.ts";
import { invalidate } from "./graph.ts";
import { setProjectVisualStyle } from "./filmBible/versioning.ts";

type Value = Record<string, any>;

export type ProjectBibleFields = {
  worldEra: string;
  visualTone: string;
  colorLighting: string;
  cameraLanguage: string;
  characterSceneConsistency: string;
  avoidItems: string;
};

export type ProjectSetupDraft = {
  name: string;
  episodeTitle: string;
  style: string;
  ratio: "16:9" | "9:16" | "1:1";
  duration: number;
  brief: string;
  generationPolicy: GenerationPolicy;
  bible: ProjectBibleFields;
};

export function defaultGenerationPolicy(providers: Value[]): GenerationPolicy {
  const ark = providers.find((provider) => provider.type === "volcengine_ark");
  if (!ark) return { text: null, image: null, video: null };
  return Object.fromEntries(
    (["text", "image", "video"] as const).map((kind) => [
      kind,
      { providerId: ark.id, modelId: ark.models?.[kind] || "" },
    ]),
  ) as GenerationPolicy;
}

export function defaultProjectSetupDraft(providers: Value[]): ProjectSetupDraft {
  return {
    name: "",
    episodeTitle: "第 01 集",
    style: "电影写实",
    ratio: "16:9",
    duration: 15,
    brief: "",
    generationPolicy: defaultGenerationPolicy(providers),
    bible: {
      worldEra: "",
      visualTone: "",
      colorLighting: "",
      cameraLanguage: "",
      characterSceneConsistency: "",
      avoidItems: "",
    },
  };
}

export function validateProjectSetupDraft(draft: ProjectSetupDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("请输入作品名称");
  if (draft.name.trim().length > 100) errors.push("作品名称最多 100 个字符");
  if (draft.episodeTitle.trim().length > 100) errors.push("EP01 标题最多 100 个字符");
  if (!draft.style.trim()) errors.push("请输入视觉风格");
  if (!(["16:9", "9:16", "1:1"] as string[]).includes(draft.ratio)) errors.push("请选择有效画幅");
  if (!Number.isFinite(draft.duration) || draft.duration < 5 || draft.duration > 3000)
    errors.push("目标时长应为 5–3000 秒");
  return errors;
}

function compactObject(value: Value): Value {
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    Array.isArray(item) ? item.length > 0 : String(item ?? "").trim() !== "",
  ));
}

export function projectSetupPayload(draft: ProjectSetupDraft) {
  const avoidItems = draft.bible.avoidItems.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return {
    name: draft.name.trim(),
    episode_title: draft.episodeTitle.trim() || "第 01 集",
    style: draft.style.trim(),
    ratio: draft.ratio,
    duration: draft.duration,
    brief: draft.brief,
    generation_policy: draft.generationPolicy,
    film_bible: {
      story: compactObject({ worldEra: draft.bible.worldEra }),
      style: compactObject({
        visualTone: draft.bible.visualTone,
        colorLighting: draft.bible.colorLighting,
        cameraLanguage: draft.bible.cameraLanguage,
        avoidItems,
      }),
      continuity: compactObject({ characterSceneConsistency: draft.bible.characterSceneConsistency }),
    },
  };
}

export function bibleFields(document: Value): ProjectBibleFields {
  const bible = document.filmBible || {};
  return {
    worldEra: String(bible.story?.worldEra || ""),
    visualTone: String(bible.style?.visualTone || ""),
    colorLighting: String(bible.style?.colorLighting || ""),
    cameraLanguage: String(bible.style?.cameraLanguage || ""),
    characterSceneConsistency: String(bible.continuity?.characterSceneConsistency || ""),
    avoidItems: Array.isArray(bible.style?.avoidItems) ? bible.style.avoidItems.join("\n") : "",
  };
}

export function mergeBibleFields<T extends Value>(document: T, fields: ProjectBibleFields): T {
  const current = document.filmBible || {};
  const avoidItems = fields.avoidItems.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return {
    ...document,
    filmBible: {
      ...current,
      story: { ...(current.story || {}), worldEra: fields.worldEra },
      style: {
        ...(current.style || {}),
        visualTone: fields.visualTone,
        colorLighting: fields.colorLighting,
        cameraLanguage: fields.cameraLanguage,
        avoidItems,
      },
      continuity: {
        ...(current.continuity || {}),
        characterSceneConsistency: fields.characterSceneConsistency,
      },
    },
  };
}

export function applyRatioChange<T extends Value & { nodes: any[]; edges: any[]; shots: any[] }>(document: T, ratio: string): T {
  if (document.ratio === ratio) return document;
  const roots = new Set<string>();
  for (const shot of document.shots || []) {
    const image = shot.imageNode || shot.pipeline?.imageNodeId;
    const video = shot.videoNode || shot.pipeline?.videoNodeId;
    if (image) roots.add(image);
    if (video) roots.add(video);
  }
  return invalidate({ ...document, ratio }, [...roots]) as unknown as T;
}

export function applyStyleChange<T extends Value>(document: T, style: string): T {
  return setProjectVisualStyle(document as any, style) as T;
}

export function applyTargetDuration<T extends Value>(document: T, duration: number): T {
  return document.duration === duration ? document : { ...document, duration };
}
