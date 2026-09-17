import presets from "../shared/visual_styles.json" with { type: "json" };

export type VisualStylePreset = {
  name: string;
  prompt: string;
};

export const VISUAL_STYLE_PRESETS: VisualStylePreset[] = presets;

export function visualStylePrompt(name: string): string {
  return VISUAL_STYLE_PRESETS.find((preset) => preset.name === name)?.prompt || name;
}
