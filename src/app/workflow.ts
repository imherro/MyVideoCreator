export const WORKFLOW_STAGES = [
  { id: "overview", label: "概览", description: "项目进度与下一步" },
  { id: "source", label: "原著", description: "原始文本与素材" },
  { id: "adaptation", label: "改编策划", description: "改编方向与结构" },
  { id: "script", label: "剧本", description: "剧本生成与修订" },
  { id: "art", label: "塑角造景", description: "角色、场景与视觉圣经" },
  { id: "storyboard", label: "分镜", description: "镜头规划与分镜图" },
  { id: "video", label: "视频", description: "镜头视频生成" },
  { id: "editor", label: "剪辑", description: "时间线与多轨剪辑" },
  { id: "canvas", label: "高级画布", description: "完整节点工作流" },
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]["id"];

const stageIds = new Set<string>(WORKFLOW_STAGES.map((stage) => stage.id));

export function parseWorkflowStage(search: string): WorkflowStage {
  const candidate = new URLSearchParams(search).get("stage") || "overview";
  return stageIds.has(candidate) ? (candidate as WorkflowStage) : "overview";
}

export function workflowStageUrl(href: string, stage: WorkflowStage) {
  const url = new URL(href);
  url.searchParams.set("stage", stage);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function defaultViewForStage(stage: WorkflowStage) {
  if (stage === "storyboard") return "shots";
  if (stage === "editor") return "editor";
  if (["overview", "source", "adaptation", "script", "art", "video"].includes(stage)) return "stage";
  return "canvas";
}
