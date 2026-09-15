export const VIDEO_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"] as const;
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const VIDEO_FORMATS = ["mp4", "mov"] as const;

export function imageSizeForRatio(ratio: string) {
  return ({
    "21:9": "2048x864",
    "16:9": "2048x1152",
    "4:3": "2048x1536",
    "1:1": "2048x2048",
    "3:4": "1536x2048",
    "9:16": "1152x2048",
  } as Record<string, string>)[ratio] || "2048x2048";
}
