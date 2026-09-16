import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ImagePlus,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  Trash2,
  Unlink,
  Volume2,
} from "lucide-react";
import { ModelSelector } from "../ModelSelector.tsx";
import type { GenerationPolicy } from "../generationPolicy.ts";
import { effectiveProjectTargets, type ProjectModelPool } from "../modelAccess.ts";
import type {
  VisualAttribute,
  VisualBible,
  VisualGenerationOverride,
  VisualVersionStatus,
  VoiceProfile,
} from "./types.ts";
import { defaultVoiceProfile } from "./voices.ts";
import { catalogVoice, CUSTOM_VOICE_ID, DOUBAO_TTS2_VOICES } from "./voiceCatalog.ts";
import { projectCharacterDialogueRows } from "./dialogueAssets.ts";
import { visualKindLabels, visualStatusLabels } from "./types.ts";
import {
  isVersionBound,
  isVisualBindingActionDisabled,
} from "./commands.ts";
import {
  primaryReference,
  resolveVisualGenerationTarget,
} from "./references.ts";
import { discoverImpactedShots } from "./versioning.ts";

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
  onDeleteCard,
  onSaveVersion,
  onStatus,
  onRestoreVersion,
  onSetImageOverride,
  onUploadReference,
  onGenerateReference,
  onLock,
  onFork,
  onUpgrade,
  onBind,
  onUnbind,
  onLocate,
  onPreviewAsset,
  assets,
  jobs,
  generationPolicy,
  modelPool,
  providers,
  localModels,
  request,
  voiceProfiles,
  onSaveVoice,
  onGenerateVoice,
  onLockVoice,
  onGenerateCharacterDialogue,
  onRegenerateDialogue,
  compactSingleSelection = false,
}: {
  visual: VisualBible;
  shots: Array<Record<string, any>>;
  focusVersionId?: string;
  onFocusVersion: (versionId: string) => void;
  onRenameCard: (cardId: string, name: string) => void;
  onDeleteCard: (cardId: string) => void;
  onSaveVersion: (versionId: string, draft: VersionDraft) => void;
  onStatus: (versionId: string, status: VisualVersionStatus) => void;
  onRestoreVersion: (versionId: string) => Promise<void>;
  onSetImageOverride: (
    cardId: string,
    override: VisualGenerationOverride,
  ) => void;
  onUploadReference: (versionId: string, file: File) => Promise<void>;
  onGenerateReference: (versionId: string) => Promise<void>;
  onLock: (versionId: string) => void;
  onFork: (versionId: string, draft: VersionDraft) => void;
  onUpgrade: (
    cardId: string,
    targetVersionId: string,
    scope: { shotUids: string[] } | { scene: string } | { sequence: string },
  ) => void;
  onBind: (shotUid: string, versionId: string) => void;
  onUnbind: (shotUid: string, versionId: string) => void;
  onLocate: (versionId: string) => void;
  onPreviewAsset: (asset: Record<string, any>) => void;
  assets: Array<Record<string, any>>;
  jobs: Array<Record<string, any>>;
  generationPolicy: GenerationPolicy | undefined;
  modelPool?: ProjectModelPool;
  providers: Array<Record<string, any>>;
  localModels: Array<Record<string, any>>;
  request: (path: string) => Promise<any>;
  voiceProfiles: Record<string, VoiceProfile>;
  onSaveVoice: (cardId: string, profile: VoiceProfile) => void;
  onGenerateVoice: (cardId: string, profile: VoiceProfile) => Promise<void>;
  onLockVoice: (cardId: string, locked: boolean) => void;
  onGenerateCharacterDialogue: (cardId: string) => Promise<number>;
  onRegenerateDialogue: (cardId: string, dialogueId: string) => Promise<void>;
  compactSingleSelection?: boolean;
}) {
  const allVersions = useMemo(
    () =>
      Object.values(visual.versions).filter(
        (version) => !visual.cards[version.cardId]?.deletedAt,
      ).sort((left, right) => {
        const leftCard = visual.cards[left.cardId];
        const rightCard = visual.cards[right.cardId];
        return `${leftCard?.kind}:${leftCard?.name}:${left.version}`.localeCompare(
          `${rightCard?.kind}:${rightCard?.name}:${right.version}`,
        );
      }),
    [visual],
  );
  const [selectedId, setSelectedId] = useState(
    focusVersionId || allVersions[0]?.id || "",
  );
  const activeCardId = visual.versions[focusVersionId || selectedId]?.cardId || allVersions[0]?.cardId;
  const versions = useMemo(
    () => compactSingleSelection
      ? allVersions.filter((version) => version.cardId === activeCardId)
      : allVersions,
    [activeCardId, allVersions, compactSingleSelection],
  );
  const [shotUid, setShotUid] = useState(
    String(shots[0]?.uid || shots[0]?.id || ""),
  );
  const selected = versions.find((version) => version.id === selectedId) || versions[0];
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
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const allowedAudioProviders = new Set(effectiveProjectTargets(modelPool, providers, "audio", localModels).map((target) => target.providerId));
  const speechProviders = providers.filter((item) => item.type === "volcengine_speech" && allowedAudioProviders.has(item.id));
  const storedVoice = card ? voiceProfiles[card.id] : undefined;
  const [voiceDraft, setVoiceDraft] = useState<VoiceProfile>(() =>
    defaultVoiceProfile("", speechProviders[0]?.id || ""),
  );
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(true);
  const [bindingOpen, setBindingOpen] = useState(false);
  const dialogueRows = useMemo(
    () => projectCharacterDialogueRows({
      shots,
      assets,
      jobs,
      cardId: card?.id || "",
      voiceVersion: storedVoice?.version,
    }),
    [shots, assets, jobs, card?.id, storedVoice?.version],
  );
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
  }, [selected?.id]);
  useEffect(() => {
    if (!card) return;
    setVoiceDraft(storedVoice || defaultVoiceProfile(card.id, speechProviders[0]?.id || ""));
    setVoiceError("");
  }, [card?.id, storedVoice, speechProviders[0]?.id]);
  useEffect(() => {
    setVoiceOpen(false);
    setReferenceOpen(true);
    setBindingOpen(false);
  }, [card?.id]);
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
  const currentVersion = visual.versions[card.currentVersionId];
  const impacted = discoverImpactedShots(
    { filmBible: { visual }, shots, nodes: [], edges: [] },
    card.id,
  );
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
  const parentVersion = selected.parentVersionId ? visual.versions[selected.parentVersionId] : undefined;
  const stateReferenceBlocked = ["character_state", "scene_state"].includes(card.kind) && (
    parentVersion?.status !== "locked" || !primaryReference(parentVersion)
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
      {!compactSingleSelection && <div className="film-bible-list" role="list" aria-label="视觉版本">
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
      </div>}
      <div className={`film-bible-editor ${compactSingleSelection ? "compact" : ""}`}>
        <div className="film-bible-toolbar">
          <span className={`visual-status ${selected.status}`}>
            {visualStatusLabels[selected.status]}
          </span>
          <button className="quiet" onClick={() => onLocate(selected.id)}>
            画布定位 <ArrowUpRight size={13} />
          </button>
          <button className="quiet danger" onClick={() => onDeleteCard(card.id)}>
            <Trash2 size={13} /> 移至回收站
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
          <>
            {selected.status === "deprecated" && <>
              <button className="secondary" disabled={restoreBusy} onClick={async () => {
                setRestoreBusy(true); setRestoreError("");
                try { await onRestoreVersion(selected.id); }
                catch (error) { setRestoreError(error instanceof Error ? error.message : String(error)); }
                finally { setRestoreBusy(false); }
              }}>{restoreBusy ? "正在恢复…" : "恢复弃用前状态"}</button>
              {restoreError && <p className="warning-text">{restoreError}</p>}
            </>}
            <p className="muted">
              {selected.status === "locked"
                ? "已锁定版本只读；修改会派生新版本，旧版本和旧分镜绑定继续保留。"
                : "已弃用版本保留历史，但不能编辑或建立新绑定。"}
            </p>
            {selected.status === "locked" && (
              <>
                <button className="secondary full" onClick={() => onFork(selected.id, draft)}>
                  创建新版本
                </button>
                <button className="danger-button full" onClick={() => onStatus(selected.id, "deprecated")}>
                  弃用此版本（保留分镜引用）
                </button>
              </>
            )}
          </>
        )}
        {card.kind === "character" && <>
          <button type="button" className="film-bible-section-toggle" aria-expanded={voiceOpen} onClick={() => setVoiceOpen((value) => !value)}>
            <span><Volume2 size={15}/><b>角色固定声音</b><small>{storedVoice ? `V${storedVoice.version} · ${storedVoice.status === "locked" ? "已锁定" : "草稿"}` : "未设置"}</small></span>
            <span>{voiceOpen ? "收起" : "设置声音"}</span>
          </button>
          {voiceOpen && <div className="film-bible-collapsible-body">
          {!speechProviders.length ? <p className="warning-text">尚未配置豆包语音。请到“设置 → 模型服务”添加豆包语音并填写独立 Speech API Key。</p> : <>
            <label>语音服务<select value={voiceDraft.providerId} disabled={voiceDraft.status === "locked"} onChange={(event)=>setVoiceDraft({...voiceDraft,providerId:event.target.value})}>{speechProviders.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>预置音色<select value={catalogVoice(voiceDraft.voiceType)?.id || CUSTOM_VOICE_ID} disabled={voiceDraft.status === "locked"} onChange={(event)=>setVoiceDraft({...voiceDraft,voiceType:event.target.value === CUSTOM_VOICE_ID ? "" : event.target.value})}>{[...new Set(DOUBAO_TTS2_VOICES.map((item)=>item.category))].map((category)=><optgroup key={category} label={category}>{DOUBAO_TTS2_VOICES.filter((item)=>item.category===category).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}<option value={CUSTOM_VOICE_ID}>自定义 / 声音复刻 ID…</option></select></label>
            {!catalogVoice(voiceDraft.voiceType) && <label>自定义 Speaker ID<input value={voiceDraft.voiceType} disabled={voiceDraft.status === "locked"} placeholder="粘贴声音复刻或音色设计返回的 ID" onChange={(event)=>setVoiceDraft({...voiceDraft,voiceType:event.target.value})}/><small>声音复刻训练完成后，把控制台返回的 Speaker ID 粘贴到这里。</small></label>}
            {catalogVoice(voiceDraft.voiceType) && <p className="muted">Speaker ID：{voiceDraft.voiceType}</p>}
            <label>试听台词<textarea value={voiceDraft.previewText} disabled={voiceDraft.status === "locked"} onChange={(event)=>setVoiceDraft({...voiceDraft,previewText:event.target.value})}/></label>
            <div className="two-fields">
              <label>语速<select value={voiceDraft.parameters.speechRate} disabled={voiceDraft.status === "locked"} onChange={(event)=>setVoiceDraft({...voiceDraft,parameters:{...voiceDraft.parameters,speechRate:Number(event.target.value)}})}><option value={-25}>较慢</option><option value={0}>正常</option><option value={25}>较快</option></select></label>
              <label>情绪<input value={voiceDraft.parameters.emotion} disabled={voiceDraft.status === "locked"} placeholder="留空自动演绎" onChange={(event)=>setVoiceDraft({...voiceDraft,parameters:{...voiceDraft.parameters,emotion:event.target.value}})}/></label>
            </div>
            <div className="film-bible-actions">
              {voiceDraft.status !== "locked" && <button onClick={()=>onSaveVoice(card.id,voiceDraft)}>保存声音设定</button>}
              {voiceDraft.status !== "locked" && <button className="primary" disabled={voiceBusy} onClick={()=>{setVoiceBusy(true);setVoiceError("");void onGenerateVoice(card.id,voiceDraft).catch((reason)=>setVoiceError(reason?.message||String(reason))).finally(()=>setVoiceBusy(false));}}>{voiceBusy?<LoaderCircle className="spin" size={14}/>:<Volume2 size={14}/>}生成试听</button>}
              {storedVoice?.previewAssetId && <button className="secondary" onClick={()=>{const asset=assets.find((item)=>item.id===storedVoice.previewAssetId);if(asset)onPreviewAsset(asset);}}>试听声音</button>}
              {storedVoice?.status === "locked" ? <button onClick={()=>onLockVoice(card.id,false)}>创建新声音版本</button> : storedVoice?.previewAssetId ? <button onClick={()=>onLockVoice(card.id,true)}>锁定为角色声音参考 V{storedVoice.version}</button> : null}
              {storedVoice?.status === 'locked' && !storedVoice.referenceAssetId && storedVoice.previewAssetId && <button onClick={()=>onLockVoice(card.id,true)}>将试听确认为角色声音参考</button>}
              {storedVoice?.referenceAssetId && <button onClick={()=>{const asset=assets.find(item=>item.id===storedVoice.referenceAssetId);if(asset)onPreviewAsset(asset);}}>试听已确认声音参考</button>}
              {storedVoice?.status === "locked" && <button className="primary" disabled={voiceBusy} onClick={()=>{setVoiceBusy(true);setVoiceError("");void onGenerateCharacterDialogue(card.id).catch((reason)=>setVoiceError(reason?.message||String(reason))).finally(()=>setVoiceBusy(false));}}><Volume2 size={14}/>生成本集全部对白</button>}
            </div>
            <p className="muted">{storedVoice ? `声音 V${storedVoice.version} · ${storedVoice.status === "locked" ? "已锁定" : "草稿"}` : "保存并试听后可锁定为角色主音色。"}</p>
            <p className="muted">音色样本参考模式下，无需生成本集全部对白。建议每个角色用 3–6 秒清晰、自然的样本；本镜情绪由分镜决定。完整对白参考模式仍需先合成对白。</p>
            <div className="voice-dialogue-heading">
              <b>本集对白</b>
              <small>{dialogueRows.length ? `${dialogueRows.filter((item)=>item.status==="ready").length}/${dialogueRows.length} 已生成` : "分镜中暂无该角色对白"}</small>
            </div>
            {dialogueRows.length > 0 && <div className="voice-dialogue-list">{dialogueRows.map((row)=>{
              const statusLabel = {missing:"未生成",queued:"排队中",running:"生成中",failed:"生成失败",interrupted:"待恢复",syncing:"正在同步",ready:"已生成"}[row.status];
              return <div className="voice-dialogue-row" key={row.id}>
                <div className="voice-dialogue-copy">
                  <div><b>第 {row.shotOrder} 镜</b>{row.emotion && <small>{row.emotion}</small>}</div>
                  <p title={row.text}>{row.text}</p>
                  {row.status === "failed" && row.job?.error && <small className="error" title={row.job.error}>{row.job.error}</small>}
                </div>
                <div className="voice-dialogue-state">
                  <span className={`voice-state ${row.status}`}>{statusLabel}</span>
                  {row.asset && <button className="secondary" onClick={()=>onPreviewAsset(row.asset!)}><Volume2 size={13}/>试听</button>}
                  {!(["queued","running","syncing"] as string[]).includes(row.status) && <button disabled={voiceBusy} onClick={()=>{setVoiceBusy(true);setVoiceError("");void onRegenerateDialogue(card.id,row.id).catch((reason)=>setVoiceError(reason?.message||String(reason))).finally(()=>setVoiceBusy(false));}}>{row.status === "ready" ? "重新生成" : "生成"}</button>}
                </div>
              </div>;
            })}</div>}
            {voiceError && <p className="error">{voiceError}</p>}
          </>}
          </div>}
        </>}
        <button type="button" className="film-bible-section-toggle" aria-expanded={referenceOpen} onClick={() => setReferenceOpen((value) => !value)}>
          <span><ImagePlus size={15}/><b>主参考图</b><small>{reference ? selected.status === "locked" ? "已锁定" : "待确认" : "未生成"}</small></span>
          <span>{referenceOpen ? "收起" : "展开"}</span>
        </button>
        {referenceOpen && <div className="film-bible-collapsible-body">
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
              allowedTargets={effectiveProjectTargets(modelPool, providers, "image", localModels)}
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
              <button
                type="button"
                className="primary-reference-preview"
                onClick={() => onPreviewAsset(referenceAsset)}
                aria-label={`放大预览${card.name}主参考图`}
                title="点击放大预览"
              >
                <img src={referenceAsset.url} alt={`${card.name} 主参考图`} />
                <span>点击放大</span>
              </button>
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
                stateReferenceBlocked ||
                Boolean(targetError) ||
                !resolvedTarget?.providerId ||
                !resolvedTarget?.modelId
              }
              onClick={() =>
                void perform(() =>
                  onGenerateReference(selected.id),
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
            {stateReferenceBlocked && <small>请先生成并锁定基础角色或场景的主参考图。</small>}
          </div>
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
        </div>}
        <button type="button" className="film-bible-section-toggle" aria-expanded={bindingOpen} onClick={() => setBindingOpen((value) => !value)}>
          <span><Link2 size={15}/><b>分镜绑定</b><small>{impacted.length ? `${impacted.length} 镜待升级` : shots.length ? `${shots.length} 个分镜可管理` : "暂无分镜"}</small></span>
          <span>{bindingOpen ? "收起" : "管理绑定"}</span>
        </button>
        {bindingOpen && <div className="film-bible-collapsible-body">
        {selected.id === card.currentVersionId && currentVersion?.status === "locked" && impacted.length > 0 && (
          <div className="version-impact">
            <b>{impacted.length} 个分镜仍使用旧版本</b>
            <small>升级只改变明确选择的分镜；旧画面会保留并标记为待更新。</small>
            {impacted.slice(0, 8).map((item) => (
              <div className="version-impact-row" key={`${item.shotUid}:${item.fromVersionId}`}>
                <span>{item.shotId} · {item.scene || "未命名场景"} · V{visual.versions[item.fromVersionId]?.version}</span>
                <button onClick={() => onUpgrade(card.id, selected.id, { shotUids: [item.shotUid] })}>
                  升级此镜头
                </button>
              </div>
            ))}
            {shot?.scene && impacted.some((item) => item.scene === String(shot.scene)) && (
              <button className="quiet full" onClick={() => onUpgrade(card.id, selected.id, { scene: String(shot.scene) })}>
                升级场景“{String(shot.scene)}”内受影响镜头
              </button>
            )}
            {(shot?.sequence || shot?.sequenceId) && (
              <button className="quiet full" onClick={() => onUpgrade(card.id, selected.id, { sequence: String(shot.sequence || shot.sequenceId) })}>
                升级当前段落内受影响镜头
              </button>
            )}
          </div>
        )}
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
        </div>}
      </div>
    </div>
  );
}
