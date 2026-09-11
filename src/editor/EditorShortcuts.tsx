import { useEffect } from "react";
import { useLivePlayerContext } from "@twick/live-player";
import { TrackElement, useTimelineContext } from "@twick/timeline";
import { splitElement } from "./editorActions";

export function EditorShortcuts({ onMessage }: { onMessage: (message: string) => void }) {
  const { editor, selectedItem } = useTimelineContext();
  const { getCurrentTime } = useLivePlayerContext();

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (!(selectedItem instanceof TrackElement)) return;
      const key = event.key.toLowerCase();
      if (key === "s" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const time = getCurrentTime();
        void splitElement(editor, selectedItem.getId(), time)
          .then(() => onMessage(`已在 ${time.toFixed(2)} 秒切分片段`))
          .catch((cause) => onMessage(cause?.message || String(cause)));
      }
      if (key === "d" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void editor.duplicateElements([selectedItem.getId()])
          .then(() => onMessage("已复制所选片段"));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [editor, getCurrentTime, onMessage, selectedItem]);
  return null;
}
