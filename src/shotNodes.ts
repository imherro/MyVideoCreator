import { nodeDefaults } from "./nodeDefaults.ts";
import { framesForDuration } from "./shotSync.ts";
import { imageSizeForRatio } from "./mediaSpecs.ts";

type Value = Record<string, any>;

export function importStoryboardShots<
  T extends { nodes: Value[]; edges: Value[]; shots: Value[] },
>(
  doc: T,
  incomingShots: Value[],
  providers: Value[],
  models: Value[],
  newId: () => string,
  storyboardNodeId?: string,
): T {
  const existing = new Map(doc.shots.map((shot) => [shot.id, shot]));
  const shots = incomingShots.map((shot) => {
    const previous = existing.get(shot.id);
    return {
      ...shot,
      compositionMode: previous ? previous.compositionMode : 'direct',
      videoReferenceMode: previous ? previous.videoReferenceMode : (shot.videoReferenceMode || ((doc as Value).videoReferenceMode && (doc as Value).videoReferenceMode !== 'legacy' ? (doc as Value).videoReferenceMode : 'multimodal')),
      storyboardNode: storyboardNodeId || previous?.storyboardNode || shot.storyboardNode,
      imageNode: previous?.imageNode,
      videoNode: previous?.videoNode,
    };
  });
  return ensureShotNodes(
    { ...doc, shots },
    providers,
    models,
    newId,
    undefined,
    storyboardNodeId,
  );
}

export function ensureShotNodes<
  T extends { nodes: Value[]; edges: Value[]; shots: Value[] },
>(
  doc: T,
  providers: Value[],
  models: Value[],
  newId: () => string,
  selectedIds?: string[],
  storyboardNodeId?: string,
): T {
  const nodes = [...doc.nodes];
  const edges = [...doc.edges];
  const hasEdge = (source: string, target: string) =>
    edges.some((edge) => edge.source === source && edge.target === target);
  const link = (source?: string, target?: string) => {
    if (source && target && !hasEdge(source, target))
      edges.push({ id: newId(), source, target });
  };
  const storyboard = nodes.find(
    (node) =>
      node.id === storyboardNodeId && node.data?.kind === "storyboard",
  );
  const script = nodes.find(
    (node) => node.data?.kind === "text" && node.data?.text,
  );
  if (storyboard) link(script?.id, storyboard.id);

  const shots = doc.shots.map((shot, index) => {
    if (selectedIds && !selectedIds.includes(shot.id)) return shot;
    const imageNodeId = shot.imageNode || shot.pipeline?.imageNodeId;
    const videoNodeId = shot.videoNode || shot.pipeline?.videoNodeId;
    let image = nodes.find(
      (node) => node.id === imageNodeId && node.data.kind === "image",
    );
    let video = nodes.find(
      (node) => node.id === videoNodeId && node.data.kind === "video",
    );
    if (!image) {
      image = {
        id: newId(),
        type: "media",
        position: { x: 1110, y: 80 + index * 320 },
        data: {
          kind: "image",
          label: `${shot.id} · 分镜图`,
          prompt: shot.image_prompt,
          ...nodeDefaults("image", providers, models, (doc as Value).generationPolicy),
          resolution: imageSizeForRatio((doc as Value).ratio || "16:9"),
        },
      };
      nodes.push(image);
    }
    if (!video) {
      const defaults = nodeDefaults("video", providers, models, (doc as Value).generationPolicy);
      video = {
        id: newId(),
        type: "media",
        position: { x: 1500, y: 80 + index * 320 },
        data: {
          kind: "video",
          label: `${shot.id} · 视频`,
          prompt: shot.video_prompt,
          ...defaults,
          frames: framesForDuration(defaults.model, shot.duration),
        },
      };
      nodes.push(video);
    }
    link(storyboard?.id, image.id);
    link(image.id, video.id);
    return {
      ...shot,
      storyboardNode: storyboard?.id || shot.storyboardNode,
      imageNode: image.id,
      videoNode: video.id,
      pipeline: {
        ...(shot.pipeline || {}),
        imageNodeId: image.id,
        videoNodeId: video.id,
      },
    };
  });
  return { ...doc, nodes, edges, shots };
}
