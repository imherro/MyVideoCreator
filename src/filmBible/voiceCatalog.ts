export type VoiceCatalogItem = {
  id: string;
  name: string;
  category: "通用" | "视频配音" | "角色扮演" | "有声阅读";
};

// Curated from the public Doubao Speech TTS 2.0 voice list. Custom and cloned
// Speaker IDs remain supported because account-specific voices cannot be
// discovered without a separate voice-management integration.
export const DOUBAO_TTS2_VOICES: VoiceCatalogItem[] = [
  { id: "zh_female_vv_uranus_bigtts", name: "Vivi 2.0 · 活泼灵动女声", category: "通用" },
  { id: "zh_male_dayi_saturn_bigtts", name: "大壹 · 沉稳男声", category: "视频配音" },
  { id: "zh_female_mizai_saturn_bigtts", name: "黑猫侦探社咪仔", category: "视频配音" },
  { id: "zh_female_jitangnv_saturn_bigtts", name: "鸡汤女", category: "视频配音" },
  { id: "zh_female_meilinvyou_saturn_bigtts", name: "魅力女友", category: "视频配音" },
  { id: "zh_female_santongyongns_saturn_bigtts", name: "流畅女声", category: "视频配音" },
  { id: "zh_male_ruyayichen_saturn_bigtts", name: "儒雅逸辰", category: "视频配音" },
  { id: "ICL_zh_female_keainvsheng_tob", name: "可爱女生", category: "角色扮演" },
  { id: "ICL_zh_female_tiaopigongzhu_tob", name: "调皮公主", category: "角色扮演" },
  { id: "zh_female_xueayi_saturn_bigtts", name: "儿童绘本", category: "有声阅读" },
];

export const CUSTOM_VOICE_ID = "__custom_voice_id__";

export function catalogVoice(id: string) {
  return DOUBAO_TTS2_VOICES.find((voice) => voice.id === id);
}

