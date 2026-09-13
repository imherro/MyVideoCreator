import { ChevronRight, Film, Plus, Trash2 } from "lucide-react";
import {
  episodeLabel,
  episodesForProduction,
  type EpisodeSummary,
  type ProductionSummary,
} from "../app/production";

export function ProductionLibrary({
  productions,
  episodes,
  currentEpisodeId,
  onCreateProduction,
  onCreateEpisode,
  onOpenEpisode,
  onDeleteEpisode,
}: {
  productions: ProductionSummary[];
  episodes: EpisodeSummary[];
  currentEpisodeId: string;
  onCreateProduction: () => void;
  onCreateEpisode: (production: ProductionSummary) => void;
  onOpenEpisode: (episode: EpisodeSummary) => void;
  onDeleteEpisode: (episode: EpisodeSummary) => void;
}) {
  return (
    <div className="production-library">
      <p className="muted">一个 Production 对应一部剧或影片；每个 Episode 是独立制作、生成和剪辑的工作区。</p>
      <button className="primary full" onClick={onCreateProduction}>
        <Plus size={16} />新建 Production
      </button>
      {productions.map((production) => {
        const productionEpisodes = episodesForProduction(episodes, production.id);
        return (
          <section className="production-group" key={production.id}>
            <header>
              <Film size={17} />
              <div><b>{production.name}</b><small>{productionEpisodes.length} 集</small></div>
              <button className="quiet" onClick={() => onCreateEpisode(production)}>
                <Plus size={14} />新增集
              </button>
            </header>
            {!productionEpisodes.length && <p className="production-empty">还没有 Episode</p>}
            {productionEpisodes.map((episode) => (
              <div className="episode-row" key={episode.id}>
                <button
                  className={episode.id === currentEpisodeId ? "active" : ""}
                  onClick={() => onOpenEpisode(episode)}
                >
                  <div>
                    <b>{episodeLabel(episode)}</b>
                    <small>{episode.id === currentEpisodeId ? "当前制作集 · " : ""}{new Date(episode.updated * 1000).toLocaleDateString()}</small>
                  </div>
                  <ChevronRight size={15} />
                </button>
                <button
                  className="icon-button danger"
                  title="将本集移入回收站"
                  aria-label={`删除 ${episodeLabel(episode)}`}
                  onClick={() => onDeleteEpisode(episode)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
