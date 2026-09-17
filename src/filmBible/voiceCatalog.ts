export type VoiceCatalogItem = {
  id: string;
  name: string;
  category: "通用" | "视频配音" | "角色扮演" | "有声阅读";
  featured?: boolean;
  legacy?: boolean;
};

export const DOUBAO_VOICE_LIST_URL = "https://www.volcengine.com/docs/6561/1257544";
export const CUSTOM_VOICE_ID = "__custom_voice_id__";
// Official TTS 2.0 / S2S-O2.0 catalog, verified 2026-09-17.
// Curated Chinese voices, not the complete multilingual catalog. Keep old IDs
// available explicitly: never migrate a saved or locked character voice silently.
export const DOUBAO_TTS2_VOICES: VoiceCatalogItem[] = [
  { id: "zh_female_vv_uranus_bigtts", name: "Vivi 2.0", category: "通用", featured: true },
  { id: "zh_female_xiaohe_uranus_bigtts", name: "小何 2.0", category: "通用", featured: true },
  { id: "zh_male_m191_uranus_bigtts", name: "云舟 2.0", category: "通用", featured: true },
  { id: "zh_male_taocheng_uranus_bigtts", name: "小天 2.0", category: "通用", featured: true },
  { id: "zh_male_liufei_uranus_bigtts", name: "刘飞 2.0", category: "通用" },
  { id: "zh_female_sophie_uranus_bigtts", name: "魅力苏菲 2.0", category: "通用" },
  { id: "zh_female_qingxinnvsheng_uranus_bigtts", name: "清新女声 2.0", category: "通用" },
  { id: "zh_female_tianmeixiaoyuan_uranus_bigtts", name: "甜美小源 2.0", category: "通用" },
  { id: "zh_female_tianmeitaozi_uranus_bigtts", name: "甜美桃子 2.0", category: "通用" },
  { id: "zh_female_shuangkuaisisi_uranus_bigtts", name: "爽快思思 2.0", category: "通用" },
  { id: "zh_female_linjianvhai_uranus_bigtts", name: "邻家女孩 2.0", category: "通用" },
  { id: "zh_male_shaonianzixin_uranus_bigtts", name: "少年梓辛 2.0", category: "通用" },
  { id: "zh_female_meilinvyou_uranus_bigtts", name: "魅力女友 2.0", category: "通用" },
  { id: "zh_female_wenroumama_uranus_bigtts", name: "温柔妈妈 2.0", category: "通用" },
  { id: "zh_male_jieshuoxiaoming_uranus_bigtts", name: "解说小明 2.0", category: "通用" },
  { id: "zh_female_tvbnv_uranus_bigtts", name: "TVB女声 2.0", category: "通用" },
  { id: "zh_male_yizhipiannan_uranus_bigtts", name: "译制片男 2.0", category: "通用" },
  { id: "zh_female_qiaopinv_uranus_bigtts", name: "俏皮女声 2.0", category: "通用" },
  { id: "zh_male_linjiananhai_uranus_bigtts", name: "邻家男孩 2.0", category: "通用" },
  { id: "zh_male_ruyaqingnian_uranus_bigtts", name: "儒雅青年 2.0", category: "通用" },
  { id: "zh_male_wennuanahu_uranus_bigtts", name: "温暖阿虎 2.0", category: "通用" },
  { id: "zh_male_naiqimengwa_uranus_bigtts", name: "奶气萌娃 2.0", category: "通用" },
  { id: "zh_female_popo_uranus_bigtts", name: "婆婆 2.0", category: "通用" },
  { id: "zh_female_gaolengyujie_uranus_bigtts", name: "高冷御姐 2.0", category: "通用" },
  { id: "zh_male_aojiaobazong_uranus_bigtts", name: "傲娇霸总 2.0", category: "通用" },
  { id: "zh_male_fanjuanqingnian_uranus_bigtts", name: "反卷青年 2.0", category: "通用" },
  { id: "zh_female_wenroushunv_uranus_bigtts", name: "温柔淑女 2.0", category: "通用" },
  { id: "zh_male_huolixiaoge_uranus_bigtts", name: "活力小哥 2.0", category: "通用" },
  { id: "zh_female_cancan_uranus_bigtts", name: "知性灿灿 2.0", category: "角色扮演" },
  { id: "zh_female_sajiaoxuemei_uranus_bigtts", name: "撒娇学妹 2.0", category: "角色扮演" },
  { id: "zh_male_qingcang_uranus_bigtts", name: "擎苍 2.0", category: "角色扮演" },
  { id: "zh_female_gufengshaoyu_uranus_bigtts", name: "古风少御 2.0", category: "角色扮演" },
  { id: "zh_male_dayi_uranus_bigtts", name: "大壹 2.0", category: "视频配音" },
  { id: "zh_female_mizai_uranus_bigtts", name: "黑猫侦探社咪仔 2.0", category: "视频配音" },
  { id: "zh_female_jitangnv_uranus_bigtts", name: "鸡汤女 2.0", category: "视频配音" },
  { id: "zh_female_liuchangnv_uranus_bigtts", name: "流畅女声 2.0", category: "视频配音" },
  { id: "zh_male_ruyayichen_uranus_bigtts", name: "儒雅逸辰 2.0", category: "视频配音" },
  { id: "zh_female_xiaoxue_uranus_bigtts", name: "儿童绘本 2.0", category: "有声阅读" },
  { id: "zh_male_baqiqingshu_uranus_bigtts", name: "霸气青叔 2.0", category: "有声阅读" },
  { id: "zh_male_dayi_saturn_bigtts", name: "大壹 · 沉稳男声", category: "视频配音", legacy: true },
  { id: "zh_female_mizai_saturn_bigtts", name: "黑猫侦探社咪仔", category: "视频配音", legacy: true },
  { id: "zh_female_jitangnv_saturn_bigtts", name: "鸡汤女", category: "视频配音", legacy: true },
  { id: "zh_female_meilinvyou_saturn_bigtts", name: "魅力女友", category: "视频配音", legacy: true },
  { id: "zh_female_santongyongns_saturn_bigtts", name: "流畅女声", category: "视频配音", legacy: true },
  { id: "zh_male_ruyayichen_saturn_bigtts", name: "儒雅逸辰", category: "视频配音", legacy: true },
  { id: "ICL_zh_female_keainvsheng_tob", name: "可爱女生", category: "角色扮演", legacy: true },
  { id: "ICL_zh_female_tiaopigongzhu_tob", name: "调皮公主", category: "角色扮演", legacy: true },
  { id: "zh_female_xueayi_saturn_bigtts", name: "儿童绘本", category: "有声阅读", legacy: true },
];

export function catalogVoice(id: string) {
  return DOUBAO_TTS2_VOICES.find((voice) => voice.id === id);
}

export function filterVoices(query = "", category = "全部") {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return DOUBAO_TTS2_VOICES.filter(voice => {
    const categoryMatch = category === "历史音色" ? voice.legacy
      : !voice.legacy && (category === "全部" || voice.category === category);
    const text = `${voice.name} ${voice.id} ${voice.category} ${voice.id.includes("female") ? "女声" : "男声"}`.toLocaleLowerCase();
    return categoryMatch && words.every(word => text.includes(word));
  });
}
