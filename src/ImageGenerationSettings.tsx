import { useEffect, useState } from "react";
import { effectiveProjectTargets } from "./modelAccess";
import { nodeDefaults } from "./nodeDefaults";

type Value = Record<string, any>;
type Props = {
  document: Value; data: Value; providers: Value[]; projectId: string;
  request: (path: string, options?: RequestInit) => Promise<any>;
  onChange: (patch: Value) => void;
};

// A page can show dozens of identical cards. Share only in-flight read-only
// requests, not persisted answers (provider settings may change elsewhere).
const pending = new Map<string, Promise<Value>>();
function preview(props: Props, body: string) {
  const path = `/projects/${props.projectId}/image-spec`;
  const key = path + body;
  if (!pending.has(key)) {
    const request = props.request(path, { method: "POST", body });
    pending.set(key, request);
    void request.finally(() => pending.delete(key)).catch(() => {});
  }
  return pending.get(key)!;
}

export function ImageGenerationSettings(props: Props) {
  const { document, data, providers, onChange } = props;
  const [state, setState] = useState<{ key: string; spec?: Value; error?: string }>({ key: "" });
  const [capabilities, setCapabilities] = useState<{ key: string; spec?: Value }>({ key: "" });
  const targets = effectiveProjectTargets(document.modelPool, providers, "image");
  const provider = providers.find(p => p.id === data.provider);
  const models = targets.filter(t => t.providerId === data.provider);
  const settings = data.imageSettings || {};
  const body = JSON.stringify({
    project: { ratio: document.ratio, videoResolution: document.videoResolution },
    input: { provider: data.provider, model: data.model, imageSettings: settings, seed: data.seed ?? -1 },
  });
  const key = props.projectId + body;
  const capabilityKey = JSON.stringify([data.provider, data.model, provider]);
  const spec = state.key === key ? state.spec : undefined;
  const controls = capabilities.key === capabilityKey ? capabilities.spec : undefined;
  const error = state.key === key ? state.error : "";
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void preview(props, body).then(spec => { if (active) { setState({ key, spec }); setCapabilities({ key: capabilityKey, spec }); } })
        .catch(error => { if (active) setState({ key, error: error.message }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [key, capabilityKey]);
  const patchSettings = (patch: Value) => onChange({ imageSettings: { ...settings, ...patch } });
  const validModel = targets.some(t => t.providerId === data.provider && t.modelId === data.model);
  return <section className="image-generation-settings" aria-label="分镜图生成参数">
    <div className="image-generation-fields">
      <label>供应商<select value={data.provider || ""} onChange={event => {
        const target = targets.find(t => t.providerId === event.target.value);
        if (target) onChange({ provider: target.providerId, model: target.modelId, model_capabilities: undefined });
      }}>
        {!targets.some(t => t.providerId === data.provider) && <option value={data.provider || ""}>请选择可用供应商</option>}
        {providers.filter(p => targets.some(t => t.providerId === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>模型<select value={data.model || ""} onChange={event => onChange({ model: event.target.value, model_capabilities: undefined })}>
        {!models.some(t => t.modelId === data.model) && <option value={data.model || ""}>{data.model || "请选择模型"}</option>}
        {models.map(t => <option key={t.modelId} value={t.modelId}>{t.modelId}</option>)}
      </select></label>
      <label>图像尺寸<select value={settings.sizeMode || "project"} onChange={event => patchSettings({ sizeMode: event.target.value, ...(event.target.value === "custom" && !settings.size ? { size: spec?.size || "2048x1152" } : {}) })}>
        {(controls?.sizeOptions || [{ value: "project", label: "跟随项目画幅 · 推荐尺寸" }]).map((item: Value) => <option key={item.value} value={item.value}>{item.label}</option>)}
        {settings.sizeMode && !controls?.sizeOptions?.some((item: Value) => item.value === settings.sizeMode) && settings.sizeMode !== "project" && <option value={settings.sizeMode}>{settings.sizeMode === "custom" ? "自定义像素尺寸" : "与项目视频像素一致"}</option>}
      </select></label>
    </div>
    {settings.sizeMode === "custom" && <label>宽 × 高<input aria-label="自定义图像尺寸" value={settings.size || ""} placeholder="1280x720" onChange={event => patchSettings({ size: event.target.value })}/></label>}
    <div className="image-generation-summary"><span>{spec ? `拟提交 ${spec.size.replace("x", " × ")} · ${spec.ratio}　｜　项目视频 ${document.videoResolution || "720p"}` : error ? "参数需调整" : "正在核对尺寸…"}</span><button className="quiet" type="button" onClick={() => {
      try {
        const defaults = nodeDefaults("image", providers, [], document.generationPolicy);
        onChange({ provider: defaults.provider, model: defaults.model, seed: -1, imageSettings: { sizeMode: "project", seed: -1 }, model_capabilities: undefined });
      } catch (error: any) { setState({ key, error: error.message }); }
    }}>恢复项目默认</button></div>
    {!validModel && <small className="error">当前模型未在项目中启用，请重新选择。</small>}
    {error && <small className="error">{error}</small>}
    <details className="image-generation-advanced"><summary>高级参数</summary>
      <label>随机种子<input type="number" min="-1" max="2147483647" step="1" disabled={!controls?.seedSupported} value={settings.seed ?? data.seed ?? -1} onChange={event => patchSettings({ seed: Number(event.target.value) })}/></label>
      <small>{controls?.seedSupported ? "-1 为随机生成；固定种子用于复现实验，不保证角色一致性。" : "当前适配器未开放固定种子。"}</small>
      {!controls?.seedSupported && settings.seed != null && settings.seed !== -1 && <button type="button" className="quiet" onClick={() => patchSettings({ seed: -1 })}>改用随机生成</button>}
      <small>{controls?.sizeNote}</small>
      {controls?.sizeOptions?.length === 1 && <small>当前适配器仅开放推荐尺寸；不将视频 480p / 720p 直接作为云端图像尺寸。</small>}
    </details>
  </section>;
}
