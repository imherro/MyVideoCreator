import { planShotTimeline } from "./shotTimeline";
import { ensureShotNodes } from "./shotNodes";
import { nodeDefaults } from "./nodeDefaults";
import React, {
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import {
  Clapperboard,
  Plus,
  Image as ImageIcon,
  Film,
  FileText,
  Layers,
  FolderOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Play,
  Download,
  Upload,
  Clock,
  Check,
  AlertCircle,
  X,
  LoaderCircle,
  Save,
  LayoutGrid,
  Table2,
  Scissors,
  Trash2,
  Copy,
  LogOut,
  Monitor,
  Link2,
  RefreshCw,
  BookOpen,
  ArrowUpRight,
  GripVertical,
  Volume2,
  Sparkles,
  History,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./style.css";
import "./timelineControls.css";
import {
  patchNode,
  invalidate,
  removeReference,
  requiresInitialStateReview,
  setInitialStateReviewed,
  setSingleImageReference,
  acceptResult,
} from "./graph";
import { PromptLibrary } from "./PromptLibrary";
import { ModelSelector } from "./ModelSelector";
import { StoryboardGrid } from "./StoryboardGrid";
import { JobProgress } from "./JobProgress";
import { RunWorkflow } from "./RunWorkflow";
import { PanoramaViewer } from "./PanoramaViewer";
import { defaultStage } from "./directorScene";
const DirectorStage = lazy(() =>
  import("./DirectorStage").then((m) => ({ default: m.DirectorStage })),
);
import { updateShot, framesForDuration } from "./shotSync";
import { TimelinePreview } from "./TimelinePreview";
import type { Clip } from "./timeline";
import type { EditorDocument } from "./editor/editorDocument";
const EditorWorkspace = lazy(() =>
  import("./editor/EditorWorkspace").then((module) => ({
    default: module.EditorWorkspace,
  })),
);

type Any = Record<string, any>;
type Asset = {
  id: string;
  name: string;
  kind: string;
  url: string;
  metadata: Any;
};
type Job = {
  id: string;
  kind: string;
  node_id: string;
  status: string;
  phase: string;
  progress: number | null;
  error: string;
  input: Any;
  result: Any;
  created: number;
  provider_job_id?: string;
};
type Doc = {
  nodes: Node[];
  edges: Edge[];
  shots: Any[];
  timeline: Clip[];
  characters: Any[];
  brief: string;
  style: string;
  ratio: string;
  duration: number;
  applied?: string[];
  editor?: EditorDocument;
};
type Project = { id: string; name: string; revision: number; document: Doc };
type SyncFailureKind = "api" | "sse" | "media";
type SyncFailure = {
  kind: SyncFailureKind;
  message: string;
  url: string;
};
const titles: Any = {
  text: "剧本",
  storyboard: "分镜规划",
  image: "图像",
  video: "视频",
  reference: "参考素材",
};
const icons: Any = {
  text: FileText,
  storyboard: Layers,
  image: ImageIcon,
  video: Film,
  reference: FolderOpen,
};
const states: Any = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "待恢复",
};
const debugUrl = (url: string) => {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
};
const api = async (path: string, options: RequestInit = {}) => {
  const url = "/api" + path;
  const requestUrl = debugUrl(url);
  try {
    const r = await fetch(url, {
      ...options,
      headers:
        options.body instanceof FormData
          ? options.headers
          : { "Content-Type": "application/json", ...options.headers },
    });
    if (!r.ok) {
      let error;
      try {
        error = (await r.json()).detail;
      } catch {
        error = await r.text();
      }
      throw Object.assign(
        new Error(typeof error === "string" ? error : JSON.stringify(error)),
        { kind: "api", status: r.status, url: requestUrl },
      );
    }
    return await r.json();
  } catch (cause: any) {
    if (cause?.url) throw cause;
    throw Object.assign(
      new Error(cause?.message || "API 请求失败"),
      { kind: "api", url: requestUrl },
    );
  }
};
const send = (method: string, value?: unknown): RequestInit => ({
  method,
  body: value === undefined ? undefined : JSON.stringify(value),
});
const id = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
function Media({
  asset,
  controls = true,
  retryKey = 0,
  onFailure,
  onReady,
}: {
  asset?: Asset | Any;
  controls?: boolean;
  retryKey?: number;
  onFailure?: (asset: Asset | Any) => void;
  onReady?: (asset: Asset | Any) => void;
}) {
  if (!asset)
    return (
      <div className="media-empty">
        <ImageIcon size={30} />
        <span>等待生成或引用素材</span>
      </div>
  );
  return asset.kind === "video" ? (
    <video
      key={`${asset.id || asset.url}-${retryKey}`}
      src={asset.url}
      controls={controls}
      preload="metadata"
      onError={() => onFailure?.(asset)}
      onLoadedData={() => onReady?.(asset)}
    />
  ) : asset.kind === "audio" ? (
    <audio
      key={`${asset.id || asset.url}-${retryKey}`}
      src={asset.url}
      controls
      onError={() => onFailure?.(asset)}
      onCanPlay={() => onReady?.(asset)}
    />
  ) : (
    <img
      key={`${asset.id || asset.url}-${retryKey}`}
      src={asset.url}
      alt={asset.name}
      onError={() => onFailure?.(asset)}
      onLoad={() => onReady?.(asset)}
    />
  );
}
function MediaNode({ data, selected }: { data: Any; selected?: boolean }) {
  const Icon = icons[data.kind] || Layers;
  const job = data.job as Job | undefined;
  return (
    <div className={"media-node " + (selected ? "selected" : "")}>
      <Handle type="target" position={Position.Left} />
      <div className="node-heading">
        <Icon size={15} />
        <span>{data.label || titles[data.kind]}</span>
        <small>
          {data.provider && data.provider !== "local" ? "服务模型" : "本地"}
        </small>
      </div>
      <div
        className={
          "node-content " +
          (["text", "storyboard"].includes(data.kind) ? "text-content" : "")
        }
      >
        {data.asset ? (
          <Media
            asset={data.asset}
            controls={false}
            retryKey={data.mediaRetryKey}
            onFailure={data.onMediaFailure}
            onReady={data.onMediaReady}
          />
        ) : data.text ? (
          <p>{data.text}</p>
        ) : ["text", "storyboard"].includes(data.kind) ? (
          <div className="node-empty">
            <Icon size={26} />
            <p>
              {data.kind === "text"
                ? "从一个故事开始"
                : "把故事拆成可拍摄的镜头"}
            </p>
          </div>
        ) : (
          <div className="node-empty">
            <Icon size={32} />
            <p>
              {data.kind === "image" ? "描绘故事的第一个瞬间" : "让画面动起来"}
            </p>
          </div>
        )}
      </div>
      <div className="node-footer">
        <span>
          {data.stale
            ? "输入已更改 · 可重新生成"
            : job
              ? states[job.status]
              : "准备创作"}
        </span>
        {job?.status === "running" ? (
          <LoaderCircle size={14} className="spin" />
        ) : data.asset || data.text ? (
          <Check size={14} />
        ) : (
          <span className="node-hint">选择以编辑 →</span>
        )}
      </div>
      {job?.status === "running" && (
        <div className="node-progress">
          <div
            style={{
              width:
                job.progress == null ? "30%" : Math.max(2, job.progress) + "%",
            }}
          />
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { media: MediaNode };

function Auth({ onLogin }: { onLogin: () => void }) {
  const [status, setStatus] = useState<Any>();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/auth/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        status?.configured ? "/auth/login" : "/auth/setup",
        send("POST", { password }),
      );
      onLogin();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="brand">
          <Clapperboard />
          映序 <small>STUDIO</small>
        </div>
        <div className="auth-lines">
          <span>01 / STORY</span>
          <span>02 / FRAME</span>
          <span>03 / MOTION</span>
        </div>
        <h1>
          让一个念头，
          <br />
          成为一部短片。
        </h1>
        <p>你的故事，你的模型，你的工作室。</p>
        <div className="auth-meta">
          <Monitor size={18} /> 浏览器创作 · 本地模型运行
        </div>
      </div>
      <form onSubmit={submit} className="auth-form">
        <span className="eyebrow">YOUR CREATIVE SPACE</span>
        <h2>{status?.configured ? "回到工作室" : "创建你的工作室"}</h2>
        <p>
          {status?.configured
            ? "在任意电脑上使用同一个工作室密码登录。"
            : "先在这台主机设置密码，之后可从其他电脑的浏览器访问。"}
        </p>
        <label>
          工作室密码
          <input
            autoFocus
            type="password"
            autoComplete={
              status?.configured ? "current-password" : "new-password"
            }
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 位"
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button
          className="primary"
          disabled={
            busy || !status || (!status.configured && !status.can_setup)
          }
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <ArrowUpRight size={17} />
          )}{" "}
          {status?.configured ? "进入工作室" : "设置并进入"}
        </button>
        {status && !status.configured && !status.can_setup && (
          <p className="error">请在 GPU 主机上访问本机地址，完成首次设置。</p>
        )}
      </form>
    </div>
  );
}

function Studio() {
  const [logged, setLogged] = useState<boolean | null>(null);
  useEffect(() => {
    api("/auth/status")
      .then((s) => setLogged(s.authenticated))
      .catch(() => setLogged(false));
  }, []);
  if (logged === null)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        正在连接工作室
      </div>
    );
  if (!logged) return <Auth onLogin={() => setLogged(true)} />;
  return (
    <ReactFlowProvider>
      <Workspace onLogout={() => setLogged(false)} />
    </ReactFlowProvider>
  );
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const [projects, setProjects] = useState<Any[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [doc, setDoc] = useState<Doc | null>(null),
    [assets, setAssets] = useState<Asset[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [system, setSystem] = useState<Any>({
      models: [],
      templates: {},
      hardware: {},
    }),
    [config, setConfig] = useState<Any>({
      providers: [],
      model_directories: [],
    });
  const [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState("canvas"),
    [panel, setPanel] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("已保存"),
    [busy, setBusy] = useState(false),
    [timelineOpen, setTimelineOpen] = useState(false),
    [revisions, setRevisions] = useState<Any[]>([]),
    [cloud, setCloud] = useState(false),
    [preview, setPreview] = useState<Asset | null>(null);
  const [previewTimeline, setPreviewTimeline] = useState(false);
  const [panorama, setPanorama] = useState<Asset | null>(null);
  const [syncFailure, setSyncFailure] = useState<SyncFailure | null>(null);
  const [mediaRetryKey, setMediaRetryKey] = useState(0);
  const [conflict, setConflict] = useState(false),
    [recoveryBusy, setRecoveryBusy] = useState(false);
  const conflictRef = useRef(false);
  const revision = useRef(1),
    dirty = useRef(false),
    current = useRef<{ project: Project | null; doc: Doc | null }>({
      project: null,
      doc: null,
    }),
    saving = useRef(false),
    saveFlight = useRef<Promise<void> | null>(null),
    refreshFlights = useRef(new Map<string, Promise<void>>()),
    nodeMeasurements = useRef(
      new Map<string, { width?: number; height?: number }>(),
    ),
    fileInput = useRef<HTMLInputElement>(null),
    { fitView } = useReactFlow(),
    updateNodeInternals = useUpdateNodeInternals();
  const [layoutVersion, setLayoutVersion] = useState(0);
  current.current = { project, doc };
  const report = (e: any) => {
    const message = e?.message || String(e);
    setError(e?.url ? `${message}（开发调试：${e.url}）` : message);
  };
  const reportMediaFailure = useCallback((asset: Asset | Any) => {
    setSyncFailure({
      kind: "media",
      message: "媒体文件加载失败，已保留画布和素材，等待网络恢复后重试",
      url: debugUrl(asset.url),
    });
  }, []);
  const clearMediaFailure = useCallback((asset: Asset | Any) => {
    const url = debugUrl(asset.url);
    setSyncFailure((previous) =>
      previous?.kind === "media" && previous.url === url ? null : previous,
    );
  }, []);
  const update = useCallback((fn: (d: Doc) => Doc) => {
    setDoc((d) => (d ? fn(d) : d));
    dirty.current = true;
    setSaved("未保存");
  }, []);
  const refresh = useCallback((pid: string) => {
    const pending = refreshFlights.current.get(pid);
    if (pending) return pending;
    const work = (async () => {
      try {
        // Treat assets and jobs as one snapshot. A partial response must never
        // replace the last known-good canvas state with an empty collection.
        const [a, j] = await Promise.all([
          api(`/projects/${pid}/assets`),
          api(`/projects/${pid}/jobs`),
        ]);
        if (current.current.project?.id === pid) {
          setAssets(a);
          setJobs(j);
        }
        setSyncFailure((previous) =>
          previous?.kind === "api" ? null : previous,
        );
      } catch (e: any) {
        setSyncFailure({
          kind: "api",
          message: "刷新失败，正在重试",
          url: e?.url || debugUrl(`/api/projects/${pid}/assets`),
        });
        throw e;
      }
    })();
    refreshFlights.current.set(pid, work);
    void work.then(
      () => refreshFlights.current.delete(pid),
      () => refreshFlights.current.delete(pid),
    );
    return work;
  }, []);
  async function openProject(pid: string) {
    if (dirty.current || saveFlight.current) await save();
    if (dirty.current)
      throw new Error("项目尚未保存，已保留当前编辑。请先解决保存冲突。");
    // Only switch views after every part of the new project snapshot arrives.
    // This leaves the current canvas visible if a refresh fails mid-request.
    let p: Project, a: Asset[], j: Job[];
    try {
      [p, a, j] = await Promise.all([
        api("/projects/" + pid),
        api(`/projects/${pid}/assets`),
        api(`/projects/${pid}/jobs`),
      ]);
    } catch (e: any) {
      setSyncFailure({
        kind: "api",
        message: "刷新失败，正在重试",
        url: e?.url || debugUrl(`/api/projects/${pid}`),
      });
      throw e;
    }
    revision.current = p.revision;
    dirty.current = false;
    nodeMeasurements.current.clear();
    setLayoutVersion((value) => value + 1);
    setProject(p);
    setDoc(p.document);
    setAssets(a);
    setJobs(j);
    setSelected(null);
    setSaved("已保存");
    setPanel(null);
    setTimeout(() => {
      fitView({ padding: 0.2 });
    }, 100);
  }
  async function boot() {
    try {
      const [list, sys, settings] = await Promise.all([
        api("/projects"),
        api("/system"),
        api("/settings"),
      ]);
      setProjects(list);
      setSystem(sys);
      setConfig(settings);
      if (list.length) await openProject(list[0].id);
      else {
        const p = await api(
          "/projects",
          send("POST", { name: "我的第一部短片" }),
        );
        setProjects([p]);
        await openProject(p.id);
      }
    } catch (e) {
      report(e);
    }
  }
  useEffect(() => {
    boot();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const events = new EventSource("/api/events");
    const eventsUrl = debugUrl("/api/events");
    events.onopen = () => {
      setSyncFailure((previous) =>
        previous?.kind === "sse" ? null : previous,
      );
    };
    events.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const pid = current.current.project?.id;
        if (data.project_id === pid && data.type === "job")
          refresh(pid!).catch(() => {});
      } catch {
        setSyncFailure({
          kind: "sse",
          message: "实时同步数据异常，正在重连",
          url: eventsUrl,
        });
      }
    };
    events.onerror = () => {
      setSyncFailure({
        kind: "sse",
        message: "实时同步已断开，正在重连",
        url: eventsUrl,
      });
    };
    const poll = setInterval(() => {
      const pid = current.current.project?.id;
      if (pid) refresh(pid).catch(() => {});
    }, 8000);
    const retryOnNetworkRecovery = () => {
      setMediaRetryKey((value) => value + 1);
      const pid = current.current.project?.id;
      if (pid) refresh(pid).catch(() => {});
    };
    window.addEventListener("online", retryOnNetworkRecovery);
    return () => {
      events.close();
      clearInterval(poll);
      window.removeEventListener("online", retryOnNetworkRecovery);
    };
  }, [refresh]);
  async function recoverConflict() {
    setRecoveryBusy(true);
    try {
      const snapshot = current.current;
      if (!snapshot.project || !snapshot.doc) return;
      const latest = await api("/projects/" + snapshot.project.id);
      const backup = JSON.stringify(
        {
          format: "yingxu-project-draft-v1",
          project_id: snapshot.project.id,
          name: snapshot.project.name,
          revision: revision.current,
          document: snapshot.doc,
        },
        null,
        2,
      );
      sessionStorage.setItem("yingxu-conflict-" + snapshot.project.id, backup);
      const url = URL.createObjectURL(
        new Blob([backup], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `映序-冲突草稿-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      revision.current = latest.revision;
      dirty.current = false;
      conflictRef.current = false;
      setConflict(false);
      setProject(latest);
      setDoc(latest.document);
      setSelected(null);
      setSaved("已保存");
      setError("");
      setNotice("本页草稿已下载备份，已载入主机最新版本");
    } catch (e) {
      report(e);
    } finally {
      setRecoveryBusy(false);
    }
  }
  async function save() {
    if (conflictRef.current) return;
    if (saveFlight.current) {
      await saveFlight.current;
      return save();
    }
    const snapshot = current.current;
    const projectSnapshot = snapshot.project;
    if (!projectSnapshot || !snapshot.doc || !dirty.current) return;
    dirty.current = false;
    saving.current = true;
    setSaved("保存中");
    const name = projectSnapshot.name.trim() || "未命名短片";
    const work = (async () => {
      try {
        const result = await api(
          "/projects/" + projectSnapshot.id,
          send("PUT", {
            name,
            revision: revision.current,
            document: snapshot.doc,
          }),
        );
        revision.current = result.revision;
        if (name !== projectSnapshot.name) {
          setProject((current) =>
            current?.id === projectSnapshot.id ? { ...current, name } : current,
          );
          setProjects((current) =>
            current.map((item) =>
              item.id === projectSnapshot.id ? { ...item, name } : item,
            ),
          );
          setNotice("项目名称不能为空，已恢复为“未命名短片”");
        }
        setSaved(dirty.current ? "未保存" : "已保存");
      } catch (e: any) {
        dirty.current = true;
        if (e.status === 409) {
          conflictRef.current = true;
          setConflict(true);
          setSaved("保存冲突");
        } else {
          setSaved("保存失败");
          report(e);
        }
      } finally {
        saving.current = false;
      }
    })();
    saveFlight.current = work;
    try {
      await work;
    } finally {
      saveFlight.current = null;
    }
  }
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirty.current) save();
    }, 2500);
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (!doc) return;
    const completed = jobs
      .filter(
        (j) =>
          j.status === "succeeded" && j.result && !doc.applied?.includes(j.id),
      )
      .sort((a, b) => a.created - b.created);
    if (!completed.length) return;
    update((d) => {
      let next = d;
      for (const job of completed) next = acceptResult(next, job, jobs);
      return {
        ...next,
        applied: [...(d.applied || []), ...completed.map((j) => j.id)],
      };
    });
  }, [jobs, doc?.applied]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Any) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "read_studio_project",
      title: "读取当前视频项目",
      description: "读取当前工作室项目的节点和分镜，不执行生成。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        id: current.current.project?.id,
        name: current.current.project?.name,
        document: current.current.doc,
      }),
    });
    register({
      name: "stage_studio_nodes",
      title: "准备创作节点",
      description:
        "批量创建待编辑的文本、分镜、图像或视频节点。不提交模型任务，不产生云端费用。",
      inputSchema: {
        type: "object",
        properties: {
          nodes: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ["text", "storyboard", "image", "video"],
                },
                prompt: { type: "string" },
                label: { type: "string" },
              },
              required: ["kind", "prompt"],
              additionalProperties: false,
            },
          },
        },
        required: ["nodes"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input: Any) => {
        if (
          !Array.isArray(input.nodes) ||
          !input.nodes.length ||
          input.nodes.length > 20
        )
          throw new Error("需要 1–20 个节点");
        if (
          input.nodes.some(
            (n: Any) =>
              !["text", "storyboard", "image", "video"].includes(n.kind) ||
              typeof n.prompt !== "string",
          )
        )
          throw new Error("节点类型或描述无效");
        const nodes = input.nodes.map((n: Any, i: number) => ({
          id: id(),
          type: "media",
          position: {
            x: 80 + i * 340,
            y: 80 + (current.current.doc?.nodes.length || 0) * 30,
          },
          data: {
            kind: n.kind,
            label: n.label || titles[n.kind],
            prompt: n.prompt,
            ...nodeDefaults(n.kind, config.providers, system.models),
          },
        }));
        update((d) => ({ ...d, nodes: [...d.nodes, ...nodes] }));
        setView("canvas");
        return {
          staged_node_ids: nodes.map((n: Any) => n.id),
          generation_submitted: false,
        };
      },
    });
    return () => lifecycle.abort();
  }, [project?.id, update, config.providers, system.models]);
  const node = doc?.nodes.find((n) => n.id === selected);
  const data = (node?.data || {}) as Any;
  function pendingInitialStateChecks(targetId: string) {
    return (doc?.edges || [])
      .filter((edge) => edge.target === targetId)
      .map((edge) => doc?.nodes.find((item) => item.id === edge.source))
      .filter(
        (source) =>
          source?.data.kind === "image" &&
          source.data.assetId &&
          requiresInitialStateReview(source.data.prompt) &&
          !source.data.state_reviewed,
      );
  }
  const pendingInitialStateNodes =
    node?.data.kind === "video" ? pendingInitialStateChecks(node.id) : [];
  const activeJob = jobs.find((j) => j.node_id === selected);
  const activeCount = jobs.filter((j) =>
    ["queued", "running"].includes(j.status),
  ).length;
  const canDeleteCurrentProject =
    !!doc &&
    !doc.nodes.length &&
    !doc.edges.length &&
    !doc.shots.length &&
    !doc.timeline.length &&
    !doc.characters.length &&
    !String(doc.brief || "").trim() &&
    !assets.length &&
    !jobs.length;
  function editNode(patch: Any) {
    if (selected) update((d) => patchNode(d, selected, patch));
  }
  function changeModel(patch: Any) {
    if (!selected) return;
    const provider = patch.provider
      ? config.providers.find((item: Any) => item.id === patch.provider)
      : undefined;
    // A tail frame is not supported by the native Hailuo path. Clear a stale
    // setting immediately when the user switches services, rather than fail
    // only after a cloud submission has been attempted.
    update((d) =>
      patchNode(
        d,
        selected,
        provider?.type === "minimax" ? { ...patch, end_asset_id: "" } : patch,
      ),
    );
  }
  function newNode(
    kind: string,
    prompt = "",
    extra: Any = {},
    sourceNodeId?: string,
  ) {
    const nid = id();
    const offset = doc?.nodes.length || 0;
    update((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id: nid,
          type: "media",
          position: {
            x: 80 + (offset % 3) * 350,
            y: 80 + Math.floor(offset / 3) * 330,
          },
          data: {
            kind,
            label: titles[kind],
            prompt,
            ...nodeDefaults(kind, config.providers, system.models),
            ...extra,
          },
        },
      ],
      edges:
        sourceNodeId &&
        d.nodes.some((item) => item.id === sourceNodeId) &&
        !d.edges.some(
          (edge) => edge.source === sourceNodeId && edge.target === nid,
        )
          ? [...d.edges, { id: id(), source: sourceNodeId, target: nid }]
          : d.edges,
    }));
    setSelected(nid);
    setPanel(null);
    return nid;
  }
  function removeNode() {
    if (!selected) return;
    update((d) => {
      const affected = d.edges
        .filter((e) => e.source === selected)
        .map((e) => e.target);
      return invalidate(
        {
          ...d,
          nodes: d.nodes.filter((n) => n.id !== selected),
          edges: d.edges.filter(
            (e) => e.source !== selected && e.target !== selected,
          ),
        },
        affected,
      );
    });
    setSelected(null);
  }
  async function createProject() {
    let preservedDraft = false;
    if (dirty.current || saveFlight.current) await save();
    if (dirty.current) {
      if (!conflictRef.current)
        throw new Error("项目尚未保存，请先解决保存失败后再新建项目。");
      const snapshot = current.current;
      if (!snapshot.project || !snapshot.doc)
        throw new Error("当前项目草稿不可用，无法安全切换项目。");
      const backup = JSON.stringify(
        {
          format: "yingxu-project-draft-v1",
          project_id: snapshot.project.id,
          name: snapshot.project.name,
          revision: revision.current,
          document: snapshot.doc,
        },
        null,
        2,
      );
      sessionStorage.setItem("yingxu-conflict-" + snapshot.project.id, backup);
      dirty.current = false;
      conflictRef.current = false;
      setConflict(false);
      setSaved("已保存");
      preservedDraft = true;
    }
    const p = await api("/projects", send("POST", { name: "未命名短片" }));
    setProjects(await api("/projects"));
    await openProject(p.id);
    if (preservedDraft)
      setNotice("已进入新项目；原项目的冲突草稿已保存在本浏览器，可随时返回恢复。");
  }
  async function deleteCurrentProject() {
    if (!project || !canDeleteCurrentProject) return;
    if (
      !window.confirm(
        `删除空项目“${project.name}”？此操作无法恢复。`,
      )
    )
      return;
    const deletedId = project.id;
    await api(`/projects/${deletedId}`, send("DELETE"));
    let list = await api("/projects");
    if (!list.length) {
      await api("/projects", send("POST", { name: "我的第一部短片" }));
      list = await api("/projects");
    }
    dirty.current = false;
    conflictRef.current = false;
    setConflict(false);
    setProjects(list);
    await openProject(list[0].id);
    setNotice("空项目已删除");
  }
  function sourceAssets(nid: string) {
    const sources =
      doc?.edges
        .filter((e) => e.target === nid)
        .map((e) => doc.nodes.find((n) => n.id === e.source)?.data.assetId)
        .filter(Boolean) || [];
    return [
      ...new Set([
        ...sources,
        ...((doc?.nodes.find((n) => n.id === nid)?.data
          .asset_ids as string[]) || []),
      ]),
    ];
  }
  function storyboardContextId(document: Doc) {
    return [...document.nodes]
      .reverse()
      .find(
        (item) => item.data.kind === "storyboard" && Boolean(item.data.text),
      )?.id;
  }
  function setSingleFirstFrame(assetId: string, providerName: string) {
    if (!selected) return;
    update((d) => setSingleImageReference(d, selected, assetId));
    setNotice(
      assetId
        ? `已将 ${providerName} 首帧限定为所选素材`
        : `已清除 ${providerName} 的图像首帧引用`,
    );
  }
  async function run(n = node) {
    if (!n || !project || busy) return;
    setBusy(true);
    setError("");
    try {
      if (n.data.kind === "video") {
        const pendingChecks = pendingInitialStateChecks(n.id);
        if (pendingChecks.length) {
          const names = pendingChecks
            .map((item) => item?.data.label || "关联分镜图")
            .join("、");
          throw new Error(`请先核验「${names}」的首帧状态，再生成视频。`);
        }
      }
      await save();
      if (dirty.current) throw new Error("项目尚未保存，请先解决保存冲突");
      const input = {
        ...n.data,
        provider: n.data.provider || "local",
        asset_ids: sourceAssets(n.id),
        allow_cloud: cloud,
        prompt: String(n.data.prompt || ""),
        ratio: doc?.ratio || "16:9",
        size: n.data.resolution || "1024x1024",
        target_duration:
          n.data.kind === "storyboard"
            ? n.data.target_duration || doc?.duration
            : undefined,
      };
      await api(
        `/projects/${project.id}/jobs`,
        send("POST", {
          node_id: n.id,
          kind: n.data.kind,
          submission_id: id(),
          input,
        }),
      );
      await refresh(project.id);
      setNotice("任务已进入服务器队列，关闭页面也会继续执行");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function runGraph(options: Any = {}) {
    if (!project || busy) return;
    setBusy(true);
    try {
      await save();
      if (dirty.current) throw new Error("请先解决保存冲突再执行画布");
      const result = await api(
        `/projects/${project.id}/run`,
        send("POST", { submission_id: id(), ...options }),
      );
      await refresh(project.id);
      setPanel("jobs");
      setNotice(`${result.count} 个任务已按连线依赖加入队列`);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  function adoptShots(job: Job) {
    if (!job.result?.shots) return;
    update((d) => {
      const storyboardNode = d.nodes.find(
        (item) => item.id === job.node_id && item.data.kind === "storyboard",
      );
      return {
        ...d,
        shots: job.result.shots.map((shot: Any) => ({
          ...shot,
          storyboardNode: storyboardNode?.id || shot.storyboardNode,
        })),
      };
    });
    setView("shots");
    setPanel(null);
    setNotice("分镜已导入，可逐镜修改并建立生成节点");
  }
  function shotNodes(shot: Any, _index: number) {
    update((d) =>
      ensureShotNodes(
        d,
        config.providers,
        system.models,
        id,
        [shot.id],
        shot.storyboardNode || storyboardContextId(d),
      ),
    );
    setView("canvas");
    setSelected(null);
    setTimeout(() => fitView({ padding: 0.2 }), 80);
  }
  function appendShotTimeline() {
    if (!doc) return;
    const plan = planShotTimeline(doc.shots, doc.nodes, assets, id);
    if (plan.issues.length) {
      report(new Error(plan.issues.join("；")));
      return;
    }
    update((d) => ({ ...d, timeline: [...d.timeline, ...plan.clips] }));
    setTimelineOpen(true);
    setNotice(`已按分镜顺序追加 ${plan.clips.length} 个镜头，保留原时间线`);
  }
  function allShotNodes() {
    update((d) =>
      ensureShotNodes(
        d,
        config.providers,
        system.models,
        id,
        undefined,
        storyboardContextId(d),
      ),
    );
    setView("canvas");
    setSelected(null);
    setTimeout(() => fitView({ padding: 0.2 }), 80);
    setNotice("已补齐分镜生成节点，检查提示词后可运行画布");
  }
  async function uploadFiles(files: FileList | null) {
    if (!files || !project) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api(`/projects/${project.id}/assets`, {
          method: "POST",
          body: form,
        });
      }
      await refresh(project.id);
      setPanel("assets");
      setNotice("素材已保存到主机，可在其他电脑访问");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  function addTimeline(asset: Asset) {
    update((d) => ({
      ...d,
      timeline: [
        ...d.timeline,
        {
          id: id(),
          asset_id: asset.id,
          start: 0,
          duration: asset.kind === "video" ? asset.metadata?.duration || 5 : 5,
          volume: 1,
        },
      ],
    }));
    setTimelineOpen(true);
    setNotice("已加入时间线");
  }
  async function exportFilm(editorOverride?: EditorDocument["timeline"]) {
    if (!project || !doc) return;
    try {
      const editorTimeline = editorOverride || doc.editor?.timeline;
      const useEditor = Boolean(
        editorTimeline?.tracks?.some((track) => track.elements?.length),
      );
      await save();
      if (dirty.current) throw new Error("项目尚未保存，请先解决保存冲突");
      await api(
        `/projects/${project.id}/jobs`,
        send("POST", {
          node_id: "export",
          kind: "export",
          submission_id: id(),
          input: {
            timeline: doc.timeline,
            editor_timeline: useEditor ? editorTimeline : undefined,
            render_mode: useEditor ? "editor" : "legacy",
            resolution: (doc as any).export_resolution || "1280x720",
            audio_id: (doc as any).audio_id,
            subtitle_id: (doc as any).subtitle_id,
            music_volume: (doc as any).music_volume ?? 0.3,
            transition: (doc as any).transition || "cut",
          },
        }),
      );
      setPanel("jobs");
      await refresh(project.id);
    } catch (e) {
      report(e);
    }
  }
  async function history() {
    if (!project) return;
    setRevisions(await api(`/projects/${project.id}/revisions`));
    setPanel("history");
  }
  const renderedNodes =
    doc?.nodes.map((n) => {
      // React Flow hides a node until it knows its dimensions. Keep those
      // measurements outside the persisted document so asset/job refreshes do
      // not reset every node to `visibility: hidden`.
      const measured = nodeMeasurements.current.get(n.id);
      return {
        ...n,
        width: n.width ?? measured?.width,
        height: n.height ?? measured?.height,
        selected: n.id === selected,
        data: {
          ...n.data,
          asset: assets.find((a) => a.id === n.data.assetId),
          job: jobs.find((j) => j.node_id === n.id),
          mediaRetryKey,
          layoutVersion,
          onMediaFailure: reportMediaFailure,
          onMediaReady: clearMediaFailure,
        },
      };
    }) || [];
  const renderedEdges =
    doc?.edges.map((edge) => ({
      ...edge,
      type: edge.type || "smoothstep",
      zIndex: 1,
      style: {
        stroke: "#d4a963",
        strokeWidth: 2.2,
        ...edge.style,
      },
    })) || [];
  if (!doc || !project)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        {error || "正在打开工作室"}
      </div>
    );
  const persistedEditorTimeline = doc.editor?.timeline;
  const hasEditorTimeline = Boolean(
    persistedEditorTimeline?.tracks?.some((track) => track.elements.length),
  );
  return (
    <div className="studio-shell">
      {previewTimeline && (
        <TimelinePreview
          clips={doc.timeline}
          assets={assets}
          audioId={(doc as any).audio_id}
          musicVolume={(doc as any).music_volume ?? 0.3}
          transition={(doc as any).transition || "cut"}
          ratio={doc.ratio || "16:9"}
          autoPlay
          onClose={() => setPreviewTimeline(false)}
        />
      )}
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setPanel(panel === "projects" ? null : "projects")}
        >
          <Clapperboard size={23} />
          <strong>映序</strong>
          <span>STUDIO</span>
        </button>
        <span className="divider" />
        <button className="project-picker" onClick={() => setPanel("projects")}>
          {project.name}
          <ChevronRight size={15} />
        </button>
        <span
          className={"save-status " + (saved === "保存失败" ? "danger" : "")}
        >
          <span className="status-dot" />
          {saved}
        </span>
        <div className="top-spacer" />
        <div className="local-badge">
          <Monitor size={14} /> 本地优先
        </div>
        <button
          className={"queue-button " + (activeCount ? "active" : "")}
          onClick={() => setPanel("jobs")}
        >
          <Clock size={16} />
          <span>任务</span>
          <b>{activeCount || jobs.length}</b>
        </button>
        <button
          className="icon-button"
          aria-label="保存项目"
          title="保存 Ctrl+S"
          onClick={() => save()}
        >
          <Save size={18} />
        </button>
        <button
          className="primary compact"
          onClick={() => {
            setTimelineOpen(true);
            if (!doc.timeline.length)
              setNotice("从素材库选择视频或图片，加入时间线后导出");
            else setPanel("export");
          }}
        >
          <Download size={16} />
          导出
        </button>
        <button
          className="avatar"
          onClick={() => setPanel("settings")}
          title="工作室设置"
        >
          我
        </button>
      </header>
      <nav className="rail">
        <button
          className="add-button"
          title="添加节点"
          onClick={() => setPanel(panel === "add" ? null : "add")}
        >
          <Plus />
        </button>
        <button
          className={panel === "assets" ? "active" : ""}
          title="素材库"
          onClick={() => setPanel(panel === "assets" ? null : "assets")}
        >
          <ImageIcon />
        </button>
        <button
          className={panel === "characters" ? "active" : ""}
          title="角色与场景"
          onClick={() => setPanel(panel === "characters" ? null : "characters")}
        >
          <FolderOpen />
        </button>
        <button title="提示词模板" onClick={() => setPanel("prompts")}>
          <BookOpen />
        </button>
        <button title="历史版本" onClick={() => history().catch(report)}>
          <History />
        </button>
        <div className="rail-space" />
        <button title="模型与服务" onClick={() => setPanel("settings")}>
          <Settings />
        </button>
      </nav>
      <main className="work-area">
        <div className="viewbar">
          <div className="segmented">
            <button
              className={view === "canvas" ? "active" : ""}
              onClick={() => setView("canvas")}
            >
              <LayoutGrid size={15} />
              创作画布
            </button>
            <button
              className={view === "editor" ? "active" : ""}
              onClick={() => setView("editor")}
            >
              <Scissors size={15} />
              剪辑
            </button>
            <button
              className={view === "shots" ? "active" : ""}
              onClick={() => setView("shots")}
            >
              <Table2 size={15} />
              分镜表<span>{doc.shots.length || ""}</span>
            </button>
            <button
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
            >
              <LayoutGrid size={15} />
              宫格
            </button>
            <button
              className={view === "director" ? "active" : ""}
              onClick={() => setView("director")}
            >
              3D 导演台
            </button>
          </div>
          <div className="view-meta">
            {doc.ratio}
            <span>·</span>
            {doc.style}
            <span>·</span>
            {doc.duration} 秒
          </div>
          {view !== "editor" && (
            <>
              <button
                className="quiet"
                disabled={busy || !doc.nodes.length}
                onClick={() => setPanel("run")}
              >
                <Play size={15} />
                运行画布
              </button>
              <button
                className="quiet"
                onClick={() => setTimelineOpen(!timelineOpen)}
              >
                <Scissors size={15} />
                {timelineOpen ? "收起时间线" : "时间线"}
              </button>
            </>
          )}
        </div>
        {view === "editor" ? (
          <Suspense fallback={<div className="loading">加载剪辑工作区…</div>}>
            <EditorWorkspace
              projectId={project.id}
              editor={doc.editor}
              assets={assets}
              ratio={doc.ratio}
              shots={doc.shots}
              nodes={doc.nodes}
              audioId={(doc as any).audio_id}
              musicVolume={(doc as any).music_volume ?? 0.3}
              onChange={(editor) =>
                update((currentDoc) => ({ ...currentDoc, editor }))
              }
              onExport={(timeline) => void exportFilm(timeline)}
            />
          </Suspense>
        ) : view === "canvas" ? (
          <div className="canvas">
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes: NodeChange[]) => {
                let measurementsChanged = false;
                for (const change of changes) {
                  if (
                    change.type !== "dimensions" ||
                    !change.dimensions ||
                    (change.dimensions.width == null &&
                      change.dimensions.height == null)
                  )
                    continue;
                  const previous = nodeMeasurements.current.get(change.id);
                  const next = {
                    width: change.dimensions.width ?? previous?.width,
                    height: change.dimensions.height ?? previous?.height,
                  };
                  if (
                    previous?.width !== next.width ||
                    previous?.height !== next.height
                  ) {
                    nodeMeasurements.current.set(change.id, next);
                    measurementsChanged = true;
                  }
                }
                if (measurementsChanged) setLayoutVersion((value) => value + 1);
                const filtered = changes.filter(
                  (c) => c.type !== "select" && c.type !== "dimensions",
                );
                if (filtered.length)
                  update((d) => ({
                    ...d,
                    nodes: applyNodeChanges(filtered, d.nodes),
                  }));
              }}
              onEdgesChange={(changes: EdgeChange[]) => {
                if (changes.every((c) => c.type === "select")) return;
                update((d) =>
                  invalidate(
                    { ...d, edges: applyEdgeChanges(changes, d.edges) },
                    d.edges
                      .filter((e) =>
                        changes.some(
                          (c) => c.type === "remove" && c.id === e.id,
                        ),
                      )
                      .map((e) => e.target),
                  ),
                );
              }}
              onConnect={(connection: Connection) => {
                if (connection.source === connection.target) return;
                update((d) =>
                  invalidate(
                    {
                      ...d,
                      edges: addEdge({ ...connection, id: id() }, d.edges),
                    },
                    [connection.target],
                  ),
                );
              }}
              onNodeClick={(_, n) => {
                setSelected(n.id);
                setPanel(null);
              }}
              onNodeDragStop={(_, n) => {
                requestAnimationFrame(() => updateNodeInternals(n.id));
              }}
              onPaneClick={() => setSelected(null)}
              fitView
              minZoom={0.2}
              maxZoom={1.8}
              defaultEdgeOptions={{
                style: { stroke: "#8f7550", strokeWidth: 1.5 },
                type: "smoothstep",
              }}
              deleteKeyCode={null}
            >
              <Background color="#343739" gap={22} size={1} />
              <Controls showInteractive={false} />
              <MiniMap nodeColor="#5b5545" maskColor="rgba(10,12,13,.6)" />
            </ReactFlow>
            {!doc.nodes.length && (
              <div className="canvas-welcome">
                <div className="welcome-mark">
                  <Clapperboard size={38} />
                </div>
                <span className="eyebrow">A NEW STORY STARTS HERE</span>
                <h1>故事，从这里开始</h1>
                <p>写下一个念头，将它变成剧本、画面与镜头。</p>
                <div className="welcome-actions">
                  <button
                    className="primary"
                    onClick={() => newNode("text", doc.brief)}
                  >
                    <FileText size={17} />
                    开始写剧本
                  </button>
                  <button onClick={() => fileInput.current?.click()}>
                    <Upload size={17} />
                    导入素材
                  </button>
                </div>
                <div className="starter-strip">
                  <span>也可以直接创建</span>
                  <button onClick={() => newNode("image")}>
                    图像 <Plus size={14} />
                  </button>
                  <button onClick={() => newNode("video")}>
                    视频 <Plus size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : view === "director" ? (
          <Suspense fallback={<div className="loading">加载 3D 导演台…</div>}>
            <DirectorStage
              stage={(doc as any).director || defaultStage()}
              onChange={(director) => update((d) => ({ ...d, director }))}
              newId={id}
              onCapture={async (blob, prompt) => {
                const form = new FormData();
                form.append("file", blob, "导演构图.png");
                const asset = await api(`/projects/${project.id}/assets`, {
                  method: "POST",
                  body: form,
                });
                await refresh(project.id);
                newNode("image", prompt, {
                  asset_ids: [asset.id],
                  resolution: "1280x720",
                });
                setView("canvas");
                setNotice("构图已保存，完善场景描述后即可生成");
              }}
            />
          </Suspense>
        ) : view === "grid" ? (
          <StoryboardGrid
            shots={doc.shots}
            nodes={doc.nodes}
            assets={assets}
            onOpen={(shot, index) => {
              if (shot.imageNode) {
                setSelected(shot.imageNode);
                setView("canvas");
              } else shotNodes(shot, index);
            }}
            onExport={async (columns, page) => {
              await save();
              if (dirty.current) throw new Error("请先解决保存冲突");
              const response = await fetch(
                `/api/projects/${project.id}/storyboard-sheet?columns=${columns}&page=${page}`,
              );
              if (!response.ok) throw new Error("分镜图板导出失败");
              const url = URL.createObjectURL(await response.blob());
              const link = document.createElement("a");
              link.href = url;
              link.download = `storyboard-${page}.png`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            }}
          />
        ) : (
          <section className="shot-view">
            <div className="section-title">
              <div>
                <span className="eyebrow">STORYBOARD</span>
                <h2>逐镜构建你的故事</h2>
              </div>
              {doc.shots.length > 0 && (
                <>
                  <button onClick={allShotNodes}>建立全部生成节点</button>
                  <button onClick={appendShotTimeline}>
                    按分镜追加到时间线
                  </button>
                </>
              )}
              <button onClick={() => newNode("storyboard", doc.brief)}>
                <Plus size={16} />
                创建分镜规划
              </button>
            </div>
            {!doc.shots.length ? (
              <div className="empty-state">
                <Layers />
                <h3>还没有分镜</h3>
                <p>生成剧本后，在分镜规划节点中拆解镜头。</p>
                <button
                  className="primary"
                  onClick={() => newNode("storyboard", doc.brief)}
                >
                  开始分镜规划
                </button>
              </div>
            ) : (
              doc.shots.map((shot, index) => (
                <article className="shot-card" key={shot.id}>
                  <div className="shot-number">
                    {String(index + 1).padStart(2, "0")}
                    <span>SHOT</span>
                  </div>
                  <div className="shot-details">
                    <div className="shot-top">
                      <b>{shot.scene || "未命名场景"}</b>
                      <label>
                        <input
                          type="number"
                          value={shot.duration}
                          min="1"
                          max="30"
                          onChange={(e) =>
                            update((d) =>
                              updateShot(d, shot.id, {
                                duration: Number(e.target.value),
                              }),
                            )
                          }
                        />{" "}
                        秒
                      </label>
                    </div>
                    <textarea
                      value={shot.action}
                      onChange={(e) =>
                        update((d) =>
                          updateShot(d, shot.id, { action: e.target.value }),
                        )
                      }
                    />
                    <div className="shot-meta">
                      <span>{shot.camera}</span>
                      <span>
                        <Volume2 size={13} />
                        {shot.audio || "无对白"}
                      </span>
                    </div>
                    {shot.prompts_need_review && (
                      <p className="danger">
                        镜头动作已修改，请核对下方图像和视频提示词。
                        <button
                          onClick={() =>
                            update((d) =>
                              updateShot(d, shot.id, {
                                prompts_need_review: false,
                              }),
                            )
                          }
                        >
                          已核对两项提示词
                        </button>
                      </p>
                    )}
                    <details>
                      <summary>编辑生成提示词（同步到已有节点）</summary>
                      {["image_prompt", "video_prompt"].map((field) => (
                        <label key={field}>
                          {field === "image_prompt" ? "图像" : "视频"}提示词
                          <textarea
                            value={shot[field]}
                            onChange={(e) =>
                              update((d) =>
                                updateShot(d, shot.id, {
                                  [field]: e.target.value,
                                }),
                              )
                            }
                          />
                        </label>
                      ))}
                    </details>
                  </div>
                  <button
                    className="quiet"
                    onClick={() =>
                      doc.nodes.some((n) => n.id === shot.imageNode)
                        ? (setSelected(shot.imageNode), setView("canvas"))
                        : shotNodes(shot, index)
                    }
                  >
                    {shot.imageNode ? "前往画布" : "建立生成节点"}
                    <ArrowUpRight size={15} />
                  </button>
                </article>
              ))
            )}
          </section>
        )}
        {view !== "editor" && timelineOpen && (
          <section className="timeline">
            <div className="timeline-header">
              <button
                disabled={!doc.timeline.length}
                onClick={() => setPreviewTimeline(true)}
              >
                <Play size={14} />
                连续预览
              </button>
              <span>
                <Scissors size={16} />
                时间线{" "}
                <small>
                  {doc.timeline
                    .reduce((sum, t) => sum + Number(t.duration), 0)
                    .toFixed(1)}{" "}
                  秒
                </small>
              </span>
              <label>
                配乐
                <select
                  value={(doc as any).audio_id || ""}
                  onChange={(e) =>
                    update((d) => ({ ...d, audio_id: e.target.value }))
                  }
                >
                  <option value="">无配乐</option>
                  {assets
                    .filter((a) => a.kind === "audio")
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <button className="quiet" onClick={() => setPanel("assets")}>
                <Plus size={14} />
                添加镜头
              </button>
              <button
                className="icon-button"
                onClick={() => setTimelineOpen(false)}
                aria-label="收起时间线"
              >
                <X size={16} />
              </button>
            </div>
            <div className="timeline-clips">
              {!doc.timeline.length ? (
                <p>从素材库将已生成的视频或图片加入时间线</p>
              ) : (
                doc.timeline.map((item, index) => {
                  const a = assets.find((a) => a.id === item.asset_id);
                  return (
                    <div className="timeline-clip" key={item.id}>
                      <Media
                        asset={a}
                        controls={false}
                        retryKey={mediaRetryKey}
                        onFailure={reportMediaFailure}
                        onReady={clearMediaFailure}
                      />
                      <div>
                        <b>
                          {index + 1}. {a?.name || "素材丢失"}
                        </b>
                        <label>
                          起点
                          <input
                            type="number"
                            min="0"
                            value={item.start}
                            onChange={(e) =>
                              update((d) => ({
                                ...d,
                                timeline: d.timeline.map((t) =>
                                  t.id === item.id
                                    ? { ...t, start: Number(e.target.value) }
                                    : t,
                                ),
                              }))
                            }
                          />
                        </label>
                        <label>
                          时长
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={item.duration}
                            onChange={(e) =>
                              update((d) => ({
                                ...d,
                                timeline: d.timeline.map((t) =>
                                  t.id === item.id
                                    ? { ...t, duration: Number(e.target.value) }
                                    : t,
                                ),
                              }))
                            }
                          />
                        </label>
                        <label>
                          原声
                          <input
                            aria-label="片段原声音量"
                            type="range"
                            min="0"
                            max="1"
                            step=".05"
                            value={item.volume ?? 1}
                            onChange={(e) =>
                              update((d) => ({
                                ...d,
                                timeline: d.timeline.map((t) =>
                                  t.id === item.id
                                    ? { ...t, volume: Number(e.target.value) }
                                    : t,
                                ),
                              }))
                            }
                          />
                          <small>{Math.round((item.volume ?? 1) * 100)}%</small>
                        </label>
                        <div className="timeline-clip-actions">
                          <button
                            disabled={index === 0}
                            title="前移"
                            onClick={() =>
                              update((d) => {
                                const timeline = [...d.timeline];
                                [timeline[index - 1], timeline[index]] = [
                                  timeline[index],
                                  timeline[index - 1],
                                ];
                                return { ...d, timeline };
                              })
                            }
                          >
                            <ChevronLeft size={13} />
                          </button>
                          <button
                            disabled={index === doc.timeline.length - 1}
                            title="后移"
                            onClick={() =>
                              update((d) => {
                                const timeline = [...d.timeline];
                                [timeline[index], timeline[index + 1]] = [
                                  timeline[index + 1],
                                  timeline[index],
                                ];
                                return { ...d, timeline };
                              })
                            }
                          >
                            <ChevronRight size={13} />
                          </button>
                          <span className="timeline-clip-action-spacer" />
                          <button
                            className="timeline-clip-remove"
                            title="移除镜头"
                            onClick={() =>
                              update((d) => ({
                                ...d,
                                timeline: d.timeline.filter(
                                  (t) => t.id !== item.id,
                                ),
                              }))
                            }
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="timeline-note">
              保留片段原声。导出面板可添加配乐、字幕和基础转场。
            </div>
          </section>
        )}
      </main>
      {selected && node && !panel && (
        <aside className="inspector">
          <div className="inspector-title">
            <span>{titles[data.kind]}设置</span>
            <button
              className="icon-button"
              onClick={() => setSelected(null)}
              aria-label="关闭属性"
            >
              <X size={17} />
            </button>
          </div>
          <div className="inspector-scroll">
            <label>
              节点名称
              <input
                value={data.label || ""}
                onChange={(e) => editNode({ label: e.target.value })}
              />
            </label>
            <div className="field-heading">
              <label>创作描述</label>
              <button className="quiet" onClick={() => setPanel("prompts")}>
                <Sparkles size={13} />
                模板
              </button>
            </div>
            <textarea
              className="prompt-input"
              value={data.prompt || ""}
              onChange={(e) => editNode({ prompt: e.target.value })}
              placeholder={
                data.kind === "text"
                  ? "故事发生在哪里？主角是谁？你想表达什么？"
                  : "描述主体、画面、动作与镜头…"
              }
            />
            {data.kind === "image" && requiresInitialStateReview(data.prompt) && (
              <div className={data.state_reviewed ? "notice" : "danger"}>
                <b>首帧状态核验</b>
                <span>
                  此图要求呈现动作发生前的状态。请确认画面中的灯光、接触关系和开关状态与提示词一致。
                </span>
                {data.assetId ? (
                  data.state_reviewed ? (
                    <small>已确认；关联视频可以使用这张首帧。</small>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() =>
                        update((d) => setInitialStateReviewed(d, node.id))
                      }
                    >
                      已核对首帧状态
                    </button>
                  )
                ) : (
                  <small>生成图片后，在预览画面核对状态，再确认。</small>
                )}
              </div>
            )}
            {data.kind === "video" && pendingInitialStateNodes.length > 0 && (
              <div className="error">
                <div>
                  <b>生成前需要核验首帧</b>
                  <p>
                    关联分镜图「
                    {pendingInitialStateNodes
                      .map((item) => item?.data.label || "未命名分镜图")
                      .join("、")}
                    」尚未确认动作发生前的画面状态。
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      const first = pendingInitialStateNodes[0];
                      if (first) setSelected(first.id);
                    }}
                  >
                    前往核验首帧
                  </button>
                </div>
              </div>
            )}
            {["text", "storyboard"].includes(data.kind) && (
              <details>
                <summary>阶段规则 · 可编辑</summary>
                <textarea
                  className="prompt-input"
                  value={
                    data.system_prompt || system.templates[data.kind] || ""
                  }
                  onChange={(e) => editNode({ system_prompt: e.target.value })}
                />
              </details>
            )}
            {data.kind === "storyboard" && (
              <label>
                分镜目标总时长（秒）
                <input
                  type="number"
                  min="1"
                  max="3000"
                  value={data.target_duration || doc.duration}
                  onChange={(e) =>
                    editNode({ target_duration: Number(e.target.value) })
                  }
                />
                <small>生成后校验总时长，不合格时自动修正一次。</small>
              </label>
            )}
            <ModelSelector
              data={data}
              providers={config.providers}
              localModels={system.models}
              request={api}
              onChange={(patch) => {
                changeModel(patch);
                if ("provider" in patch) setCloud(false);
              }}
            />
            {config.providers.find(
              (p: Any) => p.id === data.provider && !p.local,
            ) && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={cloud}
                  onChange={(e) => setCloud(e.target.checked)}
                />
                允许本次使用云端服务，按供应商计费
              </label>
            )}
            {data.kind === "video" &&
              ["minimax", "volcengine_ark"].includes(
                config.providers.find((p: Any) => p.id === data.provider)
                  ?.type,
              ) &&
              (() => {
                const references = sourceAssets(node.id) as string[];
                const providerType = config.providers.find(
                  (p: Any) => p.id === data.provider,
                )?.type;
                const providerName =
                  providerType === "volcengine_ark" ? "Seedance" : "MiniMax";
                return (
                  <label>
                    首帧（可选，图生视频）
                    <select
                      value={references.length === 1 ? references[0] : ""}
                      onChange={(e) =>
                        setSingleFirstFrame(e.target.value, providerName)
                      }
                    >
                      <option value="">不指定首帧</option>
                      {assets
                        .filter((a) => a.kind === "image")
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                    <small>
                      选择素材会清除本节点的图像连线和尾帧，只保留这一张首帧；文字连线不受影响。允许云端任务后该图会发送到供应商。
                    </small>
                    {references.length > 1 && (
                      <small className="error">
                        当前已有 {references.length} 张图像参考，{providerName}
                        只能使用一张。请选择一张素材以整理引用。
                      </small>
                    )}
                  </label>
                );
              })()}
            {["image", "video"].includes(data.kind) &&
              !(
                data.kind === "video" &&
                ["minimax", "volcengine_ark"].includes(
                  config.providers.find((p: Any) => p.id === data.provider)
                    ?.type,
                )
              ) && (
                <>
                  <div className="two-fields">
                    <label>
                      分辨率
                      <select
                        value={data.resolution || "832x480"}
                        onChange={(e) =>
                          editNode({ resolution: e.target.value })
                        }
                      >
                        <option>832x480</option>
                        <option>864x480</option>
                        <option>512x512</option>
                        <option>1280x720</option>
                        <option>720x1280</option>
                        <option>1024x1024</option>
                        <option>1024x512</option>
                      </select>
                    </label>
                    <label>
                      随机种子
                      <input
                        type="number"
                        value={data.seed ?? -1}
                        onChange={(e) =>
                          editNode({ seed: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  {data.kind === "video" && (
                    <label>
                      尾帧（可选，仅适用模型）
                      <select
                        value={data.end_asset_id || ""}
                        onChange={(e) =>
                          editNode({ end_asset_id: e.target.value })
                        }
                      >
                        <option value="">不使用尾帧</option>
                        {assets
                          .filter((a) => a.kind === "image")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                      <small>
                        连线或引用图作为首帧，尾帧用于约束镜头结束画面。
                      </small>
                    </label>
                  )}
                  <div className="field-heading">
                    <label>参考素材 · {sourceAssets(node.id).length}</label>
                    <button
                      className="quiet"
                      onClick={() => setPanel("assets")}
                    >
                      <Plus size={14} />
                      引用
                    </button>
                  </div>
                  <div className="reference-strip">
                    {sourceAssets(node.id).map((aid, referenceIndex) => {
                      const a = assets.find((a) => a.id === aid);
                      return a ? (
                        <div className="reference-item" key={String(aid)}>
                          <span className="reference-index">图 {referenceIndex + 1}</span>
                          <button onClick={() => setPreview(a)} title={a.name}>
                            <Media
                              asset={a}
                              controls={false}
                              retryKey={mediaRetryKey}
                              onFailure={reportMediaFailure}
                              onReady={clearMediaFailure}
                            />
                          </button>
                          <button
                            className="reference-remove"
                            title="移除引用及对应连线"
                            aria-label={"移除引用 " + a.name}
                            onClick={() =>
                              update((d) =>
                                removeReference(d, node.id, String(aid)),
                              )
                            }
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : null;
                    })}
                  </div>
                </>
              )}
            {activeJob?.status === "failed" && (
              <div className="error">
                <AlertCircle size={16} />
                {activeJob.error}
              </div>
            )}
            {activeJob && ["running", "queued"].includes(activeJob.status) && (
              <div className="job-running">
                <LoaderCircle className="spin" size={16} />
                <span>{activeJob.phase || "等待服务器执行"}</span>
                {activeJob.progress != null && (
                  <b>{Math.round(activeJob.progress)}%</b>
                )}
                <button
                  className="quiet"
                  onClick={() =>
                    api(`/jobs/${activeJob.id}/cancel`, send("POST"))
                      .then(() => refresh(project.id))
                      .catch(report)
                  }
                >
                  取消
                </button>
              </div>
            )}
            {data.text && (
              <details open>
                <summary>生成结果</summary>
                <div className="generated-text">{data.text}</div>
                {data.kind === "text" && (
                  <button
                    className="secondary"
                    onClick={() =>
                      newNode("storyboard", String(data.text), {}, node.id)
                    }
                  >
                    <Layers size={15} />
                    继续拆解分镜
                  </button>
                )}
                {data.kind === "storyboard" && activeJob?.result?.shots && (
                  <button
                    className="secondary"
                    onClick={() => adoptShots(activeJob)}
                  >
                    导入分镜表
                  </button>
                )}
              </details>
            )}
            {data.assetId && assets.find((a) => a.id === data.assetId) && (
              <div className="result-preview">
                <Media
                  asset={assets.find((a) => a.id === data.assetId)}
                  retryKey={mediaRetryKey}
                  onFailure={reportMediaFailure}
                  onReady={clearMediaFailure}
                />
                <button
                  onClick={() =>
                    addTimeline(assets.find((a) => a.id === data.assetId)!)
                  }
                >
                  <Scissors size={15} />
                  加入时间线
                </button>
              </div>
            )}
            <details>
              <summary>
                历史生成 · {jobs.filter((j) => j.node_id === selected).length}
              </summary>
              {jobs
                .filter((j) => j.node_id === selected)
                .map((j) => (
                  <div className="take" key={j.id}>
                    <span>
                      {new Date(j.created * 1000).toLocaleTimeString()} ·{" "}
                      {states[j.status]}
                    </span>
                    {j.result?.assets?.[0] && (
                      <button
                        onClick={() =>
                          editNode({
                            assetId: j.result.assets[0].id,
                            resultJob: j.id,
                            stale: true,
                          })
                        }
                      >
                        使用此版本
                      </button>
                    )}
                    {j.result?.text && (
                      <button
                        onClick={() =>
                          editNode({
                            text: j.result.text,
                            resultJob: j.id,
                            stale: true,
                          })
                        }
                      >
                        使用此文本
                      </button>
                    )}
                  </div>
                ))}
            </details>
          </div>
          <div className="inspector-bottom">
            <button
              className="icon-button"
              onClick={() => {
                newNode(data.kind, data.prompt, {
                  ...data,
                  assetId: undefined,
                  text: undefined,
                  resultJob: undefined,
                });
              }}
              title="复制节点"
            >
              <Copy size={17} />
            </button>
            <button
              className="icon-button"
              onClick={removeNode}
              title="移除节点"
            >
              <Trash2 size={17} />
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                ["running", "queued"].includes(activeJob?.status || "") ||
                !data.prompt?.trim()
              }
              onClick={() => run()}
            >
              <Play size={16} />
              {data.resultJob ? "重新生成" : "开始生成"}
            </button>
          </div>
        </aside>
      )}
      {panel && (
        <div
          className={
            "side-panel " +
            (["settings", "assets", "jobs", "characters"].includes(panel)
              ? "wide"
              : "")
          }
        >
          <div className="panel-title">
            <h2>
              {
                {
                  add: "添加节点",
                  projects: "我的项目",
                  assets: "素材库",
                  jobs: "生成任务",
                  settings: "模型与工作室",
                  prompts: "提示词模板",
                  history: "历史版本",
                  characters: "角色与场景",
                  export: "导出成片",
                  run: "运行工作流",
                }[panel]
              }
            </h2>
            <button
              className="icon-button"
              onClick={() => setPanel(null)}
              aria-label="关闭面板"
            >
              <X size={19} />
            </button>
          </div>
          <div className="panel-scroll">
            {panel === "run" && (
              <RunWorkflow
                nodes={doc.nodes}
                edges={doc.edges}
                providers={config.providers}
                selected={selected}
                onRun={runGraph}
              />
            )}
            {panel === "add" && (
              <div className="node-menu">
                {["text", "storyboard", "image", "video"].map((kind) => {
                  const Icon = icons[kind];
                  return (
                    <button key={kind} onClick={() => newNode(kind)}>
                      <Icon />
                      <div>
                        <b>{titles[kind]}</b>
                        <span>
                          {
                            {
                              text: "从故事概念开始",
                              storyboard: "将剧本拆解为镜头",
                              image: "生成画面与角色定妆",
                              video: "生成动态镜头",
                            }[kind]
                          }
                        </span>
                      </div>
                      <Plus size={17} />
                    </button>
                  );
                })}
                <button onClick={() => fileInput.current?.click()}>
                  <Upload />
                  <div>
                    <b>导入素材</b>
                    <span>图片、视频、声音与字幕</span>
                  </div>
                </button>
              </div>
            )}
            {panel === "projects" && (
              <>
                {sessionStorage.getItem("yingxu-conflict-" + project.id) && (
                  <div className="error">
                    <p>
                      本页保留了一份冲突草稿。恢复后将作为新的编辑保存；主机当前版本仍可在历史版本中找到。
                    </p>
                    <button
                      onClick={() => {
                        try {
                          const draft = JSON.parse(
                            sessionStorage.getItem(
                              "yingxu-conflict-" + project.id,
                            )!,
                          );
                          update(() => draft.document);
                          setProject({ ...project, name: draft.name });
                          setNotice("冲突草稿已恢复为当前编辑");
                        } catch (e) {
                          report(e);
                        }
                      }}
                    >
                      恢复本页冲突草稿
                    </button>
                  </div>
                )}
                <button
                  className="primary full"
                  onClick={() => {
                    if (
                      window.confirm(
                        "新建一个空白项目？当前项目会先保存；若存在保存冲突，会在本浏览器保留草稿。",
                      )
                    )
                      createProject().catch(report);
                  }}
                >
                  <Plus size={16} />
                  新建项目
                </button>
                {canDeleteCurrentProject && (
                  <button
                    className="full"
                    onClick={() => deleteCurrentProject().catch(report)}
                  >
                    <Trash2 size={16} />
                    删除空项目
                  </button>
                )}
                <label>
                  当前项目名称
                  <input
                    value={project.name}
                    onChange={(e) => {
                      setProject({ ...project, name: e.target.value });
                      dirty.current = true;
                      setSaved("未保存");
                    }}
                  />
                </label>
                <div className="two-fields">
                  <label>
                    画幅
                    <select
                      value={doc.ratio}
                      onChange={(e) =>
                        update((d) => ({ ...d, ratio: e.target.value }))
                      }
                    >
                      <option>16:9</option>
                      <option>9:16</option>
                      <option>1:1</option>
                    </select>
                  </label>
                  <label>
                    目标时长
                    <input
                      type="number"
                      min="5"
                      value={doc.duration}
                      onChange={(e) =>
                        update((d) => ({
                          ...d,
                          duration: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  视觉风格
                  <input
                    value={doc.style}
                    onChange={(e) =>
                      update((d) => ({ ...d, style: e.target.value }))
                    }
                  />
                </label>
                <label>
                  故事概要
                  <textarea
                    value={doc.brief}
                    onChange={(e) =>
                      update((d) => ({ ...d, brief: e.target.value }))
                    }
                  />
                </label>
                <hr />
                {projects.map((p) => (
                  <button
                    className={
                      "project-row " + (p.id === project.id ? "active" : "")
                    }
                    key={p.id}
                    onClick={() => openProject(p.id).catch(report)}
                  >
                    <Clapperboard size={19} />
                    <div>
                      <b>{p.id === project.id ? project.name : p.name}</b>
                      <small>
                        {new Date(p.updated * 1000).toLocaleDateString()}
                      </small>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </>
            )}
            {panel === "assets" && (
              <>
                <button
                  className="secondary full"
                  onClick={() =>
                    newNode(
                      "image",
                      "生成 360 度等距柱状全景环境图，2:1 画幅，完整覆盖四周环境，上下分别为天空与地面，左右边缘连续，地平线位于画面中线，无文字。场景：",
                      { resolution: "1024x512" },
                    )
                  }
                >
                  创建全景图节点
                </button>
                <button
                  className="secondary full"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={16} />
                  上传素材
                </button>
                <div className="asset-grid">
                  {assets.map((a) => (
                    <article className="asset-card" key={a.id}>
                      <button
                        className="asset-visual"
                        onClick={() => setPreview(a)}
                      >
                        <Media
                          asset={a}
                          controls={false}
                          retryKey={mediaRetryKey}
                          onFailure={reportMediaFailure}
                          onReady={clearMediaFailure}
                        />
                      </button>
                      <b title={a.name}>{a.name}</b>
                      <div>
                        {a.kind === "image" && (
                          <button onClick={() => setPanorama(a)}>
                            全景构图
                          </button>
                        )}
                        {selected && a.kind === "image" && (
                          <button
                            onClick={() => {
                              editNode({
                                asset_ids: [
                                  ...new Set([...(data.asset_ids || []), a.id]),
                                ],
                              });
                              setPanel(null);
                            }}
                          >
                            引用
                          </button>
                        )}
                        {["image", "video"].includes(a.kind) && (
                          <button onClick={() => addTimeline(a)}>
                            入时间线
                          </button>
                        )}
                        <a href={a.url} download={a.name} title="下载">
                          <Download size={14} />
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
                {!assets.length && (
                  <div className="empty-state">
                    <FolderOpen />
                    <h3>你的素材将保存在这里</h3>
                    <p>上传参考图，或生成第一个镜头。</p>
                  </div>
                )}
              </>
            )}
            {panel === "jobs" && (
              <>
                <p className="muted">
                  任务在主机持续执行。失败时保留输入和已完成的结果。
                </p>
                {jobs.map((j) => (
                  <article className="job-card" key={j.id}>
                    <div>
                      <span className={"job-state " + j.status}>
                        {j.status === "running" ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : j.status === "succeeded" ? (
                          <Check size={15} />
                        ) : (
                          <Clock size={15} />
                        )}{" "}
                        {states[j.status]}
                      </span>
                      <small>
                        {new Date(j.created * 1000).toLocaleString()}
                      </small>
                    </div>
                    <b>
                      {titles[j.kind] || "成片导出"} ·{" "}
                      {String(j.input.prompt || "时间线合成").slice(0, 70)}
                    </b>
                    <p>{j.phase}</p>
                    <JobProgress job={j} />
                    {j.error && <div className="error">{j.error}</div>}
                    {j.result?.assets?.map((a: Any) => (
                      <a
                        className="download-link"
                        href={a.url}
                        download={a.name}
                        key={a.id}
                      >
                        <Download size={14} />
                        {a.name}
                      </a>
                    ))}
                    {j.result?.shots && (
                      <button onClick={() => adoptShots(j)}>导入分镜表</button>
                    )}
                    {j.status === "interrupted" && j.provider_job_id && (
                      <button
                        onClick={() =>
                          api(`/jobs/${j.id}/resume`, send("POST"))
                            .then(() => refresh(project.id))
                            .catch(report)
                        }
                      >
                        恢复查询已有任务
                      </button>
                    )}
                    {j.status === "interrupted" && !j.provider_job_id && (
                      <p className="muted">
                        未取得上游编号，无法确认是否已提交。请先核对服务，再从节点重新生成。
                      </p>
                    )}
                    {["running", "queued", "interrupted"].includes(
                      j.status,
                    ) && (
                      <button
                        onClick={() =>
                          api(`/jobs/${j.id}/cancel`, send("POST"))
                            .then(() => refresh(project.id))
                            .catch(report)
                        }
                      >
                        取消任务
                      </button>
                    )}
                    <button
                      className="quiet"
                      onClick={() => {
                        setSelected(j.node_id);
                        setPanel(null);
                        setView("canvas");
                      }}
                    >
                      查看节点
                    </button>
                  </article>
                ))}
                {!jobs.length && (
                  <div className="empty-state">
                    <Clock />
                    <h3>还没有生成任务</h3>
                  </div>
                )}
              </>
            )}
            {panel === "export" && (
              <>
                <div className="export-summary">
                  <Film size={30} />
                  <h3>{project.name}</h3>
                  <p>
                    {hasEditorTimeline
                      ? `${persistedEditorTimeline!.tracks.length} 条编辑轨 · ${Math.max(0, ...persistedEditorTimeline!.tracks.flatMap((track) => track.elements.map((element) => Number(element.e) || 0))).toFixed(2)} 秒`
                      : `${doc.timeline.length} 个镜头 · ${doc.timeline.reduce((sum, t) => sum + Number(t.duration), 0).toFixed(2)} 秒`}
                  </p>
                </div>
                <label>
                  导出分辨率
                  <select
                    value={(doc as any).export_resolution || "1280x720"}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        export_resolution: e.target.value,
                      }))
                    }
                  >
                    <option value="1280x720">720P · 横屏</option>
                    <option value="1920x1080">1080P · 横屏</option>
                    <option value="720x1280">720P · 竖屏</option>
                    <option value="1080x1920">1080P · 竖屏</option>
                    <option value="1080x1080">1080 · 方形</option>
                  </select>
                </label>
                <label>
                  转场
                  <select
                    disabled={hasEditorTimeline}
                    value={(doc as any).transition || "cut"}
                    onChange={(e) =>
                      update((d) => ({ ...d, transition: e.target.value }))
                    }
                  >
                    <option value="cut">直接切换</option>
                    <option value="fade">淡入淡出</option>
                  </select>
                </label>
                <label>
                  背景配乐
                  <select
                    disabled={hasEditorTimeline}
                    value={(doc as any).audio_id || ""}
                    onChange={(e) =>
                      update((d) => ({ ...d, audio_id: e.target.value }))
                    }
                  >
                    <option value="">不添加</option>
                    {assets
                      .filter((a) => a.kind === "audio")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  配乐音量 ·{" "}
                  {Math.round(((doc as any).music_volume ?? 0.3) * 100)}%
                  <input
                    disabled={hasEditorTimeline}
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={(doc as any).music_volume ?? 0.3}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        music_volume: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  烧录字幕（SRT）
                  <select
                    disabled={hasEditorTimeline}
                    value={(doc as any).subtitle_id || ""}
                    onChange={(e) =>
                      update((d) => ({ ...d, subtitle_id: e.target.value }))
                    }
                  >
                    <option value="">不添加</option>
                    {assets
                      .filter((a) => a.kind === "subtitle")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="quiet"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} />
                  上传配乐或字幕
                </button>
                <p className="muted">
                  {hasEditorTimeline
                    ? "当前导出 Twick 多轨工程。配乐、字幕、转场和音量请在剪辑工作区中调整。输出为 24fps H.264/AAC MP4。"
                    : "MP4 / H.264 / 24fps。保留镜头原声，配乐循环填充时间线。字幕烧录进视频画面。"}
                </p>
                <button
                  className="primary full"
                  disabled={!doc.timeline.length && !hasEditorTimeline}
                  onClick={() => void exportFilm()}
                >
                  <Download size={17} />
                  开始导出
                </button>
              </>
            )}
            {panel === "settings" && (
              <SettingsPanel
                config={config}
                system={system}
                onSave={async (value) => {
                  setConfig(await api("/settings", send("PUT", value)));
                  setSystem(await api("/system"));
                  setNotice("设置已保存");
                }}
                onRefresh={async () => setSystem(await api("/system"))}
                onError={report}
                onLogout={async () => {
                  await save();
                  await api("/auth/logout", send("POST"));
                  onLogout();
                }}
              />
            )}
            {panel === "prompts" && (
              <PromptLibrary
                templates={system.templates}
                request={api}
                newId={id}
                onApply={(kind, content) => {
                  const patch = ["text", "storyboard"].includes(kind)
                    ? { system_prompt: content }
                    : { prompt: content };
                  if (selected && data.kind === kind) editNode(patch);
                  else newNode(kind, "", patch);
                  setPanel(null);
                  setNotice("模板已应用，可继续编辑");
                }}
              />
            )}
            {panel === "history" && (
              <>
                {revisions.map((r) => (
                  <div className="history-row" key={r.id}>
                    <div>
                      <b>版本 {r.revision}</b>
                      <small>
                        {new Date(r.created * 1000).toLocaleString()}
                      </small>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const old = await api(
                            `/projects/${project.id}/revisions/${r.id}`,
                          );
                          update(() => old.document);
                          setPanel(null);
                          setNotice("历史版本已载入，当前内容会另存为新版本");
                        } catch (e) {
                          report(e);
                        }
                      }}
                    >
                      恢复
                    </button>
                  </div>
                ))}
                {!revisions.length && (
                  <p className="muted">保存项目后会自动保留历史版本。</p>
                )}
              </>
            )}
            {panel === "characters" && (
              <>
                <p className="muted">
                  建立可复用的角色与场景设定，绑定参考图锁定外观。
                </p>
                <button
                  className="secondary full"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      characters: [
                        ...d.characters,
                        {
                          id: id(),
                          name: "新角色",
                          description: "",
                          asset_id: "",
                        },
                      ],
                    }))
                  }
                >
                  <Plus size={16} />
                  添加角色 / 场景
                </button>
                {doc.characters.map((c) => (
                  <article className="character-card" key={c.id}>
                    <label>
                      名称
                      <input
                        value={c.name}
                        onChange={(e) =>
                          update((d) => ({
                            ...d,
                            characters: d.characters.map((x) =>
                              x.id === c.id
                                ? { ...x, name: e.target.value }
                                : x,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      固定设定
                      <textarea
                        value={c.description}
                        placeholder="外观、服装、材质或场景特征"
                        onChange={(e) =>
                          update((d) => ({
                            ...d,
                            characters: d.characters.map((x) =>
                              x.id === c.id
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      参考图
                      <select
                        value={c.asset_id}
                        onChange={(e) =>
                          update((d) => ({
                            ...d,
                            characters: d.characters.map((x) =>
                              x.id === c.id
                                ? { ...x, asset_id: e.target.value }
                                : x,
                            ),
                          }))
                        }
                      >
                        <option value="">选择素材</option>
                        {assets
                          .filter((a) => a.kind === "image")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {selected && (
                      <button
                        onClick={() => {
                          editNode({
                            prompt:
                              (data.prompt || "") +
                              "\n角色/场景 " +
                              c.name +
                              "：" +
                              c.description,
                            asset_ids: c.asset_id
                              ? [
                                  ...new Set([
                                    ...(data.asset_ids || []),
                                    c.asset_id,
                                  ]),
                                ]
                              : data.asset_ids || [],
                          });
                          setPanel(null);
                        }}
                      >
                        <Link2 size={14} />
                        引用到当前节点
                      </button>
                    )}
                  </article>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      <input
        type="file"
        ref={fileInput}
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/*,.srt"
        hidden
        onChange={(e) => {
          uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {conflict && (
        <div className="modal-overlay">
          <div
            className="panorama-modal"
            role="dialog"
            aria-modal="true"
            aria-label="解决保存冲突"
          >
            <h2>项目已在另一页面更新</h2>
            <p>
              本页编辑仍然保留，自动保存已暂停。先将本页草稿下载为 JSON
              备份，再载入主机最新版本继续编辑。
            </p>
            <button
              className="primary"
              disabled={recoveryBusy}
              onClick={recoverConflict}
            >
              {recoveryBusy ? "正在载入" : "备份本页草稿并载入最新版本"}
            </button>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
      {syncFailure && (
        <div className={`sync-toast ${syncFailure.kind}`} role="status">
          {syncFailure.kind === "api" ? (
            <RefreshCw size={18} className="spin" />
          ) : (
            <AlertCircle size={18} />
          )}
          <div>
            <strong>
              {syncFailure.kind === "api"
                ? "API 请求失败"
                : syncFailure.kind === "sse"
                  ? "SSE 实时连接断开"
                  : "媒体文件加载失败"}
            </strong>
            <span>{syncFailure.message}</span>
            <small>
              开发调试 · 请求 URL：<code>{syncFailure.url}</code>
            </small>
          </div>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="关闭错误">
            <X size={16} />
          </button>
        </div>
      )}
      {panorama && (
        <PanoramaViewer
          asset={panorama}
          onClose={() => setPanorama(null)}
          onSave={async (blob, name) => {
            const form = new FormData();
            form.append("file", blob, name);
            await api(`/projects/${project.id}/assets`, {
              method: "POST",
              body: form,
            });
            await refresh(project.id);
            setNotice("全景构图已保存，可引用到生成节点");
          }}
        />
      )}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="media-modal" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3>{preview.name}</h3>
              <button
                className="icon-button"
                onClick={() => setPreview(null)}
                aria-label="关闭预览"
              >
                <X />
              </button>
            </div>
            <Media
              asset={preview}
              retryKey={mediaRetryKey}
              onFailure={reportMediaFailure}
              onReady={clearMediaFailure}
            />
            <a
              className="download-link"
              href={preview.url}
              download={preview.name}
            >
              <Download size={16} />
              下载原文件
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  config,
  system,
  onSave,
  onRefresh,
  onError,
  onLogout,
}: {
  config: Any;
  system: Any;
  onSave: (v: Any) => Promise<void>;
  onRefresh: () => Promise<void>;
  onError: (e: any) => void;
  onLogout: () => void;
}) {
  const [value, setValue] = useState<Any>(config),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  function patchProvider(index: number, patch: Any) {
    setValue({
      ...value,
      providers: value.providers.map((p: Any, i: number) =>
        i === index ? { ...p, ...patch } : p,
      ),
    });
  }
  function clearEnteredApiKeys() {
    setValue((current: Any) => ({
      ...current,
      providers: current.providers.map((provider: Any) => {
        if (!("api_key" in provider)) return provider;
        const { api_key, ...masked } = provider;
        return { ...masked, api_key_set: Boolean(api_key || provider.api_key_set) };
      }),
    }));
  }
  async function save() {
    setBusy(true);
    try {
      await onSave(value);
      clearEnteredApiKeys();
      setStatus("设置已保存");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function testArk(providerId: string) {
    setBusy(true);
    try {
      await onSave(value);
      clearEnteredApiKeys();
      const result = await api(`/providers/${encodeURIComponent(providerId)}/test`, send("POST"));
      setStatus(result.message || "火山方舟连接成功");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="hardware-card">
        <Monitor size={23} />
        <div>
          <b>{system.hardware.name}</b>
          <span>
            {system.hardware.total_mb
              ? `${(system.hardware.free_mb / 1024).toFixed(1)} / ${(system.hardware.total_mb / 1024).toFixed(0)} GB 显存可用`
              : "可连接本地或远端推理服务"}
          </span>
        </div>
        <button
          className="icon-button"
          onClick={() => onRefresh().catch(onError)}
          title="刷新状态"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="muted">
        内置推理基于 Maestro /
        WanGP，供个人非商业学习使用。推理代码、环境和模型路径均在本项目内。
      </p>
      <h3>默认模型组件</h3>
      {system.inventory?.models?.map((group: Any) => (
        <details className="model-inventory" key={group.kind}>
          <summary>
            {group.ready ? "文件齐全" : "缺少文件"} · {group.name}
          </summary>
          {group.files.map((file: Any) => (
            <p
              className={file.present ? "muted" : "error"}
              key={file.path}
              title={file.path}
            >
              {file.present ? "✓" : "缺失"} {file.name} · {file.size_gb} GB
            </p>
          ))}
        </details>
      ))}
      <h3>本地文本模型</h3>
      <div className="model-list">
        {system.models.map((m: Any) => (
          <div key={m.id}>
            <FileText size={15} />
            <span title={m.id}>{m.name}</span>
            <small>{m.size_gb} GB</small>
          </div>
        ))}
      </div>
      <label>
        额外模型目录（每行一个）
        <textarea
          value={(value.model_directories || []).join("\n")}
          onChange={(e) =>
            setValue({
              ...value,
              model_directories: e.target.value.split("\n").filter(Boolean),
            })
          }
        />
      </label>
      <div className="two-fields">
        <label>
          上下文长度
          <input
            type="number"
            min="1024"
            max="65536"
            value={value.llama_context}
            onChange={(e) =>
              setValue({ ...value, llama_context: Number(e.target.value) })
            }
          />
        </label>
        <label>
          GPU 层数（-1 自动）
          <input
            type="number"
            min="-1"
            max="999"
            value={value.llama_gpu_layers}
            onChange={(e) =>
              setValue({ ...value, llama_gpu_layers: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <button
        className="quiet"
        onClick={() =>
          api("/runtime/unload", send("POST"))
            .then(() => {
              setStatus("文本模型已卸载");
              onRefresh();
            })
            .catch(onError)
        }
      >
        卸载空闲文本模型
      </button>
      <h3>模型服务</h3>
      <p className="muted">
        本地模型默认不调用云端。图像和视频请选择配置好的服务。
      </p>
      {value.providers.map((p: Any, i: number) => (
        <article className="provider-card" key={p.id}>
          <div className="field-heading">
            <input
              aria-label="服务名称"
              value={p.name}
              onChange={(e) => patchProvider(i, { name: e.target.value })}
            />
            <button
              className="icon-button"
              title="移除服务配置"
              onClick={() =>
                setValue({
                  ...value,
                  providers: value.providers.filter(
                    (_: Any, k: number) => k !== i,
                  ),
                })
              }
            >
              <X size={16} />
            </button>
          </div>
          <div className="two-fields">
            <label>
              接口类型
              <select
                value={p.type}
                onChange={(e) =>
                  patchProvider(
                    i,
                    e.target.value === "volcengine_ark"
                      ? {
                          type: e.target.value,
                          kind: undefined,
                          local: false,
                          url: "https://ark.cn-beijing.volces.com/api/v3",
                          models: p.models || { text: "", image: "", video: "" },
                        }
                      : p.type === "volcengine_ark"
                        ? { type: e.target.value, kind: "text", model: p.models?.text || "", models: undefined }
                        : { type: e.target.value },
                  )
                }
              >
                <option value="openai">OpenAI 兼容文本 / 图像</option>
                <option value="maestro">内置 / WanGP 兼容引擎</option>
                <option value="comfy">ComfyUI 工作流</option>
                <option value="video_api">异步视频 JSON 网关</option>
                <option value="minimax">MiniMax 原生视频</option>
                <option value="replicate">Replicate 模型平台</option>
                <option value="volcengine_ark">火山方舟（文本 / 图像 / 视频）</option>
              </select>
            </label>
            {p.type === "volcengine_ark" ? (
              <label>用途<input value="统一：文本、图像、视频" readOnly /></label>
            ) : (
              <label>
                用途
                <select
                  value={p.kind || "text"}
                  onChange={(e) => patchProvider(i, { kind: e.target.value })}
                >
                  <option value="text">文本</option>
                  <option value="image">图像</option>
                  <option value="video">视频</option>
                </select>
              </label>
            )}
          </div>
          <label>
            服务地址
            <input
              value={p.url}
              onChange={(e) => patchProvider(i, { url: e.target.value })}
              placeholder="http://127.0.0.1:8188"
            />
          </label>
          {p.type === "volcengine_ark" ? (
            <>
              <label>文本模型 ID<input value={p.models?.text || ""} onChange={(e) => patchProvider(i, { models: { ...p.models, text: e.target.value } })} /></label>
              <label>图片模型 ID<input value={p.models?.image || ""} onChange={(e) => patchProvider(i, { models: { ...p.models, image: e.target.value } })} /></label>
              <label>视频模型 ID<input value={p.models?.video || ""} onChange={(e) => patchProvider(i, { models: { ...p.models, video: e.target.value } })} /></label>
              <label>Seedream 参考图上限<input type="number" min="1" max="10" value={p.parameters?.image?.max_references ?? 10} onChange={(e) => patchProvider(i, { parameters: { ...p.parameters, image: { ...p.parameters?.image, max_references: Number(e.target.value) } } })} /><small>按当前图片模型能力设置，最多 10 张；图片会在服务端编码后发送。</small></label>
            </>
          ) : (
            <label>
              默认模型 ID
              <input
                value={p.model || ""}
                onChange={(e) => patchProvider(i, { model: e.target.value })}
              />
            </label>
          )}
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              placeholder={
                p.api_key_set ? "已保存，留空保持不变" : "本地服务可留空"
              }
              value={p.api_key || ""}
              onChange={(e) => patchProvider(i, { api_key: e.target.value })}
            />
          </label>
          {p.type === "volcengine_ark" ? (
            <p className="muted">云端服务；运行节点前必须明确允许云端调用。</p>
          ) : (
            <label className="check-label">
              <input
                type="checkbox"
                checked={!!p.local}
                onChange={(e) => patchProvider(i, { local: e.target.checked })}
              />
              本地服务，不产生云端调用费用
            </label>
          )}
          {p.type === "volcengine_ark" && (
            <>
              <p className="muted">一个 ARK API Key 统一调用豆包文本、Seedream 文生图/多参考图与 Seedance 文生视频/单首帧图生视频。任务只保存素材 ID；参考图内容仅由服务端读取并编码。</p>
              <button className="secondary full" disabled={busy} onClick={() => void testArk(p.id)}>保存并测试连接</button>
            </>
          )}
          {p.type === "comfy" && (
            <label>
              API 工作流 JSON
              <textarea
                className="code-input"
                defaultValue={JSON.stringify(p.workflow || {}, null, 2)}
                onBlur={(e) => {
                  try {
                    patchProvider(i, { workflow: JSON.parse(e.target.value) });
                  } catch {
                    onError(new Error("工作流 JSON 格式不正确"));
                  }
                }}
              />
              <small>
                使用{" "}
                {
                  "{{prompt}}、{{seed}}、{{width}}、{{height}}、{{frames}}、{{image}}"
                }{" "}
                占位符。
              </small>
            </label>
          )}
          {p.type === "minimax" && (
            <>
              <p className="muted">
                地址填写 https://api.minimax.io/v1 或国内
                https://api.minimax.cn/v1，用途选视频，模型填
                MiniMax-Hailuo-2.3。支持文生视频与单首帧图生视频；停止本地等待不会取消供应商计费。
              </p>
              <label>
                云端视频时长
                <select
                  value={p.parameters?.duration || 6}
                  onChange={(e) =>
                    patchProvider(i, {
                      parameters: {
                        ...p.parameters,
                        duration: Number(e.target.value),
                      },
                    })
                  }
                >
                  <option value={6}>6 秒</option>
                  <option value={10}>10 秒（768P）</option>
                </select>
              </label>
              <label>
                云端分辨率
                <select
                  value={p.parameters?.resolution || "768P"}
                  onChange={(e) =>
                    patchProvider(i, {
                      parameters: {
                        ...p.parameters,
                        resolution: e.target.value,
                      },
                    })
                  }
                >
                  <option>768P</option>
                  <option>1080P</option>
                </select>
              </label>
            </>
          )}
          {p.type === "replicate" && (
            <>
              <p className="muted">
                地址默认 https://api.replicate.com/v1。官方模型填写 owner/model，例如
                bytedance/seedance-1-pro、kwaiyeij/kling-v2.1 或
                black-forest-labs/flux-1.1-pro；社区模型填写 owner/model:版本 ID。取消会请求停止对应云端 prediction。
              </p>
              <label>
                输入模板 JSON
                <textarea
                  className="code-input"
                  defaultValue={JSON.stringify(
                    p.parameters?.input || { prompt: "{{prompt}}" },
                    null,
                    2,
                  )}
                  onBlur={(e) => {
                    try {
                      const input = JSON.parse(e.target.value);
                      if (!input || Array.isArray(input) || typeof input !== "object") throw new Error();
                      patchProvider(i, { parameters: { ...p.parameters, input } });
                    } catch {
                      onError(new Error("Replicate 输入模板必须是 JSON 对象"));
                    }
                  }}
                />
                <small>
                  使用 {"{{prompt}}、{{image}}、{{images}}"}。各模型的输入字段不同；单图可映射到 image、first_frame 等字段。
                </small>
              </label>
            </>
          )}
          {p.type === "video_api" && (
            <>
              <label>
                提交路径
                <input
                  value={p.submit_path || "/videos"}
                  onChange={(e) =>
                    patchProvider(i, { submit_path: e.target.value })
                  }
                />
              </label>
              <label>
                查询路径
                <input
                  value={p.status_path || "/videos/{id}"}
                  onChange={(e) =>
                    patchProvider(i, { status_path: e.target.value })
                  }
                />
              </label>
              <small>需匹配返回 id、status 与 video_url 的网关协议。</small>
            </>
          )}
        </article>
      ))}
      <div className="settings-actions">
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "新服务",
                  type: "openai",
                  url: "http://127.0.0.1:8080/v1",
                  local: true,
                  kind: "text",
                  model: "",
                },
              ],
            })
          }
        >
          <Plus size={15} />
          添加服务
        </button>
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "Replicate 视频",
                  type: "replicate",
                  url: "https://api.replicate.com/v1",
                  local: false,
                  kind: "video",
                  model: "bytedance/seedance-1-pro",
                  parameters: { input: { prompt: "{{prompt}}" } },
                },
              ],
            })
          }
        >
          添加 Replicate
        </button>
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "火山方舟",
                  type: "volcengine_ark",
                  url: "https://ark.cn-beijing.volces.com/api/v3",
                  local: false,
                  models: {
                    text: "doubao-seed-2-1-pro-260628",
                    image: "doubao-seedream-5-0-260128",
                    video: "doubao-seedance-2-0-260128",
                  },
                  parameters: {
                    image: { size: "2K", watermark: false, max_references: 10 },
                    video: { duration: 5, resolution: "720p", ratio: "16:9", generate_audio: true },
                  },
                },
              ],
            })
          }
        >
          添加火山方舟
        </button>
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "Maestro 图像",
                  type: "maestro",
                  url: "http://127.0.0.1:7860",
                  local: true,
                  kind: "image",
                  model: "",
                },
              ],
            })
          }
        >
          连接 Maestro
        </button>
      </div>
      {system.runtime?.maestro_found && (
        <button
          className="secondary full"
          onClick={() =>
            api("/runtime/maestro/start", send("POST"))
              .then((r) =>
                setStatus(
                  r.status === "ready"
                    ? "内置引擎已就绪"
                    : "内置引擎正在启动，请稍后刷新",
                ),
              )
              .catch(onError)
          }
        >
          <Play size={15} />
          启动内置推理引擎
        </button>
      )}
      <label>
        FFmpeg 路径
        <input
          value={value.ffmpeg || "ffmpeg"}
          onChange={(e) => setValue({ ...value, ffmpeg: e.target.value })}
        />
      </label>
      {status && <p className="success-text">{status}</p>}
      <button className="primary full" disabled={busy} onClick={save}>
        <Save size={16} />
        保存设置
      </button>
      <hr />
      <button className="quiet" onClick={onLogout}>
        <LogOut size={16} />
        退出工作室
      </button>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Studio />);
