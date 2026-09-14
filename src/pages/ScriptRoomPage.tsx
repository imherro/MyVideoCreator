import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Save, Sparkles } from "lucide-react";
import { STATUS_LABELS, normalizeEpisodeSelection, splitList } from "../adaptation";

type Value = Record<string, any>;

export function ScriptRoomPage({
  productionId, currentEpisodeNo, providers, defaultTarget, request, notify, report, onChanged, onSelectEpisode,
}: {
  productionId: string; currentEpisodeNo: number; providers: Value[]; defaultTarget?: Value;
  request: (path: string, options?: RequestInit) => Promise<any>;
  notify: (message: string) => void; report: (error: unknown) => void;
  onChanged: (projectId?: string) => void | Promise<void>;
  onSelectEpisode: (episodeNo: number) => void | Promise<void>;
}) {
  const [items, setItems] = useState<Value[]>([]);
  const [chapters, setChapters] = useState<Value[]>([]);
  const [active, setActive] = useState(currentEpisodeNo);
  const [draft, setDraft] = useState<Value | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const textProviders = useMemo(
    () => [{ id: "local", name: "本地 llama.cpp", local: true, model: "" }, ...providers.filter((p) => !p.kind || p.kind === "text")],
    [providers],
  );
  const [providerId, setProviderId] = useState(defaultTarget?.providerId || "local");
  const [model, setModel] = useState(defaultTarget?.modelId || "");

  async function loadList(preferred = active) {
    const [scripts, sourceChapters] = await Promise.all([
      request(`/productions/${productionId}/scripts`),
      request(`/productions/${productionId}/chapters`),
    ]);
    setItems(scripts); setChapters(sourceChapters);
    const target = scripts.some((item: Value) => item.episodeNo === preferred) ? preferred : scripts[0]?.episodeNo || 1;
    setActive(target);
    setDraft(scripts.length ? await request(`/productions/${productionId}/episode-scripts/${target}`) : null);
  }
  async function selectEpisode(episodeNo: number) {
    setActive(episodeNo);
    setDraft(await request(`/productions/${productionId}/episode-scripts/${episodeNo}`));
  }
  useEffect(() => { setItems([]); setDraft(null); setSelected(new Set()); void loadList(currentEpisodeNo).catch(report); }, [productionId]);
  useEffect(() => {
    if (currentEpisodeNo !== active) void selectEpisode(currentEpisodeNo).catch(report);
  }, [currentEpisodeNo]);
  useEffect(() => {
    setProviderId(defaultTarget?.providerId || "local");
    setModel(defaultTarget?.modelId || "");
  }, [productionId, defaultTarget?.providerId, defaultTarget?.modelId]);
  function run(action: () => Promise<void>) {
    setBusy(true);
    void action().catch(report).finally(() => setBusy(false));
  }
  const item = items.find((value) => value.episodeNo === active);
  const plan = item?.plan;
  function patch(value: Value) { setDraft((current) => current && ({ ...current, ...value })); }

  async function save() {
    if (!draft) return;
    const value = await request(`/productions/${productionId}/episode-scripts/${active}`, {
      method: "PUT",
      body: JSON.stringify({
        revision: draft.revision, title: draft.title, synopsis: draft.synopsis, body: draft.body,
        estimatedDuration: Number(draft.estimatedDuration), sourceChapterRefs: draft.sourceChapterRefs,
        storyGoal: draft.storyGoal, paywallBeat: draft.paywallBeat || {}, characters: draft.characters,
        scenes: draft.scenes, props: draft.props,
      }),
    });
    setDraft(value); await onChanged(value.project_id); await loadList(active);
    notify(`EP${String(active).padStart(2, "0")} 剧本已保存为草稿`);
  }
  async function transition(action: "review" | "approve" | "needs-changes") {
    if (!draft) return;
    const value = await request(`/productions/${productionId}/episode-scripts/${active}/${action}`, { method: "POST", body: JSON.stringify({ revision: draft.revision }) });
    setDraft(value); await onChanged(value.project_id); await loadList(active);
    notify(action === "review" ? "本集剧本已提交审核" : action === "approve" ? "本集剧本已批准" : "本集剧本已退回修改");
  }
  async function generate(episodeNos: number[]) {
    const normalized = normalizeEpisodeSelection(episodeNos, items.length);
    if (!normalized.length) return;
    const provider = textProviders.find((value) => value.id === providerId);
    const modelId = model || provider?.models?.text || provider?.model || "";
    if (providerId !== "local" && !modelId) throw new Error("请填写文本模型 ID");
    if (!window.confirm(`将生成 ${normalized.length} 集剧本：${normalized.map((no) => `EP${String(no).padStart(2, "0")}`).join("、")}\n服务：${provider?.name || providerId}\n模型：${modelId || "本地默认"}\n确认创建 ${normalized.length} 个文本任务？`)) return;
    const result = await request(`/productions/${productionId}/script-generations`, {
      method: "POST",
      body: JSON.stringify({ episode_nos: normalized, provider: providerId, model: modelId, allow_cloud: providerId !== "local" && provider?.local !== true, submission_id: `scripts-${Date.now()}` }),
    });
    await onChanged(); await loadList(active);
    notify(`已创建 ${result.count} 个剧本任务，可在任务中心查看`);
  }

  return <section className="script-room-page workflow-domain-page">
    <header className="domain-header"><div><span className="eyebrow">SCRIPT ROOM</span><h1>剧本室</h1><p>逐集剧本是正式数据；高级画布中的剧本文本由这里投影，不会反向覆盖。</p></div><div className="settings-actions">
      <button disabled={busy} onClick={() => run(() => loadList(active))}><RefreshCw size={15} />刷新</button>
      <button disabled={busy || !draft} onClick={() => run(save)}><Save size={15} />保存草稿</button>
      <button disabled={busy || !draft} onClick={() => run(() => transition("review"))}>提交审核</button>
      <button className="primary" disabled={busy || draft?.status !== "review"} onClick={() => run(() => transition("approve"))}><Check size={15} />批准</button>
    </div></header>
    <div className="script-room-layout">
      <aside className="script-episode-list"><header><b>分集</b><small>勾选后批量生成</small></header>{items.map((value) => <div className={active === value.episodeNo ? "active" : ""} key={value.episodeNo}>
        <input type="checkbox" checked={selected.has(value.episodeNo)} onChange={(e) => setSelected((current) => { const next = new Set(current); e.target.checked ? next.add(value.episodeNo) : next.delete(value.episodeNo); return next; })} />
        <button onClick={() => run(async () => { await onSelectEpisode(value.episodeNo); await selectEpisode(value.episodeNo); })}><b>EP{String(value.episodeNo).padStart(2, "0")}</b><span>{value.episodeTitle}</span><small className={value.script?.status || value.plan.status}>{STATUS_LABELS[value.script?.status || value.plan.status]}</small></button>
      </div>)}</aside>
      <main>{draft && plan ? <>
        <div className="script-summary-strip"><span className={`workflow-status ${draft.status}`}>{STATUS_LABELS[draft.status]}</span><span>目标 {plan.targetDuration} 秒</span><span>{plan.paywallRole}</span><span>{draft.project_id ? "已建立 Episode" : "首次保存或生成时建立 Episode"}</span></div>
        <article className="domain-card"><div className="domain-fields">
          <label>标题<input value={draft.title} onChange={(e) => patch({ title: e.target.value })} /></label>
          <label>预计时长（秒）<input type="number" value={draft.estimatedDuration} onChange={(e) => patch({ estimatedDuration: Number(e.target.value) })} /></label>
          <label>本集概要<textarea value={draft.synopsis} onChange={(e) => patch({ synopsis: e.target.value })} /></label>
          <label>剧情目标<textarea value={draft.storyGoal} onChange={(e) => patch({ storyGoal: e.target.value })} /></label>
        </div><fieldset className="chapter-reference-field"><legend>原著来源</legend>{chapters.map((chapter) => <label className="check-label" key={chapter.id}><input type="checkbox" checked={draft.sourceChapterRefs.includes(chapter.id)} onChange={(e) => patch({ sourceChapterRefs: e.target.checked ? [...draft.sourceChapterRefs, chapter.id] : draft.sourceChapterRefs.filter((id: string) => id !== chapter.id) })} />{chapter.display_no ?? chapter.chapter_no}. {chapter.title}</label>)}</fieldset>
        <div className="plan-evidence"><div><b>开场钩子</b><p>{plan.hook || "未填写"}</p></div><div><b>结尾悬念</b><p>{plan.cliffhanger || "未填写"}</p></div><div><b>核心冲突</b><p>{plan.coreConflict || "未填写"}</p></div></div></article>
        <article className="domain-card script-body-card"><h2>剧本正文</h2><textarea value={draft.body} onChange={(e) => patch({ body: e.target.value })} placeholder="场景标题、可见动作和对白…" /></article>
        <article className="domain-card"><h2>制作清单</h2><div className="domain-fields three">
          <label>角色（逗号或换行）<textarea rows={3} value={draft.characters.join("、")} onChange={(e) => patch({ characters: splitList(e.target.value) })} /></label>
          <label>场景（逗号或换行）<textarea rows={3} value={draft.scenes.join("、")} onChange={(e) => patch({ scenes: splitList(e.target.value) })} /></label>
          <label>道具（逗号或换行）<textarea rows={3} value={draft.props.join("、")} onChange={(e) => patch({ props: splitList(e.target.value) })} /></label>
        </div></article><div className="script-state-actions"><button disabled={busy} onClick={() => run(() => transition("needs-changes"))}>退回修改</button><button disabled={busy} onClick={() => run(() => generate([active]))}><Sparkles size={15} />{draft.body ? "重新生成本集" : "生成本集"}</button></div>
      </> : <div className="empty-state"><h3>先完成分集规划</h3><p>改编策划批准后，可以在这里逐集生成和修订剧本。</p></div>}</main>
    </div>
    <footer className="domain-generation-bar"><div><b>批量生成所选剧本</b><small>已选 {selected.size} 集 · 只有已批准的改编策划可以执行</small></div><label>服务<select value={providerId} onChange={(e) => { setProviderId(e.target.value); const p = textProviders.find((x) => x.id === e.target.value); setModel(p?.models?.text || p?.model || ""); }}>{textProviders.map((value) => <option key={value.id} value={value.id}>{value.local ? "本地" : "云端"} · {value.name}</option>)}</select></label><label>模型<input value={model} placeholder="本地默认" onChange={(e) => setModel(e.target.value)} /></label><button className="primary" disabled={busy || !selected.size} onClick={() => run(() => generate([...selected]))}><Sparkles size={15} />生成 {selected.size} 集</button></footer>
  </section>;
}
