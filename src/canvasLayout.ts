type Value = Record<string, any>;

const X = {
  text: 40,
  storyboard: 410,
  visual: 790,
  image: 1170,
  video: 1570,
  other: 410,
};
const TOP = 80;
const MEDIA_GAP = 330;
const VISUAL_GAP = 285;

function shotIdentity(shot: Value) {
  return String(shot.uid || shot.id || "");
}

function orderedShots(shots: Value[]) {
  return [...shots].sort(
    (left, right) =>
      Number(left.order || Number.MAX_SAFE_INTEGER) -
        Number(right.order || Number.MAX_SAFE_INTEGER) ||
      shotIdentity(left).localeCompare(shotIdentity(right)),
  );
}

function nodeLane(node: Value) {
  if (node.type === "visualAsset" || node.data?.kind === "visual_asset")
    return "visual";
  const kind = String(node.data?.kind || "");
  if (kind === "text") return "text";
  if (kind === "storyboard") return "storyboard";
  if (kind === "reference") return "visual";
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  return "other";
}

/**
 * Deterministic left-to-right layout for the creation graph.
 * Project data, node ids, edge ids and generation state are never changed.
 */
export function autoLayoutCanvas<T extends { nodes: Value[]; edges: Value[]; shots?: Value[] }>(
  document: T,
): T {
  const positions = new Map<string, { x: number; y: number }>();
  const shots = orderedShots(document.shots || []);

  shots.forEach((shot, index) => {
    const y = TOP + index * MEDIA_GAP;
    const image = shot.imageNode || shot.pipeline?.imageNodeId;
    const video = shot.videoNode || shot.pipeline?.videoNodeId;
    if (image) positions.set(String(image), { x: X.image, y });
    if (video) positions.set(String(video), { x: X.video, y });
  });

  const laneCounts: Record<string, number> = {
    text: 0,
    storyboard: 0,
    visual: 0,
    image: shots.length,
    video: shots.length,
    other: 0,
  };
  const ordered = [...document.nodes].sort((left, right) => {
    const laneOrder = ["text", "storyboard", "visual", "image", "video", "other"];
    return (
      laneOrder.indexOf(nodeLane(left)) - laneOrder.indexOf(nodeLane(right)) ||
      String(left.data?.visualVersionId || left.id).localeCompare(
        String(right.data?.visualVersionId || right.id),
      )
    );
  });
  for (const node of ordered) {
    if (positions.has(node.id)) continue;
    const lane = nodeLane(node);
    const index = laneCounts[lane]++;
    const gap = lane === "visual" ? VISUAL_GAP : MEDIA_GAP;
    positions.set(node.id, { x: X[lane as keyof typeof X], y: TOP + index * gap });
  }

  const nodes = document.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) || node.position || { x: X.other, y: TOP },
  }));
  return { ...document, nodes };
}
