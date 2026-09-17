// Suggestions only; never overwrite saved/user-edited text or splice speakers.
export function suggestVoicePreview(
  dialogues: Array<{ text: string; emotion: string; shotId: string }>,
  script: string,
) {
  const dialogue = dialogues.find(row => row.text.trim());
  if (dialogue) return { text: dialogue.text.trim(), emotion: dialogue.emotion, source: `${dialogue.shotId} 对白` };
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
  return { text: text.trim(), emotion: "", source: text ? "本集剧本节选" : "暂无本集对白或剧本" };
}
