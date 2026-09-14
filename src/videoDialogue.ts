type Value = Record<string, any>;

export const VIDEO_DIALOGUE_MARKER = "[对白与声音]";

export function compileVideoPrompt(basePrompt: unknown, shot: Value) {
  const base = String(basePrompt || "").split(VIDEO_DIALOGUE_MARKER, 1)[0].trimEnd();
  const dialogues = (Array.isArray(shot.dialogues) ? shot.dialogues : [])
    .filter((item: Value) => String(item?.text || "").trim());
  if (!dialogues.length || dialogues.every((item: Value) => base.includes(String(item.text).trim()))) return base;
  const lines = [base, "", VIDEO_DIALOGUE_MARKER,
    "以下台词必须按原文说出，人物口型、开口时机和情绪与台词同步；不得改词、漏词或增加额外对白。",
    ...dialogues.map((item: Value, index: number) => {
      const name = String(item.characterName || `角色${index + 1}`).trim();
      const emotion = String(item.emotion || "").trim();
      const text = String(item.text || "").trim().replaceAll("“", "「").replaceAll("”", "」");
      return `${index + 1}. ${name}${emotion ? `（${emotion}）` : ""}说：“${text}”`;
    }),
    "没有台词的角色保持闭嘴；保留分镜要求的环境声和动作声，不生成字幕。"];
  return lines.join("\n").trim();
}
