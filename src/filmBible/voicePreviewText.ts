// Suggestions only; never overwrite saved/user-edited text or splice speakers.
export function suggestVoicePreview(
  dialogues: Array<{ text: string; emotion: string; shotId: string }>,
  script: string,
) {
  const dialogue = dialogues.find(row => row.text.trim());
  let combined = "";
  for (const row of dialogues) {
    const text=row.text.trim().slice(0, 80);
    if (!text) continue;
    if (combined && (combined + text).length > 80) break;
    combined += (combined ? "\n" : "") + text;
    if (combined.length >= 45) break;
  }
  if (combined.replace(/\s|[，。！？!?….,]/g, "").length >= 30 && combined.length <= 100)
    return {text:combined, emotion:dialogue?.emotion || "", source:"本角色本集对白节选"};
  const plain = script.split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:#{1,6}\s*|[-*>]\s+)/, "").trim())
    .filter(Boolean).join(" ");
  const sentences = plain.match(/[^。！？!?]+[。！？!?]?/g) || [];
  let text = "";
  for (const sentence of sentences) {
    if (text && (text + sentence).length > 80) break;
    text += sentence;
    if (text.length >= 45) break;
  }
  // Avoid unbounded synthesis for scripts containing no sentence punctuation.
  text = text.length > 100 ? text.slice(0, 80) : text;
  if (text.trim().length < combined.length) return {text:combined,emotion:dialogue?.emotion || "",source:"本角色对白（偏短，请补充试听文本）"};
  return { text: text.trim(), emotion: "", source: text ? "本集剧本节选" : "暂无本集对白或剧本" };
}
