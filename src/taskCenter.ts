type Value = Record<string, any>;

export type TaskEpisode = {
  id: string;
  production_id: string;
  episode_no: number;
  episode_title: string;
  name: string;
};

export type TaskCenterRow = {
  job: Value;
  episode?: TaskEpisode;
  node?: Value;
  shot?: Value;
  providerName: string;
  modelName: string;
};

export type TaskCenterFilters = {
  episodeId: string;
  kind: string;
  status: string;
};

function shotNodeIds(shot: Value) {
  return [
    shot.imageNode,
    shot.videoNode,
    shot.pipeline?.imageNodeId,
    shot.pipeline?.videoNodeId,
  ].filter(Boolean);
}

export function deriveTaskCenterRows(
  jobs: Value[],
  episodes: TaskEpisode[],
  documents: Record<string, Value>,
  providers: Value[],
): TaskCenterRow[] {
  const episodeMap = new Map(episodes.map((episode) => [episode.id, episode]));
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  return [...jobs]
    .sort((left, right) => Number(right.created || 0) - Number(left.created || 0))
    .map((job) => {
      const document = documents[job.project_id] || {};
      const node = (document.nodes || []).find((item: Value) => item.id === job.node_id);
      const shot = (document.shots || []).find((item: Value) =>
        shotNodeIds(item).includes(job.node_id) ||
        [item.uid, item.id, item.shot_id].filter(Boolean).includes(job.input?.shot_uid || job.input?.shot_id),
      );
      const providerId = String(job.input?.provider || node?.data?.provider || "");
      const provider = providerMap.get(providerId);
      return {
        job,
        episode: episodeMap.get(job.project_id),
        node,
        shot,
        providerName: provider?.name || providerId || (job.kind === "export" ? "本机导出" : "未记录"),
        modelName: String(job.input?.model || node?.data?.model || (job.kind === "export" ? "FFmpeg" : "未记录")),
      };
    });
}

export function filterTaskCenterRows(rows: TaskCenterRow[], filters: TaskCenterFilters) {
  return rows.filter(({ job }) =>
    (!filters.episodeId || job.project_id === filters.episodeId) &&
    (!filters.kind || job.kind === filters.kind) &&
    (!filters.status || job.status === filters.status),
  );
}

export function taskShotLabel(row: TaskCenterRow) {
  if (!row.shot) return row.node?.data?.label || row.job.node_id || "未关联节点";
  const raw = row.shot.shot_id || row.shot.id || row.shot.uid;
  return `SHOT ${String(raw || "").replace(/^shot[-_ ]?/i, "") || "?"}`;
}
