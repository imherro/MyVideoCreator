import { VISUAL_STYLE_PRESETS } from "./visualStyles";

export function VisualStylePicker({
  value,
  onChange,
  label = "视觉风格 *",
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <div className="visual-style-picker">
      <label>{label}
        <input
          maxLength={200}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="选择常用风格，或输入自定义风格描述"
        />
      </label>
      <div className="visual-style-presets" aria-label="常用视觉风格">
        {VISUAL_STYLE_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={value === preset.name ? "active" : ""}
            title={preset.prompt}
            aria-pressed={value === preset.name}
            onClick={() => onChange(preset.name)}
          >
            {preset.name}
          </button>
        ))}
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}
