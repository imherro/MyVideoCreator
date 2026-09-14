type Value = Record<string, any>;

export function filmBibleJobStages(job: Value): Value[] {
  if (!job?.input?.film_bible || job.kind !== "storyboard") return [];
  const phase = String(job.phase || "");
  const completed = job.status === "succeeded";
  const failed = job.status === "failed";
  const visualRepair = Number(job.result?.visual_repair_count || 0);
  const storyboardRepair = Number(job.result?.storyboard_repair_count || 0);
  const inVisual = /视觉圣经/.test(phase);
  const inStoryboard = /分镜|绑定/.test(phase) && !inVisual;
  const visualDone = completed || inStoryboard || storyboardRepair > 0;
  const traces = Array.isArray(job.telemetry?.prompt_stages) ? job.telemetry.prompt_stages : [];
  const stage = (id: string, label: string, done: boolean, active: boolean, repairs: number, repairActive: boolean) => ({
    id, label,
    status: done ? "succeeded" : failed && active ? "failed" : active ? "running" : "waiting",
    attempts: 1 + repairs + (repairActive && !repairs ? 1 : 0),
    repairs,
    validationError: [...traces].reverse().find((item: Value) => String(item.id || "").startsWith(id) && item.validation_error)?.validation_error,
    detail: done
      ? repairs ? `首次结果未通过校验，自动修正 ${repairs} 次后完成` : "首次结果通过严格校验"
      : repairActive ? "首次结果未通过校验，正在自动修正" : active ? "模型正在生成，完成后将进行严格校验" : "等待上一阶段完成",
  });
  return [
    stage("visual_bible", "阶段 1 · 提取视觉资产卡", visualDone, inVisual && !completed, visualRepair, /修正视觉圣经/.test(phase)),
    stage("bound_storyboard", "阶段 2 · 生成并绑定分镜", completed, inStoryboard && !completed, storyboardRepair, /修正分镜视觉绑定/.test(phase)),
  ];
}
