import type { GenerationKind, GenerationPolicy, GenerationTarget } from "./generationPolicy";
import { MODEL_POOL_KINDS, defaultProjectModelPool, targetKey, targetLabel, type ModelPoolKind, type ProjectModelPool } from "./modelAccess.ts";

type Value = Record<string, any>;
const labels: Record<ModelPoolKind, string> = { text: "文本模型", image: "图片模型", video: "视频模型", audio: "声音服务" };

export function GenerationPolicyPanel({ value, modelPool, providers, localModels, onChange, onModelPoolChange }: {
  value: GenerationPolicy | undefined;
  modelPool?: Partial<ProjectModelPool>;
  providers: Value[];
  localModels: Value[];
  onChange: (next: GenerationPolicy) => void;
  onModelPoolChange?: (next: ProjectModelPool) => void;
}) {
  const policy = value || { text: null, image: null, video: null };
  const systemPool = defaultProjectModelPool(providers, localModels);
  const pool = Object.fromEntries(MODEL_POOL_KINDS.map((kind) => [kind, Array.isArray(modelPool?.[kind]) ? modelPool![kind] : systemPool[kind]])) as ProjectModelPool;
  const patchDefault = (kind: GenerationKind, target: GenerationTarget | null) => onChange({ ...policy, [kind]: target });
  function toggle(kind: ModelPoolKind, target: GenerationTarget, checked: boolean) {
    if (!onModelPoolChange) return;
    const key = targetKey(target);
    const nextTargets = checked
      ? [...pool[kind], target].filter((item, index, all) => all.findIndex((candidate) => targetKey(candidate) === targetKey(item)) === index)
      : pool[kind].filter((item) => targetKey(item) !== key);
    onModelPoolChange({ ...pool, [kind]: nextTargets });
    if (kind !== "audio" && policy[kind] && targetKey(policy[kind]!) === key) patchDefault(kind, nextTargets[0] || null);
  }
  return <section className="generation-policy">
    <div className="field-heading"><h3>项目可用模型</h3><span className="model-pool-count">已选 {MODEL_POOL_KINDS.reduce((sum, kind) => sum + pool[kind].length, 0)}</span></div>
    <p className="muted">这里只显示“设置 → 系统模型库”已启用的模型。项目可圈选多个模型，并为文本、图片和视频分别指定默认值。</p>
    {MODEL_POOL_KINDS.map((kind) => {
      const options = systemPool[kind], selected = new Set(pool[kind].map(targetKey));
      const defaultTarget = kind === "audio" ? null : policy[kind];
      return <div className="project-model-kind" key={kind}>
        <div className="project-model-kind-heading"><b>{labels[kind]}</b><small>{pool[kind].length} / {options.length} 个可用</small></div>
        {options.length ? <div className="model-choice-grid">{options.map((target) => <label className="model-choice" key={targetKey(target)}><input type="checkbox" disabled={!onModelPoolChange} checked={selected.has(targetKey(target))} onChange={(event) => toggle(kind, target, event.target.checked)}/><span>{targetLabel(target, providers, localModels)}</span></label>)}</div> : <p className="warning-text">系统模型库尚未启用此类模型。</p>}
        {kind !== "audio" && <label className="project-default-model">默认{labels[kind]}<select value={defaultTarget ? targetKey(defaultTarget) : ""} onChange={(event) => patchDefault(kind, pool[kind].find((item) => targetKey(item) === event.target.value) || null)}><option value="">跟随系统默认</option>{pool[kind].map((target) => <option key={targetKey(target)} value={targetKey(target)}>{targetLabel(target, providers, localModels)}</option>)}</select></label>}
      </div>;
    })}
  </section>;
}
