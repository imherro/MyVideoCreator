type ExportDocument = {
  ratio?: string;
  videoRatio?: string;
  videoResolution?: string;
  export_resolution?: string;
};

const HEIGHTS: Record<string, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "768p": 768,
  "2k": 1440,
};

function dimensions(height: number, ratio: string): [number, number] {
  switch (ratio) {
    case "21:9": return [Math.round(height * 21 / 9 / 2) * 2, height];
    case "4:3": return [Math.round(height * 4 / 3 / 2) * 2, height];
    case "1:1": return [height, height];
    case "3:4": return [height, Math.round(height * 4 / 3 / 2) * 2];
    case "9:16": return [height, Math.round(height * 16 / 9 / 2) * 2];
    default: return [Math.round(height * 16 / 9 / 2) * 2, height];
  }
}

export function projectExportRatio(document: ExportDocument): string {
  const configured = document.videoRatio;
  return configured && configured !== "adaptive" ? configured : document.ratio || "16:9";
}

export function defaultExportResolution(document: ExportDocument): string {
  if (document.export_resolution) return document.export_resolution;
  const height = HEIGHTS[document.videoResolution || "720p"] || 720;
  return dimensions(height, projectExportRatio(document)).join("x");
}

export function exportResolutionOptions(document: ExportDocument) {
  const ratio = projectExportRatio(document);
  const options = Object.entries(HEIGHTS).map(([quality, height]) => {
    const [width, outputHeight] = dimensions(height, ratio);
    return {
      value: `${width}x${outputHeight}`,
      label: `${quality.toUpperCase()} · ${ratio} · ${width}×${outputHeight}`,
    };
  });
  const selected = defaultExportResolution(document);
  return options.some((option) => option.value === selected)
    ? options
    : [{ value: selected, label: `当前自定义 · ${selected.replace("x", "×")}` }, ...options];
}
