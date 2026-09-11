import test from "node:test";
import assert from "node:assert/strict";
import { parseSrt } from "../src/editor/srt.ts";

test("SRT parser imports multiline captions with millisecond timing", () => {
  assert.deepEqual(
    parseSrt("1\r\n00:00:01,250 --> 00:00:03,500\r\n第一行\r\n第二行\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.100\r\n结束"),
    [
      { start: 1.25, end: 3.5, text: "第一行\n第二行" },
      { start: 4, end: 5.1, text: "结束" },
    ],
  );
});

test("SRT parser rejects invalid ranges", () => {
  assert.throws(() => parseSrt("1\n00:00:02,000 --> 00:00:01,000\n坏字幕"), /内容或时长无效/);
});
