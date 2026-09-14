import type { WorkflowStage } from "./workflow";
import { WORKFLOW_STAGES } from "./workflow";

export function WorkflowStageNav({
  active,
  onChange,
  states = {},
}: {
  active: WorkflowStage;
  onChange: (stage: WorkflowStage) => void;
  states?: Partial<Record<WorkflowStage, string>>;
}) {
  return (
    <nav className="workflow-stage-nav" aria-label="制作流程">
      {WORKFLOW_STAGES.map((stage) => (
        <button
          key={stage.id}
          className={`${active === stage.id ? "active" : ""} workflow-nav-${stage.group}`}
          aria-current={active === stage.id ? "page" : undefined}
          title={stage.description}
          onClick={() => onChange(stage.id)}
        >
          <small>{stage.step ? String(stage.step).padStart(2, "0") : stage.id === "canvas" ? "ADV" : ""}</small>
          <span>{stage.label}</span>
          {states[stage.id] && <i className={`workflow-nav-state ${states[stage.id]}`} aria-label={states[stage.id]} />}
        </button>
      ))}
    </nav>
  );
}
