import { useMemo, useState } from "react";
import { Image, Music, Plus, Search, Video } from "lucide-react";
import { TIMELINE_DROP_MEDIA_TYPE } from "@twick/video-editor";
import { useTimelineContext } from "@twick/timeline";
import { addAssetToTimeline } from "./assetAdapter";
import type { EditorAsset } from "./editorDocument";

const supportedKinds = new Set(["video", "image", "audio"]);

export function ProjectAssetPanel({ assets, onMessage }: { assets: EditorAsset[]; onMessage: (message: string) => void }) {
  const [kind, setKind] = useState("video");
  const [query, setQuery] = useState("");
  const { editor, setSelectedItem, videoResolution } = useTimelineContext();
  const visible = useMemo(
    () =>
      assets.filter(
        (asset) =>
          supportedKinds.has(asset.kind) &&
          asset.kind === kind &&
          asset.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [assets, kind, query],
  );

  async function add(asset: EditorAsset) {
    try {
      const element = addAssetToTimeline(editor, asset, videoResolution, { append: true });
      setSelectedItem(element);
      onMessage(`已将“${asset.name}”追加到 ${asset.kind === "audio" ? "音频" : "画面"}轨`);
    } catch (cause: any) {
      onMessage(`加入失败：${cause?.message || String(cause)}`);
    }
  }

  return (
    <aside className="mvc-editor-assets">
      <div className="mvc-editor-assets-title">
        <strong>项目素材</strong>
        <small>双击、点 + 或拖入时间线</small>
      </div>
      <div className="mvc-editor-asset-tabs">
        <button className={kind === "video" ? "active" : ""} onClick={() => setKind("video")}>
          <Video size={15} /> 视频
        </button>
        <button className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}>
          <Image size={15} /> 图片
        </button>
        <button className={kind === "audio" ? "active" : ""} onClick={() => setKind("audio")}>
          <Music size={15} /> 音频
        </button>
      </div>
      <label className="mvc-editor-asset-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前项目素材" />
      </label>
      <div className="mvc-editor-asset-list">
        {visible.map((asset) => (
          <article
            key={asset.id}
            className="mvc-editor-asset"
            draggable
            onDoubleClick={() => void add(asset)}
            onDragStart={(event) => {
              event.dataTransfer.setData(
                TIMELINE_DROP_MEDIA_TYPE,
                JSON.stringify({ type: asset.kind, url: asset.url, assetId: asset.id }),
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <div className="mvc-editor-asset-preview">
              {asset.kind === "video" ? (
                <video src={asset.url} preload="metadata" muted />
              ) : asset.kind === "image" ? (
                <img src={asset.url} alt="" />
              ) : (
                <Music size={24} />
              )}
            </div>
            <div className="mvc-editor-asset-copy">
              <b title={asset.name}>{asset.name}</b>
              <small>
                {Number(asset.metadata?.duration) > 0
                  ? `${Number(asset.metadata.duration).toFixed(1)} 秒`
                  : asset.kind}
              </small>
            </div>
            <button title="加入时间线" onClick={() => void add(asset)}>
              <Plus size={15} />
            </button>
          </article>
        ))}
        {!visible.length && <p className="mvc-editor-assets-empty">当前项目没有此类素材</p>}
      </div>
    </aside>
  );
}
