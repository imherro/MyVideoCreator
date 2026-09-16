import type { ProjectJSON } from "@twick/timeline";

export function timelineContentDuration(timeline?: ProjectJSON | null) {
  return Math.max(
    0,
    ...(timeline?.tracks || []).flatMap((track) =>
      (track.elements || []).map((element) => Number(element.e) || 0),
    ),
  );
}

export function timelineWorkspaceDuration(
  timeline: ProjectJSON | null | undefined,
  projectDuration: number,
) {
  const saved = Number((timeline?.metadata as any)?.custom?.timelineDuration);
  return Math.max(
    5,
    Number(projectDuration) || 0,
    Number.isFinite(saved) ? saved : 0,
    timelineContentDuration(timeline),
  );
}

export function withTimelineWorkspaceDuration(
  timeline: ProjectJSON,
  duration: number,
  projectDuration: number,
): ProjectJSON {
  const next = Math.max(
    Number(projectDuration) || 0,
    timelineContentDuration(timeline),
    Number(duration) || 0,
  );
  return {
    ...timeline,
    metadata: {
      ...(timeline.metadata || {}),
      custom: {
        ...((timeline.metadata as any)?.custom || {}),
        timelineDuration: next,
      },
    },
  };
}
