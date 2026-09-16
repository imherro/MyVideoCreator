import { useMemo, useRef, useState } from "react";
import { Image, Music, Plus, Search, Video } from "lucide-react";
import { TIMELINE_DROP_MEDIA_TYPE } from "@twick/video-editor";
import { Track, useTimelineContext } from "@twick/timeline";
import { addAssetToTimeline } from "./assetAdapter";
import type { EditorAsset } from "./editorDocument";
import { presentEditorAssets } from "./projectAssets";

const supportedKinds = new Set(["video", "image", "audio"]);

export function ProjectAssetPanel({ assets, shots, onMessage }: { assets: EditorAsset[]; shots: Record<string, any>[]; onMessage: (message: string) => void }) {
  const [kind, setKind] = useState("video");
  const [query, setQuery] = useState("");
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(globalThis.localStorage?.getItem("mvc-editor-assets-width"));
    return Number.isFinite(saved) && saved >= 280 ? saved : 360;
  });
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const { editor, selectedItem, setSelectedItem, videoResolution } = useTimelineContext();
  const presented = useMemo(() => presentEditorAssets(assets, shots), [assets, shots]);
  const counts = useMemo(() => Object.fromEntries(["video", "image", "audio"].map((item) => [item, assets.filter((asset) => asset.kind === item).length])), [assets]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return presented.filter(({ asset, searchText }) => supportedKinds.has(asset.kind) && asset.kind === kind && (!normalized || searchText.includes(normalized)));
  }, [kind, presented, query]);

  async function add(asset: EditorAsset) {
    try {
      const targetTrack = selectedItem instanceof Track ? selectedItem : undefined;
      const element = addAssetToTimeline(editor, asset, videoResolution, { append: true, targetTrack });
      setSelectedItem(element);
      onMessage(`已将“${asset.name}”追加到 ${targetTrack?.getName() || (asset.kind === "audio" ? "音频轨" : "画面轨")}`);
    } catch (cause: any) {
      onMessage(`加入失败：${cause?.message || String(cause)}`);
    }
  }

  return (
    <aside className="mvc-editor-assets" style={{ width: panelWidth }}>
      <div
        className="mvc-editor-assets-resizer"
        role="separator"
        aria-label="调整项目素材面板宽度"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={(event) => {
          resizeStart.current = { x: event.clientX, width: panelWidth };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!resizeStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const width = Math.max(280, Math.min(640, resizeStart.current.width + event.clientX - resizeStart.current.x));
          setPanelWidth(width);
        }}
        onPointerUp={(event) => {
          resizeStart.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          globalThis.localStorage?.setItem("mvc-editor-assets-width", String(panelWidth));
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const width = Math.max(280, Math.min(640, panelWidth + (event.key === "ArrowRight" ? 24 : -24)));
          setPanelWidth(width);
          globalThis.localStorage?.setItem("mvc-editor-assets-width", String(width));
        }}
      />
      <div className="mvc-editor-assets-title">
        <strong>项目素材</strong>
        <small>{assets.filter((asset) => supportedKinds.has(asset.kind)).length} 项 · 可搜索镜头和内容</small>
      </div>
      <div className="mvc-editor-asset-tabs">
        <button className={kind === "video" ? "active" : ""} onClick={() => setKind("video")}>
          <Video size={15} /> 视频 <b>{counts.video || 0}</b>
        </button>
        <button className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}>
          <Image size={15} /> 图片 <b>{counts.image || 0}</b>
        </button>
        <button className={kind === "audio" ? "active" : ""} onClick={() => setKind("audio")}>
          <Music size={15} /> 音频 <b>{counts.audio || 0}</b>
        </button>
      </div>
      <label className="mvc-editor-asset-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索镜头、角色、内容或模型" />
      </label>
      <div className="mvc-editor-asset-list">
        {visible.map(({ asset, title, subtitle, details }) => (
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
            <div className="mvc-editor-asset-copy" title={`${title}\n${subtitle}\n${details}\n原始名称：${asset.name}`}>
              <b>{title}</b>
              <span>{subtitle}</span>
              <small>{details}</small>
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
