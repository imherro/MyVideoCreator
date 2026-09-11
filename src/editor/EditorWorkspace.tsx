import { useEffect, useMemo, useRef } from "react";
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
import "./editorWorkspace.css";

type EditorWorkspaceProps = {
  projectId: string;
  editor?: EditorDocument;
  assets: EditorAsset[];
  ratio: string;
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

export function EditorWorkspace({
  projectId,
  editor,
  assets,
  ratio,
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
          <TimelinePersistence initialTimeline={initialTimeline} assets={assets} onChange={onChange} />
          <VideoEditor
            leftPanel={<ProjectAssetPanel assets={assets} />}
            editorConfig={{
              canvasMode: true,
              videoProps: { ...resolution, backgroundColor: "#000000" },
              fps: 24,
              timelineZoomConfig: { min: 0.25, max: 4, step: 0.25, default: 1 },
            }}
          />
        </TimelineProvider>
      </LivePlayerProvider>
    </section>
  );
}
