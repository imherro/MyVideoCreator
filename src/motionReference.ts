type Value = Record<string, any>;
export function videoGenerationMode(document: Value, shot: Value) {
  return shot.videoReferenceMode || document.videoReferenceMode || 'legacy';
}
export type MotionReference = {
  assetId: string;
  characterCardId?: string;
  cameraMode: 'follow_reference' | 'use_shot_camera';
  description?: string;
};

// Backend is authoritative; mirror only the verified adapter identities here so
// canvas and batch submission guards also work before the catalog has loaded.
export function supportsMotionReference(provider: Value | undefined, model: string) {
  return provider?.type === 'volcengine_ark'
    ? /^doubao-seedance-2-(0|5)(-|$)/i.test(model)
    : provider?.type === 'hc_atom' ? /^(doubao|dreamina)-seedance-2\.(0|5)(-|$)/i.test(model) || ['wan3.0-video', 'MiniMax-H3'].includes(model)
    : provider?.type === 'runninghub' && ['bytedance/seedance-2.5-token', 'bytedance/seedance-2.5-global-token', 'alibaba/wan-3.0', 'minimax/hailuo-h3'].includes(model);
}

export function motionCharacters(document: Value, shot: Value): Value[] {
  const visual = document.filmBible?.visual || {};
  const options = new Map<string, Value>();
  for (const binding of shot.assetBindings?.characters || []) {
    const card = visual.cards?.[visual.versions?.[binding.versionId]?.cardId];
    if (!card || card.deletedAt) continue;
    options.set(card.id, card);
    const parent = visual.cards?.[card.parentCardId];
    if (parent && !parent.deletedAt) options.set(parent.id, parent);
  }
  return [...options.values()];
}
