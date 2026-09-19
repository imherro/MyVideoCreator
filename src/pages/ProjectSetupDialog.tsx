import { useState } from "react";
import { BookOpen, ChevronRight, Film, LoaderCircle, Settings2, X } from "lucide-react";
import { GenerationPolicyPanel } from "../GenerationPolicyPanel";
import { VisualStylePicker } from "../VisualStylePicker";
import { CreationModePicker } from "../components/CreationModePicker";
import { DURATION_OPTIONS, PLATFORM_OPTIONS } from "../adaptation";
import { VIDEO_FORMATS, VIDEO_RATIOS, VIDEO_RESOLUTIONS } from "../mediaSpecs";
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
  const [draft, setDraft] = useState(() => defaultProjectSetupDraft(providers, localModels));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const modelSummary = ([['text','文本'],['image','图像'],['video','视频']] as const).map(([kind,label])=>{
    const target=draft.generationPolicy[kind];
    const provider=providers.find(item=>item.id===target?.providerId);
    return `${label} · ${provider?.name || (target?.providerId ? '已选择' : '未配置')}`;
  }).join(' / ');
  const bibleSummary=Object.values(draft.bible).some(value=>value?.trim())?'已填写创作约束':'可选，后续可在项目设置中补充';
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
            <CreationModePicker value={draft.creationMode} onChange={creationMode=>patch({creationMode})} disabled={busy}/>
            <label>作品名称 *<input autoFocus maxLength={100} value={draft.name} onChange={(event)=>patch({name:event.target.value})} placeholder="例如：花信未迟"/></label>
            <details className="setup-disclosure setup-specs">
            <summary><span><b>画面与视频规格</b><small>{draft.style} · {draft.ratio} · {draft.videoResolution} · 单集 {draft.duration || 0} 秒 · {draft.episodeCount || 0} 集</small></span><ChevronRight size={17}/></summary>
            <div className="setup-disclosure-body">
            <VisualStylePicker value={draft.style} onChange={(style)=>patch({style})}/>
            <div className="two-fields">
              <label>资产画幅 *<span tabIndex={0} title="用于场景、道具参考图和分镜图；新生成角色设定板固定为 1:1" aria-label="资产画幅说明：用于场景、道具参考图和分镜图；新生成角色设定板固定为 1:1" style={{cursor:"help",fontSize:12,opacity:0.7}}> ⓘ</span><select value={draft.ratio} onChange={(event)=>patch({ratio:event.target.value as ProjectSetupDraft["ratio"]})}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
              <label>单集目标时长（秒）*<input list="project-duration-options" type="number" min={5} max={3000} value={draft.duration} onChange={(event)=>patch({duration:Number(event.target.value)})}/><datalist id="project-duration-options">{DURATION_OPTIONS.map((value)=><option value={value} key={value}/>)}</datalist></label>
              <label>默认对白方式<select value={draft.dialogueMode} onChange={event=>patch({dialogueMode:event.target.value as ProjectSetupDraft['dialogueMode']})}><option value="voice_sample">音色样本参考（无需逐句合成）</option><option value="full_dialogue">完整对白参考（先合成对白）</option></select></label>
              <label>默认视频生成模式<select value={draft.videoReferenceMode} onChange={event=>patch({videoReferenceMode:event.target.value as ProjectSetupDraft['videoReferenceMode']})}><option value="multimodal">多模态参考（推荐）</option><option value="first_frame">严格首帧（高级）</option><option value="first_last_frame">严格首尾帧（高级）</option></select></label>
              <label>视频输出分辨率 *<select value={draft.videoResolution} onChange={(event)=>patch({videoResolution:event.target.value as ProjectSetupDraft["videoResolution"]})}>{VIDEO_RESOLUTIONS.map((value)=><option value={value} key={value}>{value.toUpperCase()}</option>)}</select></label>
              <label>视频宽高比 *<select value={draft.videoRatio} onChange={(event)=>patch({videoRatio:event.target.value as ProjectSetupDraft["videoRatio"]})}>{VIDEO_RATIOS.map((value)=><option value={value} key={value}>{value}</option>)}</select><small>{["first_frame","first_last_frame"].includes(draft.videoReferenceMode) ? "首帧／首尾帧模式下，视频比例跟随首帧图片。" : "视频的目标宽高比；adaptive 由模型决定。"}</small></label>
              <label>单镜输出时长策略 *<select value={draft.videoDuration} onChange={(event)=>patch({videoDuration:Number(event.target.value)})}><option value={-1}>-1（按分镜及对白自动）</option>{Array.from({length:27},(_,index)=>index+4).map((value)=><option value={value} key={value}>{value} 秒</option>)}</select></label>
              <label>视频格式 *<select value={draft.videoFormat} onChange={(event)=>patch({videoFormat:event.target.value as ProjectSetupDraft["videoFormat"]})}>{VIDEO_FORMATS.map((value)=><option value={value} key={value}>{value}</option>)}</select></label>
              <label>总集数 *<input type="number" min={1} max={500} value={draft.episodeCount} onChange={(event)=>patch({episodeCount:Number(event.target.value)})}/><small>原著章节数不等于成片集数，可按改编节奏设置。</small></label>
              <label>发布平台 *<select value={draft.platform} onChange={(event)=>patch({platform:event.target.value})}>{PLATFORM_OPTIONS.map((value)=><option value={value} key={value}>{value}</option>)}</select><small>用于 AI 判断节奏、钩子和付费卡点。</small></label>
            </div>
            </div>
            </details>
          </section>
          <section>
            <details className="setup-disclosure">
            <summary><span><b><Settings2 size={17}/> ② 默认模型</b><small>{modelSummary}</small></span><ChevronRight size={17}/></summary>
            <div className="setup-disclosure-body">
            <GenerationPolicyPanel value={draft.generationPolicy} modelPool={draft.modelPool} providers={providers} localModels={localModels} onChange={(generationPolicy)=>patch({generationPolicy})} onModelPoolChange={(modelPool)=>patch({modelPool})}/>
            </div>
            </details>
          </section>
          <section>
            <details className="setup-disclosure">
            <summary><span><b><BookOpen size={17}/> ③ Project Bible</b><small>{bibleSummary}</small></span><ChevronRight size={17}/></summary>
            <div className="setup-disclosure-body">
            <p className="muted">先写最小创作约束即可。这里不会生成角色、场景、图片或任务。</p>
            <div className="two-fields">
              <label>世界 / 时代<input value={draft.bible.worldEra} onChange={(event)=>patchBible("worldEra",event.target.value)}/></label>
              <label>视觉基调<input value={draft.bible.visualTone} onChange={(event)=>patchBible("visualTone",event.target.value)}/></label>
              <label>色彩 / 光线<input value={draft.bible.colorLighting} onChange={(event)=>patchBible("colorLighting",event.target.value)}/></label>
              <label>镜头语言<input value={draft.bible.cameraLanguage} onChange={(event)=>patchBible("cameraLanguage",event.target.value)}/></label>
            </div>
            <label>角色 / 场景一致性<textarea value={draft.bible.characterSceneConsistency} onChange={(event)=>patchBible("characterSceneConsistency",event.target.value)}/></label>
            <label>避免项（每行一项）<textarea value={draft.bible.avoidItems} onChange={(event)=>patchBible("avoidItems",event.target.value)}/></label>
            </div>
            </details>
          </section>
        </div>
        <footer>
          <div className="setup-summary"><b>{draft.name.trim() || "未填写作品名"}</b><span>{draft.episodeCount || 0} 集 · {draft.platform} · {draft.ratio} · {draft.videoResolution} · 单集 {draft.duration || 0} 秒</span></div>
          <div>{onClose && <button onClick={onClose} disabled={busy}>取消</button>}<button className="primary" onClick={create} disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:null}{draft.creationMode === "direct" ? "创建并写 EP01 剧本" : "创建并导入原著"}</button></div>
          {!!errors.length && <div className="error setup-errors">{errors.join("；")}</div>}
        </footer>
      </div>
    </div>
  );
}
