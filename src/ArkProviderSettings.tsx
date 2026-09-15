import { CheckCircle2, RefreshCw } from "lucide-react";

type Value = Record<string, any>;
type ArkKind = "text" | "image" | "video";

const LABELS: Record<ArkKind, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
};

export function ArkProviderSettings({
  provider,
  catalog,
  verified,
  checks,
  busy,
  onPatch,
  onVerify,
  onTest,
  serviceName = "火山方舟",
}: {
  provider: Value;
  catalog: Value[];
  verified: boolean;
  checks: Partial<Record<ArkKind, Value>>;
  busy: boolean;
  onPatch: (patch: Value) => void;
  onVerify: () => void;
  onTest: (kind: ArkKind) => void;
  serviceName?: string;
}) {
  function modelField(kind: ArkKind) {
    const options = catalog.filter((model) => model.kind === kind);
    const check = checks[kind];
    const listId = `ark-${provider.id}-${kind}-models`;
    return (
      <div className="ark-model-field" key={kind}>
        <div className="field-heading">
          <label htmlFor={`${listId}-input`}>{LABELS[kind]}模型</label>
          <button
            className="quiet"
            disabled={busy || !verified || !provider.models?.[kind]}
            onClick={() => onTest(kind)}
          >
            <CheckCircle2 size={13} />
            检测
          </button>
        </div>
        <input
          id={`${listId}-input`}
          list={listId}
          placeholder={verified ? `选择或填写${LABELS[kind]}模型 ID` : "验证 Key 后读取可用模型"}
          value={provider.models?.[kind] || ""}
          onChange={(event) =>
            onPatch({
              models: { ...provider.models, [kind]: event.target.value },
              changed_model_kind: kind,
            })
          }
        />
        <datalist id={listId}>
          {options.map((model) => (
            <option key={model.id} value={model.id} label={model.name} />
          ))}
        </datalist>
        <small>
          {verified
            ? options.length
              ? `${serviceName} 目录中有 ${options.length} 个；也可以直接填写自定义模型 ID。`
              : "目录中没有自动识别到此类模型，可以手动填写接入点 ID。"
            : "请先保存并验证 Key。"}
        </small>
        {check && (
          <small className={check.status === "listed" ? "success-text" : "warning-text"}>
            {check.message}
          </small>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="ark-verification-row">
        <button className="secondary full" disabled={busy} onClick={onVerify}>
          <RefreshCw size={14} />
          {verified ? "重新验证 Key 并刷新模型" : "保存并验证 Key"}
        </button>
        <small className={verified ? "success-text" : "muted"}>
          {verified ? `Key 鉴权通过，读取到 ${catalog.length} 个适用模型。` : "验证只读取模型目录，不会提交生成任务。"}
        </small>
      </div>
      {modelField("text")}
      {modelField("image")}
      {modelField("video")}
      <label>
        图片模型参考图上限
        <input
          type="number"
          min="1"
          max="10"
          value={provider.parameters?.image?.max_references ?? 10}
          onChange={(event) =>
            onPatch({
              parameters: {
                ...provider.parameters,
                image: {
                  ...provider.parameters?.image,
                  max_references: Number(event.target.value),
                },
              },
            })
          }
        />
        <small>按当前图片模型能力设置，最多 10 张；图片会由服务端安全上传或编码后发送。</small>
      </label>
    </>
  );
}
