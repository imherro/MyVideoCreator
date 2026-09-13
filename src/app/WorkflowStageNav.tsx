import type { WorkflowStage } from "./workflow";
import { WORKFLOW_STAGES } from "./workflow";

export function WorkflowStageNav({
  active,
  onChange,
}: {
  active: WorkflowStage;
  onChange: (stage: WorkflowStage) => void;
}) {
  return (
    <nav className="workflow-stage-nav" aria-label="制作流程">
      {WORKFLOW_STAGES.map((stage, index) => (
        <button
          key={stage.id}
          className={active === stage.id ? "active" : ""}
          aria-current={active === stage.id ? "page" : undefined}
          title={stage.description}
          onClick={() => onChange(stage.id)}
        >
          <small>{String(index + 1).padStart(2, "0")}</small>
          <span>{stage.label}</span>
        </button>
      ))}
    </nav>
  );
}

