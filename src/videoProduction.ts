import { effectiveVoiceProfile } from './filmBible/voices.ts';
import { voiceCardId } from './filmBible/voiceResolution.ts';
import { requiresInitialStateReview } from "./graph.ts";
import { shotIdentity } from "./storyboard.ts";
import { supportsMotionReference, videoGenerationMode } from "./motionReference.ts";
import { dialogueMode, voiceSampleRows } from './dialogueMode.ts';

type Value = Record<string, any>;

export type VideoProductionStatus =
  | "ready"
  | "generating"
  | "failed"
  | "stale"
  | "complete"
  | "blocked";

export type VideoProductionRow = {
  uid: string;
  index: number;
  shot: Value;
  imageNode?: Value;
  videoNode?: Value;
  firstFrame?: Value;
  endFrame?: Value;
  videoAsset?: Value;
  job?: Value;
  provider?: Value;
  status: VideoProductionStatus;
  readinessReason: string;
  endFrameSupported: boolean;
  dialogueAudioAssets: Value[];
  plannedDuration: number;
  effectiveDuration: number;
  submissionDuration: number;
};

function latestJob(jobs: Value[], nodeId?: string) {
  if (!nodeId) return undefined;
  return jobs
    .filter((item) => item.node_id === nodeId)
    .sort((left, right) => Number(right.created || 0) - Number(left.created || 0))[0];
}

export function shotVideoNodeId(shot: Value) {
  return String(shot.videoNode || shot.pipeline?.videoNodeId || "");
}

export function shotImageNodeId(shot: Value) {
  return String(shot.imageNode || shot.pipeline?.imageNodeId || "");
}

export function deriveVideoProductionRows(
  document: Value,
  assets: Value[],
  jobs: Value[],
  providers: Value[],
  modelCapabilities: Record<string, Value> = {},
): VideoProductionRow[] {
  const nodes = new Map<string, Value>((document.nodes || []).map((node: Value) => [node.id, node]));
  const assetMap = new Map<string, Value>(assets.map((asset) => [asset.id, asset]));
  const providerMap = new Map<string, Value>(providers.map((provider) => [provider.id, provider]));

  return (document.shots || []).map((shot: Value, index: number) => {
    const imageNode = nodes.get(shotImageNodeId(shot));
    const videoNode = nodes.get(shotVideoNodeId(shot));
    const firstFrame = imageNode?.data?.assetId ? assetMap.get(imageNode.data.assetId) : undefined;
    const endFrame = videoNode?.data?.end_asset_id ? assetMap.get(videoNode.data.end_asset_id) : undefined;
    const videoAsset = videoNode?.data?.assetId ? assetMap.get(videoNode.data.assetId) : undefined;
    const job = latestJob(jobs, videoNode?.id);
    const provider = providerMap.get(videoNode?.data?.provider);
    const profiles = document.filmBible?.voices?.profiles || {};
    const dialogues = Array.isArray(shot.dialogues) ? shot.dialogues.filter((item: Value) => String(item.text || "").trim()) : [];
    const dialogueAudioAssets: Value[] = [];
    const plannedDuration = Math.max(0, Number(shot.duration || 0));
    const configuredDuration = Number(document.videoDuration ?? -1);
    let effectiveDuration = configuredDuration >= 4 ? configuredDuration : plannedDuration;
    let dialogueReadinessReason = "";
    if (dialogueMode(document,shot) === 'voice_sample' && dialogues.length) {
      const samples = voiceSampleRows(document,shot,assets);
      if (videoGenerationMode(document,shot) !== 'multimodal') dialogueReadinessReason = '音色样本需明确选择多模态参考生成';
      else if (!supportsMotionReference(provider,String(videoNode?.data?.model || ''))) dialogueReadinessReason = '当前适配器尚不支持音色样本参考';
      else {
        const missing = samples.find((row:Value)=>!row.ready);
        if (missing) dialogueReadinessReason = `${missing.name}尚未确认当前版本的声音参考`;
      }
    } else if (["volcengine_ark", "runninghub", "hc_atom"].includes(provider?.type)) {
      for (const dialogue of dialogues) {
        const resolvedId = voiceCardId(document,shot,dialogue);
          const profile: Value = effectiveVoiceProfile(profiles[resolvedId]) || {};
          if ((profile as Value).source?.type === 'uploaded') {
            dialogueReadinessReason = '上传声音不能自动逐句合成，请将本镜对白方式改为音色样本参考';
            break;
          }
        if (profile.status !== "locked" || !String(profile.voiceType || "").trim()) {
          dialogueReadinessReason = `${dialogue.characterName || "角色"}尚未锁定固定音色`;
          break;
        }
        const match = assets
          .filter((asset) => asset.kind === "audio" && (asset.metadata?.input?.dialogue?.voiceCardId || asset.metadata?.input?.dialogue?.characterCardId || dialogue.characterCardId) === resolvedId && asset.metadata?.input?.dialogue?.id === dialogue.id && Number(asset.metadata?.input?.dialogue?.voiceVersion) === Number(profile.version || 1))
          .sort((left, right) => Number(right.created || 0) - Number(left.created || 0))[0];
        if (!match) {
          dialogueReadinessReason = `${dialogue.characterName || "角色"}的本镜对白尚未使用当前固定音色生成`;
          break;
        }
        dialogueAudioAssets.push(match);
      }
      const spokenDuration = dialogueAudioAssets.reduce((sum, asset) => sum + Number(asset.metadata?.duration || 0), 0) + Math.max(0, dialogueAudioAssets.length - 1) * .12;
      if (!dialogueReadinessReason && dialogues.length && !spokenDuration) {
        dialogueReadinessReason = "固定对白音频时长无效";
      } else if (!dialogueReadinessReason && dialogues.length) {
        effectiveDuration = Math.max(effectiveDuration, plannedDuration, Math.ceil(spokenDuration));
      }
    }
    const catalogCapabilities = modelCapabilities[
      [String(videoNode?.data?.provider || ""), String(videoNode?.data?.model || "")].join("\u0000")
    ];
    const endFrameSupported = Boolean(
      catalogCapabilities?.end_frame ??
      videoNode?.data?.model_capabilities?.end_frame ??
      provider?.capabilities?.end_frame ??
      false
    );
    let readinessReason = "";
    const motion = Boolean(shot.motionReference);
    const mode = videoGenerationMode(document, shot);
    if (!videoNode) readinessReason = "视频生成节点不存在";
    else if (mode === 'multimodal' && !supportsMotionReference(provider, String(videoNode.data?.model || ''))) readinessReason = "当前供应商/模型适配器尚不支持多模态参考";
    else if (motion && (!assetMap.has(shot.motionReference.assetId) || assetMap.get(shot.motionReference.assetId)?.kind !== 'video')) readinessReason = "动作参考视频已丢失";
    else if (motion && mode !== 'multimodal') readinessReason = "动作视频与当前模式不兼容，请确认改用多模态参考";
    else if (mode === 'first_frame' && videoNode.data?.end_asset_id) readinessReason = "单首帧模式不能提交尾帧";
    else if (mode === 'first_last_frame' && !endFrame) readinessReason = "首尾帧模式缺少尾帧";
    else if (['first_frame','first_last_frame'].includes(mode) && dialogueAudioAssets.length) readinessReason = "固定对白音频需使用多模态参考";
    else if (!firstFrame && mode !== 'multimodal') readinessReason = "缺少已生成的首帧";
    else if (imageNode?.data?.stale) readinessReason = "首帧已经过期，请先重新生成并核验";
    else if (mode !== 'multimodal' && requiresInitialStateReview(imageNode?.data?.prompt) && !imageNode?.data?.state_reviewed)
      readinessReason = "首帧包含关键初始状态，尚未人工核验";
    else if (!String(videoNode.data?.prompt || "").trim()) readinessReason = "Video Prompt 为空";
    else if (!provider || videoNode.data?.provider === "local") readinessReason = "尚未选择可用的视频 Provider";
    else if (!String(videoNode.data?.model || "").trim()) readinessReason = "尚未选择视频模型";
    else if (mode !== 'multimodal' && videoNode.data?.end_asset_id && !endFrameSupported) readinessReason = "当前模型不支持尾帧";
    else if (dialogueReadinessReason) readinessReason = dialogueReadinessReason;

    let status: VideoProductionStatus;
    if (["queued", "running", "interrupted"].includes(job?.status)) status = "generating";
    else if (videoNode?.data?.stale || imageNode?.data?.stale) status = "stale";
    else if (job?.status === "failed") status = "failed";
    else if (videoAsset) status = "complete";
    else if (readinessReason) status = "blocked";
    else status = "ready";

    const submissionDuration = ["volcengine_ark", "runninghub", "hc_atom"].includes(provider?.type)
      ? Math.max(4, Math.min(30, Math.ceil(effectiveDuration)))
      : Math.ceil(effectiveDuration);
    return {
      uid: shotIdentity(shot), index, shot, imageNode, videoNode, firstFrame, endFrame,
      videoAsset, job, provider, status, readinessReason, endFrameSupported, dialogueAudioAssets,
      plannedDuration, effectiveDuration, submissionDuration,
    };
  });
}

