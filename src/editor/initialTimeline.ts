import type { ElementJSON, ProjectJSON, Size, TrackJSON } from "@twick/timeline";
import { attachAssetReferences, type EditorAsset } from "./editorDocument.ts";

type Value = Record<string, any>;

export type InitialTimelinePlan = {
  timeline: ProjectJSON;
  issues: string[];
  clipCount: number;
  naturalDuration: number;
  outputDuration: number;
  fitApplied: boolean;
};

export function planInitialTimeline(
  {
    shots,
    nodes,
    assets,
    resolution,
    audioId,
    musicVolume = 0.3,
    targetDuration = 0,
    fitMode = "preserve",
  }: {
    shots: Value[];
    nodes: Value[];
    assets: EditorAsset[];
    resolution: Size;
    audioId?: string;
    musicVolume?: number;
    targetDuration?: number;
    fitMode?: "preserve" | "target";
  },
  newId: () => string,
): InitialTimelinePlan {
  const issues: string[] = [];
  const videoTracks: TrackJSON[] = [];
  let cursor = 0;

  shots.forEach((shot, index) => {
    const label = `第 ${index + 1} 镜`;
    const videoNodeId = shot.videoNode || shot.pipeline?.videoNodeId;
    const node = nodes.find((candidate) => candidate.id === videoNodeId);
    const asset = assets.find(
      (candidate) => candidate.id === node?.data?.assetId && candidate.kind === "video",
    );
    if (!node || !asset) {
      issues.push(`${label}缺少已生成视频`);
      return;
    }
    if (node.data?.stale || shot.prompts_need_review) {
      issues.push(`${label}输入已变更，请核对并重新生成`);
      return;
    }
    const plannedDuration = Number(shot.duration);
    const mediaDuration = Number(asset.metadata?.duration);
    if (
      !Number.isFinite(plannedDuration) ||
      plannedDuration <= 0 ||
      !Number.isFinite(mediaDuration) ||
      mediaDuration <= 0
    ) {
      issues.push(`${label}时长无效`);
      return;
    }
    if (plannedDuration > mediaDuration + 0.08) {
      issues.push(`${label}需要 ${plannedDuration} 秒，素材仅 ${mediaDuration.toFixed(2)} 秒`);
      return;
    }

    const duration = Math.min(plannedDuration, mediaDuration);
    const elementId = `e-${newId()}`;
    const trackId = `t-v${videoTracks.length + 1}`;
    const element: ElementJSON = {
      id: elementId,
      trackId,
      type: "video",
      name: shot.title || `${label} · ${asset.name}`,
      s: cursor,
      e: cursor + duration,
      props: {
        src: asset.url,
        srcAssetId: asset.id,
        time: 0,
        playbackRate: 1,
        volume: 1,
        mediaFilter: "none",
      },
      metadata: {
        assetId: asset.id,
        assetSource: "my-video-creator",
        shotId: shot.id || shot.shot_id,
        nodeId: node.id,
        generatedInitialEdit: true,
      },
      frame: { x: 0, y: 0, size: [resolution.width, resolution.height] },
      objectFit: "cover",
      mediaDuration,
    };
    videoTracks.push({
      id: trackId,
      name: `V${videoTracks.length + 1} · ${label}`,
      type: "element",
      elements: [element],
    });
    cursor += duration;
  });

  const naturalDuration = cursor;
  const fitApplied = fitMode === "target" && targetDuration > 0 && naturalDuration > targetDuration;
  if (fitApplied) {
    const scale = targetDuration / naturalDuration;
    videoTracks.forEach((track) => track.elements.forEach((element) => {
      element.s *= scale;
      element.e *= scale;
      element.props = { ...element.props, playbackRate: 1 / scale };
      element.metadata = { ...element.metadata, initialEditFit: "target", originalDuration: (element.e - element.s) / scale };
    }));
    cursor = targetDuration;
  }

  const tracks: TrackJSON[] = [...videoTracks];

  const music = assets.find((asset) => asset.id === audioId && asset.kind === "audio");
  if (music && cursor > 0) {
    const mediaDuration = Number(music.metadata?.duration);
    tracks.push({
      id: "t-music",
      name: "A1 · 背景音乐",
      type: "audio",
      elements: [
        {
          id: `e-${newId()}`,
          trackId: "t-music",
          type: "audio",
          name: music.name,
          s: 0,
          e: cursor,
          props: {
            src: music.url,
            srcAssetId: music.id,
            time: 0,
            playbackRate: 1,
            volume: Math.max(0, Math.min(2, musicVolume)),
            loop: true,
          },
          metadata: {
            assetId: music.id,
            assetSource: "my-video-creator",
            role: "background-music",
            generatedInitialEdit: true,
          },
          mediaDuration:
            Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : cursor,
        },
      ],
    });
  }

  const timeline = attachAssetReferences(
    {
      tracks,
      version: 2,
      backgroundColor: "#000000",
      metadata: {
        custom: {
          host: "my-video-creator",
          schema: "mvc-editor-v1",
          source: "storyboard",
          timelineDuration: Math.max(Number(targetDuration) || 0, cursor),
        },
      },
    },
    assets,
  );

  return { timeline, issues, clipCount: videoTracks.length, naturalDuration, outputDuration: cursor, fitApplied };
}
