type Value = Record<string, any>;

// Missing values belong to historical shots: retain any existing composition image.
export function needsComposition(document: Value, shot: Value) {
  const mode = shot.videoReferenceMode || document.videoReferenceMode || 'legacy';
  if (mode !== 'multimodal') return true;
  if (shot.compositionMode) return shot.compositionMode === 'preview';
  return Boolean(document.nodes?.find((n: Value) => n.id === (shot.imageNode || shot.pipeline?.imageNodeId))?.data?.assetId);
}

export function compositionEdge(document: Value, source: string, target: string) {
  return (document.shots || []).some((shot: Value) =>
    !needsComposition(document, shot) &&
    (shot.imageNode || shot.pipeline?.imageNodeId) === source &&
    (shot.videoNode || shot.pipeline?.videoNodeId) === target);
}

export function visualVideoReadiness(document: Value, shot: Value) {
  const visual = document.filmBible?.visual || {};
  const bindings = shot.assetBindings || {};
  const refs = [...(bindings.characters || []), ...(bindings.props || []), ...(bindings.scene ? [bindings.scene] : [])];
  if (Object.values(visual.cards || {}).some((c: any) => !c.deletedAt && c.status !== 'deprecated') && !refs.length)
    return '本镜尚未绑定视觉资产，请先确认角色、场景或道具';
  for (const ref of refs) {
    const v = visual.versions?.[ref.versionId];
    const c = visual.cards?.[v?.cardId];
    if (!c || c.deletedAt || !['locked', 'deprecated'].includes(v?.status) || !v?.references?.some((r: Value) => r.role === 'primary' && r.assetId))
      return '绑定的视觉版本尚未确认或缺少主参考图';
  }
  return '';
}
