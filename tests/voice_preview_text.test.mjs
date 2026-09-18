import test from "node:test";
import assert from "node:assert/strict";
import { suggestVoicePreview } from "../src/filmBible/voicePreviewText.ts";

test("short character dialogue falls back to a script excerpt", () => {
  const row = {text:"你是谁？",emotion:"惊讶",shotId:"SHOT 02"};
  const script="她来到山门之前，看见夜色里亮着一盏灯。远处的山峰被云雾遮住，她停下脚步，仔细听着风中的声音。";
  const result=suggestVoicePreview([row],script);
  assert.equal(result.source,"本集剧本节选");
  assert.ok(result.text.length>=30);
});
test("several lines of the same character form a bounded sample", () => {
  const text="我沿着山路走了很久，终于看见前面有人。";
  const result=suggestVoicePreview([{text,emotion:"期待",shotId:"SHOT 01"},{text:"请告诉我这是什么地方，我想找到回家的路。",emotion:"期待",shotId:"SHOT 02"}],"");
  assert.ok(result.text.includes(text));
  assert.equal(result.source,"本角色本集对白节选");
  assert.equal(result.emotion,"期待");
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

test("long dialogue without a script still yields a bounded suggestion", () => {
  const result=suggestVoicePreview([{text:"很长的对白".repeat(100),emotion:"平静",shotId:"SHOT 01"}],"");
  assert.ok(result.text.length<=100);
});
