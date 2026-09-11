import { useState } from "react";
import { AudioElement, TrackElement, VideoElement, useTimelineContext } from "@twick/timeline";
import {
  moveElement,
  setElementDuration,
  setElementVolume,
  setMediaSourceIn,
} from "./editorActions";

export function EditorInspector() {
  const { editor, selectedItem, changeLog } = useTimelineContext();
  const [error, setError] = useState("");

  if (!(selectedItem instanceof TrackElement)) {
    return (
      <aside className="mvc-editor-inspector mvc-editor-inspector-empty">
        <strong>剪辑属性</strong>
        <p>选择时间线片段后，可精确调整位置、长度、素材入点和音量。</p>
      </aside>
    );
  }

  const element = selectedItem;
  const isMedia = element instanceof VideoElement || element instanceof AudioElement;
  const commit = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (cause: any) {
      setError(cause?.message || String(cause));
    }
  };

  return (
    <aside className="mvc-editor-inspector" key={`${element.getId()}-${changeLog}`}>
      <strong>剪辑属性</strong>
      <small>{element.getName() || element.getType()}</small>
      <label>
        时间线起点（秒）
        <input
          type="number"
          min="0"
          step="0.01"
          defaultValue={element.getStart().toFixed(2)}
          onBlur={(event) => commit(() => moveElement(editor, element.getId(), Number(event.target.value)))}
        />
      </label>
      <label>
        片段长度（秒）
        <input
          type="number"
          min="0.1"
          step="0.01"
          defaultValue={element.getDuration().toFixed(2)}
          onBlur={(event) => commit(() => setElementDuration(editor, element.getId(), Number(event.target.value)))}
        />
      </label>
      {isMedia && (
        <>
          <label>
            素材入点（秒）
            <input
              type="number"
              min="0"
              step="0.01"
              defaultValue={element.getStartAt().toFixed(2)}
              onBlur={(event) => commit(() => setMediaSourceIn(editor, element.getId(), Number(event.target.value)))}
            />
          </label>
          <label>
            音量（0–200%）
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              defaultValue={element.getVolume()}
              onChange={(event) => commit(() => setElementVolume(editor, element.getId(), Number(event.target.value)))}
            />
          </label>
        </>
      )}
      <dl>
        <dt>元素 ID</dt>
        <dd>{element.getId()}</dd>
        <dt>素材 ID</dt>
        <dd>{String(element.getMetadata()?.assetId || "—")}</dd>
      </dl>
      {error && <p className="mvc-editor-inspector-error">{error}</p>}
    </aside>
  );
}
