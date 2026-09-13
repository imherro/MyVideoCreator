import { ChevronDown } from "lucide-react";
import { episodeLabel, type EpisodeSummary } from "./production";

export function EpisodeSelector({
  episode,
  episodes,
  onSelect,
}: {
  episode: EpisodeSummary;
  episodes: EpisodeSummary[];
  onSelect: (id: string) => void;
}) {
  return (
    <label className="episode-selector" title="切换当前 Production 的制作集">
      <span className="sr-only">当前集</span>
      <select
        aria-label="当前集"
        value={episode.id}
        onChange={(event) => onSelect(event.target.value)}
      >
        {episodes.map((item) => (
          <option key={item.id} value={item.id}>{episodeLabel(item)}</option>
        ))}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}
