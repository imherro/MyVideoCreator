type Value = Record<string, any>;

export function episodeSourceReferences(adaptation: Value | null, episodeNo: number): string[] {
  const plan = adaptation?.episodePlans?.find((item: Value) => item.episodeNo === episodeNo);
  return Array.isArray(plan?.sourceChapterRefs) ? plan.sourceChapterRefs : [];
}

export function setEpisodeSourceReference(adaptation: Value, episodeNo: number, chapterId: string, enabled: boolean): Value {
  return {
    ...adaptation,
    episodePlans: (adaptation.episodePlans || []).map((plan: Value) => {
      if (plan.episodeNo !== episodeNo) return plan;
      const current = Array.isArray(plan.sourceChapterRefs) ? plan.sourceChapterRefs : [];
      const sourceChapterRefs = enabled
        ? [...new Set([...current, chapterId])]
        : current.filter((id: string) => id !== chapterId);
      return { ...plan, sourceChapterRefs };
    }),
  };
}
