export type ParsedCaption = { start: number; end: number; text: string };

function parseTimestamp(value: string) {
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error(`字幕时间格式无效：${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

export function parseSrt(source: string): ParsedCaption[] {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  return normalized.split(/\n{2,}/).map((block, index) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0]?.trim() || "")) lines.shift();
    const timing = lines.shift()?.match(/^\s*(.*?)\s*-->\s*(.*?)\s*$/);
    if (!timing) throw new Error(`第 ${index + 1} 条字幕缺少有效时间范围`);
    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    const text = lines.join("\n").trim();
    if (!text || end <= start) throw new Error(`第 ${index + 1} 条字幕内容或时长无效`);
    return { start, end, text };
  });
}
