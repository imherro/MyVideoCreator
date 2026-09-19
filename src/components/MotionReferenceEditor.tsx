import { needsComposition } from '../shotComposition.ts';
import { ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from 'react';
import { motionCharacters, supportsMotionReference, videoGenerationMode, type MotionReference } from '../motionReference.ts';
import { dialogueMode, dialogueModeLabels } from '../dialogueMode.ts';

type Value = Record<string, any>;
type Props = {
  shot: Value; document: Value; assets: Value[]; provider?: Value; node?: Value;
  busy: boolean;
  onPatch: (patch: Value) => void;
  onUpload: (file: File) => Promise<Value>;
  onCompile: () => Promise<Value>;
};

export function MotionReferenceEditor(props: Props) {
  const reference = props.shot.motionReference as MotionReference | undefined;
  const mode = videoGenerationMode(props.document, props.shot);
  const asset = props.assets.find(a => a.id === reference?.assetId);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<Value | null>(null);
  const signature = JSON.stringify([props.shot, props.node?.data, props.document.videoRatio, props.document.videoDuration, props.document.videoReferenceMode, props.document.dialogueMode, props.document.filmBible, props.assets.map(a => [a.id,a.category])]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  useEffect(() => { setPreview(null); setError(''); }, [signature]);
  const compileCallback = useRef(props.onCompile);
  compileCallback.current = props.onCompile;
  const supported = supportsMotionReference(props.provider, String(props.node?.data?.model || ''));
  function bind(assetId: string) {
    props.onPatch({ motionReference: assetId ? {
      assetId, cameraMode: reference?.cameraMode || 'use_shot_camera',
      characterCardId: reference?.characterCardId, description: reference?.description || '',
    } : null });
  }
  async function upload(file?: File) {
    if (!file) return;
    setWorking(true); setError('');
    try { const value = await props.onUpload(file); bind(value.id); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  async function compile() {
    setWorking(true); setError('');
    const requestedSignature = signature;
    try {
      const result = await compileCallback.current();
      if (currentSignature.current === requestedSignature) setPreview(result);
    }
    catch (e) { if (currentSignature.current === requestedSignature) setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  useEffect(() => {
    // Compiling the preview does not submit a generation job. Keep it available
    // while a video task is queued/running; busy still guards asset mutations.
    if (!previewOpen) return;
    const timer = window.setTimeout(() => { void compile(); }, 700);
    return () => window.clearTimeout(timer);
  }, [signature, previewOpen]);
  const patch = (value: Partial<MotionReference>) => props.onPatch({ motionReference: { ...reference, ...value } });
  return <section className="motion-reference-editor" aria-label="镜头动作参考">
    <div className="motion-reference-actions">
    <label>镜头制作方式<select disabled={props.busy || mode !== 'multimodal'} value={needsComposition(props.document, props.shot) ? 'preview' : 'direct'} onChange={event=>props.onPatch({compositionMode:event.target.value})}><option value="direct">直接生成视频（默认）</option><option value="preview">先看构图再拍视频</option></select></label>
    <label>本镜头生成模式<select value={props.shot.videoReferenceMode || ''} onChange={event=>props.onPatch({videoReferenceMode:event.target.value || undefined})}><option value="">继承项目设置（{({multimodal:'多模态参考',first_frame:'严格首帧',first_last_frame:'严格首尾帧',legacy:'兼容历史'} as Value)[props.document.videoReferenceMode || 'legacy']}）</option><option value="multimodal">多模态参考</option><option value="first_frame">严格首帧（高级）</option><option value="first_last_frame">严格首尾帧（高级）</option></select></label>
    <label>本镜对白方式<select value={props.shot.dialogueMode || ''} onChange={event=>props.onPatch({dialogueMode:event.target.value || undefined})}><option value="">继承项目设置（{dialogueModeLabels[props.document.dialogueMode || 'full_dialogue']}）</option><option value="voice_sample">音色样本参考（无需逐句合成）</option><option value="full_dialogue">完整对白参考（先合成本镜对白）</option></select></label>
      <label>从项目素材选择动作参考（支持白模）<select aria-label="动作参考视频" disabled={working || props.busy} value={reference?.assetId || ''} onChange={e => bind(e.target.value)}>
        <option value="">不使用动作参考</option>
        {reference && (!asset || asset.category !== "motion_reference") && <option value={reference.assetId}>{asset ? `${asset.name}（历史绑定）` : "素材已丢失或删除"}</option>}
        {props.assets.filter(a => a.kind === 'video' && a.category === 'motion_reference' && !a.metadata?.motionDerivedFrom).map(a => <option key={a.id} value={a.id}>{a.name} · {Number(a.metadata?.duration || 0).toFixed(2)} 秒</option>)}
      </select></label>
      <label className="motion-upload">从电脑上传动作参考（MP4）<input aria-label="上传动作参考 MP4" type="file" accept=".mp4,video/mp4" disabled={working || props.busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/></label>
      {reference && <button disabled={working} onClick={() => bind('')}>移除绑定</button>}
    </div>


    {mode === 'multimodal' && !supported && <p className="error">当前适配器尚未核实此模型的多模态协议。请选择已支持的火山方舟、幻场 AI 或 RunningHub 模型；不会自动切换供应商或降级。</p>}

    {dialogueMode(props.document,props.shot) === 'voice_sample' && <div>
      {mode !== 'multimodal' && (props.shot.dialogues || []).some((line:Value)=>String(line.text || '').trim()) && <div><p className="error">音色样本需要多模态参考。切换后，起止画面由严格约束变为构图参考。</p><button disabled={props.busy} onClick={()=>props.onPatch({videoReferenceMode:'multimodal'})}>确认改用多模态参考</button></div>}
    </div>}
    {reference && <>
      {mode !== 'multimodal' && <div><p className="error">当前模式与动作视频不兼容。切换后起止画面约束将变为参考语义。</p><button onClick={()=>props.onPatch({videoReferenceMode:'multimodal'})}>确认改用多模态参考</button></div>}
      {asset && <div className="motion-reference-media"><video src={asset.url} controls preload="metadata"/><div><b>{asset.name}</b><small>参考 {Number(asset.metadata?.duration || 0).toFixed(2)} 秒 · {asset.metadata?.width} × {asset.metadata?.height}</small><small>镜头计划 {props.shot.duration} 秒；实际提交时长见下方编译预览。不同步时建议先在外部裁剪。</small></div></div>}
      {!supported && <p className="error">当前供应商/模型尚未核实动作视频协议，不能提交此绑定。请选择火山方舟或幻场 AI Seedance 2.0/2.5，或 RunningHub Seedance 2.5。</p>}
      {mode === 'multimodal' && props.node?.data?.end_asset_id && <p>原尾帧保留为结束构图参考，不再使用严格尾帧协议。</p>}
      <div className="domain-fields two">
        <label>动作执行角色<select value={reference.characterCardId || ''} onChange={e => patch({characterCardId:e.target.value || undefined})}><option value="">未指定（镜头主体）</option>{motionCharacters(props.document, props.shot).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>
        <label>摄像机模式<select value={reference.cameraMode} onChange={e => patch({cameraMode:e.target.value as MotionReference['cameraMode']})}><option value="use_shot_camera">使用本镜头运镜，只参考动作</option><option value="follow_reference">跟随参考视频运镜（优先）</option></select></label>
      </div>
      <label>动作补充说明<textarea rows={2} value={reference.description || ''} onChange={e => patch({description:e.target.value})} placeholder="例如：参考转身、抬头的动作顺序，保持机器人没有手臂"/></label>
    </>}
      <div className="motion-preview-heading"><button type="button" className="motion-preview-toggle" aria-expanded={previewOpen} onClick={() => setPreviewOpen(value => !value)}><ChevronDown size={15} style={{transform: previewOpen ? undefined : "rotate(-90deg)"}}/><span>最终提交与参考清单</span></button><button className="icon-button" type="button" title="刷新最终提交与参考清单" aria-label="刷新最终提交与参考清单" disabled={working || (mode === 'multimodal' && !supported)} onClick={() => { if (!previewOpen) setPreviewOpen(true); else void compile(); }}><RefreshCw size={15} className={working ? 'spin' : ''}/></button>{working && <small role="status">正在更新…</small>}</div>
      {previewOpen && <>
      {!preview && !error && <p>{working ? "正在加载参考素材与提示词…" : "等待预览…"}</p>}
      {preview && <div className="motion-submission-preview">
        <div className="motion-preview-facts"><span>视频画幅 <b>{preview.video_ratio_selection?.actual==='first_frame'?'跟随首帧':preview.ratio}</b></span>
          <span>镜头计划 <b>{preview.planned_shot_duration} 秒</b></span>
          <span>实际提交 <b>{preview.shot_duration} 秒</b></span>
          {preview.motion_reference && <span>动作参考 <b>{Number(preview.motion_reference.media?.duration).toFixed(2)} 秒</b></span>}
          {preview.composition_mode && <span>制作方式 <b>{preview.composition_mode === "direct" ? "直接生成视频" : "先看构图再拍视频"}</b></span>}
          <span>生成模式 <b>{({multimodal:'多模态参考',first_frame:'严格首帧',first_last_frame:'严格首尾帧',legacy:'兼容历史'} as Value)[preview.generation_mode?.actual] || preview.generation_mode?.actual}</b></span>
          {preview.generation_mode?.requested !== preview.generation_mode?.actual && <span>选择模式 <b>{preview.generation_mode?.requested}</b></span>}
          {preview.dialogue_mode && <span>对白 <b>{dialogueModeLabels[preview.dialogue_mode.actual]}</b></span>}
        </div>
        {(preview.voice_samples || []).map((sample:Value)=><p key={sample.characterCardId}>{sample.characterName} → @音频{sample.index} · 声音 V{sample.voiceVersion} · {sample.source === "uploaded" ? "上传声音" : "豆包音色"} · {sample.media?.duration} 秒</p>)}
        {(preview.motion_warnings || []).map((warning: string) => <p key={warning} className="warning">{warning}</p>)}
        <div className="motion-inline-prompt">{String(preview.prompt || '').split(/\r?\n/).map((line, lineIndex) => {
          if (!line.trim()) return <div className="motion-prompt-gap" key={lineIndex}/>;
          if (/^\[\/[^\]]+\]$/.test(line.trim())) return null;
          if (/^\[[^\]]+\]$/.test(line.trim())) return <h5 key={lineIndex}>{line.trim().slice(1, -1)}</h5>;
          return <p className={/^@?(?:图片|图|视频|音频)\d+/.test(line.trim()) ? 'motion-prompt-reference-line' : ''} key={lineIndex}>{line.split(/(@?(?:图片|图|视频|音频)\d+)/g).map((part, index) => {
          const match = /^@?(图片|图|视频|音频)(\d+)$/.exec(part);
          if (!match) return part;
          const kind = ({图片:'image',图:'image',视频:'video',音频:'audio'} as Value)[match[1]];
          const item = (preview.reference_manifest || []).find((entry: Value) => entry.kind === kind && Number(entry.index) === Number(match[2]));
          const media = item && (props.assets.find(a => a.id === item.assetId) || (kind === 'video' ? asset : undefined));
          return media?.url ? <InlineReference key={`${index}:${media.id}`} label={part} kind={kind} name={item.name || media.name} url={media.url}/> : part;
        })}</p>;
        })}</div>
      </div>}
      </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function InlineReference({label, kind, name, url}: {label: string; kind: string; name: string; url: string}) {
  const [open, setOpen] = useState(false);
  return <span className={`motion-inline-reference${open ? ' is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    <button type="button" aria-label={`预览${label}：${name}`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {kind === 'image' ? <img src={url} alt="" loading="lazy"/> : <span className="motion-inline-play" aria-hidden="true">▶</span>}
      <span>{label}</span>
    </button>
    <span className="motion-inline-popover">
      <strong>{name}</strong>
      {kind === 'image' ? <img src={url} alt={name} loading="lazy"/> : kind === 'video' ? <video src={url} controls preload="none"/> : <audio src={url} controls preload="none"/>}
    </span>
  </span>;
}
