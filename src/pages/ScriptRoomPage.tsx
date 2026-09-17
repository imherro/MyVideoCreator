import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, RefreshCw, Save, Sparkles } from "lucide-react";
import { STATUS_LABELS, normalizeEpisodeSelection, scriptReady, splitList, episodePlanningReady } from "../adaptation";
import { activeScriptEpisodes, mergeTaskSnapshots } from "../taskCenter";
import {ScriptImportDialog} from '../components/ScriptImportDialog';
import {ImportResumeNotice} from '../components/ImportResumeNotice';

type Value = Record<string, any>;

export function ScriptRoomPage({
  productionId, projectId, onScriptsImported, currentEpisodeNo, onFocusEpisode, onAddEpisode, providers, defaultTarget, refreshKey = 0, jobs, onJobsSubmitted, request, notify, report, onChanged, onSelectEpisode, onEnterEpisode,
}: {
  onAddEpisode: () => void;
  projectId:string;onScriptsImported:(result:Value)=>Promise<void>;
  productionId: string; currentEpisodeNo: number; providers: Value[]; defaultTarget?: Value; refreshKey?: number;
  jobs: Value[]; onJobsSubmitted: (jobs: Value[]) => void;
  request: (path: string, options?: RequestInit) => Promise<any>;
  notify: (message: string) => void; report: (error: unknown) => void;
  onChanged: (projectId?: string) => void | Promise<void>;
  onFocusEpisode: (episodeNo: number) => void;
  onSelectEpisode: (episodeNo: number) => void | Promise<void>;
  onEnterEpisode: (episodeNo: number) => void | Promise<void>;
}) {
  const [items, setItems] = useState<Value[]>([]);
  const [chapters, setChapters] = useState<Value[]>([]);
  const [active, setActive] = useState(currentEpisodeNo);
  const [draft, setDraft] = useState<Value | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const importInput=useRef<HTMLInputElement>(null);
  const [importFilePreview,setImportFilePreview]=useState<File|null>(null);
  const [importResumeId,setImportResumeId]=useState<string|undefined>();
  const [submittedJobs, setSubmittedJobs] = useState<Value[]>([]);
  const unsavedDrafts = useRef(new Map<number, Value>());
  const loadedProduction = useRef<string | null>(null);
  const loadSequence = useRef(0);
  useEffect(() => () => { loadSequence.current += 1; }, []);
  const runningEpisodes = activeScriptEpisodes(mergeTaskSnapshots(submittedJobs, jobs), productionId);
  const activeGenerating = runningEpisodes.has(active);
  const selectedGenerating = [...selected].some((number) => runningEpisodes.has(number));
  const textProviders = useMemo(
    () => [{ id: "local", name: "本地 llama.cpp", local: true, model: "" }, ...providers.filter((p) => !p.kind || p.kind === "text")],
    [providers],
  );
  const fallbackTextProvider = textProviders.find((provider) => !provider.local) || textProviders[0];
  const defaultProviderId = defaultTarget?.providerId || fallbackTextProvider.id;
  const defaultModelId = defaultTarget?.modelId || fallbackTextProvider.models?.text || fallbackTextProvider.model || "";
  const configuredDefaultProvider = textProviders.find((provider) => provider.id === defaultProviderId) || fallbackTextProvider;

  async function loadList(preferred = active) {
    const sequence = ++loadSequence.current;
    const [scripts, sourceChapters] = await Promise.all([
      request(`/productions/${productionId}/scripts`),
      request(`/productions/${productionId}/chapters`),
    ]);
    if (sequence !== loadSequence.current) return;
    const target = scripts.some((item: Value) => item.episodeNo === preferred) ? preferred : scripts[0]?.episodeNo || 1;
    const nextDraft = scripts.length ? await request(`/productions/${productionId}/episode-scripts/${target}`) : null;
    if (sequence !== loadSequence.current) return;
    setItems(scripts); setChapters(sourceChapters);
    setActive(target);
    setDraft(unsavedDrafts.current.get(target) || nextDraft);
    if (scripts.length) onFocusEpisode(target);
  }
  async function selectEpisode(episodeNo: number) {
    const sequence = ++loadSequence.current;
    setActive(episodeNo);
    setDraft(null); setInstruction("");
    const nextDraft = await request(`/productions/${productionId}/episode-scripts/${episodeNo}`);
    if (sequence === loadSequence.current) setDraft(unsavedDrafts.current.get(episodeNo) || nextDraft);
  }
  useEffect(() => {
    const changed = loadedProduction.current !== productionId;
    loadedProduction.current = productionId;
    if (changed) { unsavedDrafts.current.clear(); setItems([]); setDraft(null); setSelected(new Set()); setSubmittedJobs([]); }
    void loadList(changed ? currentEpisodeNo : active).catch(report);
  }, [productionId, refreshKey]);
  useEffect(() => {
    if (currentEpisodeNo !== active) { setInstruction(""); void loadList(currentEpisodeNo).catch(report); }
  }, [currentEpisodeNo]);
  function run(action: () => Promise<void>) {
    setBusy(true);
    void action().catch(report).finally(() => setBusy(false));
  }
  const item = items.find((value) => value.episodeNo === active);
  const plan = item?.plan;
  const canAdapt = episodePlanningReady(plan);
  function patch(value: Value) { setDraft(current => { if (!current) return current; const next={...current,...value}; unsavedDrafts.current.set(active,next); return next; }); }

  async function save(showNotice = true) {
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
    unsavedDrafts.current.delete(active); setDraft(value); await onChanged(value.project_id); await loadList(active);
    if (showNotice) notify(`EP${String(active).padStart(2, "0")} 剧本已保存`);
    return value;
  }
  async function enterStoryboard() {
    const saved = await save(false);
    if (!scriptReady(saved)) throw new Error(saved?.status === "stale" ? "本集剧本需要更新，请先修订并保存" : "请先填写本集剧本正文");
    await onEnterEpisode(active);
  }
  async function generate(episodeNos: number[]) {
    const normalized = normalizeEpisodeSelection(episodeNos, Math.max(0,...items.map(item=>item.episodeNo)));
    if (!normalized.length) return;
    if (normalized.some((number) => runningEpisodes.has(number))) throw new Error("所选剧本已在排队或生成中，请等待完成后再生成");
    const provider = textProviders.find((value) => value.id === defaultProviderId) || fallbackTextProvider;
    const providerId = provider.id;
    const modelId = defaultModelId || provider?.models?.text || provider?.model || "";
    if (providerId !== "local" && !modelId) throw new Error("项目默认文本模型尚未配置，请到作品设置中选择");
    if (!window.confirm(`将使用项目默认模型生成 ${normalized.length} 集剧本：${normalized.map((no) => `EP${String(no).padStart(2, "0")}`).join("、")}\n服务：${provider?.name || providerId}\n模型：${modelId || "本地默认"}\n确认创建 ${normalized.length} 个文本任务？`)) return;
    const result = await request(`/productions/${productionId}/script-generations`, {
      method: "POST",
      body: JSON.stringify({ episode_nos: normalized, provider: providerId, model: modelId, submission_id: `scripts-${Date.now()}` }),
    });
    setSubmittedJobs((known) => mergeTaskSnapshots(known, result.jobs));
    onJobsSubmitted(result.jobs);
    await onChanged(); await loadList(active);
    notify(`已创建 ${result.count} 个剧本任务，可在任务中心查看`);
  }

  async function assist() {
    if (!instruction.trim()) throw new Error("请填写创作想法或修改要求");
    if (activeGenerating) return;
    if (!window.confirm(draft?.body?.trim() ? "AI 将根据要求修订本集剧本，原版本会保留。确认生成？" : "将使用项目默认文本模型生成本集剧本。确认创建任务？")) return;
    const saved = await save(false);
    if (!saved) return;
    const result = await request(`/productions/${productionId}/episode-scripts/${active}/assist`, {
      method: "POST", body: JSON.stringify({provider:defaultProviderId,model:defaultModelId,instruction:instruction.trim(),revision:saved.revision,submission_id:`script-assist-${Date.now()}`}),
    });
    setSubmittedJobs(known=>mergeTaskSnapshots(known,result.jobs)); onJobsSubmitted(result.jobs);
    notify("本集剧本任务已提交，完成后自动显示正文");
  }
  return <section className="script-room-page workflow-domain-page">
    <input hidden ref={importInput} type="file" accept=".txt,.md,.markdown,.docx,.doc,.wps,.pdf,.rtf,.odt" onChange={e=>{const file=e.target.files?.[0];if(file){setImportResumeId(undefined);setImportFilePreview(file);}e.target.value='';}}/>
    {!importFilePreview&&!importResumeId&&<ImportResumeNotice productionId={productionId} mode="script" jobs={jobs} request={request} onResume={record=>setImportResumeId(record.id)}/>}
    {(importFilePreview||importResumeId)&&<ScriptImportDialog key={productionId} file={importFilePreview||undefined} resumeId={importResumeId} productionId={productionId} projectId={projectId} defaultTarget={defaultTarget} request={request} onJobsSubmitted={onJobsSubmitted} onClose={()=>{setImportFilePreview(null);setImportResumeId(undefined);}} onImported={async result=>{unsavedDrafts.current.clear();await onScriptsImported(result);await loadList(result.episodes[0]?.episodeNo);}}/>}
    <header className="domain-header"><div><span className="eyebrow">SCRIPT ROOM</span><h1>剧本室</h1><p>直接编写或粘贴本集剧本，也可使用 AI 辅助创作；保存后与画布同步。</p></div><div className="settings-actions">
      <button disabled={busy} onClick={()=>run(async()=>{if(draft)await save(false);importInput.current?.click();})}>智能导入文档</button>
      <button disabled={busy} onClick={() => run(() => loadList(active))}><RefreshCw size={15} />刷新</button>
      <button disabled={busy || !draft} onClick={() => run(async () => { await save(); })}><Save size={15} />{unsavedDrafts.current.has(active) ? "保存（未保存）" : "保存"}</button>
      <button className="primary" disabled={busy || activeGenerating || !String(draft?.body || "").trim()} onClick={() => run(enterStoryboard)}>进入分镜规划<ArrowRight size={15}/></button>
    </div></header>
    <div className="script-room-layout">
      <aside className="script-episode-list"><header><b>分集</b><button className="quiet" disabled={busy} onClick={()=>run(async()=>{if(draft) await save(false);onAddEpisode();})}>新增一集</button></header>{items.map((value) => <div className={active === value.episodeNo ? "active" : ""} key={value.episodeNo}>
        <input type="checkbox" disabled={!episodePlanningReady(value.plan) || (runningEpisodes.has(value.episodeNo) && !selected.has(value.episodeNo))} checked={selected.has(value.episodeNo)} onChange={(e) => setSelected((current) => { const next = new Set(current); e.target.checked ? next.add(value.episodeNo) : next.delete(value.episodeNo); return next; })} />
        <button onClick={() => run(async () => { if(draft) await save(false); await onSelectEpisode(value.episodeNo); await selectEpisode(value.episodeNo); })}><b>EP{String(value.episodeNo).padStart(2, "0")}</b><span>{value.episodeTitle}</span><small className={value.script?.status || value.plan?.status || "draft"}>{runningEpisodes.has(value.episodeNo) ? (runningEpisodes.get(value.episodeNo) === "queued" ? "排队中" : "生成中") : (value.script?.metadata?.incomplete ? "内容待补全" : value.script?.body?.trim() ? STATUS_LABELS[value.script.status] : "待编写")}</small></button>
      </div>)}</aside>
      <main>{draft ? <>
        {draft.metadata?.incomplete&&<div className="notice">导入的本集正文疑似不完整，请补全后再进入分镜规划。{draft.metadata.importWarnings?.join('；')}</div>}
        {draft.metadata?.origin === "canvas" && <div className="notice"><b>来自画布快速创作</b><span>这里保存的是同一份正式剧本；修改后画布投影会同步更新。</span></div>}
        <div className="script-summary-strip"><span className={`workflow-status ${activeGenerating ? "running" : draft.status}`}>{activeGenerating ? (runningEpisodes.get(active) === "queued" ? "排队中" : "生成中") : (draft.body?.trim() ? STATUS_LABELS[draft.status] : "未完成")}</span><span>目标 {draft.estimatedDuration} 秒</span>{plan?.paywallRole && plan.paywallRole !== "none" && <span>{plan.paywallRole}</span>}<span>{draft.project_id ? "本集" : "首次保存时建立本集"}</span></div>
        <div className="domain-fields"><label>本集标题<input value={draft.title} onChange={event=>patch({title:event.target.value})}/></label><label>目标时长（秒）<input type="number" min={1} max={3000} value={draft.estimatedDuration} onChange={event=>patch({estimatedDuration:Number(event.target.value)})}/></label></div>
<article className="domain-card script-body-card"><h2>剧本正文</h2><textarea value={draft.body} onChange={(e) => patch({ body: e.target.value })} placeholder="场景标题、可见动作和对白…" /></article>
        <details className="domain-card"><summary>AI 辅助创作</summary><label>创作想法 / 润色或改写要求<textarea value={instruction} onChange={event=>setInstruction(event.target.value)} placeholder="例如：写一个 15 秒的机器人相遇短片；或者保留剧情，将对白改得更自然。"/></label><button disabled={busy || activeGenerating || !instruction.trim()} onClick={()=>run(assist)}><Sparkles size={15}/>{activeGenerating ? "本集生成中" : "按要求生成 / 修订本集"}</button>{plan && <button disabled={busy || activeGenerating || !canAdapt} title={canAdapt ? "根据已保存的本集规划生成" : "请先完善本集改编规划"} onClick={()=>run(()=>generate([active]))}>根据改编规划生成</button>}<small>使用项目默认模型：{configuredDefaultProvider.name} · {defaultModelId || "服务默认"}</small></details>
        <details className="domain-card"><summary>补充信息与制作清单（可选）</summary>
        <article className="domain-card"><div className="domain-fields">
          <label>本集概要<textarea value={draft.synopsis} onChange={(e) => patch({ synopsis: e.target.value })} /></label>
          <label>剧情目标<textarea value={draft.storyGoal} onChange={(e) => patch({ storyGoal: e.target.value })} /></label>
        </div><fieldset className="chapter-reference-field"><legend>原著来源</legend>{chapters.map((chapter) => <label className="check-label" key={chapter.id}><input type="checkbox" checked={draft.sourceChapterRefs.includes(chapter.id)} onChange={(e) => patch({ sourceChapterRefs: e.target.checked ? [...draft.sourceChapterRefs, chapter.id] : draft.sourceChapterRefs.filter((id: string) => id !== chapter.id) })} />{chapter.display_no ?? chapter.chapter_no}. {chapter.title}</label>)}</fieldset>
        <div className="plan-evidence"><div><b>开场钩子</b><p>{plan?.hook || "未填写"}</p></div><div><b>结尾悬念</b><p>{plan?.cliffhanger || "未填写"}</p></div><div><b>核心冲突</b><p>{plan?.coreConflict || "未填写"}</p></div></div></article>

        <article className="domain-card"><h2>制作清单</h2><div className="domain-fields three">
          <label>角色（逗号或换行）<textarea rows={3} value={draft.characters.join("、")} onChange={(e) => patch({ characters: splitList(e.target.value) })} /></label>
          <label>场景（逗号或换行）<textarea rows={3} value={draft.scenes.join("、")} onChange={(e) => patch({ scenes: splitList(e.target.value) })} /></label>
          <label>道具（逗号或换行）<textarea rows={3} value={draft.props.join("、")} onChange={(e) => patch({ props: splitList(e.target.value) })} /></label>
        </div></article></details>
      </> : <div className="empty-state"><h3>选择一集开始写剧本</h3><button onClick={onAddEpisode}>新增一集</button></div>}</main>
    </div>
    {!!selected.size && <footer className="domain-generation-bar"><div><b>根据规划批量生成所选剧本</b><small>已选 {selected.size} 集 · 使用项目默认模型：{configuredDefaultProvider.name} · {defaultModelId || "服务默认"}</small></div><button className="primary" disabled={busy || !selected.size || selectedGenerating} onClick={() => run(() => generate([...selected]))}><Sparkles size={15} />{selectedGenerating ? "所选剧本生成中" : `生成 ${selected.size} 集`}</button></footer>}
  </section>;
}
