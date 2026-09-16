import type { FilmBibleDocument, VoiceProfile } from "./types";
import { voiceCardId } from './voiceResolution.ts';
import { invalidate } from '../graph.ts';

export function voiceProfilesOf(document: FilmBibleDocument) {
  return document.filmBible?.voices?.profiles || {};
}

export function defaultVoiceProfile(cardId: string, providerId = ""): VoiceProfile {
  return {
    cardId,
    providerId,
    voiceType: "zh_female_vv_uranus_bigtts",
    version: 1,
    status: "draft",
    previewText: "你好，我是这个故事中的角色。",
    parameters: { speechRate: 0, emotion: "" },
  };
}

export function saveVoiceProfile<T extends FilmBibleDocument>(document: T, cardId: string, input: VoiceProfile): T {
  const current = voiceProfilesOf(document)[cardId];
  const voiceType = input.voiceType.trim();
  const previewText = input.previewText.trim();
  if (!input.providerId) throw new Error("请选择豆包语音服务");
  if (!voiceType) throw new Error("音色 ID 不能为空");
  if (!previewText) throw new Error("试听台词不能为空");
  const identityChanged = !!current && (current.providerId !== input.providerId || current.voiceType !== voiceType);
  const next: VoiceProfile = {
    ...input,
    lockedVersions: lockedVoiceVersions(current),
    defaultVersion: current?.defaultVersion || (current?.status === "locked" ? current.version : undefined),
    cardId,
    providerId: input.providerId,
    voiceType,
    previewText,
    version: identityChanged ? current.version + 1 : Math.max(1, input.version || 1),
    status: identityChanged ? "draft" : input.status,
    previewAssetId: identityChanged ? undefined : input.previewAssetId,
    referenceAssetId: identityChanged ? undefined : input.referenceAssetId,
    referenceVersion: identityChanged ? undefined : input.referenceVersion,
    generationJobId: identityChanged ? undefined : input.generationJobId,
    parameters: {
      speechRate: Math.max(-50, Math.min(100, Number(input.parameters?.speechRate) || 0)),
      emotion: String(input.parameters?.emotion || "").trim(),
    },
  };
  return {
    ...document,
    filmBible: {
      ...(document.filmBible || {}),
      voices: { profiles: { ...voiceProfilesOf(document), [cardId]: next } },
    },
  } as T;
}

export function acceptVoiceResult<T extends FilmBibleDocument>(document: T, job: Record<string, any>): T {
  const descriptor = job.input?.voice_profile;
  const asset = job.result?.assets?.find((item: Record<string, any>) => item.kind === "audio");
  if (!descriptor?.cardId || !asset?.id) return document;
  const current = voiceProfilesOf(document)[descriptor.cardId];
  if (!current || current.version !== descriptor.version) return document;
  return {
    ...document,
    filmBible: {
      ...(document.filmBible || {}),
      voices: {
        profiles: {
          ...voiceProfilesOf(document),
          [descriptor.cardId]: { ...current, previewAssetId: asset.id, generationJobId: job.id },
        },
      },
    },
  } as T;
}

export function setVoiceLocked<T extends FilmBibleDocument>(document: T, cardId: string, locked: boolean): T {
  const current = voiceProfilesOf(document)[cardId];
  if (!current) throw new Error("请先保存并生成角色试听音频");
  if (locked && !current.previewAssetId) throw new Error("请先生成并试听角色音色");
  const history = lockedVoiceVersions(current);
  const next = locked
    ? { ...current, status: "locked" as const, referenceAssetId: current.referenceAssetId || current.previewAssetId, referenceVersion: current.version }
    : current.status === "locked"
      ? { ...current, version: current.version + 1, status: "draft" as const, previewAssetId: undefined, referenceAssetId: undefined, referenceVersion: undefined, generationJobId: undefined }
      : { ...current, status: "draft" as const };
  next.lockedVersions = history;
  next.defaultVersion = current.defaultVersion || (locked || current.status === "locked" ? current.version : undefined);
  if (locked) { const { lockedVersions, ...snapshot } = next; history[String(next.version)] = snapshot; }
  const updated = {
    ...document,
    filmBible: {
      ...(document.filmBible || {}),
      voices: { profiles: { ...voiceProfilesOf(document), [cardId]: next } },
    },
  } as T;
  if (JSON.stringify(next) === JSON.stringify(current)) return document;
  const signature = (doc: T, shot: Record<string, any>, line: Record<string, any>) => {
    const id = voiceCardId(doc, shot, line), profile = effectiveVoiceProfile(voiceProfilesOf(doc)[id]);
    return JSON.stringify([id, profile?.status, profile?.version, profile?.voiceType, profile?.providerId, profile?.referenceAssetId, profile?.referenceVersion]);
  };
  const affected = document.shots.filter(shot => (shot.dialogues || []).some((line: Record<string, any>) => signature(document, shot, line) !== signature(updated, shot, line)))
    .map(shot => shot.videoNode || shot.pipeline?.videoNodeId).filter(Boolean);
  return invalidate(updated as any, affected) as T;
}

export function lockedVoiceVersions(profile?: VoiceProfile): Record<string, VoiceProfile> {
  const versions = { ...profile?.lockedVersions };
  if (profile?.status === 'locked') {
    const { lockedVersions, ...snapshot } = profile;
    versions[String(profile.version)] = snapshot;
  }
  return versions;
}
export function effectiveVoiceProfile(profile?: VoiceProfile): VoiceProfile | undefined {
  return profile?.defaultVersion ? lockedVoiceVersions(profile)[String(profile.defaultVersion)] || profile : profile;
}
export function chooseVoiceVersion<T extends FilmBibleDocument>(document: T, cardId: string, version: number): T {
  const card = document.filmBible?.visual?.cards[cardId];
  if (!card) throw new Error('角色不存在');
  const sourceId = card.kind === 'character_state' ? card.parentCardId! : cardId;
  const profiles = voiceProfilesOf(document), selected = lockedVoiceVersions(profiles[sourceId])[String(version)];
  if (!selected || selected.status !== 'locked') throw new Error('请选择已锁定的声音版本');
  const next = card.kind === 'character_state'
    ? { ...selected, cardId, sourceVoiceVersion: version, version: (profiles[cardId]?.version || 0) + 1, defaultVersion: undefined, lockedVersions: undefined }
    : { ...profiles[cardId], defaultVersion: version, lockedVersions: lockedVoiceVersions(profiles[cardId]) };
  if (card.kind === 'character_state') next.referenceVersion = next.version;
  return { ...document, filmBible: { ...document.filmBible, voices: { profiles: { ...profiles, [cardId]: next } } } } as T;
}
