type Value = Record<string, any>;
const nameKey = (name: unknown) => String(name || '').normalize('NFKC').toLowerCase().replace(/\s/g, '');

/** Merge a completed task into the latest shared Bible, never replace its history.
 * Older tasks have fresh IDs for the same entities: conservatively reuse a unique
 * exact name + kind + parent match, including remapping the dialogue speaker IDs.
 */
export function mergeStoryboardResult<T extends Value>(document: T, result: Value) {
  const old = document.filmBible?.visual || {cards:{},versions:{}};
  const incoming = result.filmBible?.visual;
  if (!incoming) return {document, shots:result.shots || []};
  const cards = {...old.cards}, versions = {...old.versions};
  const cardMap: Record<string,string> = {}, versionMap: Record<string,string> = {};
  const available = Object.values(old.cards) as Value[];
  const resolveCard = (cid: string): string => {
    if (cardMap[cid]) return cardMap[cid];
    if (old.cards[cid]) return cardMap[cid] = cid;
    const card = incoming.cards[cid];
    if (!card) return cid;
    const parent = card.parentCardId ? resolveCard(card.parentCardId) : null;
    const matches = available.filter(candidate => !candidate.deletedAt && candidate.status !== 'deprecated'
      && old.versions[candidate.currentVersionId] && old.versions[candidate.currentVersionId].status !== 'deprecated'
      && candidate.kind === card.kind && [candidate.name,...(candidate.aliases || [])].some(name=>nameKey(name) === nameKey(card.name))
      && (candidate.parentCardId || null) === parent);
    if (matches.length === 1) return cardMap[cid] = matches[0].id;
    cards[cid] = {...card,parentCardId:parent};
    return cardMap[cid] = cid;
  };
  Object.keys(incoming.cards).forEach(resolveCard);
  const resolveVersion = (vid: string): string => {
    if (versionMap[vid]) return versionMap[vid];
    if (old.versions[vid]) return versionMap[vid] = vid;
    const version = incoming.versions[vid];
    if (!version) return vid;
    const cid = resolveCard(version.cardId);
    if (cid !== version.cardId) return versionMap[vid] = cards[cid].currentVersionId;
    versionMap[vid] = vid;
    versions[vid] = {...version,parentVersionId:version.parentVersionId ? resolveVersion(version.parentVersionId) : null};
    return vid;
  };
  Object.keys(incoming.versions).forEach(resolveVersion);
  const shots = (result.shots || []).map((shot:Value) => {
    const binding = shot.assetBindings;
    const remap = (item:Value) => {
      const versionId = resolveVersion(item.versionId);
      const card = cards[versions[versionId]?.cardId];
      return {...item,versionId,...(item.role && card ? {role:card.name} : {})};
    };
    return {...shot,...(binding ? {assetBindings:{...binding,
      characters:(binding.characters || []).map(remap),scene:binding.scene ? remap(binding.scene) : null,
      props:(binding.props || []).map(remap)}} : {}),
      ...(shot.dialogues ? {dialogues:shot.dialogues.map((line:Value) => {
        const characterCardId = cardMap[line.characterCardId] || line.characterCardId;
        return {...line,characterCardId,characterName:cards[characterCardId]?.name || line.characterName};
      })} : {})};
  });
  return {document:{...document,filmBible:{...document.filmBible,visual:{...old,cards,versions}}} as T,shots};
}
