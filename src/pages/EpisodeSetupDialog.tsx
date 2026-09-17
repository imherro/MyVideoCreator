import { useState } from "react";
import { CreationModePicker } from "../components/CreationModePicker";

export function EpisodeSetupDialog({name, next, defaultMode, onClose, onCreate}: {
  name: string; next: number; defaultMode: string;
  onClose: () => void; onCreate: (title: string, mode: "direct" | "adaptation") => Promise<void>;
}) {
  const [title, setTitle] = useState(`第 ${String(next).padStart(2,"0")} 集`);
  const [mode, setMode] = useState<"direct" | "adaptation">(defaultMode === "adaptation" ? "adaptation" : "direct");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="episode-setup-title">
    <section className="episode-setup-dialog">
      <h2 id="episode-setup-title">新增 EP{String(next).padStart(2,"0")}</h2><p>{name}</p>
      <label>本集名称<input autoFocus value={title} maxLength={100} onChange={event=>setTitle(event.target.value)}/></label>
      <CreationModePicker value={mode} onChange={setMode} disabled={busy}/>
      <p className="muted">继承作品模型、Bible 和已有分集的制作规格。</p>
      {error && <p className="error">{error}</p>}
      <div className="settings-actions"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await onCreate(title,mode);}catch(error:any){setError(error.message);}finally{setBusy(false);}}}>{busy ? "创建中…" : "创建并开始"}</button></div>
    </section>
  </div>;
}
