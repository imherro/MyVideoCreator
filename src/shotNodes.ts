import { nodeDefaults } from "./nodeDefaults.ts";
import { framesForDuration } from "./shotSync.ts";

type Value = Record<string, any>;

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
    let image = nodes.find(
      (node) => node.id === shot.imageNode && node.data.kind === "image",
    );
    let video = nodes.find(
      (node) => node.id === shot.videoNode && node.data.kind === "video",
    );
    if (!image) {
      image = {
        id: newId(),
        type: "media",
        position: { x: 470, y: 80 + index * 320 },
        data: {
          kind: "image",
          label: `${shot.id} · 分镜图`,
          prompt: shot.image_prompt,
          ...nodeDefaults("image", providers, models),
        },
      };
      nodes.push(image);
    }
    if (!video) {
      const defaults = nodeDefaults("video", providers, models);
      video = {
        id: newId(),
        type: "media",
        position: { x: 860, y: 80 + index * 320 },
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
    };
  });
  return { ...doc, nodes, edges, shots };
}
