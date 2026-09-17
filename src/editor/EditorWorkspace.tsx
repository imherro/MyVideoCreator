import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Sparkles } from "lucide-react";
import VideoEditor from "@twick/video-editor";
import "@twick/video-editor/dist/video-editor.css";
import { LivePlayerProvider } from "@twick/live-player";
import { PLAYER_STATE, useLivePlayerContext } from "@twick/live-player";
import {
  TimelineProvider,
  useTimelineContext,
  type ProjectJSON,
} from "@twick/timeline";
import { attachAssetReferences, editorResolution, readEditorTimeline } from "./editorDocument";
import type { EditorAsset, EditorDocument } from "./editorDocument";
import { ProjectAssetPanel } from "./ProjectAssetPanel";
import type { EpisodeSummary } from "../app/production";
import { EditorInspector } from "./EditorInspector";
import { EditorToolbar } from "./EditorToolbar";
import { EditorShortcuts } from "./EditorShortcuts";
import { planInitialTimeline } from "./initialTimeline";
import { addAssetToTimeline } from "./assetAdapter";
import {
  timelineContentDuration,
  timelineWorkspaceDuration,
  withTimelineWorkspaceDuration,
} from "./timelineDuration";
import { TIMELINE_DROP_MEDIA_TYPE } from "@twick/video-editor";
import "./editorWorkspace.css";

type EditorWorkspaceProps = {
  projectId: string;
  episodes: EpisodeSummary[];
  productionName: string;
  episodeLabel: string;
  editor?: EditorDocument;
  assets: EditorAsset[];
  ratio: string;
  duration: number;
  shots: Record<string, any>[];
  nodes: Record<string, any>[];
  audioId?: string;
  musicVolume?: number;
  onChange: (editor: EditorDocument) => void;
  onExport: (timeline: ProjectJSON) => void;
};

function TimelinePersistence({
  initialTimeline,
  assets,
  onChange,
}: {
  initialTimeline: ProjectJSON;
  assets: EditorAsset[];
  onChange: EditorWorkspaceProps["onChange"];
}) {
  const { present, changeLog } = useTimelineContext();
  const lastSaved = useRef(JSON.stringify(attachAssetReferences(initialTimeline, assets)));

  useEffect(() => {
    if (!present) return;
    const timeline = attachAssetReferences(present, assets);
    const serialized = JSON.stringify(timeline);
    if (serialized === lastSaved.current) return;
    lastSaved.current = serialized;
    onChange({ version: 1, timeline });
  }, [assets, changeLog, onChange, present]);

  return null;
}

function PlaybackEndReset() {
  const { currentTime, seekTime, playerState, setSeekTime } = useLivePlayerContext();
  const { totalDuration } = useTimelineContext();
  const previousTime = useRef(0);

  useEffect(() => {
    const wrappedAtEnd =
      totalDuration > 0 &&
      previousTime.current >= Math.max(0.1, totalDuration - 0.75) &&
      currentTime < 0.05 &&
      playerState === PLAYER_STATE.PAUSED;
    if (wrappedAtEnd && seekTime > 0.05) setSeekTime(0);
    previousTime.current = currentTime;
  }, [currentTime, playerState, seekTime, setSeekTime, totalDuration]);

  return null;
}

