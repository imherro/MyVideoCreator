import { ChevronRight, Film, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
  onOpenProjectSettings,
  onOpenEpisode,
  onDeleteEpisode,
  onDeleteProduction,
}: {
  productions: ProductionSummary[];
  episodes: EpisodeSummary[];
  currentEpisodeId: string;
  onCreateProduction: () => void;
  onCreateEpisode: (production: ProductionSummary) => void;
  onOpenProjectSettings: () => void;
  onOpenEpisode: (episode: EpisodeSummary) => void;
  onDeleteEpisode: (episode: EpisodeSummary) => void;
  onDeleteProduction: (production: ProductionSummary) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  return (
    <div className="production-library">
      <p className="muted">一个 Production 对应一部剧或影片；每个 Episode 是独立制作、生成和剪辑的工作区。</p>
      <button className="primary full" onClick={onCreateProduction}>
        <Plus size={16} />新建作品
      </button>
      {!!productions.length && <button className="full" onClick={onOpenProjectSettings}>项目设置</button>}
      {productions.map((production) => {
        const productionEpisodes = episodesForProduction(episodes, production.id);
        const expanded = expandedIds.has(production.id);
        const isCurrent = productionEpisodes.some((episode) => episode.id === currentEpisodeId);
        return (
          <section className={`production-group${expanded ? " expanded" : ""}`} key={production.id}>
            <header>
              <button
                className="production-group-toggle"
                title={production.name}
                aria-expanded={expanded}
                aria-controls={`production-episodes-${production.id}`}
                onClick={() => setExpandedIds((previous) => {
                  const next = new Set(previous);
                  if (next.has(production.id)) next.delete(production.id);
                  else next.add(production.id);
                  return next;
                })}
              >
                <ChevronRight size={16} className="production-expand-icon" />
                <Film size={17} />
                <span><b>{production.name}</b><small>{productionEpisodes.length} 集{isCurrent ? " · 当前作品" : ""}</small></span>
              </button>
              <button className="quiet" onClick={() => onCreateEpisode(production)}>
                <Plus size={14} />新增集
              </button>
              <button className="icon-button danger production-trash-button" title="将整部作品移入回收站" aria-label={`删除整部作品 ${production.name}`} onClick={()=>onDeleteProduction(production)}><Trash2 size={15}/></button>
            </header>
            <div id={`production-episodes-${production.id}`} hidden={!expanded}>
            {!productionEpisodes.length && <p className="production-empty">还没有 Episode</p>}
            {productionEpisodes.map((episode) => (
              <div className="episode-row" key={episode.id}>
                <button
                  className={episode.id === currentEpisodeId ? "active" : ""}
                  title={episodeLabel(episode)}
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
            </div>
          </section>
        );
      })}
    </div>
  );
}
