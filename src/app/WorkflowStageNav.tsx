import { Fragment, type ReactNode, useEffect, useRef } from "react";
import type { WorkflowStage } from "./workflow";
import { WORKFLOW_STAGES } from "./workflow";

export function WorkflowStageNav({
  active,
  onChange,
  states = {},
  episodeControl,
  directCreation = false,
}: {
  active: WorkflowStage;
  onChange: (stage: WorkflowStage) => void;
  states?: Partial<Record<WorkflowStage, string>>;
  episodeControl?: ReactNode;
  directCreation?: boolean;
}) {
  const activeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <nav className="workflow-stage-nav" aria-label="制作流程">
      {directCreation && <details className="workflow-optional-source"><summary>原著改编</summary><div><button className={active === "source" ? "active" : ""} onClick={event=>{onChange("source");event.currentTarget.closest("details")?.removeAttribute("open");}}>原著资料</button><button className={active === "adaptation" ? "active" : ""} onClick={event=>{onChange("adaptation");event.currentTarget.closest("details")?.removeAttribute("open");}}>改编策划</button></div></details>}
      {WORKFLOW_STAGES.filter(stage=>!directCreation || !["source","adaptation"].includes(stage.id)).map((stage) => <Fragment key={stage.id}>
        {stage.id === "storyboard" && episodeControl && <div className="workflow-episode-boundary">{episodeControl}</div>}
        <button
          ref={active === stage.id ? activeButtonRef : undefined}
          className={`${active === stage.id ? "active" : ""} workflow-nav-${stage.group}`}
          aria-current={active === stage.id ? "page" : undefined}
          title={stage.description}
          onClick={() => onChange(stage.id)}
        >
          <small>{stage.step ? String(stage.step).padStart(2, "0") : stage.id === "canvas" ? "ADV" : ""}</small>
          <span>{stage.label}</span>
          {states[stage.id] && <i className={`workflow-nav-state ${states[stage.id]}`} aria-label={states[stage.id]} />}
        </button>
      </Fragment>)}
    </nav>
  );
}
