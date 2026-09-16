type Value = Record<string, any>;
export const dialogueModeLabels: Value = {voice_sample:'音色样本参考',full_dialogue:'完整对白参考'};
export function dialogueMode(document: Value, shot: Value) {
  return shot.dialogueMode || document.dialogueMode || 'full_dialogue';
}
export function voiceSampleRows(document: Value, shot: Value, assets: Value[]) {
  const profiles = document.filmBible?.voices?.profiles || {};
  const seen = new Set<string>();
  return (shot.dialogues || []).filter((line: Value) => {
    if (!String(line.text || '').trim() || seen.has(line.characterCardId)) return false;
    seen.add(line.characterCardId); return true;
  }).map((line: Value) => {
    const profile = profiles[line.characterCardId] || {};
    const asset = assets.find(a => a.id === profile.referenceAssetId && a.kind === 'audio');
    const ready = profile.status === 'locked' && !!asset && profile.referenceVersion === profile.version;
    return {cardId:line.characterCardId,name:line.characterName || '角色',asset,profile,ready};
  });
}
