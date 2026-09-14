export type VisualStylePreset = {
  name: string;
  prompt: string;
};

export const VISUAL_STYLE_PRESETS: VisualStylePreset[] = [
  { name: "电影写实", prompt: "电影写实，真实材质，自然肤质，电影级布光与景深" },
  {
    name: "东方仙侠·半写实电影",
    prompt: "东方仙侠电影质感，半写实真人风格，影视级角色设计，精致东方五官，真实皮肤纹理与丝绸服饰，电影级布光，浅景深，宏大仙侠世界，轻度 AI 漫剧美学，非卡通、非传统 3D 动画",
  },
  { name: "国风写实", prompt: "国风写实，东方美学，克制色彩，细腻自然光影" },
  { name: "日系动漫", prompt: "日系动漫，清晰线稿，赛璐璐上色，富有表现力的角色设计" },
  { name: "3D 卡通", prompt: "3D 卡通，精致角色建模，柔和材质，动画电影级灯光" },
  { name: "赛博朋克", prompt: "赛博朋克，霓虹夜景，高科技低生活，冷暖对比光" },
  { name: "水墨动画", prompt: "水墨动画，宣纸肌理，写意留白，墨色晕染与东方构图" },
  { name: "复古胶片", prompt: "复古胶片，柔和颗粒，低饱和色彩，年代感光影与镜头质感" },
  { name: "黑白电影", prompt: "黑白电影，高反差光影，银盐颗粒，经典电影构图" },
  { name: "粘土动画", prompt: "粘土定格动画，手工塑形质感，微缩布景，柔和棚拍灯光" },
  { name: "绘本插画", prompt: "绘本插画，手绘笔触，温暖配色，富有叙事感的平面构图" },
  { name: "纪录片写实", prompt: "纪录片写实，自然环境光，手持摄影感，真实生活细节" },
];

export function visualStylePrompt(name: string): string {
  return VISUAL_STYLE_PRESETS.find((preset) => preset.name === name)?.prompt || name;
}
