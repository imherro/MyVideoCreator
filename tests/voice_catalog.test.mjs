import test from "node:test";
import assert from "node:assert/strict";
import { catalogVoice, DOUBAO_TTS2_VOICES } from "../src/filmBible/voiceCatalog.ts";

test("Doubao TTS 2.0 catalog exposes named presets while allowing custom ids", () => {
  assert.ok(DOUBAO_TTS2_VOICES.length >= 10);
  assert.equal(catalogVoice("zh_female_vv_uranus_bigtts")?.name, "Vivi 2.0 · 活泼灵动女声");
  assert.equal(catalogVoice("cloned-speaker-id"), undefined);
  assert.ok(DOUBAO_TTS2_VOICES.some((voice) => voice.category === "角色扮演"));
  assert.equal(new Set(DOUBAO_TTS2_VOICES.map((voice) => voice.id)).size, DOUBAO_TTS2_VOICES.length);
});

