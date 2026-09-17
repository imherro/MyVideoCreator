import type { GenerationKind, GenerationTarget } from "./generationPolicy.ts";

type Value = Record<string, any>;

export type ModelPoolKind = GenerationKind | "audio";
export type ProjectModelPool = Record<ModelPoolKind, GenerationTarget[]>;

export const MODEL_POOL_KINDS: ModelPoolKind[] = ["text", "image", "video", "audio"];

export function emptyProjectModelPool(): ProjectModelPool {
  return { text: [], image: [], video: [], audio: [] };
}

export function targetKey(target: GenerationTarget): string {
  return `${target.providerId}\u0000${target.modelId}`;
}

export function providerSupportsKind(provider: Value, kind: ModelPoolKind): boolean {
  return !provider.kind || provider.kind === kind;
}

export function configuredModelId(provider: Value, kind: ModelPoolKind): string {
  if (kind === "audio" && provider.type === "volcengine_speech")
    return String(provider.resource_id || "seed-tts-2.0");
  return String(provider.models?.[kind] || provider.model || "");
}

export function enabledModelIds(provider: Value, kind: ModelPoolKind): string[] {
  if (!providerSupportsKind(provider, kind)) return [];
  const configured = provider.enabled_models?.[kind];
  if (Array.isArray(configured))
    return [...new Set(configured.map((value: unknown) => String(value || "").trim()).filter(Boolean))];
  const fallback = configuredModelId(provider, kind);
  return fallback ? [fallback] : [];
}

export function systemModelTargets(
  providers: Value[],
  kind: ModelPoolKind,
  localModels: Value[] = [],
): GenerationTarget[] {
  const targets: GenerationTarget[] = [];
  if (kind === "text") {
    for (const model of localModels) {
      const id = String(model.id || "").trim();
      if (id) targets.push({ providerId: "local", modelId: id });
    }
  }
  for (const provider of providers) {
    for (const modelId of enabledModelIds(provider, kind))
      targets.push({ providerId: provider.id, modelId });
  }
  return [...new Map(targets.map((target) => [targetKey(target), target])).values()];
}

export function defaultProjectModelPool(providers: Value[], localModels: Value[] = []): ProjectModelPool {
  return Object.fromEntries(
    MODEL_POOL_KINDS.map((kind) => [kind, systemModelTargets(providers, kind, localModels)]),
  ) as ProjectModelPool;
}

/** New projects start with all models enabled in the system library. */
export function defaultNewProjectModelPool(providers: Value[], localModels: Value[] = []): ProjectModelPool {
  return defaultProjectModelPool(providers, localModels);
}

export function effectiveProjectTargets(
  pool: Partial<ProjectModelPool> | undefined,
  providers: Value[],
  kind: ModelPoolKind,
  localModels: Value[] = [],
): GenerationTarget[] {
  const global = systemModelTargets(providers, kind, localModels);
  if (!pool || !Array.isArray(pool[kind])) return global;
  const allowed = new Set(global.map(targetKey));
  return (pool[kind] || []).filter((target) =>
    target && typeof target.providerId === "string" && typeof target.modelId === "string" && allowed.has(targetKey(target)),
  );
}

export function projectProviders(
  pool: Partial<ProjectModelPool> | undefined,
  providers: Value[],
  kind: ModelPoolKind,
  localModels: Value[] = [],
): Value[] {
  const targets = effectiveProjectTargets(pool, providers, kind, localModels);
  const ids = new Set(targets.map((target) => target.providerId));
  return providers.filter((provider) => ids.has(provider.id)).map((provider) => {
    const modelIds = targets.filter((target) => target.providerId === provider.id).map((target) => target.modelId);
    const configured = configuredModelId(provider, kind);
    const defaultModel = modelIds.includes(configured) ? configured : modelIds[0] || "";
    return {
      ...provider,
      enabled_models: { ...provider.enabled_models, [kind]: modelIds },
      ...(kind === "audio" ? { resource_id: defaultModel } : provider.models ? { models: { ...provider.models, [kind]: defaultModel } } : { model: defaultModel }),
    };
  });
}

export function targetLabel(target: GenerationTarget, providers: Value[], localModels: Value[] = []): string {
  if (target.providerId === "local") {
    const model = localModels.find((item) => item.id === target.modelId);
    return `本地 · ${model?.name || target.modelId}`;
  }
  const provider = providers.find((item) => item.id === target.providerId);
  return `${provider?.name || target.providerId} · ${target.modelId}`;
}
