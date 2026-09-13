export const PAYWALL_ROLES = ["none", "setup", "conversion", "retention", "major_cliffhanger"] as const;

export const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  review: "待审核",
  approved: "已批准",
  stale: "已过期",
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

export function normalizeEpisodeSelection(values: Iterable<number>, episodeCount: number) {
  return [...new Set(values)]
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= episodeCount)
    .sort((a, b) => a - b);
}

export function splitList(value: string) {
  return [...new Set(value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean))];
}