export function selectedVideoNodeIds(rows: VideoProductionRow[], uids: string[]) {
  const selected = new Set(uids);
  return rows
    .filter((row) => selected.has(row.uid))
    .map((row) => row.videoNode?.id)
    .filter((value): value is string => typeof value === "string" && Boolean(value));
}

export function validateVideoSubmission(rows: VideoProductionRow[], uids: string[]) {
  const selected = new Set(uids);
  const targets = rows.filter((row) => selected.has(row.uid));
  if (!targets.length) throw new Error("请先选择需要生成的视频镜头");
  const unavailable = targets.find((row) => row.readinessReason || row.status === "generating");
  if (unavailable) {
    const reason = unavailable.status === "generating" ? "任务已经在队列中" : unavailable.readinessReason;
    throw new Error(`SHOT ${String(unavailable.index + 1).padStart(2, "0")}：${reason}`);
  }
  return targets;
}

export function videoSubmissionSummary(rows: VideoProductionRow[], uids: string[]) {
  const selected = new Set(uids);
  const targets = rows.filter((row) => selected.has(row.uid));
  const groups = new Map<string, { providerId: string; providerName: string; modelId: string; count: number; cloud: boolean }>();
  for (const row of targets) {
    const providerId = String(row.videoNode?.data?.provider || "");
    const modelId = String(row.videoNode?.data?.model || "");
    const key = `${providerId}\u0000${modelId}`;
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, {
      providerId,
      providerName: String(row.provider?.name || providerId || "未选择"),
      modelId: modelId || "未选择",
      count: 1,
      cloud: Boolean(row.provider && !row.provider.local),
    });
  }
  return { count: targets.length, groups: [...groups.values()], cloudCount: targets.filter((row) => row.provider && !row.provider.local).length };
}
