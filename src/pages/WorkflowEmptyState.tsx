import { ArrowRight, BookOpen, PanelsTopLeft } from "lucide-react";
import type { WorkflowStage } from "../app/workflow";

export function WorkflowEmptyState({
  kind,
  onContinue,
}: {
  kind: "source" | "adaptation";
  onContinue: (stage: WorkflowStage) => void;
}) {
  const source = kind === "source";
  return (
    <section className="workflow-empty-page">
      <div className="workflow-empty-card">
        {source ? <BookOpen /> : <PanelsTopLeft />}
        <span className="eyebrow">{source ? "SOURCE LIBRARY · PHASE 2" : "ADAPTATION ROOM · PHASE 3"}</span>
        <h1>{source ? "原著资料库将在后续阶段开放" : "改编策划室将在后续阶段开放"}</h1>
        <p>
          {source
            ? "这里将管理原著文本、章节和研究资料。本阶段不创建临时数据结构，现有项目内容保持原样。"
            : "这里将承载改编方向、结构拆解和版本决策。本阶段先保留清晰入口。"}
        </p>
        <button onClick={() => onContinue(source ? "script" : "script")}>
          继续使用现有剧本能力 <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}

