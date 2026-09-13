import type { VisualCard, VisualVersion } from "./filmBible/types";

export type ArtStatus = "未设计" | "草稿" | "待参考" | "待确认" | "已锁定" | "有新版" | "已弃用";

export function deriveArtStatus(
  card: VisualCard,
  version: VisualVersion | undefined,
  versions: VisualVersion[],
): ArtStatus {
  if (card.deletedAt || card.status === "deprecated" || version?.status === "deprecated") return "已弃用";
  if (!version?.spec?.description?.trim()) return "未设计";
  if (versions.some((item) => item.version > version.version)) return "有新版";
  if (version.status === "locked") return "已锁定";
  if (version.status === "pending_reference") {
    return version.references?.some((item) => item?.role === "primary") ? "待确认" : "待参考";
  }
  return "草稿";
}

export function usageLabels(episodes: Array<{ episode_no: number }>) {
  return episodes.map((item) => `EP${String(item.episode_no).padStart(2, "0")}`);
}
