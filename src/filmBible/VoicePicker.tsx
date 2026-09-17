import React, { useId, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { catalogVoice, DOUBAO_VOICE_LIST_URL, filterVoices } from "./voiceCatalog.ts";

export function VoicePicker({ value, disabled, onChange }: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [manual, setManual] = useState(!catalogVoice(value));
  const panelId = useId();
  const selected = catalogVoice(value);
  const voices = filterVoices(query, category);
  return <div className="voice-picker full">
    <button type="button" className="voice-picker-trigger" disabled={disabled}
      aria-expanded={open && !disabled} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <span><small>豆包音色</small><b>{selected?.name || (value ? "自定义音色" : "选择音色")}</b></span>
      <span>{disabled ? "暂不可更换" : "更换音色"}<ChevronDown size={14}/></span>
    </button>
    {open && !disabled && <div id={panelId} className="voice-picker-panel" onKeyDown={event => {
      if (event.key === "Escape") { setOpen(false); event.stopPropagation(); }
    }}>
      <label className="voice-picker-search"><Search size={14}/><input autoFocus aria-label="搜索豆包音色"
        placeholder="搜索名称、男声 / 女声、Speaker ID" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="voice-picker-filters" aria-label="音色分类">
        {["全部", "通用", "角色扮演", "视频配音", "有声阅读", "历史音色"].map(item => <button
          type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <div className="voice-picker-results" aria-label="音色选择">
        {voices.map(voice => <button type="button" key={voice.id} aria-pressed={value === voice.id} title={voice.id}
          onClick={() => { onChange(voice.id); setManual(false); setOpen(false); }}>
          <span><b>{voice.name}</b><small>{voice.id.includes("female") ? "女声" : "男声"} · {voice.category}{voice.featured ? " · 主打" : ""}</small></span>
          {value === voice.id && <Check size={15}/>}
        </button>)}
        {!voices.length && <p className="muted">没有匹配音色，换个关键词试试，或手动填写 ID。</p>}
      </div>
      <div className="voice-picker-footer"><small>{voices.length} 个音色</small><button type="button" className="quiet"
        onClick={() => { setManual(true); setOpen(false); }}>手动填写 / 声音复刻 ID</button></div>
    </div>}
    {(manual || !selected) && <label className="voice-picker-custom">自定义 Speaker ID
      <input value={value} disabled={disabled} placeholder="粘贴官方音色或声音复刻 ID" onChange={event => onChange(event.target.value)}/>
      <small>更多音色可查阅 <a href={DOUBAO_VOICE_LIST_URL} target="_blank" rel="noopener noreferrer">官方目录 ↗</a></small>
    </label>}
  </div>;
}
