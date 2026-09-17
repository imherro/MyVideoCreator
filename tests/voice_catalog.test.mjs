import test from "node:test";
import assert from "node:assert/strict";
import { catalogVoice, DOUBAO_TTS2_VOICES, filterVoices } from "../src/filmBible/voiceCatalog.ts";

test("Doubao TTS 2.0 catalog exposes named presets while allowing custom ids", () => {
  assert.ok(DOUBAO_TTS2_VOICES.length >= 40);
  assert.equal(catalogVoice("zh_female_vv_uranus_bigtts")?.name, "Vivi 2.0");
  assert.equal(catalogVoice("cloned-speaker-id"), undefined);
  assert.ok(DOUBAO_TTS2_VOICES.some((voice) => voice.category === "角色扮演"));
  assert.equal(new Set(DOUBAO_TTS2_VOICES.map((voice) => voice.id)).size, DOUBAO_TTS2_VOICES.length);
});

test("featured voices use official TTS 2.0 IDs; old saved IDs remain resolvable", () => {
  assert.deepEqual(DOUBAO_TTS2_VOICES.filter(v => v.featured).map(v => [v.name, v.id]), [
    ["Vivi 2.0", "zh_female_vv_uranus_bigtts"], ["小何 2.0", "zh_female_xiaohe_uranus_bigtts"],
    ["云舟 2.0", "zh_male_m191_uranus_bigtts"], ["小天 2.0", "zh_male_taocheng_uranus_bigtts"],
  ]);
  assert.ok(filterVoices("", "通用").length >= 24);
  assert.equal(catalogVoice("zh_male_dayi_saturn_bigtts")?.legacy, true);
  assert.equal(filterVoices("", "历史音色").length, 9);
  assert.ok(filterVoices().every(v => !v.legacy));
});

test("catalog search combines category, gender, names and case-insensitive Speaker IDs", () => {
  assert.equal(filterVoices("  VIVI ", "通用")[0].name, "Vivi 2.0");
  assert.equal(filterVoices("小天 男声")[0].id, "zh_male_taocheng_uranus_bigtts");
  assert.equal(filterVoices("小天 女声").length, 0);
  assert.equal(filterVoices("小天", "角色扮演").length, 0);
  assert.equal(filterVoices("ZH_FEMALE_XIAOHE_URANUS")[0].name, "小何 2.0");
});
