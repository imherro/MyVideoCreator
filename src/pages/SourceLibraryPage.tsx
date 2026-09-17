import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckSquare2, FilePlus2, Plus, RefreshCw, Save, Search, Sparkles, Square, Trash2, Upload, X } from "lucide-react";
import { activeSourceChapters } from '../taskCenter.ts';
import {ScriptImportDialog} from '../components/ScriptImportDialog';

type AnyValue = any;
type CreateDialog = { mode: "source" | "chapter"; sourceId?: string; sourceName?: string };

export function SourceLibraryPage({
  productionId, projectId, providers, defaultTarget, refreshKey = 0, request, notify, report, onChanged, jobs, onJobsSubmitted, onScriptsImported,
}: {
  productionId: string; projectId: string;
  providers: AnyValue[]; defaultTarget?: AnyValue; refreshKey?: number;
  request: (path: string, options?: RequestInit) => Promise<AnyValue>;
  notify: (message: string) => void; report: (error: unknown) => void;
  onChanged?: () => void;
  jobs: AnyValue[];
  onJobsSubmitted: (jobs: AnyValue[]) => void;
  onScriptsImported: (result:AnyValue)=>Promise<void>;
}) {
  const [sources, setSources] = useState<AnyValue[]>([]);
  const [chapters, setChapters] = useState<AnyValue[]>([]);
  const [events, setEvents] = useState<AnyValue[]>([]);
  const [active, setActive] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<CreateDialog | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [chapterTitle, setChapterTitle] = useState("第一章");
  const [chapterContent, setChapterContent] = useState("");
  const [dirtyChapters, setDirtyChapters] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [importFilePreview,setImportFilePreview]=useState<File|null>(null);
  const importTarget = useRef<{productionId: string; sourceId?: string; sourceName?: string} | null>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const loadSequence = useRef(0);
  const [loadedProduction, setLoadedProduction] = useState('');
  const ready = loadedProduction === productionId;
  const textProviders = useMemo(
    () => [{ id: "local", name: "本地 llama.cpp", local: true, model: "" }, ...providers.filter((provider) => !provider.kind || provider.kind === "text")],
    [providers],
  );
  const fallbackTextProvider = textProviders.find((provider) => !provider.local) || textProviders[0];
  const defaultProviderId = defaultTarget?.providerId || fallbackTextProvider.id;
  const defaultModelId = defaultTarget?.modelId || fallbackTextProvider.models?.text || fallbackTextProvider.model || "";
  const [providerId, setProviderId] = useState(defaultProviderId);
  const [model, setModel] = useState(defaultModelId);
  const activeTextProvider = textProviders.find((item) => item.id === providerId);
  const allowedTextModels: string[] = activeTextProvider?.enabled_models?.text || (activeTextProvider?.models?.text ? [activeTextProvider.models.text] : activeTextProvider?.model ? [activeTextProvider.model] : []);
  const chapter = chapters.find((item) => item.id === active);
  const activeSource = sources.find((item) => item.id === chapter?.source_id) || sources[0];
  const extracting = activeSourceChapters(jobs);
  const selectedExtractingCount = [...selected].filter(id => extracting.has(id)).length;

  async function load() {
    const sequence = ++loadSequence.current;
    const [nextSources, nextChapters, nextEvents] = await Promise.all([
      request(`/productions/${productionId}/sources`),
      request(`/productions/${productionId}/chapters`),
      request(`/productions/${productionId}/source-events`),
    ]);
    if (sequence !== loadSequence.current) return;
    setLoadedProduction(productionId);
    setSources(nextSources);
    setChapters(nextChapters);
    setEvents(nextEvents);
    setActive((value) => value && nextChapters.some((item: AnyValue) => item.id === value) ? value : nextChapters[0]?.id || "");
  }

  useEffect(() => { setSelected(new Set()); setDirtyChapters(new Set()); void load().catch(report); return () => {loadSequence.current++;}; }, [productionId, refreshKey]);
  useEffect(() => {
    setProviderId(defaultProviderId);
    setModel(defaultModelId);
  }, [productionId, projectId, defaultTarget?.providerId, defaultTarget?.modelId]);

  function run(action: () => Promise<void>) { void action().catch(report); }
  function openCreateSource(additional = false) {
    if (!ready || busy || (sources.length > 0 && !additional)) return;
    if (moreRef.current) moreRef.current.open = false;
    setSourceName("");
    setChapterTitle("第一章");
    setChapterContent("");
    setDialog({ mode: "source" });
  }
  function openCreateChapter() {
    const source = sources.find((item) => item.id === chapter?.source_id) || sources[0];
    if (!source) return;
    setChapterTitle(`第 ${Number(source.chapter_count || 0) + 1} 章`);
    setChapterContent("");
    setDialog({ mode: "chapter", sourceId: source.id, sourceName: source.title });
  }
  async function createManualContent() {
    if (!dialog || !chapterTitle.trim() || (dialog.mode === "source" && !sourceName.trim())) return;
    setBusy(true);
    try {
      let sourceId = dialog.sourceId;
      if (dialog.mode === "source") {
        const source = await request(`/productions/${productionId}/sources`, {
          method: "POST", body: JSON.stringify({ title: sourceName.trim(), type: "manual", metadata: {} }),
        });
        sourceId = source.id;
      }
      const created = await request(`/productions/${productionId}/sources/${sourceId}/chapters`, {
        method: "POST", body: JSON.stringify({ title: chapterTitle.trim(), content: chapterContent }),
      });
      const mode = dialog.mode;
      setDialog(null);
      await load();
      setActive(created.id);
      onChanged?.();
      notify(mode === "source" ? "原著和第一章已建立" : "章节已新增");
    } finally { setBusy(false); }
  }
  function chooseImport(additional = false) {
    if (!ready || busy) return;
    importTarget.current = {productionId, sourceId: additional ? undefined : activeSource?.id, sourceName: additional ? undefined : activeSource?.title};
    if (moreRef.current) moreRef.current.open = false;
    fileRef.current?.click();
  }
  async function importFile(draftId:string,episodeNos:number[],originalOnly=false) {
    const target = importTarget.current;
    if (!target || target.productionId !== productionId) throw new Error('作品已切换，请重新选择导入文件');
    setBusy(true);
    try {
      for (const edited of chapters.filter(item => dirtyChapters.has(item.id))) await persistChapter(edited);
      const imported=await request(`/productions/${productionId}/script-imports/${draftId}/confirm-source`,{method:'POST',body:JSON.stringify({source_id:target.sourceId,episode_nos:episodeNos,original_only:originalOnly})});
      await load();
      onChanged?.();
      setActive(imported.first_chapter_id || "");
      notify(target.sourceId ? `已向“${target.sourceName}”追加 ${imported.imported_count} 章，原有章节保持不变` : `已导入 ${imported.imported_count} 个原著章节`);
    } finally { setBusy(false); }
  }

  async function persistChapter(target: AnyValue) {
    const saved = await request(`/productions/${productionId}/chapters/${target.id}`, {
      method: "PUT", body: JSON.stringify({ title: target.title, content: target.content, revision: target.revision }),
    });
    setChapters((items) => items.map((item) => item.id === saved.id ? saved : item));
    setDirtyChapters((items) => { const next = new Set(items); next.delete(saved.id); return next; });
    onChanged?.();
    return saved;
  }
  async function saveChapter() {
    if (!chapter) return;
    setBusy(true);
    try {
      await persistChapter(chapter);
      notify("章节已保存");
    } finally { setBusy(false); }
  }
  async function deleteActiveSource() {
    if (!activeSource) return;
    if (!window.confirm(`将原著“${activeSource.title}”及其 ${activeSource.chapter_count || 0} 个章节移入回收站？\n章节和已提取事件会暂时隐藏，恢复原著后会重新出现。`)) return;
    setBusy(true);
    try {
      await request(`/productions/${productionId}/sources/${activeSource.id}`, { method: "DELETE" });
      setSelected(new Set());
      await load();
      onChanged?.();
      notify(`原著“${activeSource.title}”已移入回收站`);
    } finally { setBusy(false); }
  }
  async function deleteSelectedChapters() {
    if (!selected.size) return;
    if (!window.confirm(`将选中的 ${selected.size} 个章节移入回收站？\n对应的已提取事件会暂时隐藏，恢复章节后会重新出现。`)) return;
    setBusy(true);
    try {
      await request(`/productions/${productionId}/chapters/trash`, {
        method: "POST", body: JSON.stringify({ chapter_ids: [...selected] }),
      });
      const count = selected.size;
      setSelected(new Set());
      await load();
      onChanged?.();
      notify(`已将 ${count} 个章节移入回收站`);
    } finally { setBusy(false); }
  }
  async function extract() {
    if (busy || !ready || !selected.size || selectedExtractingCount > 0) return;
    const provider = textProviders.find((item) => item.id === providerId);
    const modelId = model || provider?.models?.text || provider?.model || "";
    if (!modelId && providerId !== "local") throw new Error("请填写文本模型 ID");
    if (!window.confirm(`将分析 ${selected.size} 个章节\n模型：${provider?.name || providerId} / ${modelId || "本地默认"}\n确认创建文本任务？`)) return;
    setBusy(true);
    try {
      let savedBeforeExtraction = false;
      if (chapter && dirtyChapters.has(chapter.id)) {
        await persistChapter(chapter);
        savedBeforeExtraction = true;
      }
      const result = await request(`/productions/${productionId}/source-extractions`, { method: "POST", body: JSON.stringify({
        project_id: projectId, chapter_ids: [...selected], provider: providerId, model: modelId,
        submission_id: `source-${Date.now()}`,
      }) });
      onJobsSubmitted(result.jobs);
      notify(`${savedBeforeExtraction ? "当前章节已自动保存；" : ""}已提交 ${result.count} 个章节的事件提取${result.reused_count ? `（${result.reused_count} 个已有任务继续执行）` : ""}，可在任务中心查看`);
    } finally { setBusy(false); }
  }

  const visible = chapters.filter((item) => !query || item.title.includes(query) || item.content.includes(query));
  return <section className="source-library-page">
    <header className="source-library-header">
      <div><span className="eyebrow">PRODUCTION SOURCE LIBRARY</span><h1>整部作品原著库</h1><p>Production 共享资料 · 章节与分集的对应关系在改编策划和单集剧本中设置。</p></div>
      <div className="settings-actions">
        <button onClick={() => run(load)} disabled={busy}><RefreshCw size={15}/>刷新</button>
        <button onClick={() => chooseImport()} disabled={busy || !ready} title={activeSource ? `追加到“${activeSource.title}”，不会覆盖原有章节` : "导入文档（TXT / Word / PDF 等）"}><Upload size={15}/>{activeSource ? "导入章节到当前原著" : "导入文档"}</button>
        <span title={sources.length ? "已有原著，请使用新增章节" : undefined}><button onClick={() => openCreateSource()} disabled={busy || !ready || sources.length > 0}><FilePlus2 size={15}/>新建原著</button></span>
        <button className={sources.length ? "primary" : undefined} onClick={openCreateChapter} disabled={busy || !ready || !sources.length}><Plus size={15}/>新增章节</button>
        <button className="danger-button" onClick={() => run(deleteActiveSource)} disabled={busy || !activeSource} title="移入回收站，可恢复"><Trash2 size={15}/>移除当前原著</button>
        {ready && sources.length > 0 && <details className="source-more-menu" ref={moreRef}><summary>更多</summary><div><button disabled={busy} onClick={() => openCreateSource(true)}><FilePlus2 size={15}/>添加另一部原著</button><button disabled={busy} onClick={() => chooseImport(true)}><Upload size={15}/>导入为另一部原著</button></div></details>}
      </div>
    </header>
    <input ref={fileRef} hidden type="file" accept=".txt,.md,.markdown,.docx,.doc,.wps,.pdf,.rtf,.odt" onChange={(event) => { const file = event.target.files?.[0]; if (file) run(async()=>{setBusy(true);try{for(const edited of chapters.filter(item=>dirtyChapters.has(item.id)))await persistChapter(edited);setImportFilePreview(file);}finally{setBusy(false);}}); event.target.value = ""; }}/>
    {importFilePreview&&<ScriptImportDialog key={productionId} file={importFilePreview} productionId={productionId} projectId={projectId} defaultTarget={defaultTarget} request={request} onJobsSubmitted={onJobsSubmitted} onClose={()=>setImportFilePreview(null)} onImported={onScriptsImported} onSourceImport={importFile}/>}
    <div className="source-library-grid">
      <aside>
        <label className="source-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节"/></label>
        <small>{sources.length} 部原著 · {chapters.length} 章</small>
        <div className="source-selection-actions"><span>已选 {selected.size} 章</span><div><button disabled={busy || !visible.length} onClick={() => setSelected(new Set(visible.map((item) => item.id)))}><CheckSquare2 size={14}/>全选</button><button disabled={busy || !selected.size} onClick={() => setSelected(new Set())}><Square size={14}/>全不选</button><button className="danger-button icon-button" title="移除所选章节" aria-label="移除所选章节" disabled={busy || !selected.size} onClick={() => run(deleteSelectedChapters)}><Trash2 size={14}/></button></div></div>
        {visible.map((item) => <button className={active === item.id ? "active" : ""} key={item.id} onClick={() => setActive(item.id)}><input type="checkbox" checked={selected.has(item.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelected((value) => { const next = new Set(value); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })}/><span><b>{item.display_no ?? item.chapter_no}. {item.title}</b><small>{item.source_title}</small></span></button>)}
      </aside>
      <main>{chapter ? <>
        <div className="chapter-editor-head"><input value={chapter.title} onChange={(event) => { setDirtyChapters((items) => new Set(items).add(chapter.id)); setChapters((items) => items.map((item) => item.id === chapter.id ? { ...item, title: event.target.value } : item)); }}/><button disabled={busy || !dirtyChapters.has(chapter.id)} onClick={() => run(saveChapter)}><Save size={14}/>{dirtyChapters.has(chapter.id) ? "保存章节" : "已保存"}</button></div>
        <textarea className="chapter-editor" value={chapter.content} onChange={(event) => { setDirtyChapters((items) => new Set(items).add(chapter.id)); setChapters((items) => items.map((item) => item.id === chapter.id ? { ...item, content: event.target.value } : item)); }}/>
        <h3>已提取事件</h3>{events.filter((item) => item.chapter_id === chapter.id).map((item) => <article className="source-event" key={item.id}><b>{item.event_order}. {item.summary}</b><small>{item.importance} · {item.emotion || "无情绪标注"} · {item.characters.join("、") || "无明确人物"}</small></article>)}
      </> : <div className="empty-state"><BookOpen/><h3>导入或新建原著</h3></div>}</main>
      <aside className="source-analysis">
        <h3>AI 事件提取</h3><p>作品级分析 · 已选 {selected.size} 章。任务失败时保留已有事件。</p>
        <label>文本服务<select value={providerId} onChange={(event) => { setProviderId(event.target.value); const provider = textProviders.find((item) => item.id === event.target.value); setModel(provider?.enabled_models?.text?.[0] || provider?.models?.text || provider?.model || ""); }}>{textProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.local ? "本地" : "云端"} · {provider.name}</option>)}</select></label>
        <label>模型{providerId === "local" ? <input value={model} placeholder="留空使用本地默认模型" onChange={(event) => setModel(event.target.value)}/> : <select value={model} onChange={(event) => setModel(event.target.value)}>{!allowedTextModels.includes(model) && model && <option value={model} disabled>{model}（已停用）</option>}{allowedTextModels.map((modelId) => <option value={modelId} key={modelId}>{modelId}</option>)}</select>}</label>
        <button disabled={busy || !ready || !selected.size || selectedExtractingCount > 0} onClick={() => run(extract)} title={selectedExtractingCount ? '所选章节已有任务排队或运行中，完成后可再次提取' : undefined}><Sparkles size={15}/>{selectedExtractingCount ? `正在提取（${selectedExtractingCount} 章）` : '提取所选章节事件'}</button>
      </aside>
    </div>
    {dialog && <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="source-create-title"><div className="source-create-dialog">
      <header><div><span className="eyebrow">SOURCE</span><h2 id="source-create-title">{dialog.mode === "source" ? "手工新建原著" : `新增章节 · ${dialog.sourceName}`}</h2></div><button className="icon-button" aria-label="关闭" onClick={() => setDialog(null)}><X size={18}/></button></header>
      {dialog.mode === "source" && <label>原著名称 *<input autoFocus maxLength={200} value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="例如：小球下山"/></label>}
      <label>章节标题 *<input autoFocus={dialog.mode === "chapter"} maxLength={300} value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="例如：第一章 下山"/></label>
      <label>章节正文<textarea value={chapterContent} onChange={(event) => setChapterContent(event.target.value)} placeholder="可以先留空，建立后继续编辑"/></label>
      <footer><button onClick={() => setDialog(null)} disabled={busy}>取消</button><button className="primary" onClick={() => run(createManualContent)} disabled={busy || !chapterTitle.trim() || (dialog.mode === "source" && !sourceName.trim())}>{dialog.mode === "source" ? "建立原著和第一章" : "新增章节"}</button></footer>
    </div></div>}
  </section>;
}
