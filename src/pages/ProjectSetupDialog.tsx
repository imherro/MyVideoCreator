import { useState } from "react";
import { BookOpen, Film, LoaderCircle, Settings2, X } from "lucide-react";
import { GenerationPolicyPanel } from "../GenerationPolicyPanel";
import {
  defaultProjectSetupDraft,
  validateProjectSetupDraft,
  type ProjectSetupDraft,
} from "../projectSetup";

type Value = Record<string, any>;

export function ProjectSetupDialog({
  providers,
  localModels,
  onClose,
  onCreate,
}: {
  providers: Value[];
  localModels: Value[];
  onClose?: () => void;
  onCreate: (draft: ProjectSetupDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => defaultProjectSetupDraft(providers));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const patch = (value: Partial<ProjectSetupDraft>) => setDraft((current) => ({ ...current, ...value }));
  const patchBible = (key: keyof ProjectSetupDraft["bible"], value: string) =>
    setDraft((current) => ({ ...current, bible: { ...current.bible, [key]: value } }));
  const create = async () => {
    const nextErrors = validateProjectSetupDraft(draft);
    setErrors(nextErrors);
    if (nextErrors.length) return;
    setBusy(true);
    try { await onCreate(draft); }
    catch (error: any) { setErrors([error?.message || String(error)]); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay project-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="project-setup-title">
      <div className="project-setup-dialog">
        <header>
          <div><span className="eyebrow">NEW PRODUCTION</span><h2 id="project-setup-title">创建一部新作品</h2></div>
          {onClose && <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19}/></button>}
        </header>
        <div className="project-setup-content">
          <section>
            <h3><Film size={17}/> ① 基本信息</h3>
            <div className="two-fields">
              <label>作品名称 *<input autoFocus maxLength={100} value={draft.name} onChange={(event)=>patch({name:event.target.value})} placeholder="例如：花信未迟"/></label>
              <label>EP01 标题<input maxLength={100} value={draft.episodeTitle} onChange={(event)=>patch({episodeTitle:event.target.value})}/></label>
            </div>
            <div className="three-fields">
              <label>视觉风格 *<input maxLength={200} value={draft.style} onChange={(event)=>patch({style:event.target.value})} list="project-style-presets"/><datalist id="project-style-presets"><option value="电影写实"/></datalist></label>
              <label>画幅 *<select value={draft.ratio} onChange={(event)=>patch({ratio:event.target.value as ProjectSetupDraft["ratio"]})}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
              <label>目标时长（秒）*<input type="number" min={5} max={3000} value={draft.duration} onChange={(event)=>patch({duration:Number(event.target.value)})}/></label>
            </div>
            <label>创作简介<textarea value={draft.brief} onChange={(event)=>patch({brief:event.target.value})} placeholder="故事主题、人物关系或本集目标"/></label>
          </section>
          <section>
            <h3><Settings2 size={17}/> ② 默认模型</h3>
            <GenerationPolicyPanel value={draft.generationPolicy} providers={providers} localModels={localModels} onChange={(generationPolicy)=>patch({generationPolicy})}/>
          </section>
          <section>
            <h3><BookOpen size={17}/> ③ Project Bible</h3>
            <p className="muted">先写最小创作约束即可。这里不会生成角色、场景、图片或任务。</p>
            <div className="two-fields">
              <label>世界 / 时代<input value={draft.bible.worldEra} onChange={(event)=>patchBible("worldEra",event.target.value)}/></label>
              <label>视觉基调<input value={draft.bible.visualTone} onChange={(event)=>patchBible("visualTone",event.target.value)}/></label>
              <label>色彩 / 光线<input value={draft.bible.colorLighting} onChange={(event)=>patchBible("colorLighting",event.target.value)}/></label>
              <label>镜头语言<input value={draft.bible.cameraLanguage} onChange={(event)=>patchBible("cameraLanguage",event.target.value)}/></label>
            </div>
            <label>角色 / 场景一致性<textarea value={draft.bible.characterSceneConsistency} onChange={(event)=>patchBible("characterSceneConsistency",event.target.value)}/></label>
            <label>避免项（每行一项）<textarea value={draft.bible.avoidItems} onChange={(event)=>patchBible("avoidItems",event.target.value)}/></label>
          </section>
        </div>
        <footer>
          <div className="setup-summary"><b>{draft.name.trim() || "未填写作品名"}</b><span>{draft.episodeTitle || "第 01 集"} · {draft.style} · {draft.ratio} · {draft.duration || 0} 秒</span></div>
          <div>{onClose && <button onClick={onClose} disabled={busy}>取消</button>}<button className="primary" onClick={create} disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:null}创建并进入 EP01</button></div>
          {!!errors.length && <div className="error setup-errors">{errors.join("；")}</div>}
        </footer>
      </div>
    </div>
  );
}
