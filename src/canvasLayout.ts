type Value = Record<string, any>;

const X = {
  text: 40,
  storyboard: 440,
  visualCharacter: 820,
  visualCharacterState: 1160,
  visualScene: 1500,
  visualSceneState: 1840,
  visualProp: 2180,
  image: 2780,
  video: 3260,
  other: 440,
};
const TOP = 80;
const MEDIA_GAP = 380;
const VISUAL_GAP = 360;

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

function nodeLane(node: Value, document?: Value) {
  if (node.type === "visualAsset" || node.data?.kind === "visual_asset") {
    const version = document?.filmBible?.visual?.versions?.[node.data?.visualVersionId];
    const card = version ? document?.filmBible?.visual?.cards?.[version.cardId] : undefined;
    if (card?.kind === "character_state") return "visualCharacterState";
    if (card?.kind === "scene_state") return "visualSceneState";
    if (card?.kind === "scene") return "visualScene";
    if (card?.kind === "prop") return "visualProp";
    return "visualCharacter";
  }
  const kind = String(node.data?.kind || "");
  if (kind === "text") return "text";
  if (kind === "storyboard") return "storyboard";
  if (kind === "reference") return "visualProp";
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  return "other";
}

/**
 * Deterministic left-to-right layout for the creation graph.
 * Project data, node ids, edge ids and generation state are never changed.
 */
export function autoLayoutCanvas<T extends { nodes: Value[]; edges: Value[]; shots?: Value[]; filmBible?: Value }>(
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
    visualCharacter: 0,
    visualCharacterState: 0,
    visualScene: 0,
    visualSceneState: 0,
    visualProp: 0,
    image: shots.length,
    video: shots.length,
    other: 0,
  };
  const ordered = [...document.nodes].sort((left, right) => {
    const laneOrder = ["text", "storyboard", "visualCharacter", "visualCharacterState", "visualScene", "visualSceneState", "visualProp", "image", "video", "other"];
    return (
      laneOrder.indexOf(nodeLane(left, document)) - laneOrder.indexOf(nodeLane(right, document)) ||
      String(left.data?.visualVersionId || left.id).localeCompare(
        String(right.data?.visualVersionId || right.id),
      )
    );
  });
  for (const node of ordered) {
    if (positions.has(node.id)) continue;
    const lane = nodeLane(node, document);
    const index = laneCounts[lane]++;
    const gap = lane.startsWith("visual") ? VISUAL_GAP : MEDIA_GAP;
    let y = TOP + index * gap;
    if (lane === "visualCharacterState" || lane === "visualSceneState") {
      const version = document?.filmBible?.visual?.versions?.[node.data?.visualVersionId];
      const parentNode = ordered.find((candidate) => candidate.data?.visualVersionId === version?.parentVersionId);
      const parentPosition = parentNode ? positions.get(parentNode.id) : undefined;
      if (parentPosition) y = Math.max(y, parentPosition.y);
    }
    positions.set(node.id, { x: X[lane as keyof typeof X], y });
  }

  const nodes = document.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) || node.position || { x: X.other, y: TOP },
  }));
  return { ...document, nodes };
}
