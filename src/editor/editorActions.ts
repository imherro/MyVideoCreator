import {
  AudioElement,
  VideoElement,
  type TimelineEditor,
  type TrackElement,
} from "@twick/timeline";

function findElement(editor: TimelineEditor, elementId: string): TrackElement {
  for (const track of editor.getTimelineData()?.tracks || []) {
    const element = track.getElementById(elementId);
    // Twick exposes track children as readonly, while its editing methods accept
    // the same live instance as TrackElement.
    if (element) return element as TrackElement;
  }
  throw new Error(`找不到剪辑元素：${elementId}`);
}

function requireFiniteNumber(value: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须是有效数字`);
  return parsed;
}

export function moveElement(
  editor: TimelineEditor,
  elementId: string,
  start: number,
) {
  const element = findElement(editor, elementId);
  const duration = element.getDuration();
  const nextStart = Math.max(0, requireFiniteNumber(start, "时间线起点"));
  editor.updateElements([
    {
      elementId,
      updates: { s: nextStart, e: nextStart + duration },
    },
  ]);
}

export function setElementDuration(
  editor: TimelineEditor,
  elementId: string,
  duration: number,
) {
  const element = findElement(editor, elementId);
  const nextDuration = Math.max(0.1, requireFiniteNumber(duration, "片段长度"));
  const playbackRate =
    element instanceof VideoElement || element instanceof AudioElement
      ? element.getPlaybackRate()
      : 1;
  const sourceIn =
    element instanceof VideoElement || element instanceof AudioElement
      ? element.getStartAt()
      : 0;
  const mediaDuration =
    element instanceof VideoElement || element instanceof AudioElement
      ? element.getMediaDuration()
      : Number.POSITIVE_INFINITY;
  if (
    Number.isFinite(mediaDuration) &&
    sourceIn + nextDuration * playbackRate > mediaDuration + 0.01
  ) {
    const availableDuration = Math.max(0, (mediaDuration - sourceIn) / playbackRate);
    throw new Error(`片段长度超出素材剩余时长 ${availableDuration.toFixed(2)} 秒`);
  }
  if (!editor.trimElement(element, element.getStart(), element.getStart() + nextDuration)) {
    throw new Error("片段时长调整失败，请检查是否与同轨片段重叠");
  }
}

export function setMediaSourceIn(
  editor: TimelineEditor,
  elementId: string,
  sourceIn: number,
) {
  const element = findElement(editor, elementId);
  if (!(element instanceof VideoElement || element instanceof AudioElement)) {
    throw new Error("只有视频和音频支持素材入点");
  }
  const nextSourceIn = Math.max(0, requireFiniteNumber(sourceIn, "素材入点"));
  const sourceEnd = nextSourceIn + element.getDuration() * element.getPlaybackRate();
  if (sourceEnd > element.getMediaDuration() + 0.01) {
    const latestSourceIn = Math.max(
      0,
      element.getMediaDuration() - element.getDuration() * element.getPlaybackRate(),
    );
    throw new Error(`素材入点过晚，当前片段最晚只能从 ${latestSourceIn.toFixed(2)} 秒开始`);
  }
  element.setStartAt(nextSourceIn);
  editor.updateElement(element);
}

export function setElementVolume(
  editor: TimelineEditor,
  elementId: string,
  volume: number,
) {
  const element = findElement(editor, elementId);
  if (!(element instanceof VideoElement || element instanceof AudioElement)) {
    throw new Error("只有视频和音频支持音量设置");
  }
  element.setVolume(
    Math.max(0, Math.min(2, requireFiniteNumber(volume, "音量"))),
  );
  editor.updateElement(element);
}

export async function splitElement(
  editor: TimelineEditor,
  elementId: string,
  time: number,
) {
  const result = await editor.splitElement(findElement(editor, elementId), time);
  if (!result.success) throw new Error("切分失败，请确认切分点位于片段内部");
  return result;
}

export function removeElement(editor: TimelineEditor, elementId: string) {
  if (!editor.removeElement(findElement(editor, elementId))) {
    throw new Error("删除剪辑元素失败");
  }
}
