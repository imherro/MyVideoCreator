export const PAYWALL_ROLES = ["none", "setup", "conversion", "retention", "major_cliffhanger"] as const;
export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180] as const;
export const RATIO_OPTIONS = ["16:9", "9:16", "1:1"] as const;
export const PLATFORM_OPTIONS = ["通用短视频", "抖音", "快手", "红果短剧", "微信视频号", "小红书", "B站", "YouTube"] as const;

export const STATUS_LABELS: Record<string, string> = {
  draft: "已保存",
  review: "已保存",
  approved: "已保存",
  stale: "需要更新",
};

export const PAYWALL_LABELS: Record<string, string> = {
  none: "无",
  setup: "付费铺垫",
  conversion: "转付费",
  retention: "留存",
  major_cliffhanger: "强悬念",
};

export type EpisodePlan = {
  episodeNo: number;
  sourceChapterRefs: string[];
  logline: string;
  coreConflict: string;
  emotionalBeat: string;
  hook: string;
  cliffhanger: string;
  paywallRole: string;
  targetDuration: number;
  status: string;
};

export function createEpisodePlans(count: number, targetDuration: number, previous: EpisodePlan[] = []) {
  const safeCount = Math.max(1, Math.min(500, Math.round(Number(count) || 1)));
  const old = new Map(previous.map((plan) => [plan.episodeNo, plan]));
  return Array.from({ length: safeCount }, (_, index): EpisodePlan => {
    const episodeNo = index + 1;
    return old.get(episodeNo) || {
      episodeNo,
      sourceChapterRefs: [],
      logline: "",
      coreConflict: "",
      emotionalBeat: "",
      hook: "",
      cliffhanger: "",
      paywallRole: "none",
      targetDuration: Number(targetDuration) || 60,
      status: "draft",
    };
  });
}

export function appendEpisodeForChapter(previous: EpisodePlan[], targetDuration: number, chapterId = "") {
  const plans = createEpisodePlans(previous.length + 1, targetDuration, previous);
  if (chapterId) plans[plans.length - 1] = { ...plans[plans.length - 1], sourceChapterRefs: [chapterId] };
  return plans;
}

export function normalizeEpisodeSelection(values: Iterable<number>, episodeCount: number) {
  return [...new Set(values)]
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= episodeCount)
    .sort((a, b) => a - b);
}

export function splitList(value: string) {
  return [...new Set(value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean))];
}
// Legacy review/approved values stay in storage; readiness uses saved content.
export function scriptReady(script?: Record<string, any> | null) {
  return Boolean(script && script.status !== "stale" && String(script.body || "").trim());
}

export function sharedPlanningReady(plan?: Record<string, any>) {
  return Boolean(plan && plan.status !== "stale" && ["storyCore", "storyArc", "adaptationStrategy"].every(
    (key) => Object.values(plan[key] || {}).some((value) => String(value || "").trim()),
  ));
}

export function episodePlanningReady(plan?: Record<string, any>) {
  return Boolean(plan && plan.status !== "stale" && plan.sourceChapterRefs?.length &&
    ["logline", "coreConflict", "hook", "cliffhanger"].every((key) => String(plan[key] || "").trim()));
}

export function adaptationReviewSummary(value: Record<string, any>) {
  const shared = value.adaptationPlan;
  const protectedEpisodes = new Set<number>(value.protectedEpisodeNos || []);
  const pending = (value.episodePlans || []).filter((plan: EpisodePlan) => !protectedEpisodes.has(plan.episodeNo) && !episodePlanningReady(plan));
  if (shared?.status === "stale") return { status: "stale", headline: "全剧故事骨架需要更新", reason: "原著已改变，请修订或重新生成故事骨架；已有结果仍保留。" };
  if (!sharedPlanningReady(shared)) return { status: "draft", headline: "请完善故事骨架和改编策略", reason: "保存后即可生成内容完整的分集剧本。" };
  if (pending.length) {
    const status = pending.some((plan: EpisodePlan) => plan.status === "stale") ? "stale" : "draft";
    const labels = pending.filter((plan: EpisodePlan) => status !== "stale" || plan.status === "stale").map((plan: EpisodePlan) => `EP${String(plan.episodeNo).padStart(2, "0")}`).join("、");
    return { status, headline: `${labels} ${status === "stale" ? "规划需要更新" : "规划待完善"}`, reason: "仅需处理对应分集，其他内容完整的分集可以继续生成剧本。" };
  }
  return { status: "ready", headline: "改编策划已保存，可进入剧本", reason: "" };
}

// Planning selection is independent of whether an episode production project exists yet.
export function resolvePlanningEpisode(
  plans: Pick<EpisodePlan, "episodeNo" | "status">[],
  preferred?: number,
  protectedEpisodeNos: number[] = [],
): number {
  if (preferred && plans.some((plan) => plan.episodeNo === preferred)) return preferred;
  return plans.find((plan) => plan.status !== "approved" && !protectedEpisodeNos.includes(plan.episodeNo))?.episodeNo
    || plans[0]?.episodeNo || 0;
}