function TimelineDurationFloor({ projectDuration }: { projectDuration: number }) {
  const { editor, totalDuration, changeLog } = useTimelineContext();
  const [value, setValue] = useState(() =>
    timelineWorkspaceDuration(editor.getProject(), projectDuration),
  );
  const contentDuration = timelineContentDuration(editor.getProject());
  const minimum = Math.max(Number(projectDuration) || 0, contentDuration, 5);

  useEffect(() => {
    const floor = timelineWorkspaceDuration(editor.getProject(), projectDuration);
    setValue((current) => Math.max(current, floor));
    if (totalDuration + 0.001 < floor) editor.getContext().setTotalDuration(floor);
  }, [changeLog, editor, projectDuration, totalDuration]);

  const commit = (requested: number) => {
    const next = Math.max(minimum, Number(requested) || minimum);
    setValue(next);
    const project = withTimelineWorkspaceDuration(editor.getProject(), next, projectDuration);
    editor.setMetadata(project.metadata || {});
    editor.getContext().setTotalDuration(next);
  };

  return (
    <label className="mvc-editor-duration" title="时间轴工作区至少采用影片目标时长；可继续延长，以便把素材拖到更靠后的位置">
      时间线
      <input
        aria-label="时间线工作区时长"
        type="number"
        min={minimum}
        step="1"
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        onBlur={(event) => commit(Number(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      秒
    </label>
  );
}

function EditorSurface({
  projectId,
  episodes,
  productionName,
  episodeLabel,
  initialTimeline,
  assets,
  shots,
  nodes,
  audioId,
  musicVolume,
  duration,
  onChange,
  onExport,
}: {
  projectId: string;
  episodes: EpisodeSummary[];
  productionName: string;
  episodeLabel: string;
  initialTimeline: ProjectJSON;
  assets: EditorAsset[];
  shots: Record<string, any>[];
  nodes: Record<string, any>[];
  audioId?: string;
  musicVolume?: number;
  duration: number;
  onChange: EditorWorkspaceProps["onChange"];
  onExport: EditorWorkspaceProps["onExport"];
}) {
  const { editor, videoResolution, changeLog, setSelectedItem, totalDuration } = useTimelineContext();
  const { getCurrentTime, setCurrentTime, setSeekTime, playerState } = useLivePlayerContext();
  const [message, setMessage] = useState("编辑会随当前项目自动保存");
  const [messageTone, setMessageTone] = useState<"normal" | "error" | "success">("normal");
  const [initialEditMode, setInitialEditMode] = useState<"preserve" | "target">("preserve");
  const surfaceRef = useRef<HTMLDivElement>(null);
  const showMessage = (value: string) => {
    setMessageTone("normal");
    setMessage(value);
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let frame = 0;
    const notifyLayout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    };
    const observer = new ResizeObserver(notifyLayout);
    observer.observe(surface);
    notifyLayout();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const tracks = editor.getTimelineData()?.tracks || [];
      const counters = new Map<string, number>();
      surfaceRef.current?.querySelectorAll<HTMLElement>(".twick-track-header-content").forEach((header, index) => {
        const track = tracks[index];
        if (!track) return;
        const type = track.getType();
        const group = type === "video" || type === "element" ? "visual" : type;
        const number = (counters.get(group) || 0) + 1;
        counters.set(group, number);
        const label = group === "visual" ? `V${number}` : type === "audio" ? `A${number}` : type === "caption" ? "字幕" : type === "text" ? `T${number}` : "空";
        header.dataset.trackLabel = label;
        header.title = `${label} · ${track.getName() || "未命名轨道"}`;
      });
      const split = surfaceRef.current?.querySelector<HTMLButtonElement>(".split-btn");
      const remove = surfaceRef.current?.querySelector<HTMLButtonElement>(".delete-btn");
      if (split) {
        split.title = "切分所选片段（播放头必须位于片段内部）";
        split.setAttribute("aria-label", "切分所选片段");
      }
      if (remove) {
        remove.title = "删除所选片段";
        remove.setAttribute("aria-label", "删除所选片段");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [changeLog, editor]);

  function draggedAsset(event: DragEvent<HTMLElement>) {
    try {
      const raw = event.dataTransfer.getData(TIMELINE_DROP_MEDIA_TYPE);
      const data = raw ? JSON.parse(raw) : null;
      return assets.find((asset) => asset.id === data?.assetId);
    } catch {
      return undefined;
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.types.includes(TIMELINE_DROP_MEDIA_TYPE) && (event.target as Element).closest(".twick-track")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const trackNode = (event.target as Element).closest(".twick-track");
    const asset = draggedAsset(event);
    if (!trackNode || !asset) return;
    event.preventDefault();
    event.stopPropagation();
    const nodes = [...(surfaceRef.current?.querySelectorAll(".twick-track") || [])];
    const targetTrack = editor.getTimelineData()?.tracks[nodes.indexOf(trackNode)];
    try {
      const element = addAssetToTimeline(editor, asset, videoResolution, {
        start: getCurrentTime(),
        targetTrack,
      });
      setSelectedItem(element);
      setMessage(`已将“${asset.name}”放到 ${element.getStart().toFixed(2)} 秒`);
    } catch (cause: any) {
      setMessage(`加入失败：${cause?.message || String(cause)}`);
    }
  }

  function generateInitialEdit() {
    const plan = planInitialTimeline(
      { shots, nodes, assets, resolution: videoResolution, audioId, musicVolume, targetDuration: duration, fitMode: initialEditMode },
      () => crypto.randomUUID(),
    );
    if (plan.issues.length) {
      setMessageTone("error");
      setMessage(`无法生成初剪：${plan.issues.join("；")}`);
      return;
    }
    if (!plan.clipCount) {
      setMessageTone("error");
      setMessage("无法生成初剪：分镜中还没有可用的视频素材");
      return;
    }
    const hasExistingEdit = (editor.getProject().tracks || []).some(
      (track) => track.elements.length > 0,
    );
    if (
      hasExistingEdit &&
      !window.confirm("生成初剪会替换当前剪辑时间线，是否继续？")
    ) {
      return;
    }
    editor.loadProject(plan.timeline);
    setCurrentTime(0);
    setSeekTime(0);
    setMessageTone("success");
    setMessage(`已建立 ${plan.clipCount} 个镜头，${initialEditMode === "preserve" ? "顺序放入同一视频轨" : "按镜头分轨排列"}${plan.fitApplied ? `，由 ${plan.naturalDuration.toFixed(1)} 秒匹配至 ${plan.outputDuration.toFixed(1)} 秒` : `，总长 ${plan.outputDuration.toFixed(1)} 秒`}；准备好后请手动播放`);
  }

  return (
    <>
      <TimelinePersistence initialTimeline={initialTimeline} assets={assets} onChange={onChange} />
      <PlaybackEndReset />
      <EditorShortcuts onMessage={showMessage} />
      <div className="mvc-editor-actionbar">
        <button className="primary compact" onClick={generateInitialEdit}>
          <Sparkles size={15} /> 生成初剪
        </button>
        <label className="mvc-initial-edit-mode" title="完整镜头按顺序放入同一视频轨，保留原时长；匹配影片时长按镜头分轨，超出目标时等比例加速，保留完整内容">
          初剪方式
          <select value={initialEditMode} onChange={(event) => setInitialEditMode(event.target.value as "preserve" | "target")}>
            <option value="preserve">完整镜头 · 同轨</option>
            <option value="target">匹配 {Number(duration).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 秒 · 分轨</option>
          </select>
        </label>
        <TimelineDurationFloor projectDuration={duration} />
        <span className={`mvc-editor-message ${messageTone}`} role={messageTone === "error" ? "alert" : "status"}><b>{productionName} · {episodeLabel}</b>　{message}</span>
        <span className={`mvc-preview-readiness ${playerState === PLAYER_STATE.REFRESH ? "loading" : "ready"}`} role="status">
          {!totalDuration ? "等待时间线内容" : playerState === PLAYER_STATE.REFRESH ? "视频加载中…" : playerState === PLAYER_STATE.PLAYING ? "正在预览" : "点击预览以加载"}
        </span>
        <EditorToolbar assets={assets} onMessage={showMessage} onExport={onExport} />
      </div>
      <div className="mvc-editor-surface" ref={surfaceRef} onDragOverCapture={handleDragOver} onDropCapture={handleDrop}>
        <VideoEditor
          leftPanel={<ProjectAssetPanel currentProjectId={projectId} episodes={episodes} assets={assets} shots={shots} onMessage={showMessage} />}
          rightPanel={<EditorInspector assets={assets} />}
          editorConfig={{
            canvasMode: true,
            videoProps: { ...videoResolution, backgroundColor: "#000000" },
            fps: 24,
            timelineZoomConfig: { min: 0.25, max: 4, step: 0.25, default: 1 },
          }}
        />
      </div>
    </>
  );
}

export function EditorWorkspace({
  projectId,
  episodes,
  productionName,
  episodeLabel,
  editor,
  assets,
  ratio,
  duration,
  shots,
  nodes,
  audioId,
  musicVolume,
  onChange,
  onExport,
}: EditorWorkspaceProps) {
  const initialTimeline = useMemo(
    () => attachAssetReferences(readEditorTimeline(editor), assets),
    [projectId],
  );
  const resolution = editorResolution(ratio);

  return (
    <section className="mvc-editor-workspace">
      <LivePlayerProvider key={`${projectId}:${ratio}`}>
        <TimelineProvider
          key={projectId}
          contextId={`mvc-editor-${projectId}`}
          initialData={initialTimeline}
          resolution={resolution}
          maxHistorySize={50}
          analytics={{ enabled: false }}
        >
          <EditorSurface
            projectId={projectId}
            episodes={episodes}
            initialTimeline={initialTimeline}
            productionName={productionName}
            episodeLabel={episodeLabel}
            assets={assets}
            shots={shots}
            nodes={nodes}
            audioId={audioId}
            musicVolume={musicVolume}
            duration={duration}
            onChange={onChange}
            onExport={onExport}
          />
        </TimelineProvider>
      </LivePlayerProvider>
    </section>
  );
}
