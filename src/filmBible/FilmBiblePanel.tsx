import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Link2, LockKeyhole, Unlink } from "lucide-react";
import type { VisualAttribute, VisualBible, VisualVersionStatus } from "./types.ts";
import { visualKindLabels, visualStatusLabels } from "./types.ts";
import { isVersionBound } from "./commands.ts";

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
  onBind,
  onUnbind,
  onLocate,
}: {
  visual: VisualBible;
  shots: Array<Record<string, any>>;
  focusVersionId?: string;
  onFocusVersion: (versionId: string) => void;
  onRenameCard: (cardId: string, name: string) => void;
  onSaveVersion: (versionId: string, draft: VersionDraft) => void;
  onStatus: (versionId: string, status: VisualVersionStatus) => void;
  onBind: (shotUid: string, versionId: string) => void;
  onUnbind: (shotUid: string, versionId: string) => void;
  onLocate: (versionId: string) => void;
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
            <button
              onClick={() => onStatus(
                selected.id,
                selected.status === "draft" ? "pending_reference" : "draft",
              )}
            >
              {selected.status === "draft" ? "标记待参考图" : "恢复草稿"}
            </button>
            <button className="danger-button" onClick={() => onStatus(selected.id, "deprecated")}>弃用版本</button>
          </div>
        )}
        {!editable && (
          <p className="muted">
            {selected.status === "locked"
              ? "已锁定版本只读；Phase 3 将提供参考图和锁定流程。"
              : "已弃用版本保留历史，但不能编辑或建立新绑定。"}
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
              disabled={selected.status === "deprecated"}
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

