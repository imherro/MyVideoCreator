import { useState } from "react";

export function TrashConfirmDialog({ name, whole, onClose, onConfirm }: {
  name: string;
  whole: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [entered, setEntered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-overlay"><form className="trash-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="trash-confirm-title" onSubmit={async event => {
    event.preventDefault();
    if (busy || entered.trim() !== name) return;
    setBusy(true); setError("");
    try { await onConfirm(); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "移入回收站失败，请重试"); }
    finally { setBusy(false); }
  }}>
    <h2 id="trash-confirm-title">{whole ? "整部作品" : "当前制作集"}移入回收站</h2>
    <p>{whole ? "整部作品及其所有制作集将隐藏，剧本、素材和 Bible 会保留，可在回收站恢复。" : "仅隐藏这一集，不影响其他集，可在回收站恢复。"}</p>
    <label>请输入名称「{name}」确认<input autoFocus value={entered} onChange={event => setEntered(event.target.value)} disabled={busy}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="danger" disabled={busy || entered.trim() !== name}>{busy ? "正在移入…" : "移入回收站"}</button></footer>
  </form></div>;
}
