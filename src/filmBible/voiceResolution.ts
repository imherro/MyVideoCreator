type Value = Record<string, any>;
export function voiceCardId(document: Value, shot: Value, dialogue: Value): string {
  const film = document.filmBible || {}, visual = film.visual || {};
  const cards = visual.cards || {}, versions = visual.versions || {}, profiles = film.voices?.profiles || {};
  const cid = dialogue.characterCardId || '', card = cards[cid] || {};
  const base = card.kind === 'character_state' ? card.parentCardId : cid;
  if (card.kind === 'character_state' && profiles[cid]) return cid;
  const candidates = new Set<string>();
  for (const binding of shot.assetBindings?.characters || []) {
    const stateId = versions[binding.versionId]?.cardId, state = cards[stateId] || {};
    if (state.kind === 'character_state' && state.parentCardId === base && profiles[stateId]) candidates.add(stateId);
  }
  if (candidates.size > 1) throw new Error('同一镜头绑定了多个不同音色的角色状态，请保留明确的说话状态');
  return candidates.values().next().value || base || cid;
}
