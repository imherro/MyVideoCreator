import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import VideoEditor from "@twick/video-editor";
import { LivePlayerProvider } from "@twick/live-player";
import {
  TimelineProvider,
  useTimelineContext,
  type ProjectJSON,
} from "@twick/timeline";
import { attachAssetReferences, editorResolution, readEditorTimeline } from "./editorDocument";
import type { EditorAsset, EditorDocument } from "./editorDocument";
import { ProjectAssetPanel } from "./ProjectAssetPanel";
import { planInitialTimeline } from "./initialTimeline";
import "./editorWorkspace.css";

type EditorWorkspaceProps = {
  projectId: string;
  editor?: EditorDocument;
  assets: EditorAsset[];
  ratio: string;
  shots: Record<string, any>[];
  nodes: Record<string, any>[];
  audioId?: string;
  musicVolume?: number;
  onChange: (editor: EditorDocument) => void;
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

function EditorSurface({
  initialTimeline,
  assets,
  shots,
  nodes,
  audioId,
  musicVolume,
  onChange,
}: {
  initialTimeline: ProjectJSON;
  assets: EditorAsset[];
  shots: Record<string, any>[];
  nodes: Record<string, any>[];
  audioId?: string;
  musicVolume?: number;
  onChange: EditorWorkspaceProps["onChange"];
}) {
  const { editor, videoResolution } = useTimelineContext();
  const [message, setMessage] = useState("编辑会随当前项目自动保存");

  function generateInitialEdit() {
    const plan = planInitialTimeline(
      { shots, nodes, assets, resolution: videoResolution, audioId, musicVolume },
      () => crypto.randomUUID(),
    );
    if (plan.issues.length) {
      setMessage(`暂未生成：${plan.issues.join("；")}`);
      return;
    }
    if (!plan.clipCount) {
      setMessage("暂未生成：分镜中还没有可用的视频素材");
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
    setMessage(`已按分镜顺序建立 ${plan.clipCount} 个镜头的初剪`);
  }

  return (
    <>
      <TimelinePersistence initialTimeline={initialTimeline} assets={assets} onChange={onChange} />
      <div className="mvc-editor-actionbar">
        <button className="primary compact" onClick={generateInitialEdit}>
          <Sparkles size={15} /> 生成初剪
        </button>
        <span>{message}</span>
      </div>
      <div className="mvc-editor-surface">
        <VideoEditor
          leftPanel={<ProjectAssetPanel assets={assets} />}
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
  editor,
  assets,
  ratio,
  shots,
  nodes,
  audioId,
  musicVolume,
  onChange,
}: EditorWorkspaceProps) {
  const initialTimeline = useMemo(() => readEditorTimeline(editor), [projectId]);
  const resolution = editorResolution(ratio);

  return (
    <section className="mvc-editor-workspace">
      <LivePlayerProvider>
        <TimelineProvider
          key={projectId}
          contextId={`mvc-editor-${projectId}`}
          initialData={initialTimeline}
          resolution={resolution}
          maxHistorySize={50}
          analytics={{ enabled: false }}
        >
          <EditorSurface
            initialTimeline={initialTimeline}
            assets={assets}
            shots={shots}
            nodes={nodes}
            audioId={audioId}
            musicVolume={musicVolume}
            onChange={onChange}
          />
        </TimelineProvider>
      </LivePlayerProvider>
    </section>
  );
}
