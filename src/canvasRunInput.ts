type Value = Record<string, any>;

export function canvasScriptInputMatches(document: Value, node: Value, input: Value) {
  if (!Array.isArray(input.canvas_script_sources)) return true;
  if (String(node.data.prompt || "") !== String(input.canvas_script_instruction || "")) return false;
  const ids = new Set((document.edges || []).filter((edge: Value) => edge.target === node.id).map((edge: Value) => edge.source));
  const sources = (document.nodes || []).filter((source: Value) => ids.has(source.id) && source.data?.kind === "text");
  return sources.length === input.canvas_script_sources.length && sources.every((source: Value) =>
    input.canvas_script_sources.some((frozen: Value) => frozen.nodeId === source.id && frozen.text === String(source.data.text || "").trim()));
}

/** A storyboard may consume connected script output without an extra instruction. */
export function canvasRunInput(document: Value, node: Value | undefined, jobs: Value[] = []) {
  const data = node?.data || {};
  const sourceIds = new Set((document.edges || []).filter((edge: Value) => edge.target === node?.id).map((edge: Value) => edge.source));
  const scripts = data.kind === "storyboard"
    ? (document.nodes || []).filter((source: Value) => sourceIds.has(source.id) && source.data?.kind === "text")
    : [];
  if (scripts.some((source: Value) => jobs.some(job => job.node_id === source.id && ["queued", "running"].includes(job.status))))
    return { ready: false, reason: "上游剧本正在生成，请等待完成", scriptCount: scripts.length };
  if (scripts.some((source: Value) => !String(source.data.text || "").trim()))
    return { ready: false, reason: "已连接的剧本还没有正文，请先编写或生成剧本", scriptCount: scripts.length };
  if (scripts.some((source: Value) => source.data.stale || source.data.scriptStatus === "stale"))
    return { ready: false, reason: "上游剧本需要更新，请先确认或更新正文", scriptCount: scripts.length };
  const ready = !!String(data.prompt || "").trim() || scripts.length > 0;
  return { ready, reason: ready ? "" : data.kind === "storyboard" ? "请连接已有正文的剧本，或填写创作描述" : "请填写创作描述", scriptCount: scripts.length };
}
