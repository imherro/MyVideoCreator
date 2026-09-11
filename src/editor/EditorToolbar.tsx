import { Captions, Download, Plus, Trash2, Type, Volume2 } from "lucide-react";
import { TrackElement, useTimelineContext } from "@twick/timeline";
import type { ProjectJSON } from "@twick/timeline";
import { addCaptionElements, addTextElement, addTrack } from "./editorActions";
import type { EditorAsset } from "./editorDocument";
import { attachAssetReferences } from "./editorDocument";
import { parseSrt } from "./srt";

export function EditorToolbar({
  assets,
  onMessage,
  onExport,
}: {
  assets: EditorAsset[];
  onMessage: (message: string) => void;
  onExport: (timeline: ProjectJSON) => void;
}) {
  const { editor, selectedItem, videoResolution, totalDuration, changeLog } = useTimelineContext();
  const subtitles = assets.filter((asset) => asset.kind === "subtitle");
  void changeLog;
  const emptyTracks = (editor.getTimelineData()?.tracks || []).filter((track) => !track.getElements().length);

  async function addTitle() {
    try {
      const start = selectedItem instanceof TrackElement ? selectedItem.getStart() : 0;
      await addTextElement(editor, videoResolution, { start });
      onMessage("已加入标题；选择标题后可在右侧编辑样式和位置");
    } catch (cause: any) {
      onMessage(cause?.message || String(cause));
    }
  }

  async function importSubtitle(assetId: string) {
    if (!assetId) return;
    try {
      const asset = subtitles.find((candidate) => candidate.id === assetId);
      if (!asset) throw new Error("字幕素材不存在");
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`字幕读取失败：${response.status}`);
      const count = await addCaptionElements(editor, parseSrt(await response.text()));
      onMessage(`已从 ${asset.name} 导入 ${count} 条字幕`);
    } catch (cause: any) {
      onMessage(cause?.message || String(cause));
    }
  }

  return (
    <div className="mvc-editor-tools">
      <button title="增加一条空的视频或图片叠加轨" onClick={() => { addTrack(editor, "video"); onMessage("已增加空视频轨；请从左侧拖入素材"); }}>
        <Plus size={14} /> 空视频轨
      </button>
      <button title="增加一条独立音频轨" onClick={() => { addTrack(editor, "audio"); onMessage("已增加音频轨"); }}>
        <Volume2 size={14} /> 音频轨
      </button>
      <button title="删除所有没有片段的轨道" disabled={!emptyTracks.length} onClick={() => {
        emptyTracks.forEach((track) => editor.removeTrack(track));
        onMessage(`已清理 ${emptyTracks.length} 条空轨道`);
      }}>
        <Trash2 size={14} /> 清理空轨
      </button>
      <button title="在当前片段起点加入标题" onClick={() => void addTitle()}>
        <Type size={14} /> 标题
      </button>
      <label className="mvc-editor-subtitle-import" title="把项目中的 SRT 转为可编辑字幕片段">
        <Captions size={14} />
        <select defaultValue="" onChange={(event) => { void importSubtitle(event.target.value); event.target.value = ""; }}>
          <option value="">导入 SRT</option>
          {subtitles.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
      </label>
      <button className="primary" disabled={!totalDuration} onClick={() => onExport(attachAssetReferences(editor.getProject(), assets))}>
        <Download size={14} /> 导出工程
      </button>
    </div>
  );
}
