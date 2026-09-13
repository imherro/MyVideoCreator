export type ProductionSummary = {
  id: string;
  name: string;
  created: number;
  updated: number;
  episode_count: number;
};

export type EpisodeSummary = {
  id: string;
  name: string;
  revision: number;
  created: number;
  updated: number;
  production_id: string;
  episode_no: number;
  episode_title: string;
};

export function episodesForProduction<T extends EpisodeSummary>(
  episodes: T[],
  productionId: string,
) {
  return episodes
    .filter((episode) => episode.production_id === productionId)
    .sort((left, right) => left.episode_no - right.episode_no || left.id.localeCompare(right.id));
}
export function episodeLabel(episode: Pick<EpisodeSummary, "episode_no" | "episode_title" | "name">) {
  const number = String(episode.episode_no || 1).padStart(2, "0");
  return `EP${number} · ${episode.episode_title || episode.name}`;
}
