import test from "node:test";
import assert from "node:assert/strict";
import { compileVideoPrompt, VIDEO_DIALOGUE_MARKER } from "../src/videoDialogue.ts";

const shot = { dialogues: [
  { characterName: "球球", emotion: "坚定", text: "下一步直接拔电源。" },
  { characterName: "林岚", text: "你确定吗？" },
] };

test("video prompt preview includes exact structured dialogue", () => {
  const value = compileVideoPrompt("机器人抬头。", shot);
  assert.match(value, /球球（坚定）说：“下一步直接拔电源。”/);
  assert.match(value, /林岚说：“你确定吗？”/);
  assert.equal(value.split(VIDEO_DIALOGUE_MARKER).length, 2);
  assert.equal(compileVideoPrompt(value, shot), value);
});

test("an authored prompt that already contains every line is preserved", () => {
  const value = "球球说：下一步直接拔电源。林岚回答：你确定吗？";
  assert.equal(compileVideoPrompt(value, shot), value);
});
