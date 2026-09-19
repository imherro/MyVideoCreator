import {CreativeConstraintsCard} from "./components/CreativeConstraintsCard";
import { AssistantPanel } from "./components/AssistantPanel";
import type { AssistantAction } from "./assistantChat";
import { TrashConfirmDialog } from "./components/TrashConfirmDialog";
import { voiceCardId } from "./filmBible/voiceResolution.ts";
import { planShotTimeline } from "./shotTimeline";
import { ensureShotNodes, importStoryboardShots } from "./shotNodes";
import { mergeStoryboardResult } from "./filmBible/storyboardImport";
import { autoLayoutCanvas } from "./canvasLayout";
import { canvasEdgeColor, removeCanvasEdges } from "./canvasEdges";
import { canvasRunInput } from "./canvasRunInput";
import { imageSizeForRatio, VIDEO_FORMATS, VIDEO_RATIOS, VIDEO_RESOLUTIONS } from "./mediaSpecs";
import {
  planBatchGeneration,
  assetBatchFeedback,
  type BatchGenerationKind,
} from "./batchGeneration";
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
  MarkerType,
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
  Sparkles,
  History,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./style.css";
import "./timelineControls.css";
import "./filmBible/filmBible.css";
import {
  patchNode,
  invalidate,
  removeReference,
  requiresInitialStateReview,
  setInitialStateReviewed,
  setSingleImageReference,
  acceptResult,
  reconcileCompiledVideoResults,
} from "./graph";
import { PromptLibrary } from "./PromptLibrary";
import { ModelSelector } from "./ModelSelector";
import { ArkProviderSettings } from "./ArkProviderSettings";
import { GenerationPolicyPanel } from "./GenerationPolicyPanel";
import { VisualStylePicker } from "./VisualStylePicker";
import type { GenerationPolicy } from "./generationPolicy";
import { effectiveProjectTargets, projectProviders, type ProjectModelPool } from "./modelAccess.ts";
import { FilmBiblePanel } from "./filmBible/FilmBiblePanel";
import {
  bindVisualVersion,
  renameVisualCard,
  restoreVisualCard,
  setVisualVersionStatus,
  softDeleteVisualCard,
  unbindVisualVersion,
  updateDraftVisualVersion,
} from "./filmBible/commands";
import {
  forkLockedVisualVersion,
  setProjectVisualStyle,
  upgradeVisualBindings,
} from "./filmBible/versioning";
import {
  acceptVisualReferenceResult,
  attachUploadedPrimaryReference,
  isStateCard,
  lockVisualVersion,
  planVisualReferenceGeneration,
  resolveVisualGenerationTarget,
  setVisualCardImageOverride,
  visualAssetCategory,
} from "./filmBible/references";
import {
  deriveManagedGraph,
  filterManagedEdgeRemovals,
  isManagedVisualEdge,
  isManagedVisualNode,
  visualVersionIdFromNode,
} from "./filmBible/managedGraph";
import {
  VisualAssetNode,
  VisualBibleGraphProvider,
} from "./filmBible/VisualAssetNode";
import { visualBibleOf } from "./filmBible/types";
import type { VoiceProfile } from "./filmBible/types";
import { voiceIdentity, requireTtsVoice, chooseVoiceVersion, effectiveVoiceProfile, acceptVoiceResult, saveVoiceProfile, setVoiceLocked, voiceProfilesOf } from "./filmBible/voices";
import { catalogVoice, CUSTOM_VOICE_ID, DOUBAO_TTS2_VOICES } from "./filmBible/voiceCatalog";
import { StoryboardWorkspace } from "./pages/StoryboardWorkspace";
import { ImageGenerationSettings } from "./ImageGenerationSettings";
import { MotionReferenceEditor } from "./components/MotionReferenceEditor";
import { videoGenerationMode } from "./motionReference";
import { VideoProductionWorkspace } from "./pages/VideoProductionWorkspace";
import { activeTaskCount, mergeTaskSnapshots } from "./taskCenter";
import { TaskCenter } from "./pages/TaskCenter";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import {
  createStoryboardShot,
  moveStoryboardShot,
  selectedShotImageNodeIds,
  selectedShotVideoNodeIds,
  shotIdentity,
  updateStoryboardShot,
} from "./storyboard";
import { deriveVideoProductionRows, validateVideoSubmission } from "./videoProduction";
import { RunWorkflow } from "./RunWorkflow";
import { PanoramaViewer } from "./PanoramaViewer";
import { defaultStage } from "./directorScene";
import {compositionData,panoramaSource,patchCompositionNode,setCompositionOutput,type CompositionKind} from "./compositionNodes";
import {CompositionInspector} from "./CompositionInspector";
const DirectorStage = lazy(() =>
  import("./DirectorStage").then((m) => ({ default: m.DirectorStage })),
);
import { framesForDuration, migrateLinkedNodePrompts, updateLinkedNodePrompt, updateShot } from "./shotSync";
import { TimelinePreview } from "./TimelinePreview";
import { defaultExportResolution, exportResolutionOptions } from "./exportSettings";
import type { Clip } from "./timeline";
import type { EditorDocument } from "./editor/editorDocument";
import { AnYingMark } from "./app/AnYingMark";
import { GlobalNav, type GlobalPanel } from "./app/GlobalNav";
import { planGlobalPanelAction } from "./app/globalNavigation";
import { WorkflowStageNav } from "./app/WorkflowStageNav";
import { readApiErrorMessage } from "./apiResponse";
import {
  importAnalysisCompletions,
  importResultStage,
  showImportDesktopNotification,
} from "./importNotifications";
import { WorkflowGuideBanner } from "./app/WorkflowGuideBanner";
import { deriveWorkflowGuide } from "./app/workflowGuide";
import {
  defaultViewForStage,
  parseWorkflowStage,
  workflowStageScope,
  workflowStageUrl,
  type WorkflowStage,
} from "./app/workflow";
import { WorkflowOverview } from "./pages/WorkflowOverview";
import { SourceLibraryPage } from "./pages/SourceLibraryPage";
import { AdaptationPage } from "./pages/AdaptationPage";
import { EpisodeSetupDialog } from "./pages/EpisodeSetupDialog";
import { ScriptRoomPage } from "./pages/ScriptRoomPage";
import { ArtDepartmentPage } from "./pages/ArtDepartmentPage";
import { ProductionAssetCenter } from "./pages/ProductionAssetCenter";
import { EpisodeSelector } from "./app/EpisodeSelector";
import { EpisodeTransition, useEpisodeTransition } from "./app/EpisodeTransition";
import {
  episodeLabel,
  episodesForProduction,
  type EpisodeSummary,
  type ProductionSummary,
} from "./app/production";
import { ProductionLibrary } from "./pages/ProductionLibrary";
import { ProjectSetupDialog } from "./pages/ProjectSetupDialog";
import {
  applyRatioChange,
  applyTargetDuration,
  applyVideoResolution,
  applyVideoOutputSetting,
  bibleFields,
  mergeBibleFields,
  projectSetupPayload,
  type ProjectSetupDraft,
} from "./projectSetup";
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
  category: string;
  source: string;
};
type Job = {
  id: string;
  submission_id?: string;
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
type VisualUsage = {
  version_id: string;
  episodes: Array<{ project_id: string; episode_no: number; episode_title: string }>;
  shots: Array<{ project_id: string; episode_no: number; shot_uid: string; shot_id: string }>;
};
type Doc = {
  schemaVersion: number;
  filmBible: Any;
  generationPolicy: GenerationPolicy;
  modelPool?: ProjectModelPool | null;
  nodes: Node[];
  edges: Edge[];
  shots: Any[];
  timeline: Clip[];
  characters: Any[];
  brief: string;
  style: string;
  ratio: string;
  duration: number;
  videoResolution: string;
  videoReferenceMode?: string;
  dialogueMode?: string;
  videoRatio?: string;
  videoDuration?: number;
  videoFormat?: string;
  applied?: string[];
  editor?: EditorDocument;
  export_resolution?: string;
};
type Project = EpisodeSummary & { document: Doc; production_revision: number };
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
  audio: "角色配音",
  reference: "参考素材", motion_reference: "动作参考",
};
const icons: Any = {
  text: FileText,
  storyboard: Layers,
  image: ImageIcon,
  video: Film,
  audio: FileText,
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
const assetCategories: Any = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  shot: "分镜",
  music: "音乐",
  sfx: "音效",
  voice: "人声",
  reference: "参考", motion_reference: "动作参考",
  other: "其他",
};
const assetKinds: Any = { image: "图片", video: "视频", audio: "音频", subtitle: "字幕" };
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
      const error = await readApiErrorMessage(r);
      throw Object.assign(
        new Error(error),
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
function dialoguePerformance(shot: Any, dialogue: Any, profile: Any) {
  const dialogueEmotion = String(dialogue?.emotion || "").trim();
  const shotEmotion = String(shot?.emotion || "").trim();
  const defaultEmotion = String(profile?.parameters?.emotion || "").trim();
  const emotion = dialogueEmotion || shotEmotion || defaultEmotion;
  const parts = [
    shot?.scene ? `场景：${shot.scene}` : "",
    shot?.action ? `镜头动作：${shot.action}` : "",
    shotEmotion ? `全镜情绪：${shotEmotion}` : "",
    emotion ? `本句表演：${emotion}` : "请根据台词语义自然演绎",
    "保持角色既定声纹，语气与影片表演同步，不要用播报腔",
  ].filter(Boolean);
  return {
    emotion,
    contextTexts: [`影片对白表演指令。${parts.join("；")}。`],
  };
}
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
          {data.compositionType ? "构图辅助" : data.referencePurpose === "composition" ? "构图参考" : data.provider && data.provider !== "local" ? "服务模型" : "本地"}
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
              {data.compositionType ? "选择以编辑构图" : data.kind === "image" ? "描绘故事的第一个瞬间" : "让画面动起来"}
            </p>
          </div>
        )}
      </div>
      {data.compositionType && <button className="nodrag nowheel composition-node-edit" onClick={event=>{event.stopPropagation();data.onEditComposition?.();}}>编辑构图</button>}
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
const nodeTypes = { media: MediaNode, visualAsset: VisualAssetNode };

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
          <AnYingMark size={29} />
          安影 <small>STUDIO</small>
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
          <Monitor size={18} /> 浏览器创作 · 云端与本地模型
        </div>
      </div>
      <form onSubmit={submit} className="auth-form">
        <span className="eyebrow">YOUR CREATIVE SPACE</span>
        <h2>{status?.configured ? "回到工作室" : "创建你的工作室"}</h2>
        <p>
          {status?.configured
            ? "在任意电脑上使用同一个工作室密码登录。"
            : "设置工作室密码后，即可从当前浏览器开始创作。"}
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
          disabled={busy || !status}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <ArrowUpRight size={17} />
          )}{" "}
          {status?.configured ? "进入工作室" : "设置并进入"}
        </button>
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
  const taskId = new URLSearchParams(window.location.search).get("task");
  if (taskId) return <TaskDetailPage jobId={taskId} request={api} />;
  return (
    <ReactFlowProvider>
      <Workspace onLogout={() => setLogged(false)} />
    </ReactFlowProvider>
  );
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const initialWorkflowStage = parseWorkflowStage(window.location.search);
  const [productions, setProductions] = useState<ProductionSummary[]>([]),
    [projects, setProjects] = useState<EpisodeSummary[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [doc, setDoc] = useState<Doc | null>(null),
    [assets, setAssets] = useState<Asset[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [productionJobs, setProductionJobs] = useState<Any[]>([]),
    [visualUsage, setVisualUsage] = useState<VisualUsage[]>([]),
    [workflowContext, setWorkflowContext] = useState<Any>({ adaptation: null, scripts: [] }),
    [system, setSystem] = useState<Any>({
      models: [],
      templates: {},
      hardware: {},
    }),
    [config, setConfig] = useState<Any>({
      providers: [],
      model_directories: [],
    });
  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>(initialWorkflowStage);
  // Adaptation and scripts share a production-scoped focus, including uncreated episodes.
  const [planningEpisodeFocus, setPlanningEpisodeFocus] = useState<Record<string, number>>({});
  const { transition: episodeTransition, switchEpisode } = useEpisodeTransition();
  const [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState(defaultViewForStage(initialWorkflowStage)),
    [panel, setPanel] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("已保存"),
    [busy, setBusy] = useState(false),
    [timelineOpen, setTimelineOpen] = useState(false),
    [revisions, setRevisions] = useState<Any[]>([]),
    [trashItems, setTrashItems] = useState<Any>({ productions: [], projects: [], assets: [], sources: [], chapters: [] }),
    [preview, setPreview] = useState<Asset | null>(null);
  const [importCompletion, setImportCompletion] = useState<{
    id: string;
    title: string;
    body: string;
    stage: "source" | "script";
    productionId: string;
    importId: string;
  } | null>(null);
  const batchSubmissionRef = useRef(false);
  const [workflowDataRevision, setWorkflowDataRevision] = useState({ source: 0, adaptation: 0, script: 0 });
  const [previewTimeline, setPreviewTimeline] = useState(false);
  const [exportSource, setExportSource] = useState<"legacy" | "editor">("legacy");
  const [editorExportTimeline, setEditorExportTimeline] = useState<EditorDocument["timeline"] | undefined>();
  const [booted, setBooted] = useState(false);
  const [episodeSetupProduction, setEpisodeSetupProduction] = useState<ProductionSummary | null>(null);
  const [projectSetupOpen, setProjectSetupOpen] = useState(false);
  const [projectSetupKey, setProjectSetupKey] = useState(0);
  const [projectSettingsTab, setProjectSettingsTab] = useState<"production" | "episode">("production");
  const [productionNameDraft, setProductionNameDraft] = useState("");
  const [visualStyleDraft, setVisualStyleDraft] = useState("");
  const [visualFocus, setVisualFocus] = useState<string | undefined>();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [compositionEditor, setCompositionEditor] = useState<string | null>(null);
  const [panorama, setPanorama] = useState<Asset | null>(null);
  const [syncFailure, setSyncFailure] = useState<SyncFailure | null>(null);
  const [mediaRetryKey, setMediaRetryKey] = useState(0);
  const [pendingAutoRunNodeId, setPendingAutoRunNodeId] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState("other");
  const storyboardSubmissionRef = useRef(false);
  const workflowStageRef = useRef<WorkflowStage>(initialWorkflowStage);
  const revision = useRef(1),
    productionRevision = useRef(1),
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
    observedCompletedJobs = useRef(new Set<string>()),
    observedImportJobs = useRef(new Map<string, string>()),
    { fitView } = useReactFlow(),
    updateNodeInternals = useUpdateNodeInternals();
  const [layoutVersion, setLayoutVersion] = useState(0);
  current.current = { project, doc };
  workflowStageRef.current = workflowStage;
  useEffect(() => {
    if (!project) return;
    const active = productions.find((item) => item.id === project.production_id);
    if (active) setProductionNameDraft(active.name);
  }, [project?.production_id, productions]);
  useEffect(() => {
    if (doc) setVisualStyleDraft(doc.style);
  }, [project?.id, doc?.style]);
  function activateWorkflowStage(
    next: WorkflowStage,
    historyMode: "push" | "replace" | "none" = "push",
  ) {
    workflowStageRef.current = next;
    setWorkflowStage(next);
    if (historyMode !== "none") {
      const nextUrl = workflowStageUrl(window.location.href, next);
      window.history[historyMode === "replace" ? "replaceState" : "pushState"](
        null,
        "",
        nextUrl,
      );
    }
    setPanel(null);
    if (next === "editor") setSelected(null);
    if (next === "storyboard" && view === "shots") return;
    if (next === "images" && ["shots", "grid"].includes(view)) return;
    setView(defaultViewForStage(next));
  }
  function revealImportResult(value: {productionId?: string;importId?: string;stage: "source" | "script"}) {
    const productionId = value.productionId || current.current.project?.production_id;
    const importId = value.importId;
    if (productionId && importId) {
      try { sessionStorage.setItem("anying-open-import", JSON.stringify({ productionId, importId, stage: value.stage })); } catch {}
    }
    activateWorkflowStage(value.stage);
    setImportCompletion(null);
    if (productionId && importId) {
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("anying:open-import", { detail: { productionId, importId } })), 0);
    }
  }
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
    const base = current.current.doc;
    if (!base) return;
    const next = deriveManagedGraph(fn(base));
    current.current = { ...current.current, doc: next };
    setDoc(next);
    dirty.current = true;
    setSaved("未保存");
  }, []);
  useEffect(() => { setSelectedEdge(null); setEdgeMenu(null); setCompositionEditor(null); }, [project?.id, view, workflowStage]);
  useEffect(() => {
    if (selectedEdge && !doc?.edges.some(edge => edge.id === selectedEdge)) {
      setSelectedEdge(null); setEdgeMenu(null);
    }
  }, [selectedEdge, doc?.edges]);
  useEffect(() => {
    if (!edgeMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".canvas-edge-menu")) setEdgeMenu(null);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [edgeMenu]);
  function deleteCanvasEdge(edgeId: string) {
    const document = current.current.doc;
    if (!document) return;
    const result = removeCanvasEdges(document, [edgeId]);
    setEdgeMenu(null);
    if (result.blocked.length) {
      setNotice("此连线由资产绑定或角色状态关系管理，请到塑角造景解除对应绑定");
      return;
    }
    if (!result.removed.length) return;
    update(() => result.document);
    setSelectedEdge(null);
    setNotice("已删除连线，卡片与已有素材保留");
  }
  const refresh = useCallback((pid: string) => {
    const pending = refreshFlights.current.get(pid);
    if (pending) return pending;
    const work = (async () => {
      try {
        // Treat assets and jobs as one snapshot. A partial response must never
        // replace the last known-good canvas state with an empty collection.
        const productionId = current.current.project?.id === pid
          ? current.current.project.production_id
          : undefined;
        const [a, j, usages, adaptation, scripts, jobStatuses] = await Promise.all([
          api(`/projects/${pid}/assets?scope=production`),
          api(`/projects/${pid}/jobs`),
          productionId ? api(`/productions/${productionId}/visual-usage`) : Promise.resolve([]),
          productionId ? api(`/productions/${productionId}/adaptation`) : Promise.resolve(null),
          productionId ? api(`/productions/${productionId}/scripts`) : Promise.resolve([]),
          productionId ? api(`/productions/${productionId}/job-statuses`) : Promise.resolve([]),
        ]);
        if (current.current.project?.id === pid) {
          setAssets(a);
          setJobs(j);
          setProductionJobs(jobStatuses);
          setVisualUsage(usages);
          setWorkflowContext({ adaptation, scripts });
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
    let p: Project, a: Asset[], j: Job[], usages: VisualUsage[], adaptation: Any, scripts: Any[], jobStatuses: Any[];
    try {
      p = await api("/projects/" + pid);
      [a, j, usages, adaptation, scripts, jobStatuses] = await Promise.all([
        api(`/projects/${pid}/assets?scope=production`),
        api(`/projects/${pid}/jobs`),
        api(`/productions/${p.production_id}/visual-usage`),
        api(`/productions/${p.production_id}/adaptation`),
        api(`/productions/${p.production_id}/scripts`),
        api(`/productions/${p.production_id}/job-statuses`),
      ]);
    } catch (e: any) {
      setSyncFailure({
        kind: "api",
        message: "刷新失败，正在重试",
        url: e?.url || debugUrl(`/api/projects/${pid}`),
      });
      throw e;
    }
    const migratedDocument = migrateLinkedNodePrompts(p.document);
    const projectedDocument = deriveManagedGraph(migratedDocument);
    const openedProject = { ...p, document: projectedDocument };
    revision.current = p.revision;
    productionRevision.current = p.production_revision;
    // Managed canvas nodes are a deterministic view of the canonical project.
    // Merely opening the project must not create a new revision, otherwise two
    // browsers that only view the same project will race each other's autosave.
    dirty.current = false;
    // Update the imperative snapshot before scheduling React state changes.
    // This prevents an autosave tick from pairing the new project id with the
    // previous project's document while the project switch is being rendered.
    if (current.current.project?.production_id === p.production_id && current.current.project.id !== p.id) {
      setPlanningEpisodeFocus((known) => ({ ...known, [p.production_id]: p.episode_no }));
    }
    current.current = { project: openedProject, doc: projectedDocument };
    nodeMeasurements.current.clear();
    setLayoutVersion((value) => value + 1);
    setProject(openedProject);
    setDoc(projectedDocument);
    setAssets(a);
    setJobs(j);
    setProductionJobs(jobStatuses);
    setVisualUsage(usages);
    setWorkflowContext({ adaptation, scripts });
    setSelected(null);
    setHoveredNode(null);
    setVisualFocus(undefined);
    setPreview(null);
    setPreviewTimeline(false);
    setPanorama(null);
    setTimelineOpen(false);
    setView(defaultViewForStage(workflowStageRef.current));
    setSaved("已保存");
    setPanel(null);
    setTimeout(() => {
      fitView({ padding: 0.2 });
    }, 100);
  }
  async function boot() {
    try {
      const [productionList, list, sys, settings] = await Promise.all([
        api("/productions"),
        api("/projects"),
        api("/system"),
        api("/settings"),
      ]);
      setProductions(productionList);
      setProjects(list);
      setSystem(sys);
      setConfig(settings);
      if (list.length) await openProject(list[0].id);
      else {
        setProjectSetupOpen(true);
      }
    } catch (e) {
      report(e);
    } finally {
      setBooted(true);
    }
  }
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      workflowStageUrl(window.location.href, workflowStageRef.current),
    );
    const onPopState = () =>
      activateWorkflowStage(parseWorkflowStage(window.location.search), "none");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view]);
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
      const pid = current.current.project?.id;
      if (pid) refresh(pid).catch(() => {});
    };
    events.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const pid = current.current.project?.id;
        if (data.project_id === pid && data.type === "production" && typeof data.revision === "number") {
          setProductions((items) => items.map((item) => item.id === current.current.project?.production_id ? { ...item, revision: data.revision } : item));
          if (!dirty.current && !saveFlight.current && data.revision !== productionRevision.current) {
            void api(`/projects/${pid}`).then((latest) => {
              if (current.current.project?.id !== pid || dirty.current || saveFlight.current) return;
              const projectedDocument = deriveManagedGraph(latest.document);
              const openedProject = { ...latest, document: projectedDocument };
              revision.current = latest.revision;
              productionRevision.current = latest.production_revision;
              current.current = { project: openedProject, doc: projectedDocument };
              setProject(openedProject);
              setDoc(projectedDocument);
              setSaved("已同步");
            }).catch(report);
          }
        }
        if (data.project_id === pid && data.type === "project" && typeof data.revision === "number") {
          if (!dirty.current && !saveFlight.current && data.revision !== revision.current) {
            void api(`/projects/${pid}`).then((latest) => {
              if (current.current.project?.id !== pid || dirty.current || saveFlight.current) return;
              const projectedDocument = deriveManagedGraph(latest.document);
              const openedProject = { ...latest, document: projectedDocument };
              revision.current = latest.revision;
              productionRevision.current = latest.production_revision;
              current.current = { project: openedProject, doc: projectedDocument };
              setProject(openedProject);
              setDoc(projectedDocument);
              setSaved("已同步");
            }).catch(report);
          }
        }
        if (pid && data.type === "job" && (data.project_id === pid || data.production_id === current.current.project?.production_id))
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
  async function syncLatestProject(pid: string, preserveNewEdits = false) {
    const latest = await api("/projects/" + pid);
    if (current.current.project?.id !== pid) return;
    if (preserveNewEdits && dirty.current) { await refresh(pid); return; }
    const projectedDocument = deriveManagedGraph(
      migrateLinkedNodePrompts(latest.document),
    );
    const openedProject = { ...latest, document: projectedDocument };
    revision.current = latest.revision;
    productionRevision.current = latest.production_revision;
    dirty.current = false;
    current.current = { project: openedProject, doc: projectedDocument };
    setProject(openedProject);
    setDoc(projectedDocument);
    setSelected(null);
    setSaved("已同步");
    setError("");
    sessionStorage.removeItem("yingxu-conflict-" + pid);
    setNotice("项目已在另一页面更新，已自动载入最新版本");
    void refresh(pid).catch(() => {});
  }
  async function save() {
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
            production_revision: productionRevision.current,
            document: snapshot.doc,
          }),
        );
        revision.current = result.revision;
        productionRevision.current = result.production_revision;
        setProject((current) =>
          current?.id === projectSnapshot.id
            ? {
                ...current,
                name,
                episode_title: name,
                revision: result.revision,
                production_revision: result.production_revision,
              }
            : current,
        );
        if (name !== projectSnapshot.name) {
          setProjects((current) =>
            current.map((item) =>
              item.id === projectSnapshot.id
                ? { ...item, name, episode_title: name }
                : item,
            ),
          );
          setNotice("项目名称不能为空，已恢复为“未命名短片”");
        }
        setSaved(dirty.current ? "未保存" : "已保存");
      } catch (e: any) {
        dirty.current = true;
        if (e.status === 409) {
          try {
            await syncLatestProject(projectSnapshot.id);
          } catch (syncError) {
            setSaved("同步失败");
            report(syncError);
          }
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
          j.status === "succeeded" && j.result &&
          !["source_analysis", "adaptation_generation", "adaptation_episode_generation", "script_generation"].includes(j.input?.stage) &&
          !doc.applied?.includes(j.id),
      )
      .sort((a, b) => a.created - b.created);
    if (!completed.length) {
      const repaired = reconcileCompiledVideoResults(doc, jobs);
      if (repaired !== doc) update(() => repaired as Doc);
      return;
    }
    const importedStoryboard = completed.find((job) => job.kind === "storyboard" && job.result?.shots);
    update((d) => {
      let next = reconcileCompiledVideoResults(d, jobs);
      for (const job of completed) {
        if (job.kind === "audio" && job.input?.voice_profile) {
          next = acceptVoiceResult(next, job);
        } else if (job.node_id.startsWith("visual-version:")) {
          next = acceptVisualReferenceResult(next, job);
        } else if (job.kind === "storyboard" && job.result?.shots) {
          const storyboardNode = next.nodes.find(
            (item) => item.id === job.node_id && item.data.kind === "storyboard",
          );
          const imported = mergeStoryboardResult(next, job.result);
          next = importStoryboardShots(
            imported.document,
            imported.shots,
            config.providers,
            system.models,
            id,
            storyboardNode?.id,
          );
        } else {
          next = acceptResult(next, job, jobs);
        }
      }
      return {
        ...next,
        applied: [...(d.applied || []), ...completed.map((j) => j.id)],
      };
    });
    if (importedStoryboard) {
      setNotice(`分镜规划已完成并自动导入 ${importedStoryboard.result.shots.length} 个分镜，画布节点和连线已同步建立`);
    }
  }, [jobs, doc?.applied, config.providers, system.models]);
  const checkedVideoResults = useRef(new Set<string>());
  useEffect(() => {
    if (!doc || !project || dirty.current || saveFlight.current) return;
    const snapshot=doc, pid=project.id, rev=revision.current, productionRev=productionRevision.current;
    const stale=doc.nodes.filter(node=>node.data.kind==='video' && node.data.stale && node.data.resultJob);
    if (!stale.length) return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{void (async()=>{
      const matched=new Set<string>();
      for (const node of stale) {
        if(cancelled) return;
        const key=JSON.stringify([pid,rev,productionRev,node.id,node.data.resultJob]);
        if(checkedVideoResults.current.has(key)) continue;
        try {
          const result=await api(`/projects/${pid}/nodes/${encodeURIComponent(node.id)}/video-result-status`);
          if(cancelled) return;
          if(checkedVideoResults.current.size>500) checkedVideoResults.current.clear();
          checkedVideoResults.current.add(key);
          if(result.matches && result.revision===rev && result.production_revision===productionRev && result.resultJob===node.data.resultJob) matched.add(node.id);
        } catch { /* Preserve the existing warning when verification is unavailable. */ }
      }
      if(!cancelled && matched.size && current.current.project?.id===pid && current.current.doc===snapshot && !dirty.current && revision.current===rev && productionRevision.current===productionRev) {
        update(document=>({...document,nodes:document.nodes.map(node=>matched.has(node.id)?{...node,data:{...node.data,stale:false}}:node)}));
      }
    })();},350);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[doc,project?.revision,saved]);
  useEffect(() => {
    const completed = productionJobs.filter((job) => job.status === "succeeded");
    const newlyCompleted = completed.filter((job) => !observedCompletedJobs.current.has(job.id));
    completed.forEach((job) => observedCompletedJobs.current.add(job.id));
    const workflowCompleted = newlyCompleted.filter((job) =>
      ["source_analysis", "adaptation_generation", "adaptation_episode_generation", "script_generation"].includes(job.input?.stage),
    );
    if (workflowCompleted.length) {
      setWorkflowDataRevision((value) => ({
        source: value.source + Number(workflowCompleted.some((job) => job.input?.stage === "source_analysis")),
        adaptation: value.adaptation + Number(workflowCompleted.some((job) => ["source_analysis", "adaptation_generation", "adaptation_episode_generation"].includes(job.input?.stage))),
        script: value.script + Number(workflowCompleted.some((job) => job.input?.stage === "script_generation")),
      }));
      if (workflowCompleted.some((job) => job.input?.stage === "script_generation")) {
        const pid = current.current.project?.id;
        if (pid && !dirty.current && !saveFlight.current) {
          void api(`/projects/${pid}`).then((latest) => {
            if (current.current.project?.id !== pid || dirty.current) return;
            const projectedDocument = deriveManagedGraph(latest.document);
            revision.current = latest.revision;
            productionRevision.current = latest.production_revision;
            current.current = { project: { ...latest, document: projectedDocument }, doc: projectedDocument };
            setProject({ ...latest, document: projectedDocument });
            setDoc(projectedDocument);
          }).catch(report);
        }
      }
    }
  }, [productionJobs]);
  useEffect(() => {
    const completed = importAnalysisCompletions(observedImportJobs.current, productionJobs);
    for (const item of completed) {
      void (async () => {
        let draft: Any | null = null;
        try {
          draft = await api(`/productions/${item.productionId}/script-imports/${encodeURIComponent(item.importId)}`);
        } catch {
          // The job snapshot is enough to notify. Opening the result will retry
          // the draft request through the normal import-resume flow.
        }
        const stage = importResultStage(item.productionId, item.importId);
        const count = Number(draft?.manifest?.episodes?.length || 0);
        const title = item.status === "succeeded"
          ? "原著 / 剧本分析完成"
          : item.status === "cancelled"
            ? "原著 / 剧本分析已停止"
            : item.status === "interrupted"
              ? "原著 / 剧本分析已中断"
              : "原著 / 剧本分析未完成";
        const body = item.status === "succeeded"
          ? `“${item.filename}”${count ? `已识别 ${count} 集` : "已完成结构识别"}，点击查看结果。`
          : `“${item.filename}”${draft?.job?.error ? `：${draft.job.error}` : "的原文已保留，可返回工作室查看详情。"}`;
        const alert = { id: item.id, title, body, stage, productionId: item.productionId, importId: item.importId };
        setImportCompletion(alert);
        showImportDesktopNotification(alert, () => revealImportResult(alert));
      })();
    }
  }, [productionJobs]);
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
            ...nodeDefaults(n.kind, config.providers, system.models, current.current.doc?.generationPolicy),
          },
        }));
        update((d) => ({ ...d, nodes: [...d.nodes, ...nodes] }));
        activateWorkflowStage("canvas");
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
  const selectedVideoShot = doc?.shots.find(s => (s.videoNode || s.pipeline?.videoNodeId) === node?.id);
  const selectedVideoMode = videoGenerationMode(doc || {}, selectedVideoShot || {});
  function pendingInitialStateChecks(targetId: string) {
    if (videoGenerationMode(doc || {}, doc?.shots.find(s => (s.videoNode || s.pipeline?.videoNodeId) === targetId) || {}) === "multimodal") return [];
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
  const selectedRunInput = canvasRunInput(doc || {}, node, jobs);
  const activeCount = activeTaskCount(productionJobs);
  function editNode(patch: Any) {
    if (!selected) return;
    update((d) => {
      if (!("prompt" in patch)) return patchNode(d, selected, patch);
      const { prompt, ...rest } = patch;
      const next = updateLinkedNodePrompt(d, selected, String(prompt));
      return Object.keys(rest).length ? patchNode(next, selected, rest) : next;
    });
  }
  function changeModel(patch: Any) {
    if (!selected) return;
    if (data.canonicalScriptProjection)
      patch = { ...patch, generationPolicyInherited: false };
    // Preserve references on provider changes; incompatible combinations are
    // rejected before submission instead of silently removing selected media.
    update((d) => patchNode(d, selected, patch));
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
            ...(kind === "reference" ? {} : nodeDefaults(kind, config.providers, system.models, doc?.generationPolicy)),
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
  function newComposition(kind: CompositionKind) {
    const legacy = kind === "director" && !doc?.nodes.some(n=>n.data.compositionType === "director") ? (doc as Any)?.director : undefined;
    return newNode("reference", "", compositionData(kind, legacy));
  }
  async function finishScriptImport(result: Any) {
    await refreshProductionHierarchy();
    const first=result.episodes[0];
    if(first){
      setPlanningEpisodeFocus(known=>({...known,[project!.production_id]:first.episodeNo}));
      await openProject(first.projectId);
    }
    setWorkflowDataRevision(value=>({...value,script:value.script+1,source:value.source+1}));
    activateWorkflowStage("script");
    setNotice(`已导入 ${result.count} 集剧本，可选择分集继续编辑和分镜规划`);
  }
  function patchComposition(nodeId: string, patch: Any) {
    update(document=>patchCompositionNode(document,nodeId,patch));
  }
  function createPanoramaSource(owner: Any) {
    const existing=doc?.nodes.find(n=>n.id===owner.data.composition?.sourceNodeId);
    if(existing){setSelected(existing.id);return;}
    const nid=newNode("image", "生成 360 度等距柱状全景环境图，2:1 画幅，完整覆盖四周环境，上下分别为天空与地面，左右边缘连续，地平线位于画面中线，无文字。场景：", {label:`${owner.data.label} · 全景原图`,imagePurpose:"panorama"});
    update(document=>({...document,nodes:document.nodes.map(n=>n.id===owner.id?{...n,data:{...n.data,composition:{...(n.data.composition as Any),sourceAssetId:"",sourceNodeId:nid}}}:n),edges:[...document.edges,{id:id(),source:nid,target:owner.id,data:{origin:"composition_source"}}]}));
  }
  async function saveComposition(nodeId: string, blob: Blob) {
    const snapshot=current.current;
    const owner=snapshot.doc?.nodes.find(n=>n.id===nodeId);
    if(!snapshot.project||!owner)return;
    const config=JSON.stringify(owner.data.composition);
    const form=new FormData();form.append("file",blob,`${owner.data.label}构图_${Date.now()}.png`);
    const asset=await api(`/projects/${snapshot.project.id}/assets`,{method:"POST",body:form});
    if(current.current.project?.id!==snapshot.project.id)return;
    if(!current.current.doc?.nodes.some(n=>n.id===nodeId))return;
    update(document=>setCompositionOutput(document,nodeId,asset.id,id,config));
    await refresh(snapshot.project.id);
    await save();
    setNotice("已保存构图参考图，可从输出节点连到分镜图");
  }
  function generateStoryboardFromScript(sourceNode: Any) {
    if (!doc || busy) return;
    const existingId = doc.edges.find((edge) => edge.source === sourceNode.id &&
      doc.nodes.some((item) => item.id === edge.target && item.data.kind === "storyboard"))?.target;
    const storyboardId = existingId || newNode(
      "storyboard",
      String(sourceNode.data.text),
      {},
      sourceNode.id,
    );
    if (existingId) {
      const defaults = nodeDefaults("storyboard", config.providers, system.models, doc.generationPolicy);
      update((document) => patchNode(document, existingId, {
        provider: defaults.provider,
        model: defaults.model,
        model_capabilities: undefined,
      }));
    }
    setSelected(storyboardId);
    setPendingAutoRunNodeId(storyboardId);
    setNotice(existingId ? "正在使用已有分镜规划节点提交任务" : "已建立并连接分镜规划节点，正在提交任务");
    setTimeout(() => fitView({ nodes: [{ id: storyboardId }], padding: 0.8 }), 80);
  }
  async function promoteCanvasScript(sourceNode: Any) {
    const snapshot = current.current;
    const body = String(sourceNode?.data?.text || "").trim();
    if (!snapshot.project || !snapshot.doc || sourceNode?.data?.kind !== "text" || !body)
      throw new Error("请先生成或填写剧本正文");
    await save();
    if (dirty.current) throw new Error("请先解决保存冲突，再保存正式剧本");
    const episodeNo = snapshot.project.episode_no || 1;
    const currentScript = await api(`/productions/${snapshot.project.production_id}/episode-scripts/${episodeNo}`);
    if (currentScript.body?.trim() && currentScript.body.trim() !== body && !window.confirm("采用此画布草稿将替换本集剧本正文，原版本会保留。确认采用？")) return;
    await api(
      `/productions/${snapshot.project.production_id}/episode-scripts/${episodeNo}`,
      send("PUT", {
        revision: currentScript.revision,
        title: currentScript.title || sourceNode.data.label || snapshot.project.episode_title || snapshot.project.name,
        synopsis: currentScript.synopsis || "",
        body,
        estimatedDuration: Number(currentScript.estimatedDuration || snapshot.doc.duration || 15),
        sourceChapterRefs: currentScript.sourceChapterRefs || [],
        storyGoal: currentScript.storyGoal || "",
        paywallBeat: currentScript.paywallBeat || {},
        characters: currentScript.characters || [],
        scenes: currentScript.scenes || [],
        props: currentScript.props || [],
        canvasNodeId: sourceNode.id,
      }),
    );
    setWorkflowDataRevision((value) => ({ ...value, script: value.script + 1 }));
    await openProject(snapshot.project.id);
    setNotice("画布剧本已采用为本集剧本；可进入剧本页继续修订或开始分镜规划");
  }
  function startStoryboardPlanning() {
    if (!doc) return;
    if (storyboardSubmissionRef.current || jobs.some((job) =>
      job.kind === "storyboard" && ["queued", "running"].includes(job.status),
    )) {
      setNotice("分镜规划任务已经在队列中，请等待当前任务完成");
      return;
    }
    const scriptNode = doc.nodes.find((node) =>
      node.data?.canonicalScriptProjection && node.data?.scriptStatus !== "stale" && String(node.data?.text || "").trim(),
    );
    if (!scriptNode) {
      report(new Error("请先在剧本页填写并保存本集剧本；如提示需要更新，请先修订"));
      activateWorkflowStage("script");
      return;
    }
    storyboardSubmissionRef.current = true;
    generateStoryboardFromScript(scriptNode);
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
  async function prepareProjectSwitch() {
    if (dirty.current || saveFlight.current) await save();
    if (dirty.current)
      throw new Error("项目尚未保存，请等待网络恢复后再切换项目。");
  }
  async function refreshProductionHierarchy() {
    const [productionList, episodeList] = await Promise.all([
      api("/productions"),
      api("/projects"),
    ]);
    setProductions(productionList);
    setProjects(episodeList);
    return { productions: productionList, projects: episodeList };
  }
  function openProjectSetup() {
    setProjectSetupKey((value) => value + 1);
    setProjectSetupOpen(true);
  }
  async function createProduction(draft: ProjectSetupDraft) {
    await prepareProjectSwitch();
    const productionName = draft.name.trim();
    const episode = await api("/projects", send("POST", projectSetupPayload(draft)));
    await refreshProductionHierarchy();
    await openProject(episode.id);
    setPlanningEpisodeFocus(known=>({...known,[episode.production_id]:episode.episode_no}));
    activateWorkflowStage(draft.creationMode === "adaptation" ? "source" : "script", "replace");
    setProjectSetupOpen(false);
    setNotice(`已新建作品“${productionName}”并进入 EP01`);
  }
  async function createEpisode(production: ProductionSummary, title: string, creationMode: "direct" | "adaptation") {
    await prepareProjectSwitch();
    const episode = await api(
      `/productions/${production.id}/episodes`,
      send("POST", { title, creation_mode: creationMode }),
    );
    await refreshProductionHierarchy();
    await openProject(episode.id);
    setEpisodeSetupProduction(null);
    setPlanningEpisodeFocus(known=>({...known,[production.id]:episode.episode_no}));
    activateWorkflowStage(creationMode === "adaptation" ? "source" : "script");
    setNotice(`已在“${production.name}”中新建 EP${String(episode.episode_no).padStart(2, "0")}`);
  }
  async function renameProduction(name: string) {
    if (!project) return;
    const target = productions.find((item) => item.id === project.production_id);
    if (!target) throw new Error("当前作品信息尚未载入");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("作品名称不能为空");
    const updated = await api(`/productions/${target.id}`, send("PATCH", {
      revision: productionRevision.current,
      name: trimmed,
    }));
    productionRevision.current = updated.revision;
    setProject((value) => value ? { ...value, production_revision: updated.revision } : value);
    setProductions((items) => items.map((item) => item.id === target.id ? { ...item, ...updated } : item));
    setProductionNameDraft(trimmed);
    setNotice("作品名称已保存");
  }
  async function loadTrash() {
    setTrashItems(await api("/trash"));
  }
  async function openTrash() {
    setPanel("trash");
    await loadTrash();
  }
  function activateGlobalPanel(next: GlobalPanel) {
    const action = planGlobalPanelAction(panel, next);
    if (action.loadTrash) {
      openTrash().catch(report);
      return;
    }
    setPanel(action.panel);
  }
  const [trashTarget, setTrashTarget] = useState<{kind:"production"|"project";item:Any}|null>(null);
  async function deleteProduction(target: Any) {
    if (!target) return;
    const isCurrent=project?.production_id===target.id;
    if(isCurrent && (dirty.current || saveFlight.current)) await save();
    if(isCurrent && dirty.current) throw new Error("当前制作集尚未保存，请先解决保存问题。");
    await api(`/productions/${target.id}`,send("DELETE"));
    const list=await api("/projects");
    setProjects(list);setProductions(await api("/productions"));
    if(isCurrent){
      dirty.current=false;
      if(list.length)await openProject(list[0].id);
      else{current.current={project:null,doc:null};setProject(null);setDoc(null);setPanel(null);setProjectSetupOpen(false);}
    }
    await loadTrash();setNotice(`整部作品“${target.name}”已移入回收站`);
  }
  async function deleteProject(target: Any) {
    if (!target) return;
    if (target.id === project?.id && (dirty.current || saveFlight.current))
      await save();
    if (target.id === project?.id && dirty.current)
      throw new Error("当前项目尚未保存，请先解决保存问题再移入回收站。");
    await api(`/projects/${target.id}`, send("DELETE"));
    const list = await api("/projects");
    setProjects(list);
    setProductions(await api("/productions"));
    if (target.id === project?.id) {
      dirty.current = false;
      if (list.length) await openProject(list[0].id);
      else {
        current.current = { project: null, doc: null };
        setProject(null);
        setDoc(null);
        setPanel(null);
      }
    }
    await loadTrash();
    setNotice(`制作集“${target.name}”已移入回收站`);
  }
  async function deleteAsset(asset: Asset) {
    if (!project) return;
    if (!window.confirm(`将素材“${asset.name}”移入回收站？项目中的引用会暂时不可用，恢复后会重新出现。`)) return;
    await api(`/projects/${project.id}/assets/${asset.id}`, send("DELETE"));
    setAssets((items) => items.filter((item) => item.id !== asset.id));
    await loadTrash();
    setNotice(`素材“${asset.name}”已移入回收站`);
  }
  async function restoreTrashItem(kind: "production" | "project" | "asset" | "source" | "chapter", item: Any) {
    const currentProjectId = project?.id;
    await api(`/trash/${kind}/${item.id}/restore`, send("POST"));
    const restoredProjects=await api("/projects");
    setProjects(restoredProjects);
    if(!currentProjectId && restoredProjects.length){setProjectSetupOpen(false);await openProject(restoredProjects[0].id);}
    setProductions(await api("/productions"));
    if (kind === "asset" && currentProjectId && item.production_id === project?.production_id)
      await refresh(currentProjectId);
    if (kind === "source" || kind === "chapter") setWorkflowDataRevision((value) => ({ ...value, source: value.source + 1, adaptation: value.adaptation + 1 }));
    await loadTrash();
    const label = kind === "production" ? "整部作品" : kind === "project" ? "制作集" : kind === "asset" ? "素材" : kind === "source" ? "原著" : "章节";
    setNotice(`${label}“${item.name}”已恢复`);
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
      const readiness = canvasRunInput(current.current.doc || {}, n, jobs);
      if (!readiness.ready) throw new Error(readiness.reason);
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
      const targetProvider = config.providers.find(
        (provider: Any) => provider.id === (n.data.provider || "local"),
      );
      const input = {
        ...n.data,
        provider: n.data.provider || "local",
        asset_ids: sourceAssets(n.id),
        parameters: n.data.kind === "video" && ["volcengine_ark", "hc_atom", "runninghub"].includes(targetProvider?.type)
          ? { resolution: doc?.videoResolution || "720p", outputFormat: doc?.videoFormat || "mp4", ...(n.data.parameters || {}) }
          : n.data.parameters,
        prompt: String(n.data.prompt || ""),
        ratio: n.data.kind === "video" ? (doc?.videoRatio || doc?.ratio || "16:9") : (doc?.ratio || "16:9"),
        size: n.data.resolution || "1024x1024",
        target_duration:
          n.data.kind === "text" || n.data.kind === "storyboard"
            ? n.data.target_duration || doc?.duration
            : undefined,
        film_bible:
          n.data.kind === "storyboard"
            ? n.data.film_bible !== false
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
      const imported = mergeStoryboardResult(d, job.result);
      return importStoryboardShots(
        imported.document,
        imported.shots,
        config.providers,
        system.models,
        id,
        storyboardNode?.id,
      );
    });
    activateWorkflowStage("storyboard");
    setNotice(`已导入 ${job.result.shots.length} 个分镜，复用已有资产并合并新增资产，画布节点和连线已同步建立`);
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
    activateWorkflowStage("canvas");
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
    activateWorkflowStage("canvas");
    setSelected(null);
    setTimeout(() => fitView({ padding: 0.2 }), 80);
    setNotice("已补齐分镜生成节点，检查提示词后可运行画布");
  }
  async function generateStoryboardImages(shotUids: string[]) {
    const snapshot = current.current;
    if (!snapshot.project || !snapshot.doc || busy) return;
    const selected = new Set(shotUids);
    const targetShots = snapshot.doc.shots.filter((shot) =>
      selected.has(shotIdentity(shot)),
    );
    if (!targetShots.length) throw new Error("请先选择需要生成的镜头");
    const visual = visualBibleOf(snapshot.doc);
    const hasVisualCards = Object.values(visual.cards).some((card) => !card.deletedAt && card.status !== "deprecated");
    for (const shot of targetShots) {
      const bindings = shot.assetBindings || {};
      const versionIds = [
        ...(bindings.characters || []).map((item: Any) => item.versionId),
        ...(bindings.props || []).map((item: Any) => item.versionId),
        bindings.scene?.versionId,
      ].filter(Boolean);
      if (hasVisualCards && !versionIds.length)
        throw new Error("所选镜头尚未绑定视觉版本，请先在“分镜规划”确认角色、场景或道具");
      for (const versionId of versionIds) {
        const version = visual.versions[versionId];
        if (!version || version.status !== "locked")
          throw new Error("所选镜头引用的视觉版本尚未锁定，请先到“塑角造景”确认");
        if (!version.references?.some((item: Any) => item.role === "primary" && item.assetId))
          throw new Error("所选镜头引用的视觉版本缺少主参考图，请先到“塑角造景”生成或上传");
      }
    }
    let prepared = deriveManagedGraph(
      ensureShotNodes(
        snapshot.doc,
        config.providers,
        system.models,
        id,
        targetShots.map((shot) => shot.id),
        storyboardContextId(snapshot.doc),
      ),
    ) as Doc;
    const nodeIds = selectedShotImageNodeIds(prepared, shotUids);
    if (nodeIds.length !== targetShots.length)
      throw new Error("部分镜头缺少分镜图生成节点");
    for (const nodeId of nodeIds) {
      const imageNode = prepared.nodes.find((item) => item.id === nodeId);
      if (!String(imageNode?.data?.prompt || "").trim())
        throw new Error("所选镜头存在空的 Image Prompt，请先填写后再生成");
      const provider = config.providers.find(
        (item: Any) => item.id === (imageNode?.data?.provider || "local"),
      );
      if (!provider || imageNode?.data?.provider === "local")
        throw new Error("所选镜头尚未选择可用的图片生成服务");
    }
    current.current = { project: snapshot.project, doc: prepared };
    setDoc(prepared);
    dirty.current = true;
    setSaved("未保存");
    setBusy(true);
    setError("");
    try {
      await save();
      if (dirty.current) throw new Error("请先解决保存冲突再生成分镜图");
      const result = await api(
        `/projects/${snapshot.project.id}/run`,
        send("POST", {
          submission_id: id(),
          node_ids: nodeIds,
          exact: true,
        }),
      );
      await refresh(snapshot.project.id);
      setNotice(`已提交 ${result.count} 个所选分镜图任务`);
    } catch (reason) {
      report(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!pendingAutoRunNodeId) return;
    const target = doc?.nodes.find((item) => item.id === pendingAutoRunNodeId);
    if (!target) return;
    setPendingAutoRunNodeId(null);
    void run(target).finally(() => { storyboardSubmissionRef.current = false; });
  }, [pendingAutoRunNodeId, doc?.nodes]);
  async function generateShotVideos(shotUids: string[]) {
    const snapshot = current.current;
    if (!snapshot.project || !snapshot.doc || busy) return;
    const selectedUids = new Set(shotUids);
    const targetShots = snapshot.doc.shots.filter((shot) =>
      selectedUids.has(shotIdentity(shot)),
    );
    if (!targetShots.length) throw new Error("请先选择需要生成的视频镜头");
    let prepared = deriveManagedGraph(
      ensureShotNodes(
        snapshot.doc,
        config.providers,
        system.models,
        id,
        targetShots.map((shot) => shot.id),
        storyboardContextId(snapshot.doc),
      ),
    ) as Doc;
    const rows = deriveVideoProductionRows(prepared, assets, jobs, config.providers);
    const targets = validateVideoSubmission(rows, shotUids);
    let extendedCount = 0;
    for (const target of targets) {
      if (target.effectiveDuration > target.plannedDuration && videoGenerationMode(prepared, target.shot) === 'legacy') {
        prepared = updateShot(prepared, target.shot.id, { duration: target.effectiveDuration }) as Doc;
        extendedCount += 1;
      }
    }
    const nodeIds = selectedShotVideoNodeIds(prepared, shotUids);
    if (nodeIds.length !== targets.length)
      throw new Error("部分镜头缺少视频生成节点");
    current.current = { project: snapshot.project, doc: prepared };
    setDoc(prepared);
    dirty.current = true;
    setSaved("未保存");
    setBusy(true);
    setError("");
    try {
      await save();
      if (dirty.current) throw new Error("请先解决保存冲突再生成视频");
      const result = await api(
        `/projects/${snapshot.project.id}/run`,
        send("POST", {
          submission_id: id(),
          node_ids: nodeIds,
          exact: true,
        }),
      );
      await refresh(snapshot.project.id);
      setPanel("jobs");
      setNotice(`已提交 ${result.count} 个所选视频任务${extendedCount ? `；${extendedCount} 个镜头已按对白自动延长` : ""}`);
    } catch (reason) {
      report(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  }
  async function uploadMotionReference(file: File) {
    const projectId = current.current.project?.id;
    if (!projectId) throw new Error('请先选择项目');
    const form = new FormData(); form.append('file', file);
    const asset = await api(`/projects/${projectId}/assets?category=motion_reference`, {method:'POST',body:form});
    if (current.current.project?.id !== projectId) throw new Error('项目已切换，素材已上传至原项目，请在原项目绑定');
    setAssets(previous => [asset, ...previous.filter(item => item.id !== asset.id)]);
    return asset;
  }
  async function previewVideoSubmission(nodeId: string) {
    const projectId = current.current.project?.id;
    await save();
    if (dirty.current || current.current.project?.id !== projectId) throw new Error('请先保存当前镜头再预览');
    return api(`/projects/${projectId}/nodes/${encodeURIComponent(nodeId)}/video-preview`);
  }
  async function uploadFiles(files: FileList | null, category = uploadCategory) {
    if (!files || !project) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api(`/projects/${project.id}/assets?category=${encodeURIComponent(category)}`, {
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
  async function uploadVisualReference(versionId: string, file: File) {
    const snapshot = current.current;
    if (!snapshot.project || !snapshot.doc) return;
    const visual = visualBibleOf(snapshot.doc);
    const version = visual.versions[versionId];
    const card = version ? visual.cards[version.cardId] : undefined;
    if (!version || !card) throw new Error("视觉版本不存在");
    const form = new FormData();
    form.append("file", file);
    const asset = await api(
      `/projects/${snapshot.project.id}/assets?category=${encodeURIComponent(visualAssetCategory(card))}`,
      { method: "POST", body: form },
    );
    if (asset.kind !== "image") throw new Error("主参考素材必须是图片");
    update((document) =>
      attachUploadedPrimaryReference(document, versionId, asset),
    );
    setAssets((items) => [
      asset,
      ...items.filter((item) => item.id !== asset.id),
    ]);
    setNotice("主参考图已上传，请检查画面后确认锁定");
  }
  async function generateVisualReference(versionId: string) {
    const snapshot = current.current;
    if (!snapshot.project || !snapshot.doc) return;
    const visual = visualBibleOf(snapshot.doc);
    const version = visual.versions[versionId];
    const card = version ? visual.cards[version.cardId] : undefined;
    if (!version || !card) throw new Error("视觉版本不存在");
    const alreadyActive = jobs.find((job) =>
      job.node_id === `visual-version:${versionId}` && ["queued", "running"].includes(job.status),
    );
    if (alreadyActive) throw new Error("该资产参考图已在排队或生成中，请勿重复提交");
    const target = resolveVisualGenerationTarget(
      card,
      snapshot.doc.generationPolicy,
      config.providers,
      system.models,
    );
    const provider = config.providers.find(
      (item: Any) => item.id === target.providerId,
    );
    if (!provider) throw new Error("图片生成服务已不存在，请重新选择");
    let capabilities: Any | undefined;
    if (isStateCard(card)) {
      const catalog = await api(
        `/providers/${encodeURIComponent(target.providerId)}/models?kind=image`,
      );
      const model = (catalog.models || []).find(
        (item: Any) => item.id === target.modelId,
      );
      capabilities = model?.capabilities;
    }
    const plan = planVisualReferenceGeneration(
      snapshot.doc,
      versionId,
      target,
      capabilities,
    );
    await save();
    if (dirty.current) throw new Error("项目尚未保存，请先解决保存冲突");
    const submissionId = id();
    const job = await api(
      `/projects/${snapshot.project.id}/jobs`,
      send("POST", {
        node_id: `visual-version:${versionId}`,
        kind: "image",
        submission_id: submissionId,
        input: {
          provider: plan.providerId,
          model: plan.modelId,
          prompt: plan.prompt,
          asset_ids: plan.assetIds,
          asset_category: plan.assetCategory,
          output_name: `${card.name} · ${isStateCard(card) ? "状态参考图" : "主参考图"} · V${version.version}.png`,
          ratio: snapshot.doc.ratio || "16:9",
          size: imageSizeForRatio(snapshot.doc.ratio || "16:9"),
          visual_reference: {
            versionId,
            targetSource: plan.targetSource,
            parentVersionId: plan.parentVersionId,
            parentReferenceAssetId: plan.parentReferenceAssetId,
          },
        },
      }),
    );
    if (
      !job.project_document ||
      typeof job.project_revision !== "number" ||
      typeof job.production_revision !== "number"
    )
      throw new Error("服务端未返回已持久化的参考图任务归属");
    if (job.production_revision < productionRevision.current) {
      await refresh(snapshot.project.id);
      setNotice("主参考图任务已进入队列；已保留服务器上的较新项目版本");
      return;
    }
    const projectedDocument = deriveManagedGraph(job.project_document);
    revision.current = job.project_revision;
    productionRevision.current = job.production_revision;
    dirty.current = projectedDocument !== job.project_document;
    const updatedProject = {
      ...snapshot.project,
      revision: job.project_revision,
      production_revision: job.production_revision,
      document: projectedDocument,
    };
    current.current = { project: updatedProject, doc: projectedDocument };
    setProject((currentProject) =>
      currentProject && currentProject.id === snapshot.project!.id
        ? updatedProject
        : currentProject,
    );
    setDoc(projectedDocument);
    setSaved(dirty.current ? "未保存" : "已保存");
    await refresh(snapshot.project.id);
    setNotice("主参考图任务已进入队列；完成后请人工确认并锁定");
  }
  async function runSmartBatch(kind: BatchGenerationKind) {
    const snapshot = current.current;
    if (!snapshot.project || !snapshot.doc || busy || batchSubmissionRef.current) return;
    const plan = planBatchGeneration(
      snapshot.doc,
      jobs,
      config.providers,
      system.models,
      kind,
    );
    const names = {
      assets: "资产参考图",
      shot_images: "分镜图",
      shot_videos: "视频",
    };
    if (!plan.readyIds.length) {
      if (kind === "assets") {
        const feedback = assetBatchFeedback(plan, 0);
        setNotice(feedback.notice);
        setError(feedback.error);
        return;
      }
      const detail = plan.blocked.slice(0, 3).map((item) => `${item.label}：${item.reason}`).join("；");
      report(new Error(detail || `没有需要生成的${names[kind]}`));
      return;
    }
    batchSubmissionRef.current = true;
    setBusy(true);
    setError("");
    try {
      let submitted = 0;
      const failed: string[] = [];
      if (kind === "assets") {
        for (const versionId of plan.readyIds) {
          if (current.current.project?.id !== snapshot.project.id) break;
          try {
            await generateVisualReference(versionId);
            submitted += 1;
          } catch (reason: any) {
            const version = visualBibleOf(snapshot.doc).versions[versionId];
            const label = visualBibleOf(snapshot.doc).cards[version?.cardId]?.name || versionId;
            failed.push(`${label}：${reason?.message || String(reason)}`);
          }
        }
      } else {
        await save();
        if (dirty.current) throw new Error("请先解决保存冲突再批量生成");
        const result = await api(
          `/projects/${snapshot.project.id}/run`,
          send("POST", {
            submission_id: id(),
            node_ids: plan.readyIds,
            exact: true,
          }),
        );
        submitted = result.count;
        await refresh(snapshot.project.id);
      }
      if (current.current.project?.id !== snapshot.project.id) return;
      if (kind === "assets") {
        const feedback = assetBatchFeedback(plan, submitted, failed);
        setNotice(feedback.notice);
        setError(feedback.error);
        return;
      }
      if (!submitted && failed.length) throw new Error(failed[0]);
      if (kind === "shot_videos") setPanel("jobs");
      setNotice(
        `已提交 ${submitted} 个${names[kind]}任务` +
          (plan.blocked.length ? `，${plan.blocked.length} 项条件未满足` : "") +
          (plan.skipped.length ? `，跳过 ${plan.skipped.length} 项` : "") +
          (failed.length ? `，${failed.length} 项提交失败` : ""),
      );
      if (failed.length) setError(`部分任务提交失败：${failed[0]}`);
      else if (plan.blocked.length) {
        const details = plan.blocked
          .slice(0, 3)
          .map((item) => `${item.label}：${item.reason}`)
          .join("；");
        setError(`${plan.blocked.length} 项未提交：${details}`);
      }
    } catch (reason) {
      report(reason);
    } finally {
      batchSubmissionRef.current = false;
      setBusy(false);
    }
  }
  async function changeAssetCategory(asset: Asset, category: string) {
    if (!project) return;
    try {
      const updated = await api(`/projects/${project.id}/assets/${asset.id}`, send("PATCH", { category }));
      setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, ...updated } : item));
      setNotice(`已归类为${assetCategories[category]}`);
    } catch (e) { report(e); }
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
    setNotice("已加入连续预览");
  }
  async function exportFilm(
    source: "legacy" | "editor",
    editorOverride?: EditorDocument["timeline"],
  ) {
    if (!project || !doc) return;
    try {
      const editorTimeline = source === "editor"
        ? editorOverride || doc.editor?.timeline
        : undefined;
      if (source === "editor" && !editorTimeline?.tracks?.some((track) => track.elements?.length)) {
        throw new Error("高级剪辑中还没有可导出的轨道内容");
      }
      if (source === "legacy" && !doc.timeline.length) {
        throw new Error("时间线预览中还没有可导出的镜头");
      }
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
            editor_timeline: source === "editor" ? editorTimeline : undefined,
            render_mode: source,
            resolution: defaultExportResolution(doc),
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
      if (isManagedVisualNode(n as Any))
        return {
          ...n,
          width: n.width ?? measured?.width,
          height: n.height ?? measured?.height,
          selected: n.id === selected,
        };
      return {
        ...n,
        width: n.width ?? measured?.width,
        height: n.height ?? measured?.height,
        selected: n.id === selected,
        data: {
          ...n.data,
          asset: assets.find((a) => a.id === (n.data.compositionType ? n.data.previewAssetId : n.data.assetId)),
          onEditComposition: () => setCompositionEditor(n.id),
          job: jobs.find((j) => j.node_id === n.id),
          mediaRetryKey,
          layoutVersion,
          onMediaFailure: reportMediaFailure,
          onMediaReady: clearMediaFailure,
        },
      };
    }) || [];
  const renderedEdges =
    doc?.edges.map((edge, edgeIndex) => {
      const managed = edge.data?.managed === true;
      const lineage = edge.data?.origin === "visual_lineage";
      const stroke = canvasEdgeColor(edge, doc.nodes, doc.filmBible?.visual);
      const focusedNode = hoveredNode || selected;
      const related =
        !focusedNode || edge.source === focusedNode || edge.target === focusedNode;
      return {
        ...edge,
        selected: edge.id === selectedEdge,
        interactionWidth: 24,
        // Orthogonal smooth-step edges share vertical trunks when one source
        // fans out to many shots. Bezier wires diverge immediately, matching
        // the readable socket-to-socket routing used by node editors.
        type: "default",
        pathOptions: {
          curvature: managed
            ? 0.34 + (edgeIndex % 3) * 0.035
            : 0.25 + (edgeIndex % 3) * 0.025,
        },
        animated: edge.animated !== false && related,
        className: `${edge.className || ""} mvc-flow-edge${managed ? " mvc-flow-edge-managed" : ""}${lineage ? " mvc-flow-edge-lineage" : ""}`.trim(),
        zIndex: edge.id === selectedEdge ? 1 : 0,
        markerEnd: {
          ...(typeof edge.markerEnd === "object" ? edge.markerEnd : {}),
          type: MarkerType.ArrowClosed,
          color: stroke,
          width:
            typeof edge.markerEnd === "object" ? (edge.markerEnd.width ?? 14) : 14,
          height:
            typeof edge.markerEnd === "object" ? (edge.markerEnd.height ?? 14) : 14,
        },
        style: {
          ...edge.style,
          stroke,
          strokeWidth: edge.id === selectedEdge ? 4 : focusedNode && related ? 2.65 : lineage ? 1.75 : managed ? 1.85 : 1.7,
          strokeDasharray: lineage ? "7 7" : undefined,
          opacity: edge.id === selectedEdge ? 1 : focusedNode
            ? related
              ? 0.96
              : 0.19
            : managed
              ? 0.76
              : 0.68,
        },
      };
    }) || [];
  async function assistantNavigate(action: AssistantAction) {
    if (action.projectId && action.projectId !== project?.id) await openProject(action.projectId);
    if (action.kind === "stage" && ["overview","source","adaptation","script","storyboard","art","images","video","editor","canvas"].includes(action.stage || "")) {
      activateWorkflowStage(action.stage as WorkflowStage); setPanel(null);
    } else if (action.kind === "panel" && ["settings","projectInfo"].includes(action.panel || "")) {
      if(action.panel === "projectInfo")setProjectSettingsTab("production");
      setPanel(action.panel!);
    } else if(action.kind === "node" && action.nodeId) {
      const target=current.current.doc?.nodes.find((item:Any)=>item.id===action.nodeId);
      if(!target)throw new Error("此节点已不存在，请重新提问以刷新状态。");
      activateWorkflowStage("canvas");setSelected(action.nodeId);setPanel(null);
      setTimeout(()=>fitView({nodes:[{id:action.nodeId!}],padding:0.8}),100);
    }
  }
  const workflowGuide = deriveWorkflowGuide({
    adaptation: workflowContext.adaptation,
    scripts: workflowContext.scripts,
    currentProject: project,
    document: doc,
    jobs: mergeTaskSnapshots(jobs, productionJobs.filter((job) =>
      ["source_analysis", "adaptation_generation", "adaptation_episode_generation", "script_generation"].includes(job.input?.stage))),
  });
  const assistantUI=<AssistantPanel open={panel==="assistant"} onClose={()=>setPanel(null)} projectId={project?.id} productionId={project?.production_id}
    context={{production:productions.find(item=>item.id===project?.production_id)?.name || project?.name,episode:project?.episode_no,page:({overview:"概览",source:"原著",adaptation:"改编策划",script:"剧本",storyboard:"分镜规划",art:"塑角造景",images:"分镜图",video:"视频",editor:"剪辑",canvas:"高级画布"})[workflowStage],selectedNode:selected?{label:doc?.nodes.find(item=>item.id===selected)?.data?.label as string}:undefined}}
    stage={workflowStage} nodeId={selected} unsaved={dirty.current} pageGuide={JSON.stringify(workflowGuide.stages[workflowStage] || {})} onAction={assistantNavigate}/>;
  if (!doc || !project)
    return (
      <div className={booted ? "empty-workspace" : "loading"}>
        {!booted ? <><LoaderCircle className="spin" />{error || "正在打开工作室"}</> : <>
          <AnYingMark size={64}/>
          <span className="eyebrow">ANYING STUDIO</span>
          <h1>创建第一部作品</h1>
          <p>先确认视觉风格、资产画幅、目标时长、默认模型与 Project Bible，再进入 EP01。</p>
          <button className="primary" onClick={openProjectSetup}><Plus size={17}/>创建第一部作品</button>
          <button onClick={()=>{loadTrash().then(()=>setPanel("trash")).catch(report);}}><Trash2 size={16}/>回收站</button>
          {panel==="trash"&&<section className="empty-trash-list"><h3>回收站</h3>{[...(trashItems.productions||[]).map((item:Any)=>({...item,trashKind:"production"})),...trashItems.projects.map((item:Any)=>({...item,trashKind:"project"}))].map((item:Any)=><div className="trash-row" key={item.id}><b>{item.name}</b><button onClick={()=>restoreTrashItem(item.trashKind,item).catch(report)}>恢复{item.trashKind==="production"?"整部作品":"制作集"}</button></div>)}{!trashItems.productions?.length&&!trashItems.projects.length&&<p className="muted">没有可恢复的作品或制作集</p>}</section>}
          <button onClick={()=>setPanel(panel==="assistant"?null:"assistant")}>AI助手</button>
          {error && <div className="error">{error}</div>}
        </>}
        {panel==="assistant"&&<div className="assistant-scrim" onClick={()=>setPanel(null)}/>}
        {assistantUI}
        {panel==="settings"&&<div className="modal-overlay"><div className="project-setup-dialog"><header><h2>设置</h2><button onClick={()=>setPanel(null)}>关闭</button></header><div className="project-setup-content"><SettingsPanel config={config} system={system} onSave={async value=>{setConfig(await api("/settings",send("PUT",value)));setSystem(await api("/system"));}} onRefresh={async()=>setSystem(await api("/system"))} onError={report} onLogout={async()=>{await api("/auth/logout",send("POST"));onLogout();}}/></div></div></div>}
        {projectSetupOpen && <ProjectSetupDialog
          key={projectSetupKey}
          providers={config.providers}
          localModels={system.models}
          onClose={() => setProjectSetupOpen(false)}
          onCreate={createProduction}
        />}
      </div>
    );
  const assetBatchPlan = planBatchGeneration(
    doc, jobs, config.providers, system.models, "assets",
  );
  const imageBatchPlan = planBatchGeneration(
    doc, jobs, config.providers, system.models, "shot_images",
  );
  const videoBatchPlan = planBatchGeneration(
    doc, jobs, config.providers, system.models, "shot_videos",
  );
  const persistedEditorTimeline = doc.editor?.timeline;
  const exportEditorTimeline = editorExportTimeline || persistedEditorTimeline;
  const exportEditorTracks = exportEditorTimeline?.tracks || [];
  const currentProduction =
    productions.find((item) => item.id === project.production_id) || null;
  const currentEpisodes = episodesForProduction(projects, project.production_id);
  const currentWorkflowScope = workflowStageScope(workflowStage);
  const projectBibleFields = bibleFields(doc);
  const filmBiblePanelProps: React.ComponentProps<typeof FilmBiblePanel> = {
    visual: visualBibleOf(doc),
    scriptText: String(doc.nodes.find(node => node.data?.canonicalScriptProjection)?.data?.text || ""),
    shots: doc.shots,
    assets,
    jobs,
    generationPolicy: doc.generationPolicy,
    modelPool: doc.modelPool || undefined,
    providers: config.providers,
    localModels: system.models,
    request: api,
    voiceProfiles: voiceProfilesOf(doc),
    onPreviewAsset: (asset) => setPreview(asset as Asset),
    onChooseVoiceVersion: (cardId, version) => {
      try { update(document => chooseVoiceVersion(document, cardId, version)); setNotice("声音版本已选择，关联的旧视频需要重新生成"); } catch (reason) { report(reason); }
    },
    onInheritVoice: (cardId) => {
      update((document) => {
        const profiles = { ...voiceProfilesOf(document) };
        delete profiles[cardId];
        return { ...document, filmBible: { ...document.filmBible, voices: { profiles } } };
      });
      setNotice("该状态已恢复继承基础角色音色");
    },
    onBindVoiceSample: async (cardId, profile, file, assetId) => {
      const projectId = project.id;
      const initial = JSON.stringify(voiceProfilesOf(current.current.doc!)[cardId]);
      if (file) {
        const form = new FormData(); form.append('file', file);
        const uploaded = await api(`/projects/${projectId}/assets?category=voice&voice_reference=true`, {method:'POST',body:form});
        assetId = uploaded.id;
      }
      if (!assetId) throw new Error('请选择声音文件');
      const asset = await api(`/projects/${projectId}/assets/${assetId}/voice-reference`, send('POST', {authorized:true}));
      if (current.current.project?.id !== projectId || JSON.stringify(voiceProfilesOf(current.current.doc!)[cardId]) !== initial) throw new Error('声音配置已改变，文件已保留到素材库，请重新选择绑定');
      setAssets(previous => [asset, ...previous.filter(item => item.id !== asset.id)]);
      update(document => saveVoiceProfile(document, cardId, {...profile, source:{type:'uploaded',originalAssetId:asset.id,authorizedAt:asset.metadata.voice_reference.authorized_at},providerId:'',voiceType:'',previewText:'',status:'draft',referenceAssetId:undefined,referenceVersion:undefined,generationJobId:undefined}));
      await save();
      if (dirty.current) throw new Error('声音草稿未保存，请重试保存');
      setNotice('声音样本已保存为草稿，试听后可锁定');
    },
    onSaveVoice: (cardId, profile) => {
      try {
        update((document)=>saveVoiceProfile(document,cardId,profile));
        setNotice("角色声音设定已保存");
      } catch (reason) { report(reason); }
    },
    onGenerateVoice: async (cardId, profile) => {
      requireTtsVoice(profile);
      const card = visualBibleOf(doc).cards[cardId];
      if (!card) throw new Error("角色资产卡不存在");
      const next = saveVoiceProfile(doc, cardId, profile);
      const savedProfile = voiceProfilesOf(next)[cardId];
      update(()=>next);
      await save();
      if (dirty.current) throw new Error("角色声音设定尚未保存，请先解决保存冲突");
      const job = await api(`/projects/${project.id}/jobs`, send("POST", {
        node_id: `voice-profile:${cardId}`,
        kind: "audio",
        submission_id: id(),
        input: {
          prompt: savedProfile.previewText,
          provider: savedProfile.providerId,
          model: savedProfile.voiceType,
          voice_type: savedProfile.voiceType,
          voice_version: savedProfile.version,
          character_name: card.name,
          output_name: `${card.name} · 声音 V${savedProfile.version} 试听.mp3`,
          asset_category: "voice",
          parameters: {
            speech_rate: savedProfile.parameters.speechRate,
            emotion: savedProfile.parameters.emotion,
          },
          voice_profile: { cardId, version: savedProfile.version, identity: voiceIdentity(savedProfile) },
        },
      }));
      update((document)=>{
        const currentVoice=voiceProfilesOf(document)[cardId];
        if (!currentVoice || currentVoice.version!==savedProfile.version || voiceIdentity(currentVoice)!==voiceIdentity(savedProfile)) return document;
        return {...document,filmBible:{...document.filmBible,voices:{profiles:{...voiceProfilesOf(document),[cardId]:{...currentVoice,generationJobId:job.id}}}}};
      });
      await refresh(project.id);
      setNotice("角色固定音色试听已进入任务队列");
    },
    onLockVoice: (cardId, locked) => {
      try {
        update((document)=>setVoiceLocked(document,cardId,locked));
        setNotice(locked ? "角色主音色已锁定" : "已创建可编辑的新声音版本");
      } catch (reason) { report(reason); }
    },
    onGenerateCharacterDialogue: async (cardId) => {
      const profile = effectiveVoiceProfile(voiceProfilesOf(doc)[cardId]);
      const card = visualBibleOf(doc).cards[cardId];
      if (!profile || profile.status !== "locked") throw new Error("请先试听并锁定角色主音色");
      requireTtsVoice(profile);
      const dialogues = doc.shots.flatMap((shot) =>
        (Array.isArray(shot.dialogues) ? shot.dialogues : [])
          .filter((dialogue: Any) => voiceCardId(doc, shot, dialogue) === cardId)
          .map((dialogue: Any, index: number) => ({ shot, dialogue, index })),
      );
      if (!dialogues.length) throw new Error("本集分镜没有该角色的结构化对白；重新生成分镜规划后会自动提取对白");
      const existing = new Set(assets.flatMap((asset) => {
        const dialogue = asset.metadata?.input?.dialogue;
        return dialogue?.id && (dialogue.voiceCardId || dialogue.characterCardId) === cardId && dialogue.voiceVersion === profile.version ? [dialogue.id] : [];
      }));
      const pending = new Set(jobs.flatMap((job) => {
        const dialogue = job.input?.dialogue;
        return dialogue?.id && (dialogue.voiceCardId || dialogue.characterCardId) === cardId && dialogue.voiceVersion === profile.version && ["queued","running","succeeded"].includes(job.status) ? [dialogue.id] : [];
      }));
      const needed = dialogues.filter(({dialogue})=>!existing.has(dialogue.id) && !pending.has(dialogue.id));
      if (!needed.length) throw new Error("该角色本集对白已经生成或正在生成");
      await save();
      await Promise.all(needed.map(({shot,dialogue,index})=>{
        const performance = dialoguePerformance(shot, dialogue, profile);
        return api(`/projects/${project.id}/jobs`,send("POST",{
        node_id:`dialogue:${dialogue.id}`,
        kind:"audio",
        submission_id:id(),
        input:{
          prompt:dialogue.text,
          provider:profile.providerId,
          model:profile.voiceType,
          voice_type:profile.voiceType,
          voice_version:profile.version,
          character_name:card?.name || dialogue.characterName,
          output_name:`${shot.id || "分镜"} · ${card?.name || "角色"}对白 ${index+1}.mp3`,
          asset_category:"voice",
          emotion:performance.emotion,
          parameters:{speech_rate:profile.parameters.speechRate,emotion:performance.emotion,context_texts:performance.contextTexts},
          dialogue:{id:dialogue.id,shotUid:String(shot.uid||shot.id),characterCardId:dialogue.characterCardId,voiceCardId:cardId,voiceVersion:profile.version,text:dialogue.text,emotion:performance.emotion,contextTexts:performance.contextTexts},
        },
      }));
      }));
      await refresh(project.id);
      setNotice(`已并发提交 ${needed.length} 条${card?.name || "角色"}对白`);
      return needed.length;
    },
    onRegenerateDialogue: async (cardId, dialogueId) => {
      const profile = effectiveVoiceProfile(voiceProfilesOf(doc)[cardId]);
      const card = visualBibleOf(doc).cards[cardId];
      if (!profile || profile.status !== "locked") throw new Error("请先试听并锁定角色主音色");
      requireTtsVoice(profile);
      const match = doc.shots.flatMap((shot) =>
        (Array.isArray(shot.dialogues) ? shot.dialogues : [])
          .filter((dialogue: Any) => voiceCardId(doc, shot, dialogue) === cardId && dialogue.id === dialogueId)
          .map((dialogue: Any) => ({ shot, dialogue })),
      )[0];
      if (!match) throw new Error("该对白已不存在，请刷新后重试");
      const active = jobs.some((job) => job.input?.dialogue?.id === dialogueId && job.input?.dialogue?.voiceVersion === profile.version && ["queued","running"].includes(job.status));
      if (active) throw new Error("该对白正在生成，请等待当前任务完成");
      await save();
      if (dirty.current) throw new Error("角色声音设定尚未保存，请先解决保存冲突");
      const performance = dialoguePerformance(match.shot, match.dialogue, profile);
      await api(`/projects/${project.id}/jobs`,send("POST",{
        node_id:`dialogue:${dialogueId}`,
        kind:"audio",
        submission_id:id(),
        input:{
          prompt:match.dialogue.text,
          provider:profile.providerId,
          model:profile.voiceType,
          voice_type:profile.voiceType,
          voice_version:profile.version,
          character_name:card?.name || match.dialogue.characterName,
          output_name:`${match.shot.id || "分镜"} · ${card?.name || "角色"}对白 · 新版本.mp3`,
          asset_category:"voice",
          emotion:performance.emotion,
          parameters:{speech_rate:profile.parameters.speechRate,emotion:performance.emotion,context_texts:performance.contextTexts},
          dialogue:{id:dialogueId,shotUid:String(match.shot.uid||match.shot.id),characterCardId:match.dialogue.characterCardId,voiceCardId:cardId,voiceVersion:profile.version,text:match.dialogue.text,emotion:performance.emotion,contextTexts:performance.contextTexts},
        },
      }));
      await refresh(project.id);
      setNotice("对白已重新提交，旧音频仍保留在素材库");
    },
    focusVersionId: visualFocus,
    onFocusVersion: setVisualFocus,
    onRenameCard: (cardId, name) => {
      try {
        update(() => renameVisualCard(doc, cardId, name));
        setNotice("视觉卡名称已保存");
      } catch (reason) { report(reason); }
    },
    onDeleteCard: (cardId) => {
      const card = visualBibleOf(doc).cards[cardId];
      if (!card || !window.confirm(`将视觉资产卡“${card.name}”移入回收站？恢复后原分镜绑定会重新生效。`)) return;
      try {
        update((currentDoc) => softDeleteVisualCard(currentDoc, cardId));
        setNotice(`视觉资产卡“${card.name}”已移入回收站`);
      } catch (reason) { report(reason); }
    },
    onSaveVersion: (versionId, draft) => {
      try {
        update(() => updateDraftVisualVersion(doc, versionId, {
          spec: { description: draft.description, attributes: draft.attributes },
          invariants: draft.invariants,
        }));
        setNotice("视觉版本文字已保存");
      } catch (reason) { report(reason); }
    },
    onStatus: (versionId, status) => {
      try { update(() => setVisualVersionStatus(doc, versionId, status)); }
      catch (reason) { report(reason); }
    },
    onRestoreVersion: async (versionId) => {
      const pid = current.current.project?.id;
      if (!pid) return;
      await save();
      if (dirty.current) throw new Error("请先解决保存失败，再恢复版本");
      if (current.current.project?.id !== pid) return;
      await api(`/projects/${pid}/visual-versions/${versionId}/restore`, send("POST", {
        production_revision: productionRevision.current,
      }));
      // Keep edits made while the restore request was in flight; normal refresh
      // reconciles the production revision instead of replacing the whole draft.
      if (current.current.project?.id !== pid) return;
      if (!dirty.current) await syncLatestProject(pid, true);
      else await refresh(pid);
      setNotice("已恢复弃用前状态，原参考图和分镜绑定保持不变");
    },
    onSetImageOverride: (cardId, override) => {
      try {
        update((document) => setVisualCardImageOverride(document, cardId, override));
        setNotice(override.mode === "override" ? "此资产将使用自定义图片模型" : "此资产将继承项目默认图片模型");
      } catch (reason) { report(reason); }
    },
    onUploadReference: uploadVisualReference,
    onGenerateReference: generateVisualReference,
    onLock: (versionId) => {
      try {
        update((document) => lockVisualVersion(document, versionId));
        setNotice("视觉版本已确认锁定");
      } catch (reason) { report(reason); }
    },
    onFork: (versionId, draft) => {
      try {
        const next = forkLockedVisualVersion(doc, versionId, {
          spec: { description: draft.description, attributes: draft.attributes },
          invariants: draft.invariants,
        });
        update(() => next);
        const source = visualBibleOf(doc).versions[versionId];
        setVisualFocus(visualBibleOf(next).cards[source.cardId].currentVersionId);
        setNotice("已派生新草稿版本；旧版本和分镜绑定保持不变");
      } catch (reason) { report(reason); }
    },
    onUpgrade: (cardId, targetVersionId, scope) => {
      try {
        update(() => upgradeVisualBindings(doc, cardId, targetVersionId, scope));
        setNotice("已升级明确范围内的分镜；旧生成素材已保留并标记待更新");
      } catch (reason) { report(reason); }
    },
    onBind: (shotUid, versionId) => {
      try {
        update(() => bindVisualVersion(doc, shotUid, versionId));
        setNotice("视觉版本已绑定到分镜");
      } catch (reason) { report(reason); }
    },
    onUnbind: (shotUid, versionId) => {
      try {
        update(() => unbindVisualVersion(doc, shotUid, versionId));
        setNotice("视觉版本已从分镜解除");
      } catch (reason) { report(reason); }
    },
    onLocate: (versionId) => {
      const visualNode = doc.nodes.find((item) => item.data?.visualVersionId === versionId);
      if (!visualNode) return;
      activateWorkflowStage("canvas");
      setSelected(visualNode.id);
      setPanel(null);
      setTimeout(() => fitView({ nodes: [{ id: visualNode.id }], padding: 0.8 }), 50);
    },
  };
  const toggleTimelineWorkspace = () => {
    if (view === "editor") {
      setView("canvas");
      setTimelineOpen(true);
      return;
    }
    setTimelineOpen(!timelineOpen);
  };
  return (
    <div className="studio-shell" inert={episodeTransition ? true : undefined} aria-busy={Boolean(episodeTransition)}>
      <EpisodeTransition transition={episodeTransition} />
      {projectSetupOpen && <ProjectSetupDialog
        key={projectSetupKey}
        providers={config.providers}
        localModels={system.models}
        onClose={() => setProjectSetupOpen(false)}
        onCreate={createProduction}
      />}
      {episodeSetupProduction && <EpisodeSetupDialog name={episodeSetupProduction.name} next={Math.max(0,...episodesForProduction(projects,episodeSetupProduction.id).map(item=>item.episode_no))+1} defaultMode={episodeSetupProduction.id === project.production_id ? ((doc as Any).creationMode || "direct") : "direct"} onClose={()=>setEpisodeSetupProduction(null)} onCreate={(title,mode)=>createEpisode(episodeSetupProduction,title,mode)}/>}
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
          onClick={() => {
            activateWorkflowStage("overview");
          }}
          aria-label="返回安影项目概览"
        >
          <AnYingMark />
          <strong>安影</strong>
          <span>STUDIO</span>
        </button>
        <span className="divider" />
        <button
          className={panel === "projectInfo" ? "project-menu active" : "project-menu"}
          onClick={() => { setProjectSettingsTab("production"); setPanel(panel === "projectInfo" ? null : "projectInfo"); }}
          title="查看和修改当前项目"
          aria-label={`查看和修改项目：${currentProduction?.name || project.name}`}
        >
          {currentProduction?.name || project.name}
        </button>
        <WorkflowStageNav
          active={workflowStage}
          directCreation={(doc as Any).creationMode === "direct"}
          onChange={activateWorkflowStage}
          states={Object.fromEntries(Object.entries(workflowGuide.stages).map(([stage, guide]: any) => [stage, guide.state]))}
          episodeControl={<EpisodeSelector episode={project} episodes={currentEpisodes} onSelect={(projectId) => {
            if (projectId === project.id) return;
            const target = currentEpisodes.find((item) => item.id === projectId);
            if (!target) return;
            void switchEpisode(`EP${String(target.episode_no).padStart(2, "0")}`, () => openProject(projectId)).catch(report);
          }} />}
        />
        <div className="workflow-header-meta" title="当前项目规格">
          <span>{doc.ratio}</span><i>·</i><span>{doc.style}</span><i>·</i><span>{doc.duration} 秒</span>
        </div>
        <button
          className="project-settings-button"
          aria-label={currentWorkflowScope === "production" ? "打开作品设置" : "打开当前集设置"}
          title={currentWorkflowScope === "production" ? "作品设置" : "当前集设置"}
          onClick={() => { setProjectSettingsTab(currentWorkflowScope); setPanel("projectInfo"); }}
        >
          <FileText size={15} /><span>{currentWorkflowScope === "production" ? "作品设置" : "当前集设置"}</span>
        </button>
        <span
          className={"save-status " + (saved === "保存失败" ? "danger" : "")}
        >
          <span className="status-dot" />
          {saved}
        </span>
        <div className="top-spacer" />
        <button
          className="icon-button"
          aria-label="保存项目"
          title="保存 Ctrl+S"
          onClick={() => save()}
        >
          <Save size={18} />
        </button>
        <button
          className="avatar"
          onClick={() => setPanel("settings")}
          title="工作室设置"
        >
          我
        </button>
      </header>
      <GlobalNav
        active={panel}
        taskCount={activeCount}
        onChange={activateGlobalPanel}
      />
      <main className="work-area">
        <div className={`viewbar ${workflowStage === "storyboard" ? "storyboard-viewbar" : ""}`}>
          {workflowStage === "storyboard" ? (
            <div className="segmented" aria-label="分镜视图">
              <button className={view === "shots" ? "active" : ""} onClick={() => setView("shots")}>
                <Table2 size={15} />分镜表<span>{doc.shots.length || ""}</span>
              </button>
              <button onClick={() => activateWorkflowStage("canvas")}>
                高级画布<ArrowUpRight size={13} />
              </button>
            </div>
          ) : workflowStage === "images" ? (
            <div className="segmented" aria-label="分镜图视图">
              <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><LayoutGrid size={15}/>宫格<span>{doc.shots.length || ""}</span></button>
              <button className={view === "shots" ? "active" : ""} onClick={() => setView("shots")}><Table2 size={15}/>列表</button>
              <button onClick={() => activateWorkflowStage("canvas")}>高级画布<ArrowUpRight size={13}/></button>
            </div>
          ) : workflowStage === "editor" ? (
            <strong className="workspace-title"><Scissors size={15} />Twick 多轨剪辑</strong>
          ) : (
            <strong className="workspace-title">
              {{
                overview: "项目概览",
                source: "原著资料",
                adaptation: "改编策划",
                script: "剧本工作区",
                art: "塑角造景",
                images: "分镜图",
                video: "视频工作区",
                canvas: "高级画布",
              }[workflowStage]}
            </strong>
          )}
          {!['overview', 'canvas'].includes(workflowStage) && <WorkflowGuideBanner
            guide={workflowGuide.stages[workflowStage]}
            onNavigate={activateWorkflowStage}
          />}
          {workflowStage === "canvas" && view === "canvas" && (
            <>
            <button className="quiet" onClick={() => setPanel(panel === "add" ? null : "add")}>
              <Plus size={15} />添加节点
            </button>
            <button className="quiet" onClick={() => setPanel("prompts")}>
              <Sparkles size={15} />提示词
            </button>
            <button className="quiet" onClick={() => history().catch(report)}>
              <History size={15} />历史
            </button>
            <button
              className="quiet"
              disabled={!doc.nodes.length}
              onClick={() => {
                update((document) => autoLayoutCanvas(document));
                setSelected(null);
                setLayoutVersion((value) => value + 1);
                setTimeout(() => fitView({ padding: 0.16 }), 100);
                setNotice("画布已按创作链路自动排列");
              }}
              title="按剧本、分镜、视觉资产、分镜图和视频自动排列"
            >
              <LayoutGrid size={15} />
              自动排列
            </button>
            </>
          )}
          {["art", "images", "video", "canvas"].includes(workflowStage) && (
            <div className="batch-generation-actions" aria-label="批量生成">
              {["art", "canvas"].includes(workflowStage) && <button
                className="quiet"
                disabled={busy}
                onClick={() => void runSmartBatch("assets")}
                title={`仅生成缺失且满足条件的资产；${assetBatchPlan.waiting.length} 个状态资产等待基础图锁定，${assetBatchPlan.blocked.length} 项需要处理`}
              >
                <BookOpen size={15} />
                生成全部资产 <b>{assetBatchPlan.readyIds.length}</b>{assetBatchPlan.waiting.length > 0 && <small> · {assetBatchPlan.waiting.length} 项等待锁定</small>}
              </button>}
              {["images", "canvas"].includes(workflowStage) && <button
                className="quiet"
                disabled={busy}
                onClick={() => void runSmartBatch("shot_images")}
                title={`智能生成缺失或过期的分镜图；${imageBatchPlan.blocked.length} 项尚未满足条件`}
              >
                <ImageIcon size={15} />
                全部分镜图 <b>{imageBatchPlan.readyIds.length}</b>
              </button>}
              {["video", "canvas"].includes(workflowStage) && <button
                className="quiet"
                disabled={busy}
                onClick={() => void runSmartBatch("shot_videos")}
                title={`智能生成已有合格首帧的镜头视频；${videoBatchPlan.blocked.length} 项尚未满足条件`}
              >
                <Film size={15} />
                全部视频 <b>{videoBatchPlan.readyIds.length}</b>
              </button>}
            </div>
          )}
          {workflowStage === "canvas" && view !== "editor" && (
              <button
                className="quiet"
                disabled={busy || !doc.nodes.length}
                onClick={() => setPanel("run")}
              >
                <Play size={15} />
                高级运行
              </button>
          )}
        </div>
        {workflowStage === "overview" ? (
          <WorkflowOverview
            projectName={currentProduction?.name || project.name}
            duration={doc.duration}
            ratio={doc.ratio}
            style={doc.style}
            scriptCount={(workflowContext.scripts || []).filter((item: Any) => String(item.script?.body || "").trim()).length}
            visualCount={Object.values(visualBibleOf(doc).cards).filter((card) => !card.deletedAt).length}
            shotCount={doc.shots.length}
            videoCount={doc.nodes.filter((node) => node.data?.kind === "video" && node.data?.assetId).length}
            activeJobs={activeCount}
            guide={workflowGuide}
            onOpenStage={activateWorkflowStage}
          />
        ) : workflowStage === "source" ? (
          <SourceLibraryPage
            key={project.production_id}
            onScriptsImported={finishScriptImport}
            jobs={productionJobs}
            onJobsSubmitted={(submitted) => {
              if (current.current.project?.production_id === project.production_id) {
                setProductionJobs((known) => mergeTaskSnapshots(known, submitted));
              }
            }}
            productionId={project.production_id}
            projectId={project.id}
            providers={projectProviders(doc.modelPool || undefined, config.providers, "text", system.models)}
            defaultTarget={(doc as Any).generationPolicy?.text}
            refreshKey={workflowDataRevision.source}
            request={api}
            notify={setNotice}
            report={report}
            onChanged={() => setWorkflowDataRevision((value) => ({ ...value, adaptation: value.adaptation + 1 }))}
          />
        ) : workflowStage === "adaptation" ? (
          <AdaptationPage
            key={project.production_id}
            focusedEpisodeNo={planningEpisodeFocus[project.production_id]}
            onSelectEpisode={(episodeNo) => setPlanningEpisodeFocus((known) => known[project.production_id] === episodeNo ? known : { ...known, [project.production_id]: episodeNo })}
            productionId={project.production_id}
            projectId={project.id}
            providers={projectProviders(doc.modelPool || undefined, config.providers, "text", system.models)}
            defaultTarget={(doc as Any).generationPolicy?.text}
            refreshKey={workflowDataRevision.adaptation}
            request={api}
            notify={setNotice}
            report={report}
            onOpenSource={() => activateWorkflowStage("source")}
            onOpenScript={() => activateWorkflowStage("script")}
            onRevision={(nextRevision) => {
              productionRevision.current = nextRevision;
              setProject((currentProject) => currentProject ? { ...currentProject, production_revision: nextRevision } : currentProject);
              setProductions((items) => items.map((item) => item.id === project.production_id ? { ...item, revision: nextRevision } : item));
            }}
          />
        ) : workflowStage === "script" ? (
          <ScriptRoomPage
            constraintsCard={<CreativeConstraintsCard key={project.production_id} document={doc} productionId={project.production_id} projectId={project.id} jobs={productionJobs} request={api} notify={setNotice} report={report}
              onPrepare={async()=>{await save();if(dirty.current)throw new Error("请先保存当前项目后重试");}}
              onApply={async fields=>{update(document=>mergeBibleFields(document,fields));await save();if(dirty.current||Object.entries(fields).some(([key,value])=>(bibleFields(current.current.doc!) as Any)[key]!==value))throw new Error("创作约束未保存成功，请刷新核对后重试");}}
              onJob={submitted=>setProductionJobs(known=>mergeTaskSnapshots(known,submitted))}/>}
            projectId={project.id}
            onScriptsImported={finishScriptImport}
            onAddEpisode={()=>{if(currentProduction)setEpisodeSetupProduction(currentProduction);}}
            key={project.production_id}
            productionId={project.production_id}
            currentEpisodeNo={planningEpisodeFocus[project.production_id] || project.episode_no}
            onFocusEpisode={(episodeNo) => setPlanningEpisodeFocus((known) => known[project.production_id] === episodeNo ? known : { ...known, [project.production_id]: episodeNo })}
            jobs={productionJobs}
            onJobsSubmitted={(submitted) => {
              if (current.current.project?.production_id === project.production_id) {
                setProductionJobs((known) => mergeTaskSnapshots(known, submitted));
              }
            }}
            providers={projectProviders(doc.modelPool || undefined, config.providers, "text", system.models)}
            defaultTarget={(doc as Any).generationPolicy?.text}
            refreshKey={workflowDataRevision.script}
            request={api}
            notify={setNotice}
            report={report}
            onChanged={async (changedProjectId) => {
              await refreshProductionHierarchy();
              await refresh(project.id);
              if (changedProjectId === project.id) await openProject(project.id);
            }}
            onSelectEpisode={async (episodeNo) => {
              const episode = currentEpisodes.find((item) => item.episode_no === episodeNo);
              if (episode && episode.id !== project.id) await openProject(episode.id);
              setPlanningEpisodeFocus((known) => ({ ...known, [project.production_id]: episodeNo }));
            }}
            onEnterEpisode={async (episodeNo) => {
              const hierarchy = await refreshProductionHierarchy();
              const episode = episodesForProduction(hierarchy.projects, project.production_id).find((item) => item.episode_no === episodeNo);
              if (episode && episode.id !== project.id) await openProject(episode.id);
              if (!episode) throw new Error(`EP${String(episodeNo).padStart(2, "0")} 尚未建立可制作的 Episode`);
              activateWorkflowStage("storyboard");
            }}
          />
        ) : workflowStage === "art" ? (
          <ArtDepartmentPage
            {...filmBiblePanelProps}
            productionName={currentProduction?.name || project.name}
            usage={visualUsage}
            batchPlan={assetBatchPlan}
          />
        ) : ["storyboard", "images"].includes(workflowStage) && (view === "shots" || view === "grid") ? (
          <StoryboardWorkspace
            renderImageSettings={(shot) => {
              const imageNode = doc.nodes.find(item => item.id === (shot.imageNode || shot.pipeline?.imageNodeId));
              const target = doc.generationPolicy?.image;
              return <ImageGenerationSettings document={doc} data={imageNode?.data || { provider: target?.providerId, model: target?.modelId }} providers={config.providers} projectId={project.id} request={api} onChange={patch => update(document => {
                const prepared = ensureShotNodes(document, config.providers, system.models, id, [shot.id], storyboardContextId(document));
                const preparedShot = prepared.shots.find(item => shotIdentity(item) === shotIdentity(shot));
                return patchNode(prepared, preparedShot?.imageNode || preparedShot?.pipeline?.imageNodeId, patch);
              })}/>;
            }}
            purpose={workflowStage === "images" ? "images" : "planning"}
            mode={view === "grid" ? "grid" : "table"}
            document={doc}
            assets={assets}
            jobs={jobs}
            busy={busy}
            onPatch={(uid, patch) =>
              update((document) => updateStoryboardShot(document, uid, patch))
            }
            onMove={(uid, offset) =>
              update((document) => moveStoryboardShot(document, uid, offset))
            }
            onCreate={() => {
              update((document) => createStoryboardShot(document, id));
              setNotice("已新建空镜头；填写内容后再显式生成分镜图");
            }}
            onCreatePlan={startStoryboardPlanning}
            onEnsureAll={allShotNodes}
            onAppendTimeline={appendShotTimeline}
            onBind={(uid, versionId) => {
              update((document) => {
                const shot = document.shots.find((item) => shotIdentity(item) === uid);
                const next = bindVisualVersion(document, uid, versionId);
                return invalidate(next, [
                  shot?.imageNode || shot?.pipeline?.imageNodeId,
                  shot?.videoNode || shot?.pipeline?.videoNodeId,
                ].filter(Boolean));
              });
              setNotice("视觉版本已绑定到镜头");
            }}
            onUnbind={(uid, versionId) => {
              update((document) => {
                const shot = document.shots.find((item) => shotIdentity(item) === uid);
                const next = unbindVisualVersion(document, uid, versionId);
                return invalidate(next, [
                  shot?.imageNode || shot?.pipeline?.imageNodeId,
                  shot?.videoNode || shot?.pipeline?.videoNodeId,
                ].filter(Boolean));
              });
              setNotice("视觉版本已从镜头解除");
            }}
            onUpgrade={(uid, cardId, versionId) => {
              update((document) =>
                upgradeVisualBindings(document, cardId, versionId, {
                  shotUids: [uid],
                }),
              );
              setNotice("已显式升级当前镜头的视觉版本；旧画面保留并标记待更新");
            }}
            onGenerate={generateStoryboardImages}
            onOpenCanvas={(shot, index) => {
              if (shot.imageNode || shot.pipeline?.imageNodeId) {
                setSelected(shot.imageNode || shot.pipeline.imageNodeId);
                activateWorkflowStage("canvas");
              } else shotNodes(shot, index);
            }}
            onPreview={setPreview}
            onOpenVideo={() => activateWorkflowStage("video")}
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
        ) : workflowStage === "video" ? (
          <VideoProductionWorkspace
            projectId={project.id}
            onPrepareAdvice={async()=>{await save();if(dirty.current)throw new Error("请先保存当前项目后重试");}}
            onAdviceJob={job=>{setJobs(known=>mergeTaskSnapshots(known,[job]) as Job[]);setProductionJobs(known=>mergeTaskSnapshots(known,[job]));}}
            document={doc}
            assets={assets}
            jobs={jobs}
            providers={projectProviders(doc.modelPool || undefined, config.providers, "video", system.models)}
            busy={busy}
            request={api}
            onPatchShot={(uid, patch) =>
              update((document) => updateStoryboardShot(document, uid, patch))
            }
            onPatchVideoNode={(nodeId, patch) =>
              update((document) => patchNode(document, nodeId, patch))
            }
            onGenerate={generateShotVideos}
            onOpenCanvas={(nodeId) => {
              setSelected(nodeId);
              activateWorkflowStage("canvas");
            }}
            onOpenEditor={() => activateWorkflowStage("editor")}
            onPreview={setPreview}
            onUploadMotion={uploadMotionReference}
            onCompileVideo={previewVideoSubmission}
          />
        ) : view === "editor" ? (
          <Suspense fallback={<div className="loading">加载剪辑工作区…</div>}>
            <EditorWorkspace
              projectId={project.id}
              episodes={currentEpisodes}
              productionName={currentProduction?.name || project.name}
              episodeLabel={episodeLabel(project)}
              editor={doc.editor}
              assets={assets}
              ratio={doc.ratio}
              duration={doc.duration}
              shots={doc.shots}
              nodes={doc.nodes}
              audioId={(doc as any).audio_id}
              musicVolume={(doc as any).music_volume ?? 0.3}
              onChange={(editor) =>
                update((currentDoc) => ({ ...currentDoc, editor }))
              }
              onExport={(timeline) => {
                setEditorExportTimeline(timeline);
                setExportSource("editor");
                setPanel("export");
              }}
            />
          </Suspense>
        ) : view === "canvas" ? (
          <div className="canvas" ref={canvasRef} tabIndex={0} aria-label="工作流画布" onKeyDown={event => {
            const target = event.target as HTMLElement;
            if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
            if (event.key === "Escape") { setEdgeMenu(null); setSelectedEdge(null); }
            if (selectedEdge && !event.ctrlKey && !event.metaKey && !event.altKey && ["Delete", "Backspace"].includes(event.key)) {
              event.preventDefault(); event.stopPropagation(); deleteCanvasEdge(selectedEdge);
            }
          }}>
            <VisualBibleGraphProvider visual={visualBibleOf(doc)} assets={assets}>
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              nodeTypes={nodeTypes}
              onEdgeClick={(_, edge) => {
                setSelected(null); setSelectedEdge(edge.id); setEdgeMenu(null);
                canvasRef.current?.focus({ preventScroll: true });
              }}
              onEdgeContextMenu={(event, edge) => {
                event.preventDefault();
                setSelected(null); setSelectedEdge(edge.id);
                setEdgeMenu({ id: edge.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 268)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
                canvasRef.current?.focus({ preventScroll: true });
              }}
              onMoveStart={() => setEdgeMenu(null)}
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
                  (c) =>
                    c.type !== "select" &&
                    c.type !== "dimensions" &&
                    !(
                      c.type === "remove" &&
                      doc.nodes.some(
                        (item) =>
                          item.id === c.id && isManagedVisualNode(item as Any),
                      )
                    ),
                );
                if (filtered.length)
                  update((d) => ({
                    ...d,
                    nodes: applyNodeChanges(filtered, d.nodes),
                  }));
              }}
              onEdgesChange={(changes: EdgeChange[]) => {
                if (changes.every((c) => c.type === "select")) return;
                const { allowed, blocked } = filterManagedEdgeRemovals(
                  changes,
                  doc.edges as Any[],
                );
                if (blocked.length)
                  setNotice(
                    "视觉绑定连线由资产关系管理；请在视觉圣经中解除绑定",
                  );
                if (!allowed.length) return;
                update((d) =>
                  invalidate(
                    { ...d, edges: applyEdgeChanges(allowed, d.edges) },
                    d.edges
                      .filter((e) =>
                        allowed.some(
                          (c) => c.type === "remove" && c.id === e.id,
                        ),
                      )
                      .map((e) => e.target),
                  ),
                );
              }}
              onConnect={(connection: Connection) => {
                if (connection.source === connection.target) return;
                const source = doc.nodes.find(
                  (item) => item.id === connection.source,
                );
                const target = doc.nodes.find(
                  (item) => item.id === connection.target,
                );
                if(source?.data.compositionType || target?.data.compositionType){
                  setNotice("构图辅助通过编辑器选择输入并保存输出，请从构图参考图节点连线");return;
                }
                if(source?.data.referencePurpose === "composition" && target?.data.kind !== "image"){
                  setNotice("构图参考请连接到图像或分镜图节点，再由分镜图生成视频");return;
                }
                if (source && isManagedVisualNode(source as Any)) {
                  const versionId = visualVersionIdFromNode(source as Any);
                  const shot = doc.shots.find(
                    (item) =>
                      item.imageNode === target?.id ||
                      item.pipeline?.imageNodeId === target?.id,
                  );
                  if (!shot || target?.data.kind !== "image") {
                    report(new Error("视觉版本只能连接到分镜图节点"));
                    return;
                  }
                  try {
                    const next = bindVisualVersion(
                      doc,
                      String(shot.uid || shot.id),
                      versionId,
                    );
                    update(() => next);
                    setNotice("已建立视觉绑定，受管连线已同步");
                  } catch (reason) {
                    report(reason);
                  }
                  return;
                }
                if (target && isManagedVisualNode(target as Any)) {
                  report(
                    new Error(
                      "视觉版本节点只接受从自身连向分镜图的绑定操作",
                    ),
                  );
                  return;
                }
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
                setSelectedEdge(null); setEdgeMenu(null);
                if (isManagedVisualNode(n as Any)) {
                  setSelected(n.id);
                  setVisualFocus(visualVersionIdFromNode(n as Any));
                  setPanel("filmBible");
                  return;
                }
                setSelected(n.id);
                setPanel(null);
              }}
              onNodeMouseEnter={(_, n) => setHoveredNode(n.id)}
              onNodeMouseLeave={() => setHoveredNode(null)}
              onNodeDragStop={(_, n) => {
                requestAnimationFrame(() => updateNodeInternals(n.id));
              }}
              onPaneClick={() => { setSelected(null); setSelectedEdge(null); setEdgeMenu(null); }}
              fitView
              minZoom={0.2}
              maxZoom={1.8}
              defaultEdgeOptions={{
                style: { stroke: "#8f7550", strokeWidth: 1.5 },
                type: "default",
                animated: true,
              }}
              deleteKeyCode={null}
            >
              <Background color="#343739" gap={22} size={1} />
              <Controls showInteractive={false} />
              <MiniMap nodeColor="#5b5545" maskColor="rgba(10,12,13,.6)" />
            </ReactFlow>
            </VisualBibleGraphProvider>
            {edgeMenu && <div className="canvas-edge-menu" role="menu" aria-label="连线操作" style={{ left: edgeMenu.x, top: edgeMenu.y }}>
              {isManagedVisualEdge(doc.edges.find(edge => edge.id === edgeMenu.id) || {})
                ? <span>资产关系连线，请到塑角造景解除绑定或调整状态关系</span>
                : <button role="menuitem" onClick={() => deleteCanvasEdge(edgeMenu.id)}><Trash2 size={15}/>删除连线<kbd>Delete</kbd></button>}
            </div>}
            {selectedEdge && !edgeMenu && <div className="canvas-edge-selection-hint">已选中连线 · Delete / Backspace 删除 · 右键查看操作</div>}
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
        ) : null}
        {view !== "editor" && timelineOpen && (
          <section className="timeline">
            <div className="timeline-header">
              <button
                disabled={!doc.timeline.length}
                onClick={() => setPreviewTimeline(true)}
              >
                <Play size={14} />
                连续预览
                <small>
                  {doc.timeline.reduce((sum, t) => sum + Number(t.duration), 0).toFixed(1)} 秒
                </small>
              </button>
              <span />
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
                className="primary compact"
                disabled={!doc.timeline.length}
                onClick={() => {
                  setEditorExportTimeline(undefined);
                  setExportSource("legacy");
                  setPanel("export");
                }}
              >
                <Download size={14} />
                导出样片
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
      {selected && node && !panel && data.compositionType && <CompositionInspector node={node} assets={assets} sourceAssetId={panoramaSource(doc,node)} onPatch={patch=>patchComposition(node.id,patch)} onEdit={()=>setCompositionEditor(node.id)} onGenerate={()=>createPanoramaSource(node)} onDuplicate={()=>newNode("reference","",{...compositionData(data.compositionType),composition:structuredClone(data.composition)})} onDelete={removeNode}/>}
      {selected && node && !panel && data.referencePurpose === "composition" && <aside className="inspector"><div className="inspector-title"><b>构图参考图</b><button aria-label="关闭属性" onClick={()=>setSelected(null)}><X size={17}/></button></div><div className="inspector-scroll"><p>{data.label}</p>{assets.find(a=>a.id===data.assetId) && <button className="composition-preview" onClick={()=>setPreview(assets.find(a=>a.id===data.assetId)!)}><img src={assets.find(a=>a.id===data.assetId)!.url} alt={data.label}/></button>}<p className="muted">提供站位、空间布局和机位参考，人物外观与服装仍由视觉资产决定。将本节点连到分镜图即可使用。</p>{data.stale && <p className="error">构图已改变，请重新编辑并保存。</p>}{doc.nodes.some(n=>n.id===data.compositionOwner) && <button onClick={()=>setCompositionEditor(data.compositionOwner)}>编辑来源构图</button>}<button onClick={()=>newNode("image","依据构图参考生成正式画面，请补充角色和场景描述。",{},node.id)}>新建图像生成节点</button></div><div className="inspector-bottom"><button title="移除参考图节点" onClick={removeNode}><Trash2 size={16}/></button></div></aside>}
      {selected && node && !panel && !data.compositionType && data.referencePurpose !== "composition" && !isManagedVisualNode(node as Any) && (
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
            {data.imagePurpose === "panorama" && <p className="muted">这是 2:1 全景原图。生成后，请回到“全景场景”节点选择方向并保存普通构图参考图。</p>}
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
            {data.kind === "image" ? <ImageGenerationSettings document={doc} data={data} providers={config.providers} projectId={project.id} request={api} onChange={changeModel}/> : <ModelSelector
              data={data}
              canvasVideoDuration={data.kind === "video" && !selectedVideoShot ? (doc.videoDuration ?? -1) : undefined}
              providers={config.providers}
              localModels={system.models}
              allowedTargets={effectiveProjectTargets(doc.modelPool || undefined, config.providers, data.kind === "storyboard" ? "text" : data.kind, system.models)}
              request={api}
              onChange={changeModel}
            />}
            {data.kind === "video" && selectedVideoShot && <MotionReferenceEditor shot={selectedVideoShot} document={doc} assets={assets} provider={config.providers.find((p:Any)=>p.id===data.provider)} node={node} busy={busy} onPatch={patch=>update(document=>updateStoryboardShot(document,shotIdentity(selectedVideoShot),patch))} onUpload={uploadMotionReference} onCompile={()=>previewVideoSubmission(node.id)}/>}
            {data.kind === "video" && selectedVideoMode === "multimodal" && <p className="muted">多模态参考：关联分镜图作为起始构图参考，角色、场景、道具按绑定追加，不是严格首帧。</p>}
            {data.kind === "video" && selectedVideoMode !== "multimodal" &&
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
                      选择素材会清除本节点的图像连线和尾帧，只保留这一张首帧；文字连线不受影响。生成时该图会发送到当前配置的视频服务。
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
            {data.kind === "video" && (selectedVideoMode === "first_last_frame" || selectedVideoMode === "legacy" || data.end_asset_id) &&
              config.providers.find((p: Any) => p.id === data.provider)
                ?.type && ["volcengine_ark", "runninghub"].includes(config.providers.find((p: Any) => p.id === data.provider)?.type) && (
                <label>
                  {selectedVideoMode === "multimodal" ? "结束构图参考（非硬尾帧）" : "尾帧（可选，首尾帧视频）"}
                  <select
                    value={data.end_asset_id || ""}
                    disabled={selectedVideoMode !== "multimodal" && sourceAssets(node.id).length !== 1}
                    onChange={(e) =>
                      editNode({ end_asset_id: e.target.value })
                    }
                  >
                    <option value="">不指定尾帧</option>
                    {assets
                      .filter((a) => a.kind === "image")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                  <small>
                    {selectedVideoMode === "multimodal" ? "作为结束构图的普通参考，不锁定最后一帧。" : "先保留一张首帧，再选择同宽高比的尾帧；模型会生成两帧之间的连续运动。"}
                  </small>
                </label>
              )}
            {data.kind === "video" &&
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
                  {data.kind === "video" && (selectedVideoMode === "first_last_frame" || selectedVideoMode === "legacy" || data.end_asset_id) && (
                    <label>
                      {selectedVideoMode === "multimodal" ? "结束构图参考（非硬尾帧）" : "尾帧（可选，仅适用模型）"}
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
                <summary>{data.kind === "text" ? "剧本正文" : "生成结果"}</summary>
                {data.kind === "text" && !data.canonicalScriptProjection ? (
                  <textarea
                    className="prompt-input canvas-script-editor"
                    value={data.text}
                    onChange={(event) => editNode({ text: event.target.value })}
                    aria-label="画布剧本正文"
                  />
                ) : (
                  <div className="generated-text">{data.text}</div>
                )}
                {data.kind === "text" && !data.canonicalScriptProjection && (
                  <button className="primary full" disabled={busy} onClick={() => void promoteCanvasScript(node).catch(report)}>
                    <FileText size={15} />采用为本集剧本
                  </button>
                )}
                {data.kind === "text" && data.canonicalScriptProjection && (
                  <>
                    <button className="secondary full" onClick={() => activateWorkflowStage("script")}>
                      <FileText size={15} />编辑正式剧本
                    </button>
                    {data.scriptStatus !== "stale" && String(data.text || "").trim() && (
                      <button className="secondary full" disabled={busy} onClick={() => generateStoryboardFromScript(node)}>
                        <Layers size={15} />生成分镜规划
                      </button>
                    )}
                  </>
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
                  加入连续预览
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
                !selectedRunInput.ready
              }
              title={selectedRunInput.reason || (selectedRunInput.scriptCount ? `使用连线中的 ${selectedRunInput.scriptCount} 份剧本正文` : "提交生成任务")}
              onClick={() => run()}
            >
              <Play size={16} />
              {data.resultJob ? "重新生成" : "开始生成"}
            </button>
          </div>
          {data.kind === "storyboard" && <small className="canvas-run-input-hint">{selectedRunInput.reason || (selectedRunInput.scriptCount ? `已连接 ${selectedRunInput.scriptCount} 份剧本，将使用上游正文生成分镜。` : "将按创作描述生成分镜。")}</small>}
        </aside>
      )}
      {panel==="assistant"&&<div className="assistant-scrim" onClick={()=>setPanel(null)}/> }
      {assistantUI}
      {panel && panel!=="assistant" && <div className="side-panel-scrim" onClick={() => setPanel(null)} aria-hidden="true" />}
      {panel && panel!=="assistant" && (
        <div
          className={
            "side-panel " +
            (["settings", "assets", "jobs", "characters", "filmBible", "projectInfo", "trash"].includes(
              panel,
            )
              ? panel === "filmBible"
                ? "film-bible-wide"
                : panel === "settings"
                  ? "settings-wide"
                  : "wide"
              : "")
          }
        >
          <div className="panel-title">
            <h2>
              {
                {
                  add: "添加节点",
                  projects: "项目库",
                  projectInfo: "项目设置",
                  assets: "资产中心",
                  jobs: "生成任务",
                  settings: "设置",
                  prompts: "提示词模板",
                  history: "历史版本",
                  characters: "角色与场景",
                  export: "导出成片",
                  run: "运行工作流",
                  filmBible: "视觉圣经",
                  trash: "回收站",
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
            {panel === "filmBible" && <FilmBiblePanel {...filmBiblePanelProps} />}
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
                <h3>构图辅助</h3>
                <button onClick={()=>newComposition("panorama")}><ImageIcon/><div><b>全景场景</b><span>选择或生成全景图，保存不同方向的构图</span></div><Plus size={17}/></button>
                <button onClick={()=>newComposition("director")}><Monitor/><div><b>3D 构图</b><span>摆放人物与物体，设计机位并保存参考图</span></div><Plus size={17}/></button>
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
              <ProductionLibrary
                productions={productions}
                episodes={projects}
                currentEpisodeId={project.id}
                onCreateProduction={openProjectSetup}
                onOpenProjectSettings={() => { setProjectSettingsTab("production"); setPanel("projectInfo"); }}
                onCreateEpisode={setEpisodeSetupProduction}
                onOpenEpisode={(episode) => openProject(episode.id).catch(report)}
                onDeleteProduction={(production)=>setTrashTarget({kind:"production",item:production})}
                onDeleteEpisode={(episode) => setTrashTarget({kind:"project",item:episode.id === project.id ? { ...episode, name: project.name } : episode})}
              />
            )}
            {panel === "trash" && (
              <>
                <p className="muted">这里只隐藏内容，不删除数据库记录和媒体文件。恢复后会回到原来的项目。</p>
                {!!trashItems.productions?.length && <h3>整部作品</h3>}
                {trashItems.productions?.map((item:Any)=><div className="trash-row" key={item.id}><Film size={17}/><div><b>{item.name}</b><small>{item.episode_count} 集 · {new Date(item.deleted_at*1000).toLocaleString()}</small></div><button onClick={()=>restoreTrashItem("production",item).catch(report)}><RefreshCw size={14}/>恢复整部作品</button></div>)}
                {!!trashItems.projects.length && <h3>制作集</h3>}
                {trashItems.projects.map((item: Any) => (
                  <div className="trash-row" key={`project-${item.id}`}>
                    <FolderOpen size={17} />
                    <div><b>{item.name}</b><small>{new Date(item.deleted_at * 1000).toLocaleString()}</small></div>
                    <button onClick={() => restoreTrashItem("project", item).catch(report)}><RefreshCw size={14} /> 恢复</button>
                  </div>
                ))}
                {!!trashItems.assets.length && <h3>素材</h3>}
                {trashItems.assets.map((item: Any) => (
                  <div className="trash-row" key={`asset-${item.id}`}>
                    <ImageIcon size={17} />
                    <div><b>{item.name}</b><small>{item.project_name} · {assetKinds[item.kind] || item.kind}</small></div>
                    <button onClick={() => restoreTrashItem("asset", item).catch(report)}><RefreshCw size={14} /> 恢复</button>
                  </div>
                ))}
                {!!trashItems.sources?.length && <h3>原著资料</h3>}
                {trashItems.sources?.map((item: Any) => (
                  <div className="trash-row" key={`source-${item.id}`}>
                    <BookOpen size={17} />
                    <div><b>{item.name}</b><small>{item.production_name} · {item.chapter_count} 章</small></div>
                    <button onClick={() => restoreTrashItem("source", item).catch(report)}><RefreshCw size={14} /> 恢复</button>
                  </div>
                ))}
                {!!trashItems.chapters?.length && <h3>原著章节</h3>}
                {trashItems.chapters?.map((item: Any) => (
                  <div className="trash-row" key={`chapter-${item.id}`}>
                    <BookOpen size={17} />
                    <div><b>{item.name}</b><small>{item.production_name} · {item.source_name}</small></div>
                    <button onClick={() => restoreTrashItem("chapter", item).catch(report)}><RefreshCw size={14} /> 恢复</button>
                  </div>
                ))}
                {!!doc.characters.filter((item) => item.deletedAt).length && <h3>当前项目角色 / 场景</h3>}
                {doc.characters.filter((item) => item.deletedAt).map((item) => (
                  <div className="trash-row" key={`character-${item.id}`}>
                    <FolderOpen size={17} />
                    <div><b>{item.name}</b><small>手工角色 / 场景设定</small></div>
                    <button onClick={() => {
                      update((d) => ({
                        ...d,
                        characters: d.characters.map((candidate) => {
                          if (candidate.id !== item.id) return candidate;
                          const restored = { ...candidate };
                          delete restored.deletedAt;
                          return restored;
                        }),
                      }));
                      setNotice(`角色/场景“${item.name}”已恢复`);
                    }}><RefreshCw size={14} /> 恢复</button>
                  </div>
                ))}
                {!!Object.values(visualBibleOf(doc).cards).filter((item) => item.deletedAt).length && <h3>当前项目视觉资产卡</h3>}
                {Object.values(visualBibleOf(doc).cards).filter((item) => item.deletedAt).map((item) => (
                  <div className="trash-row" key={`visual-${item.id}`}>
                    <BookOpen size={17} />
                    <div><b>{item.name}</b><small>{assetCategories[item.kind === "character_state" ? "character" : item.kind === "scene_state" ? "scene" : item.kind] || item.kind}</small></div>
                    <button onClick={() => {
                      update((currentDoc) => restoreVisualCard(currentDoc, item.id));
                      setNotice(`视觉资产卡“${item.name}”已恢复`);
                    }}><RefreshCw size={14} /> 恢复</button>
                  </div>
                ))}
                {!trashItems.productions?.length && !trashItems.projects.length && !trashItems.assets.length && !trashItems.sources?.length && !trashItems.chapters?.length && !doc.characters.some((item) => item.deletedAt) && !Object.values(visualBibleOf(doc).cards).some((item) => item.deletedAt) && (
                  <div className="empty-state"><Trash2 /><h3>回收站为空</h3><p>移入回收站的项目、素材、原著和角色场景会显示在这里。</p></div>
                )}
              </>
            )}
            {panel === "projectInfo" && (
              <>
                <div className="current-project-card">
                  <AnYingMark size={30} />
                  <div>
                    <small>{projectSettingsTab === "production" ? "整部作品" : "当前制作集"}</small>
                    <b>{currentProduction?.name || project.name} · {episodeLabel(project)}</b>
                  </div>
                </div>
                <div className="settings-tabs" role="tablist" aria-label="项目设置范围">
                  <button className={projectSettingsTab === "production" ? "active" : ""} onClick={() => setProjectSettingsTab("production")}>整部作品</button>
                  <button className={projectSettingsTab === "episode" ? "active" : ""} onClick={() => setProjectSettingsTab("episode")}>当前制作集</button>
                </div>
                {projectSettingsTab === "production" ? <>
                  <h3>整部作品设置</h3>
                  <label>作品名称<div className="inline-save-field"><input maxLength={100} value={productionNameDraft} onChange={(event)=>setProductionNameDraft(event.target.value)}/><button disabled={!productionNameDraft.trim() || productionNameDraft.trim() === currentProduction?.name} onClick={()=>renameProduction(productionNameDraft).catch(report)}>保存名称</button></div><small>修改作品名称不会改变任何 Episode 标题，也不会触发生成。</small></label>
                  <div className="visual-style-setting">
                    <VisualStylePicker value={visualStyleDraft} onChange={setVisualStyleDraft} label="高层视觉风格" hint="选择预设或直接输入自定义风格。应用后会统一进入资产、分镜图和视频的生成上下文。"/>
                    <button disabled={!visualStyleDraft.trim() || visualStyleDraft.trim() === doc.style} onClick={()=>{update((document)=>setProjectVisualStyle(document,visualStyleDraft.trim()));setNotice("视觉风格已应用；旧媒体保留，相关生成结果已标记为待更新");}}>应用风格</button>
                    <small>修改后会把已生成的分镜图和视频标记为待更新；旧媒体和剪辑内容会保留，不会自动生成。</small>
                  </div>
                  <GenerationPolicyPanel value={doc.generationPolicy} modelPool={doc.modelPool || undefined} providers={config.providers} localModels={system.models} onChange={(generationPolicy)=>update((document)=>({...document,generationPolicy}))} onModelPoolChange={(modelPool)=>update((document)=>({...document,modelPool}))}/>
                  <div className="project-bible-heading"><div><span className="eyebrow">PROJECT BIBLE</span><h3>创作约束</h3></div><button className="quiet" onClick={()=>setPanel("filmBible")}><BookOpen size={15}/>打开塑角造景 {Object.keys(visualBibleOf(doc).cards).length || ""}<ChevronRight size={14}/></button></div>
                  <p className="muted">这里只修改文字约束，不会覆盖已有 VisualCard、VisualVersion 或锁定参考图。</p>
                  <label>世界 / 时代<input value={projectBibleFields.worldEra} onChange={(event)=>update((document)=>mergeBibleFields(document,{...bibleFields(document),worldEra:event.target.value}))}/></label>
                  {projectBibleFields.summary && <label>导入的故事与人物共享设定<textarea rows={8} value={projectBibleFields.summary} onChange={event=>update(document=>mergeBibleFields(document,{...bibleFields(document),summary:event.target.value}))}/></label>}
                  <div className="two-fields">
                    <label>视觉基调<input value={projectBibleFields.visualTone} onChange={(event)=>update((document)=>mergeBibleFields(document,{...bibleFields(document),visualTone:event.target.value}))}/></label>
                    <label>色彩 / 光线<input value={projectBibleFields.colorLighting} onChange={(event)=>update((document)=>mergeBibleFields(document,{...bibleFields(document),colorLighting:event.target.value}))}/></label>
                  </div>
                  <label>镜头语言<input value={projectBibleFields.cameraLanguage} onChange={(event)=>update((document)=>mergeBibleFields(document,{...bibleFields(document),cameraLanguage:event.target.value}))}/></label>
                  <label>角色 / 场景一致性<textarea value={projectBibleFields.characterSceneConsistency} onChange={(event)=>update((document)=>mergeBibleFields(document,{...bibleFields(document),characterSceneConsistency:event.target.value}))}/></label>
                  <label>避免项（每行一项）<textarea value={projectBibleFields.avoidItems} onChange={(event)=>update((document)=>mergeBibleFields(document,{...bibleFields(document),avoidItems:event.target.value}))}/></label>
                </> : <>
                  <h3>当前制作集设置</h3>
                  <label>Episode 标题<input maxLength={100} value={project.name} onChange={(event)=>{setProject({...project,name:event.target.value,episode_title:event.target.value});dirty.current=true;setSaved("未保存");}}/><small>只修改当前 EP{String(project.episode_no).padStart(2,"0")}，不会改变整部作品名称。</small></label>
                  <label>创作简介<textarea value={doc.brief} onChange={(event)=>update((document)=>({...document,brief:event.target.value}))}/></label>
                  <div className="two-fields">
                    <label>资产画幅<span tabIndex={0} title="用于场景、道具参考图和分镜图；新生成角色设定板固定为 1:1" aria-label="资产画幅说明：用于场景、道具参考图和分镜图；新生成角色设定板固定为 1:1" style={{cursor:"help",fontSize:12,opacity:0.7}}> ⓘ</span><select value={doc.ratio} onChange={(event)=>{update((document)=>applyRatioChange(document,event.target.value));setNotice("资产画幅已修改；已有分镜图和视频保留并标记为待更新");}}><option>21:9</option><option>16:9</option><option>4:3</option><option>1:1</option><option>3:4</option><option>9:16</option></select></label>
                    <label>目标时长（秒）<input type="number" min="5" max="3000" value={doc.duration} onChange={(event)=>update((document)=>applyTargetDuration(document,Number(event.target.value)))}/><small>策划目标，不会裁剪已有镜头或成片。</small></label>
                    <label>默认对白方式<select value={doc.dialogueMode || 'full_dialogue'} onChange={event=>update(document=>applyVideoOutputSetting(document,{dialogueMode:event.target.value}))}><option value="voice_sample">音色样本参考（无需逐句合成）</option><option value="full_dialogue">完整对白参考（先合成对白）</option></select><small>镜头可覆盖。修改保留旧结果并标记需更新；不会自动重新生成。</small></label>
                    <label>默认视频生成模式<select value={doc.videoReferenceMode || 'legacy'} onChange={event=>update(document=>applyVideoOutputSetting(document,{videoReferenceMode:event.target.value}))}><option value="multimodal">多模态参考（默认）</option><option value="first_frame">严格首帧（高级）</option><option value="first_last_frame">严格首尾帧（高级）</option>{(!doc.videoReferenceMode || doc.videoReferenceMode === 'legacy') && <option value="legacy">兼容历史模式（保持原有行为）</option>}</select><small>影响继承项目设置的镜头。模式修改后旧视频保留并标记需更新，历史任务不变。</small></label>
                    <label>视频分辨率<select value={doc.videoResolution || "720p"} onChange={(event)=>{update((document)=>applyVideoResolution(document,event.target.value));setNotice("视频分辨率已修改；已有视频保留并标记为待更新");}}>{VIDEO_RESOLUTIONS.map((value)=><option key={value} value={value}>{value.toUpperCase()}</option>)}</select><small>所有新视频任务继承该设置。</small></label>
                    <label>视频宽高比<select value={doc.videoRatio || doc.ratio || "16:9"} onChange={(event)=>update((document)=>applyVideoOutputSetting(document,{videoRatio:event.target.value}))}>{VIDEO_RATIOS.map((value)=><option key={value}>{value}</option>)}</select><small>{["first_frame","first_last_frame"].includes(doc.videoReferenceMode || "") ? "首帧／首尾帧模式下，视频比例跟随首帧图片。" : "视频的目标宽高比；adaptive 由模型决定。"}</small></label>
                    <label>视频输出时长<select value={doc.videoDuration ?? -1} onChange={(event)=>update((document)=>applyVideoOutputSetting(document,{videoDuration:Number(event.target.value)}))}><option value={-1}>-1（按分镜和对白自动）</option>{Array.from({length:27},(_,index)=>index+4).map((value)=><option key={value} value={value}>{value} 秒</option>)}</select><small>默认使用分镜时长；完整对白过长时延长，音色样本长度不影响时长。</small></label>
                    <label>视频格式<select value={doc.videoFormat || "mp4"} onChange={(event)=>update((document)=>applyVideoOutputSetting(document,{videoFormat:event.target.value}))}>{VIDEO_FORMATS.map((value)=><option key={value}>{value}</option>)}</select><small>用于输出与导出。</small></label>
                  </div>
                  <div className="duration-impact"><span>目标 {doc.duration} 秒</span><span>镜头合计 {doc.shots.reduce((sum,shot)=>sum+Number(shot.duration||0),0).toFixed(1)} 秒</span><span>剪辑 {Math.max(0,...(doc.editor?.timeline?.tracks||[]).flatMap((track)=>track.elements.map((element)=>Number(element.e)||0))).toFixed(1)} 秒</span></div>
                </>}
                <button
                  className="full danger-button"
                  onClick={() => setTrashTarget({kind:"project",item:project})}
                >
                  <Trash2 size={16} />
                  将当前集移入回收站
                </button>
              </>
            )}
            {panel === "assets" && (
              <ProductionAssetCenter
                document={doc}
                assets={assets}
                projects={currentEpisodes}
                currentProjectId={project.id}
                usage={visualUsage}
                uploadCategory={uploadCategory}
                onUploadCategory={setUploadCategory}
                onUpload={() => fileInput.current?.click()}
                onOpenArt={(versionId) => {
                  setVisualFocus(versionId);
                  activateWorkflowStage("art");
                }}
                onPreview={(asset) => setPreview(asset as Asset)}
                renderMedia={(asset) => <Media asset={asset as Asset} controls={false} retryKey={mediaRetryKey} onFailure={reportMediaFailure} onReady={clearMediaFailure} />}
                onCategory={(asset, category) => void changeAssetCategory(asset as Asset, category)}
                onDelete={(asset) => void deleteAsset(asset as Asset)}
                onTimeline={(asset) => addTimeline(asset as Asset)}
                onPanorama={(asset) => setPanorama(asset as Asset)}
                onReference={selected ? (asset) => {
                  editNode({ asset_ids: [...new Set([...(data.asset_ids || []), asset.id])] });
                  setPanel(null);
                } : undefined}
              />
            )}
            {panel === "jobs" && (
              <TaskCenter
                productionName={currentProduction?.name || project.name}
                episodes={currentEpisodes}
                currentProjectId={project.id}
                currentDocument={doc}
                currentJobs={jobs}
                jobStatuses={productionJobs}
                providers={config.providers}
                request={api}
                onRefreshCurrent={() => refresh(project.id)}
                onOpenNode={async (projectId, nodeId) => {
                  if (projectId !== project.id) await openProject(projectId);
                  setSelected(nodeId);
                  activateWorkflowStage("canvas");
                }}
                onAdoptShots={(job) => adoptShots(job as Job)}
              />
            )}
            {panel === "export" && (
              <>
                <div className="export-summary">
                  <Film size={30} />
                  <h3>{project.name}</h3>
                  <strong>{exportSource === "editor" ? "高级剪辑" : "时间线预览"}</strong>
                  <p>
                    {exportSource === "editor"
                      ? `${exportEditorTracks.length} 条编辑轨 · ${Math.max(0, ...exportEditorTracks.flatMap((track) => track.elements.map((element) => Number(element.e) || 0))).toFixed(2)} 秒`
                      : `${doc.timeline.length} 个镜头 · ${doc.timeline.reduce((sum, t) => sum + Number(t.duration), 0).toFixed(2)} 秒`}
                  </p>
                </div>
                <label>
                  导出分辨率
                  <select
                    value={defaultExportResolution(doc)}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        export_resolution: e.target.value,
                      }))
                    }
                  >
                    {exportResolutionOptions(doc).map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  转场
                  <select
                    disabled={exportSource === "editor"}
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
                    disabled={exportSource === "editor"}
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
                    disabled={exportSource === "editor"}
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
                    disabled={exportSource === "editor"}
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
                  {exportSource === "editor"
                    ? exportEditorTimeline?.metadata?.custom?.selectedClipName
                      ? `仅导出选中片段：${exportEditorTimeline.metadata.custom.selectedClipName}。保留裁剪、速度和音量，不包含其他轨道或跨片段转场。完成后可在任务结果中下载。`
                      : "当前导出 Twick 多轨工程。配乐、字幕、转场和音量请在剪辑工作区中调整。输出为 24fps H.264/AAC MP4。"
                    : "MP4 / H.264 / 24fps。保留镜头原声，配乐循环填充时间线。高于源素材分辨率时会由 FFmpeg 缩放插值并适配画布，输出像素会增加，但不会恢复真实细节。"}
                </p>
                <button
                  className="primary full"
                  disabled={exportSource === "editor"
                    ? !exportEditorTracks.some((track) => track.elements.length)
                    : !doc.timeline.length}
                  onClick={() => void exportFilm(exportSource, editorExportTimeline)}
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
                {doc.characters.filter((c) => !c.deletedAt).map((c) => (
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
                    <button
                      className="quiet danger"
                      onClick={() => {
                        if (!window.confirm(`将角色/场景“${c.name}”移入回收站？`)) return;
                        update((d) => ({
                          ...d,
                          characters: d.characters.map((item) =>
                            item.id === c.id
                              ? { ...item, deletedAt: Date.now() / 1000 }
                              : item,
                          ),
                        }));
                        setNotice(`角色/场景“${c.name}”已移入回收站`);
                      }}
                    >
                      <Trash2 size={14} /> 移至回收站
                    </button>
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
          uploadFiles(e.target.files, uploadCategory);
          e.target.value = "";
        }}
      />
      {trashTarget && <TrashConfirmDialog key={`${trashTarget.kind}:${trashTarget.item.id}`} name={trashTarget.item.name} whole={trashTarget.kind==="production"} onClose={()=>setTrashTarget(null)} onConfirm={()=>trashTarget.kind==="production"?deleteProduction(trashTarget.item):deleteProject(trashTarget.item)}/> }
      {importCompletion && (
        <aside className="background-task-complete" role="alertdialog" aria-labelledby="import-completion-title">
          <FileText size={21}/>
          <div>
            <strong id="import-completion-title">{importCompletion.title}</strong>
            <span>{importCompletion.body}</span>
            <div>
              <button className="primary" onClick={()=>revealImportResult(importCompletion)}>查看结果</button>
              <button onClick={()=>setImportCompletion(null)}>稍后处理</button>
            </div>
          </div>
          <button className="icon-button" aria-label="关闭完成提醒" onClick={()=>setImportCompletion(null)}><X size={16}/></button>
        </aside>
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
      {compositionEditor && (()=>{
        const owner=doc.nodes.find(n=>n.id===compositionEditor);
        if(!owner)return null;
        const config=(owner.data.composition || {}) as Any;
        if(owner.data.compositionType==="panorama"){
          const source=assets.find(a=>a.id===panoramaSource(doc,owner));
          return source ? <PanoramaViewer key={owner.id+source.id} asset={source} projectRatio={doc.ratio} initialView={config} onViewChange={view=>patchComposition(owner.id,{composition:{...config,...view}})} onClose={()=>setCompositionEditor(null)} onSave={blob=>saveComposition(owner.id,blob)}/> : <div className="modal-overlay"><div className="episode-setup-dialog"><p>请先选择或生成一张全景原图。</p><button onClick={()=>setCompositionEditor(null)}>关闭</button></div></div>;
        }
        return <div className="modal-overlay"><div className="composition-editor-modal" role="dialog" aria-modal="true" aria-label="3D 构图编辑器"><header className="panel-title"><h2>{owner.data.label as string}</h2><label>输出画幅<select value={config.ratio || ""} onChange={e=>patchComposition(owner.id,{composition:{...config,ratio:e.target.value}})}><option value="">跟随项目 · {doc.ratio}</option>{["21:9","16:9","4:3","1:1","3:4","9:16"].map(r=><option key={r}>{r}</option>)}</select></label><button className="icon-button" aria-label="关闭构图" onClick={()=>setCompositionEditor(null)}><X/></button></header><Suspense fallback={<div>加载构图工具…</div>}><DirectorStage key={owner.id} stage={config.stage || defaultStage()} ratio={config.ratio || doc.ratio} onChange={stage=>patchComposition(owner.id,{composition:{...config,stage}})} newId={id} onCapture={async blob=>{await saveComposition(owner.id,blob);setCompositionEditor(null);}}/></Suspense></div></div>;
      })()}
      {panorama && (
        <PanoramaViewer
          projectRatio={doc.ratio}
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
    [busy, setBusy] = useState(false),
    [settingsTab, setSettingsTab] = useState<"providers" | "runtime">("providers"),
    [openProviderId, setOpenProviderId] = useState<string>(config.providers?.[0]?.id || ""),
    [arkCatalogs, setArkCatalogs] = useState<Record<string, Any[]>>({}),
    [arkVerified, setArkVerified] = useState<Record<string, boolean>>({}),
    [arkChecks, setArkChecks] = useState<Record<string, Record<string, Any>>>({});
  const cloudProviders = (value.providers || []).filter((provider: Any) => !provider.local);
  const activeProviderId = cloudProviders.some((provider: Any) => provider.id === openProviderId)
    ? openProviderId
    : cloudProviders[0]?.id || "";
  function patchProvider(index: number, patch: Any) {
    const current = value.providers[index];
    const changedKind = patch.changed_model_kind;
    if (changedKind) {
      const { changed_model_kind: _changedModelKind, ...cleanPatch } = patch;
      patch = cleanPatch;
      setArkChecks((checks) => ({
        ...checks,
        [current.id]: { ...checks[current.id], [changedKind]: undefined },
      }));
    }
    if (["volcengine_ark", "volcengine_speech", "hc_atom", "runninghub"].includes(current?.type) && ("api_key" in patch || "url" in patch)) {
      setArkVerified((verified) => ({ ...verified, [current.id]: false }));
      setArkCatalogs((catalogs) => ({ ...catalogs, [current.id]: [] }));
      setArkChecks((checks) => ({ ...checks, [current.id]: {} }));
    }
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
  async function verifyArk(providerId: string) {
    setBusy(true);
    try {
      await onSave(value);
      clearEnteredApiKeys();
      const result = await api(`/providers/${encodeURIComponent(providerId)}/verify`, send("POST"));
      setArkCatalogs((catalogs) => ({ ...catalogs, [providerId]: result.models || [] }));
      setArkVerified((verified) => ({ ...verified, [providerId]: true }));
      setArkChecks((checks) => ({ ...checks, [providerId]: {} }));
      setStatus(result.message || "ARK API Key 可用");
    } catch (e: any) {
      setArkVerified((verified) => ({ ...verified, [providerId]: false }));
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function testArkModel(providerId: string, kind: "text" | "image" | "video") {
    setBusy(true);
    try {
      await onSave(value);
      clearEnteredApiKeys();
      const result = await api(
        `/providers/${encodeURIComponent(providerId)}/test?kind=${encodeURIComponent(kind)}`,
        send("POST"),
      );
      setArkChecks((checks) => ({
        ...checks,
        [providerId]: { ...checks[providerId], [kind]: result },
      }));
      setStatus(result.message);
    } catch (e: any) {
      setArkChecks((checks) => ({
        ...checks,
        [providerId]: {
          ...checks[providerId],
          [kind]: { status: "failed", message: e.message || "模型检测失败" },
        },
      }));
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-tabs settings-tabs-wide">
        <button className={settingsTab === "providers" ? "active" : ""} onClick={() => setSettingsTab("providers")}>供应商与模型库</button>
        <button className={settingsTab === "runtime" ? "active" : ""} onClick={() => setSettingsTab("runtime")}>本地运行设置</button>
      </div>
      {settingsTab === "runtime" && <section className="settings-section">
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
      <div className="local-provider-heading">
        <div><h3>本地模型服务</h3><p className="muted">管理本机或局域网内的文本、图像和视频推理端点。</p></div>
        <div className="local-provider-actions">
          {!value.providers.some((provider: Any) => provider.type === "maestro") && <button onClick={() => setValue({
            ...value,
            providers: [...value.providers, { id: id(), name: "Maestro 图像", type: "maestro", url: "http://127.0.0.1:7860", local: true, kind: "image", model: "" }],
          })}>连接 Maestro</button>}
          <button onClick={() => setValue({
            ...value,
            providers: [...value.providers, { id: id(), name: "本地模型服务", type: "openai", url: "http://127.0.0.1:8080/v1", local: true, kind: "text", model: "" }],
          })}><Plus size={14}/>添加本地服务</button>
        </div>
      </div>
      <div className="local-provider-list">
        {value.providers.map((provider: Any, index: number) => provider.local ? (
          <article key={provider.id} className="local-provider-card">
            <div className="field-heading">
              <input aria-label="本地服务名称" value={provider.name} onChange={(event) => patchProvider(index, { name: event.target.value })}/>
              <button className="icon-button" title="移除本地服务" onClick={() => setValue({ ...value, providers: value.providers.filter((_: Any, itemIndex: number) => itemIndex !== index) })}><X size={15}/></button>
            </div>
            <div className="two-fields">
              <label>接口类型<select value={provider.type} onChange={(event) => patchProvider(index, { type: event.target.value })}><option value="openai">OpenAI 兼容</option><option value="maestro">Maestro / WanGP</option><option value="comfy">ComfyUI</option><option value="video_api">异步视频网关</option></select></label>
              <label>用途<select value={provider.kind || "text"} onChange={(event) => patchProvider(index, { kind: event.target.value })}><option value="text">文本</option><option value="image">图像</option><option value="video">视频</option></select></label>
            </div>
            <label>服务地址<input value={provider.url || ""} onChange={(event) => patchProvider(index, { url: event.target.value })}/></label>
            <label>默认模型 ID<input value={provider.model || ""} onChange={(event) => patchProvider(index, { model: event.target.value })}/></label>
            {provider.type === "comfy" && <label>API 工作流 JSON<textarea className="code-input compact" defaultValue={JSON.stringify(provider.workflow || {}, null, 2)} onBlur={(event) => { try { patchProvider(index, { workflow: JSON.parse(event.target.value) }); } catch { onError(new Error("工作流 JSON 格式不正确")); } }}/></label>}
          </article>
        ) : null)}
        {!value.providers.some((provider: Any) => provider.local) && <p className="muted local-provider-empty">尚未配置本地模型服务；云端模型仍可正常使用。</p>}
      </div>
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
      </section>}
      {settingsTab === "providers" && <section className="settings-section">
      <h3>模型服务</h3>
      <p className="muted">从左侧选择云端供应商，在右侧分别维护连接凭证和项目可用模型。本地端点已移到“本地运行设置”。</p>
      <div className="provider-workbench">
        <nav className="provider-master-list" aria-label="云端供应商">
          {cloudProviders.map((provider: Any) => <button key={provider.id} className={activeProviderId === provider.id ? "active" : ""} onClick={() => setOpenProviderId(provider.id)}>
            <span><b>{provider.name || "未命名供应商"}</b><small>{provider.type}</small></span>
            <em>{Object.values(provider.enabled_models || {}).flat().length || (provider.model || Object.values(provider.models || {}).filter(Boolean).length) ? "已配置" : "待配置"}</em>
          </button>)}
          {!cloudProviders.length && <p>还没有云端供应商</p>}
        </nav>
        <div className="provider-detail-pane">
      {value.providers.map((p: Any, i: number) => !p.local && p.id === activeProviderId ? (
        <div className="provider-card provider-detail" key={p.id}>
          <header className="provider-summary">
            <span><b>{p.name || "未命名供应商"}</b><small>{p.type} · {p.local ? "本地" : "云端"}</small></span>
            <em>{Object.values(p.enabled_models || {}).flat().length || (p.model || Object.values(p.models || {}).filter(Boolean).length) ? "已配置" : "待配置"}</em>
          </header>
          <section className="provider-config-block provider-connection-card">
          <h4>连接与用途</h4>
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
                    ["volcengine_ark", "hc_atom", "runninghub"].includes(e.target.value)
                      ? {
                          type: e.target.value,
                          kind: undefined,
                          local: false,
                          url: e.target.value === "hc_atom" ? "https://api-aigc.fzyinghe.com" : e.target.value === "runninghub" ? "https://www.runninghub.ai" : "https://ark.cn-beijing.volces.com/api/v3",
                          models: p.models || { text: "", image: "", video: "" },
                          enabled_models: p.enabled_models || {},
                        }
                      : e.target.value === "volcengine_speech"
                        ? {
                            type: e.target.value,
                            kind: "audio",
                            local: false,
                            url: "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse",
                            model: p.model || "zh_female_vv_uranus_bigtts",
                            resource_id: p.resource_id || "seed-tts-2.0",
                            enabled_models: p.enabled_models || { audio: [p.resource_id || "seed-tts-2.0"] },
                          }
                      : ["volcengine_ark", "hc_atom", "runninghub"].includes(p.type)
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
                <option value="hc_atom">幻场 AI / HC-ATOM（文本 / 图像 / 视频）</option>
                <option value="runninghub">RunningHub（文本 / 图像 / 视频）</option>
                <option value="volcengine_speech">豆包语音（角色固定音色）</option>
              </select>
            </label>
            {["volcengine_ark", "hc_atom", "runninghub"].includes(p.type) ? (
              <label>用途<input value="统一：文本、图像、视频" readOnly /></label>
            ) : p.type === "volcengine_speech" ? (
              <label>用途<input value="角色对白与旁白" readOnly /></label>
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
          </section>
          <section className="provider-config-block provider-model-card">
          <h4>可用模型与高级参数</h4>
          {!["volcengine_ark", "hc_atom", "runninghub"].includes(p.type) && (
            <label>
              {p.type === "volcengine_speech" ? "默认音色 ID" : "默认模型 ID"}
              {p.type === "volcengine_speech" ? <>
                <select value={catalogVoice(p.model || "")?.id || CUSTOM_VOICE_ID} onChange={(e)=>patchProvider(i,{model:e.target.value === CUSTOM_VOICE_ID ? "" : e.target.value})}>
                  {[...new Set(DOUBAO_TTS2_VOICES.map((item)=>item.category))].map((category)=><optgroup key={category} label={category}>{DOUBAO_TTS2_VOICES.filter((item)=>item.category===category).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}
                  <option value={CUSTOM_VOICE_ID}>自定义 / 声音复刻 ID…</option>
                </select>
                {!catalogVoice(p.model || "") && <input value={p.model || ""} placeholder="粘贴自定义 Speaker ID" onChange={(e)=>patchProvider(i,{model:e.target.value})}/>}
              </> : <input value={p.model || ""} onChange={(e) => patchProvider(i, { model: e.target.value })}/>}
            </label>
          )}
          {["volcengine_ark", "hc_atom", "runninghub"].includes(p.type) ? (
            <>
              {p.type === "hc_atom" && <label>
                安影公网访问地址
                <input
                  value={p.public_base_url || ""}
                  onChange={(e) => patchProvider(i, { public_base_url: e.target.value })}
                  placeholder="https://vc.goroc.com"
                />
                <small>幻场 Seedance V3 用它读取带签名的首帧素材；应填写可从公网访问本工作室的 HTTPS 地址。</small>
              </label>}
              <ArkProviderSettings
                provider={p}
                catalog={arkCatalogs[p.id] || []}
                verified={!!arkVerified[p.id]}
                checks={arkChecks[p.id] || {}}
                busy={busy}
                onPatch={(patch) => patchProvider(i, patch)}
                onVerify={() => void verifyArk(p.id)}
                onTest={(kind) => void testArkModel(p.id, kind)}
                serviceName={p.type === "hc_atom" ? "幻场 AI" : p.type === "runninghub" ? "RunningHub" : "火山方舟"}
              />
              <p className="muted">{p.type === "hc_atom" ? "一个幻场 AI Key 统一调用文本、图片和异步视频模型；Seedance 首帧会自动登记到同一账号的虚拟人像素材库，审核通过后再提交视频任务。" : p.type === "runninghub" ? "一个 RunningHub Enterprise-Shared Key 统一调用文本、Seedream 5 Pro 图片与 Seedance 2.5 视频；本地参考素材会先安全上传。" : "一个 ARK API Key 统一调用豆包文本、Seedream 图片与 Seedance 视频。"}</p>
            </>
          ) : p.type === "volcengine_speech" ? (
            <>
              <label>
                Resource ID
                <input value={p.resource_id || "seed-tts-2.0"} onChange={(e) => patchProvider(i, { resource_id: e.target.value, enabled_models: { ...p.enabled_models, audio: e.target.value.trim() ? [e.target.value.trim()] : [] } })}/>
                <small>常用值为 seed-tts-2.0；必须与已开通的豆包语音实例和音色匹配。</small>
              </label>
              <div className="two-fields">
                <label>输出格式<select value={p.parameters?.format || "mp3"} onChange={(e)=>patchProvider(i,{parameters:{...p.parameters,format:e.target.value}})}><option value="mp3">MP3</option><option value="ogg_opus">OGG Opus</option></select></label>
                <label>采样率<select value={p.parameters?.sample_rate || 24000} onChange={(e)=>patchProvider(i,{parameters:{...p.parameters,sample_rate:Number(e.target.value)}})}><option value={24000}>24 kHz</option><option value={48000}>48 kHz</option></select></label>
              </div>
              <button className="secondary full" disabled={busy} onClick={()=>void verifyArk(p.id)}><Check size={14}/>检查语音配置</button>
              <p className="muted">Speech API Key 与 ARK API Key 是两套凭证。配置检查不生成音频；角色卡中的试听会调用语音服务。</p>
            </>
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
          </section>
        </div>
      ) : null)}
        </div>
      </div>
      <div className="settings-actions">
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "自定义云服务",
                  type: "openai",
                  url: "https://api.openai.com/v1",
                  local: false,
                  kind: "text",
                  model: "",
                },
              ],
            })
          }
        >
          <Plus size={15} />
          添加自定义云服务
        </button>
        {!value.providers.some((provider: Any) => provider.type === "replicate") && (
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
        )}
        {!value.providers.some((provider: Any) => provider.type === "volcengine_ark") && (
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
                    image: "doubao-seedream-5-0-pro-260628",
                    video: "doubao-seedance-2-5-260628",
                  },
                  enabled_models: {
                    text: ["doubao-seed-2-1-pro-260628"],
                    image: ["doubao-seedream-5-0-pro-260628"],
                    video: ["doubao-seedance-2-5-260628", "doubao-seedance-2-0-260128"],
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
        )}
        {!value.providers.some((provider: Any) => provider.type === "hc_atom") && (
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "幻场 AI",
                  type: "hc_atom",
                  url: "https://api-aigc.fzyinghe.com",
                  local: false,
                  models: { text: "", image: "", video: "doubao-seedance-2.5" },
                  enabled_models: { text: [], image: [], video: ["doubao-seedance-2.5", "doubao-seedance-2.0", "wan3.0-video", "MiniMax-H3"] },
                  parameters: {
                    image: { size: "1024x1024", n: 1 },
                    video: { duration: 5, ratio: "16:9" },
                  },
                },
              ],
            })
          }
        >
          添加幻场 AI
        </button>
        )}
        {!value.providers.some((provider: Any) => provider.type === "runninghub") && (
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "RunningHub",
                  type: "runninghub",
                  url: "https://www.runninghub.ai",
                  local: false,
                  models: {
                    text: "bytedance/doubao-seed-2.1-pro",
                    image: "seedream-v5-pro",
                    video: "bytedance/seedance-2.5-token",
                  },
                  enabled_models: {
                    text: [],
                    image: [],
                    video: ["alibaba/wan-3.0", "minimax/hailuo-h3"],
                  },
                  parameters: {
                    image: { size: "1024x1024", resolution: "2k", outputFormat: "jpeg", max_references: 10 },
                    video: { duration: 5, resolution: "720p", ratio: "16:9", generateAudio: true },
                  },
                },
              ],
            })
          }
        >
          添加 RunningHub
        </button>
        )}
        {!value.providers.some((provider: Any) => provider.type === "volcengine_speech") && (
        <button
          onClick={() =>
            setValue({
              ...value,
              providers: [
                ...value.providers,
                {
                  id: id(),
                  name: "豆包语音",
                  type: "volcengine_speech",
                  url: "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse",
                  local: false,
                  kind: "audio",
                  model: "zh_female_vv_uranus_bigtts",
                  resource_id: "seed-tts-2.0",
                  enabled_models: { audio: ["seed-tts-2.0"] },
                  parameters: { format: "mp3", sample_rate: 24000, speech_rate: 0 },
                },
              ],
            })
          }
        >
          添加豆包语音
        </button>
        )}

      </div>
      </section>}
      {settingsTab === "runtime" && <section className="settings-section">
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
      </section>}
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
