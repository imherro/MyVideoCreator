import { useEffect, useRef, useState } from 'react';
import { motionCharacters, supportsMotionReference, videoGenerationMode, type MotionReference } from '../motionReference.ts';
import { dialogueMode, dialogueModeLabels, voiceSampleRows } from '../dialogueMode.ts';

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
  const [preview, setPreview] = useState<Value | null>(null);
  const signature = JSON.stringify([props.shot, props.node?.data, props.document.videoDuration, props.document.videoReferenceMode, props.document.dialogueMode, props.document.filmBible, props.assets.map(a => a.id)]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  useEffect(() => { setPreview(null); setError(''); }, [signature]);
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
      const result = await props.onCompile();
      if (currentSignature.current === requestedSignature) setPreview(result);
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  const patch = (value: Partial<MotionReference>) => props.onPatch({ motionReference: { ...reference, ...value } });
  return <section className="motion-reference-editor" aria-label="镜头动作参考">
    <label>本镜头生成模式<select value={props.shot.videoReferenceMode || ''} onChange={event=>props.onPatch({videoReferenceMode:event.target.value || undefined})}><option value="">继承项目设置（{({multimodal:'多模态参考',first_frame:'严格首帧',first_last_frame:'严格首尾帧',legacy:'兼容历史'} as Value)[props.document.videoReferenceMode || 'legacy']}）</option><option value="multimodal">多模态参考</option><option value="first_frame">严格首帧（高级）</option><option value="first_last_frame">严格首尾帧（高级）</option></select></label>
    {mode === 'multimodal' && !supported && <p className="error">当前适配器尚未核实此模型的多模态协议。请选择已支持的火山方舟或 RunningHub 模型；不会自动切换供应商或降级。</p>}
    <label>本镜对白方式<select value={props.shot.dialogueMode || ''} onChange={event=>props.onPatch({dialogueMode:event.target.value || undefined})}><option value="">继承项目设置（{dialogueModeLabels[props.document.dialogueMode || 'full_dialogue']}）</option><option value="voice_sample">音色样本参考（无需逐句合成）</option><option value="full_dialogue">完整对白参考（先合成本镜对白）</option></select></label>
    {dialogueMode(props.document,props.shot) === 'voice_sample' && <div><p>只参考已确认样本的声线，台词和情绪取自本镜。样本不会作为成片对白，也不决定镜头时长。</p>
      {mode !== 'multimodal' && (props.shot.dialogues || []).some((line:Value)=>String(line.text || '').trim()) && <div><p className="error">音色样本需要多模态参考。切换后，起止画面由严格约束变为构图参考。</p><button disabled={props.busy} onClick={()=>props.onPatch({videoReferenceMode:'multimodal'})}>确认改用多模态参考</button></div>}
      {voiceSampleRows(props.document,props.shot,props.assets).map((row:Value)=><div key={row.cardId}><b>{row.name}</b> · {row.ready ? `已确认声音 V${row.profile.referenceVersion}` : '请到塑角造景确认角色声音参考'}{row.ready && <audio controls preload="none" src={row.asset.url} aria-label={`${row.name}声音参考试听`}/>}</div>)}
      {!(props.shot.dialogues || []).some((line:Value)=>String(line.text || '').trim()) && <small>本镜无对白，不提交角色音色样本。</small>}
    </div>}
    <div className="motion-reference-actions">
      <label>从项目素材选择动作参考<select aria-label="动作参考视频" disabled={working || props.busy} value={reference?.assetId || ''} onChange={e => bind(e.target.value)}>
        <option value="">不使用动作参考</option>
        {reference && !asset && <option value={reference.assetId}>素材已丢失或删除</option>}
        {props.assets.filter(a => a.kind === 'video' && !a.metadata?.motionDerivedFrom).map(a => <option key={a.id} value={a.id}>{a.name} · {Number(a.metadata?.duration || 0).toFixed(2)} 秒</option>)}
      </select></label>
      <label className="motion-upload">从电脑上传动作参考（MP4）<input aria-label="上传动作参考 MP4" type="file" accept=".mp4,video/mp4" disabled={working || props.busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/></label>
      {reference && <button disabled={working} onClick={() => bind('')}>移除绑定</button>}
    </div>
    {reference && <>
      {mode !== 'multimodal' && <div><p className="error">当前模式与动作视频不兼容。切换后起止画面约束将变为参考语义。</p><button onClick={()=>props.onPatch({videoReferenceMode:'multimodal'})}>确认改用多模态参考</button></div>}
      {asset && <div className="motion-reference-media"><video src={asset.url} controls preload="metadata"/><div><b>{asset.name}</b><small>参考 {Number(asset.metadata?.duration || 0).toFixed(2)} 秒 · {asset.metadata?.width} × {asset.metadata?.height}</small><small>镜头计划 {props.shot.duration} 秒；实际提交时长见下方编译预览。不同步时建议先在外部裁剪。</small></div></div>}
      {!supported && <p className="error">当前供应商/模型尚未核实动作视频协议，不能提交此绑定。请选择火山方舟 Seedance 2.0/2.5 或 RunningHub Seedance 2.5。</p>}
      {mode === 'multimodal' && props.node?.data?.end_asset_id && <p>原尾帧保留为结束构图参考，不再使用严格尾帧协议。</p>}
      <div className="domain-fields two">
        <label>动作执行角色<select value={reference.characterCardId || ''} onChange={e => patch({characterCardId:e.target.value || undefined})}><option value="">未指定（镜头主体）</option>{motionCharacters(props.document, props.shot).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>
        <label>摄像机模式<select value={reference.cameraMode} onChange={e => patch({cameraMode:e.target.value as MotionReference['cameraMode']})}><option value="use_shot_camera">使用本镜头运镜，只参考动作</option><option value="follow_reference">跟随参考视频运镜（优先）</option></select></label>
      </div>
      <label>动作补充说明<textarea rows={2} value={reference.description || ''} onChange={e => patch({description:e.target.value})} placeholder="例如：参考转身、抬头的动作顺序，保持机器人没有手臂"/></label>
    </>}
      <button disabled={working || props.busy || (mode === 'multimodal' && !supported)} onClick={() => void compile()}>{working ? '正在检查素材…' : '预览最终提交与参考清单（不生成）'}</button>
      {preview && <div className="motion-submission-preview"><b>镜头计划 {preview.planned_shot_duration} 秒 · {preview.motion_reference ? `动作参考 ${Number(preview.motion_reference.media?.duration).toFixed(2)} 秒` : '无动作参考'} · 实际提交 {preview.shot_duration} 秒</b>
        <p>选择模式：{preview.generation_mode?.requested} · 提交模式：{preview.generation_mode?.actual}</p>
        {preview.dialogue_mode && <p>对白方式：{dialogueModeLabels[preview.dialogue_mode.actual]}</p>}
        {(preview.voice_samples || []).map((sample:Value)=><p key={sample.characterCardId}>{sample.characterName} → @音频{sample.index} · 声音 V{sample.voiceVersion} · 仅参考音色</p>)}
        {(preview.motion_warnings || []).map((warning: string) => <p key={warning} className="warning">{warning}</p>)}
        <ol>{(preview.reference_manifest || []).map((item: Value) => <li key={`${item.kind}:${item.index}`}>@{({image:'图片',video:'视频',audio:'音频'} as Value)[item.kind]}{item.index} · {item.name}{item.audio === 'stripped' ? '（提交静音副本）' : ''}</li>)}</ol><pre>{preview.prompt}</pre>
      </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
