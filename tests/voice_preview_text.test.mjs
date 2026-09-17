import test from "node:test";
import assert from "node:assert/strict";
import { suggestVoicePreview } from "../src/filmBible/voicePreviewText.ts";

test("preview keeps the chosen character's dialogue intact and its emotion", () => {
  const row = { text: "你怎么在这里？", emotion: "惊讶", shotId: "SHOT 02" };
  assert.deepEqual(suggestVoicePreview([row, {text:"下一句", emotion:"愤怒", shotId:"SHOT 03"}], "其他剧本"),
    {text:row.text, emotion:row.emotion, source:"SHOT 02 对白"});
});
test("no dialogue falls back to a bounded current-script excerpt, never invented text", () => {
  const script = "# 山门\n\n清晨，山门缓缓打开。".repeat(20);
  const result = suggestVoicePreview([], script);
  assert.equal(result.source, "本集剧本节选");
  assert.ok(result.text.includes("清晨，山门缓缓打开。"));
  assert.ok(result.text.length <= 100);
  assert.equal(result.emotion, "");
  assert.equal(suggestVoicePreview([], "长".repeat(1000)).text.length, 80);
  assert.equal(suggestVoicePreview([], "").text, "");
});
