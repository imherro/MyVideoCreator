import { AlertCircle, ArrowRight, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import type { WorkflowStageGuide } from "./workflowGuide";

const labels: Record<string, string> = {
  unstarted: "未开始", ready: "可开始", running: "进行中", review: "待确认",
  complete: "已完成", skipped: "已跳过", stale: "需更新", blocked: "前置条件未完成",
};

export function WorkflowGuideBanner({ guide, onNavigate }: {
  guide?: WorkflowStageGuide;
  onNavigate: (stage: WorkflowStageGuide["stage"]) => void;
}) {
  if (!guide) return null;
  const Icon = guide.state === "complete" ? CheckCircle2 : guide.state === "running" ? LoaderCircle : guide.state === "review" ? Clock3 : AlertCircle;
  return <aside className={`workflow-guide-banner ${guide.state}`}>
    <Icon className={guide.state === "running" ? "spin" : ""} size={19} />
    <div><span>{labels[guide.state]}</span><b>{guide.headline}</b>{guide.reasons.map((reason) => <small key={reason}>{reason}</small>)}</div>
    {guide.action && <button className="primary compact" onClick={() => onNavigate(guide.action!.stage)}>{guide.action.label}<ArrowRight size={14}/></button>}
  </aside>;
}
