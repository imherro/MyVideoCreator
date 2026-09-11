import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ImagePlus,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  Unlink,
} from "lucide-react";
import { ModelSelector } from "../ModelSelector.tsx";
import type { GenerationPolicy } from "../generationPolicy.ts";
import type {
  VisualAttribute,
  VisualBible,
  VisualGenerationOverride,
  VisualVersionStatus,
} from "./types.ts";
import { visualKindLabels, visualStatusLabels } from "./types.ts";
import {
  isVersionBound,
  isVisualBindingActionDisabled,
} from "./commands.ts";
import {
  primaryReference,
  resolveVisualGenerationTarget,
} from "./references.ts";

type VersionDraft = {
  description: string;
  attributes: VisualAttribute[];
  invariants: string[];
};

export function FilmBiblePanel({
  visual,
  shots,
  focusVersionId,
  onFocusVersion,
  onRenameCard,
  onSaveVersion,
  onStatus,
  onSetImageOverride,
  onUploadReference,
  onGenerateReference,
  onLock,
  onBind,
  onUnbind,
  onLocate,
  assets,
  jobs,
  generationPolicy,
  providers,
  localModels,
  request,
}: {
  visual: VisualBible;
  shots: Array<Record<string, any>>;
  focusVersionId?: string;
  onFocusVersion: (versionId: string) => void;
  onRenameCard: (cardId: string, name: string) => void;
  onSaveVersion: (versionId: string, draft: VersionDraft) => void;
  onStatus: (versionId: string, status: VisualVersionStatus) => void;
  onSetImageOverride: (
    cardId: string,
    override: VisualGenerationOverride,
  ) => void;
  onUploadReference: (versionId: string, file: File) => Promise<void>;
  onGenerateReference: (versionId: string, allowCloud: boolean) => Promise<void>;
  onLock: (versionId: string) => void;
  onBind: (shotUid: string, versionId: string) => void;
  onUnbind: (shotUid: string, versionId: string) => void;
  onLocate: (versionId: string) => void;
  assets: Array<Record<string, any>>;
  jobs: Array<Record<string, any>>;
  generationPolicy: GenerationPolicy | undefined;
  providers: Array<Record<string, any>>;
  localModels: Array<Record<string, any>>;
  request: (path: string) => Promise<any>;
}) {
  const versions = useMemo(
    () =>
      Object.values(visual.versions).sort((left, right) => {
        const leftCard = visual.cards[left.cardId];
        const rightCard = visual.cards[right.cardId];
        return `${leftCard?.kind}:${leftCard?.name}:${left.version}`.localeCompare(
          `${rightCard?.kind}:${rightCard?.name}:${right.version}`,
        );
      }),
    [visual],
  );
  const [selectedId, setSelectedId] = useState(
    focusVersionId || versions[0]?.id || "",
  );
  const [shotUid, setShotUid] = useState(
    String(shots[0]?.uid || shots[0]?.id || ""),
  );
  const selected = visual.versions[selectedId] || versions[0];
  const card = selected ? visual.cards[selected.cardId] : undefined;
  const shot = shots.find(
    (item) => String(item.uid || item.id || "") === shotUid,
  );
  const [name, setName] = useState(card?.name || "");
  const [draft, setDraft] = useState<VersionDraft>({
    description: selected?.spec.description || "",
    attributes: selected?.spec.attributes || [],
    invariants: selected?.invariants || [],
  });
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [allowCloud, setAllowCloud] = useState(false);
  useEffect(() => {
    if (focusVersionId && visual.versions[focusVersionId])
      setSelectedId(focusVersionId);
  }, [focusVersionId, visual.versions]);
  useEffect(() => {
    if (!selected || !card) return;
    setName(card.name);
    setDraft({
      description: selected.spec.description,
      attributes: selected.spec.attributes.map((item) => ({ ...item })),
      invariants: [...selected.invariants],
    });
  }, [selected?.id, selected?.spec, selected?.invariants, card?.name]);
  useEffect(() => {
    if (!shotUid && shots[0]) setShotUid(String(shots[0].uid || shots[0].id));
  }, [shotUid, shots]);
  useEffect(() => {
    setReferenceError("");
    setAllowCloud(false);
  }, [selected?.id]);
  if (!versions.length)
    return (
      <div className="empty-state film-bible-empty">
        <LockKeyhole />
        <h3>还没有视觉圣经</h3>
        <p>从分镜规划节点生成并导入分镜后，角色、场景和道具会显示在这里。</p>
      </div>
    );
  if (!selected || !card) return null;
  const editable = ["draft", "pending_reference"].includes(selected.status);
  const bound = isVersionBound(shot, selected.id);
  const bindingActionDisabled = isVisualBindingActionDisabled(
    selected.status,
    card.status,
    bound,
  );
  const reference = primaryReference(selected);
  const referenceAsset = assets.find((item) => item.id === reference?.assetId);
  const generationRecord = selected.provenance?.referenceGeneration as
    | Record<string, any>
    | undefined;
  const referenceJob = jobs.find(
    (item) => item.id === generationRecord?.jobId,
  );
  const generationRunning = ["queued", "running"].includes(
    referenceJob?.status || "",
  );
  let resolvedTarget: ReturnType<typeof resolveVisualGenerationTarget> | undefined;
  let targetError = "";
  try {
    resolvedTarget = resolveVisualGenerationTarget(
      card,
      generationPolicy,
      providers,
      localModels,
    );
  } catch (reason: any) {
    targetError = reason?.message || String(reason);
  }
  const targetProvider = providers.find(
    (item) => item.id === resolvedTarget?.providerId,
  );
  const cloudTarget = Boolean(targetProvider && !targetProvider.local);
  const override = card.generation?.image;
  const perform = async (action: () => Promise<void>) => {
    setReferenceBusy(true);
    setReferenceError("");
    try {
      await action();
    } catch (reason: any) {
      setReferenceError(reason?.message || String(reason));
    } finally {
      setReferenceBusy(false);
    }
  };
  const selectVersion = (versionId: string) => {
    setSelectedId(versionId);
    onFocusVersion(versionId);
  };
  return (
    <div className="film-bible-panel">
      <div className="film-bible-list" role="list" aria-label="视觉版本">
        {versions.map((version) => {
          const item = visual.cards[version.cardId];
          return (
            <button
              key={version.id}
              className={version.id === selected.id ? "active" : ""}
              onClick={() => selectVersion(version.id)}
            >
              <span>{visualKindLabels[item.kind]}</span>
              <b>{item.name}</b>
              <small>V{version.version} · {visualStatusLabels[version.status]}</small>
            </button>
          );
        })}
      </div>
      <div className="film-bible-editor">
        <div className="film-bible-toolbar">
          <span className={`visual-status ${selected.status}`}>
            {visualStatusLabels[selected.status]}
          </span>
          <button className="quiet" onClick={() => onLocate(selected.id)}>
            画布定位 <ArrowUpRight size={13} />
          </button>
        </div>
        <label>
          资产卡名称
          <input
            value={name}
            disabled={!editable}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name.trim() && name.trim() !== card.name && onRenameCard(card.id, name)}
          />
        </label>
        <label>
          可见外观描述
          <textarea
            value={draft.description}
            disabled={!editable}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <div className="film-bible-section-title">
          <b>结构化属性</b><small>只保存长期外观特征</small>
        </div>
        {draft.attributes.map((attribute, index) => (
          <div className="film-bible-attribute" key={index}>
            <input
              aria-label={`属性 ${index + 1} 名称`}
              value={attribute.name}
              disabled={!editable}
              onChange={(event) => setDraft({
                ...draft,
                attributes: draft.attributes.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, name: event.target.value } : item,
                ),
              })}
            />
            <input
              aria-label={`属性 ${index + 1} 内容`}
              value={attribute.value}
              disabled={!editable}
              onChange={(event) => setDraft({
                ...draft,
                attributes: draft.attributes.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, value: event.target.value } : item,
                ),
              })}
            />
            {editable && (
              <button
                className="icon-button"
                aria-label={`删除属性 ${index + 1}`}
                onClick={() => setDraft({
                  ...draft,
                  attributes: draft.attributes.filter((_, itemIndex) => itemIndex !== index),
                })}
              >×</button>
            )}
          </div>
        ))}
        {editable && (
          <button
            className="quiet"
            onClick={() => setDraft({
              ...draft,
              attributes: [...draft.attributes, { name: "", value: "" }],
            })}
          >+ 添加属性</button>
        )}
        <label>
          不可改变项（每行一项）
          <textarea
            value={draft.invariants.join("\n")}
            disabled={!editable}
            onChange={(event) => setDraft({
              ...draft,
              invariants: event.target.value.split("\n"),
            })}
          />
        </label>
        {editable && (
          <div className="film-bible-actions">
            <button className="primary" onClick={() => onSaveVersion(selected.id, draft)}>
              保存版本文字
            </button>
            {selected.status === "pending_reference" && (
              <button onClick={() => onStatus(selected.id, "draft")}>
                恢复草稿
              </button>
            )}
            <button className="danger-button" onClick={() => onStatus(selected.id, "deprecated")}>弃用版本</button>
          </div>
        )}
        {!editable && (
          <p className="muted">
            {selected.status === "locked"
              ? "已锁定版本只读；当前仍可用于分镜绑定或保留为历史。"
              : "已弃用版本保留历史，但不能编辑或建立新绑定。"}
          </p>
        )}
        <hr />
        <h3>主参考图</h3>
        <div className="reference-policy">
          <label>
            图片模型策略
            <select
              value={override?.mode === "override" ? "override" : "inherit"}
              disabled={!editable}
              onChange={(event) => {
                if (event.target.value === "inherit") {
                  onSetImageOverride(card.id, { mode: "inherit" });
                  return;
                }
                const fallback =
                  resolvedTarget ||
                  (() => {
                    const provider = providers.find(
                      (item) => !item.kind || item.kind === "image",
                    );
                    return {
                      providerId: provider?.id || "",
                      modelId:
                        provider?.models?.image || provider?.model || "",
                    };
                  })();
                onSetImageOverride(card.id, {
                  mode: "override",
                  providerId: fallback.providerId,
                  modelId: fallback.modelId,
                });
              }}
            >
              <option value="inherit">继承项目默认</option>
              <option value="override">此资产自定义</option>
            </select>
          </label>
          {override?.mode === "override" && editable && (
            <ModelSelector
              data={{
                kind: "image",
                provider: override.providerId,
                model: override.modelId,
              }}
              providers={providers}
              localModels={localModels}
              request={request}
              onChange={(patch) =>
                onSetImageOverride(card.id, {
                  mode: "override",
                  providerId: String(patch.provider || override.providerId),
                  modelId: String(patch.model ?? override.modelId),
                })
              }
            />
          )}
          {override?.mode === "override" && !editable && (
            <p className="muted">
              已锁定自定义：{targetProvider?.name || override.providerId} · {override.modelId || "服务默认模型"}
            </p>
          )}
          {override?.mode !== "override" && resolvedTarget && (
            <p className="muted">
              当前继承：{targetProvider?.name || resolvedTarget.providerId} · {resolvedTarget.modelId || "服务默认模型"}
            </p>
          )}
          {targetError && <p className="error">{targetError}</p>}
        </div>
        {reference ? (
          <div className="primary-reference">
            {referenceAsset ? (
              <img src={referenceAsset.url} alt={`${card.name} 主参考图`} />
            ) : (
              <div className="missing-reference">参考素材暂未加载：{reference.assetId}</div>
            )}
            <div>
              <b>{reference.source === "generated" ? "模型生成" : "本地上传"}</b>
              <small>{referenceAsset?.name || reference.assetId}</small>
              {reference.provenance.providerId && (
                <small>
                  {reference.provenance.providerId} · {reference.provenance.modelId}
                </small>
              )}
            </div>
          </div>
        ) : (
          <p className="muted">尚未设置主参考图。提取剧本和分镜不会自动调用图片模型。</p>
        )}
        {editable && (
          <div className="reference-actions">
            <label className="upload-reference-button">
              <ImagePlus size={15} /> 上传主参考图
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={referenceBusy || generationRunning}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void perform(() => onUploadReference(selected.id, file));
                }}
              />
            </label>
            <button
              className="primary"
              disabled={
                referenceBusy ||
                generationRunning ||
                Boolean(targetError) ||
                !resolvedTarget?.providerId ||
                !resolvedTarget?.modelId ||
                (cloudTarget && !allowCloud)
              }
              onClick={() =>
                void perform(() =>
                  onGenerateReference(selected.id, allowCloud),
                )
              }
            >
              {referenceBusy || generationRunning ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              {reference ? "重新生成参考图" : "生成主参考图"}
            </button>
          </div>
        )}
        {editable && cloudTarget && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={allowCloud}
              onChange={(event) => setAllowCloud(event.target.checked)}
            />
            允许本次使用云端图片模型，按供应商计费
          </label>
        )}
        {referenceJob?.status === "failed" && (
          <p className="error">参考图生成失败：{referenceJob.error}</p>
        )}
        {referenceError && <p className="error">{referenceError}</p>}
        {selected.status === "pending_reference" && reference && (
          <button
            className="primary full lock-reference"
            onClick={() => onLock(selected.id)}
          >
            <LockKeyhole size={15} /> 确认此图并锁定版本
          </button>
        )}
        {selected.status === "locked" && (
          <p className="locked-reference-note">
            <LockKeyhole size={14} /> 此参考图已确认锁定，可安全用于后续分镜一致性约束。
          </p>
        )}
        <hr />
        <h3>分镜绑定</h3>
        {!shots.length ? (
          <p className="muted">导入分镜后可以建立视觉绑定。</p>
        ) : (
          <>
            <label>
              目标分镜
              <select value={shotUid} onChange={(event) => setShotUid(event.target.value)}>
                {shots.map((item, index) => (
                  <option key={String(item.uid || item.id)} value={String(item.uid || item.id)}>
                    {String(index + 1).padStart(2, "0")} · {item.scene || item.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={bound ? "secondary full" : "primary full"}
              disabled={bindingActionDisabled}
              onClick={() => bound ? onUnbind(shotUid, selected.id) : onBind(shotUid, selected.id)}
            >
              {bound ? <Unlink size={15} /> : <Link2 size={15} />}
              {bound ? "解除当前绑定" : "绑定到这个分镜"}
            </button>
            <small>绑定会自动投影为视觉资产到分镜图的受管连线。</small>
          </>
        )}
      </div>
    </div>
  );
}
