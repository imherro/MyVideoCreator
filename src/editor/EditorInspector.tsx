import { useRef, useState } from "react";
import {
  AudioElement,
  CaptionElement,
  ImageElement,
  TextElement,
  TrackElement,
  VideoElement,
  useTimelineContext,
} from "@twick/timeline";
import {
  getElementFade,
  getVolumeAutomation,
  moveElement,
  replaceElementAsset,
  setElementDuration,
  setElementFade,
  setElementTransform,
  setElementVolume,
  setMediaFilter,
  setMediaSourceIn,
  setPlaybackRate,
  parseVolumeAutomation,
  setTextContent,
  setTextStyle,
  setTransition,
  setVolumeAutomation,
} from "./editorActions";
import type { EditorAsset } from "./editorDocument";

const visualTypes = new Set(["video", "image"]);

export function EditorInspector({ assets }: { assets: EditorAsset[] }) {
  const { editor, selectedItem, changeLog, present } = useTimelineContext();
  const [error, setError] = useState("");
  const transitionTargetRef = useRef<HTMLSelectElement>(null);

  if (!(selectedItem instanceof TrackElement)) {
    return (
      <aside className="mvc-editor-inspector mvc-editor-inspector-empty">
        <strong>剪辑属性</strong>
        <p>V 是视频/图片轨，越靠上越覆盖下层；A 是音频轨；T 是标题轨，字幕轨单独显示。</p>
        <p>点击或双击左侧素材即可追加；拖到轨道可按当前播放头加入。片段可左右拖动，拖两端可裁剪。</p>
        <p>快捷键：S 在播放头切分，Ctrl/Cmd+D 复制，Delete 删除，Ctrl/Cmd+Z 撤销。</p>
      </aside>
    );
  }

  const element = selectedItem;
  const isMedia = element instanceof VideoElement || element instanceof AudioElement;
  const isVisual = element instanceof VideoElement || element instanceof ImageElement;
  const isText = element instanceof TextElement;
  const isCaption = element instanceof CaptionElement;
  const fade = getElementFade(element);
  const frame = isVisual ? element.getFrame() : undefined;
  const transition = element.getTransition();
  const candidates = (present?.tracks || [])
    .flatMap((track) => track.elements)
    .filter((candidate) => candidate.id !== element.getId() && visualTypes.has(candidate.type))
    .sort((a, b) => a.s - b.s);
  const defaultTarget = transition?.toElementId || candidates.find((candidate) => candidate.s >= element.getStart())?.id || "";
  const matchingAssets = assets.filter((asset) => asset.kind === element.getType());

  const commit = async (action: () => unknown | Promise<unknown>) => {
    try {
      await action();
      setError("");
    } catch (cause: any) {
      setError(cause?.message || String(cause));
    }
  };

  return (
    <aside className="mvc-editor-inspector" key={`${element.getId()}-${changeLog}`}>
      <strong>剪辑属性</strong>
      <small>{element.getName() || element.getType()}</small>

      <div className="mvc-editor-inspector-grid">
        <label>
          起点（秒）
          <input type="number" min="0" step="0.01" defaultValue={element.getStart().toFixed(2)}
            onBlur={(event) => void commit(() => moveElement(editor, element.getId(), Number(event.target.value)))} />
        </label>
        <label>
          长度（秒）
          <input type="number" min="0.1" step="0.01" defaultValue={element.getDuration().toFixed(2)}
            onBlur={(event) => void commit(() => setElementDuration(editor, element.getId(), Number(event.target.value)))} />
        </label>
      </div>

      {(isText || isCaption) && (
        <label>
          文字内容
          <textarea defaultValue={element.getText()}
            onBlur={(event) => void commit(() => setTextContent(editor, element.getId(), event.target.value))} />
        </label>
      )}

      {isText && (
        <div className="mvc-editor-inspector-grid">
          <label>
            字号
            <input type="number" min="8" max="300" defaultValue={Number(element.getProps().fontSize) || 48}
              onBlur={(event) => void commit(() => setTextStyle(editor, element.getId(), { fontSize: Number(event.target.value) }))} />
          </label>
          <label>
            文字颜色
            <input type="color" defaultValue={String(element.getProps().fill || "#ffffff")}
              onChange={(event) => void commit(() => setTextStyle(editor, element.getId(), { fill: event.target.value }))} />
          </label>
        </div>
      )}

      {isMedia && (
        <>
          <div className="mvc-editor-inspector-grid">
            <label>
              素材入点
              <input type="number" min="0" step="0.01" defaultValue={element.getStartAt().toFixed(2)}
                onBlur={(event) => void commit(() => setMediaSourceIn(editor, element.getId(), Number(event.target.value)))} />
            </label>
            <label>
              播放速度
              <input type="number" min="0.25" max="4" step="0.05" defaultValue={element.getPlaybackRate()}
                onBlur={(event) => void commit(() => setPlaybackRate(editor, element.getId(), Number(event.target.value)))} />
            </label>
          </div>
          <label>
            音量 · {Math.round(element.getVolume() * 100)}%
            <input type="range" min="0" max="2" step="0.01" defaultValue={element.getVolume()}
              onChange={(event) => void commit(() => setElementVolume(editor, element.getId(), Number(event.target.value)))} />
          </label>
          <label>
            音量关键帧（片段秒:百分比）
            <input type="text" placeholder="例如 0:30, 2:80, 5:40"
              defaultValue={getVolumeAutomation(element).map((point) => `${point.time}:${Math.round(point.value * 100)}`).join(", ")}
              onBlur={(event) => void commit(() => setVolumeAutomation(editor, element.getId(), parseVolumeAutomation(event.target.value, element.getDuration())))} />
          </label>
          <small className="mvc-editor-preview-note">静态音量可实时试听；音量关键帧和音频淡化以导出成片为准。</small>
          <div className="mvc-editor-inspector-grid">
            <label>
              音频淡入
              <input type="number" min="0" step="0.05" defaultValue={fade.audioIn}
                onBlur={(event) => void commit(() => setElementFade(editor, element.getId(), { audioIn: Number(event.target.value) }))} />
            </label>
            <label>
              音频淡出
              <input type="number" min="0" step="0.05" defaultValue={fade.audioOut}
                onBlur={(event) => void commit(() => setElementFade(editor, element.getId(), { audioOut: Number(event.target.value) }))} />
            </label>
          </div>
        </>
      )}

      {(isVisual || isText) && (
        <>
          <div className="mvc-editor-inspector-grid">
            <label>
              X
              <input type="number" step="1" defaultValue={element.getPosition().x.toFixed(0)}
                onBlur={(event) => void commit(() => setElementTransform(editor, element.getId(), { x: Number(event.target.value) }))} />
            </label>
            <label>
              Y
              <input type="number" step="1" defaultValue={element.getPosition().y.toFixed(0)}
                onBlur={(event) => void commit(() => setElementTransform(editor, element.getId(), { y: Number(event.target.value) }))} />
            </label>
            {frame?.size && <label>
              宽度
              <input type="number" min="1" step="1" defaultValue={frame.size[0].toFixed(0)}
                onBlur={(event) => void commit(() => setElementTransform(editor, element.getId(), { width: Number(event.target.value) }))} />
            </label>}
            {frame?.size && <label>
              高度
              <input type="number" min="1" step="1" defaultValue={frame.size[1].toFixed(0)}
                onBlur={(event) => void commit(() => setElementTransform(editor, element.getId(), { height: Number(event.target.value) }))} />
            </label>}
            <label>
              旋转
              <input type="number" step="1" defaultValue={element.getRotation().toFixed(0)}
                onBlur={(event) => void commit(() => setElementTransform(editor, element.getId(), { rotation: Number(event.target.value) }))} />
            </label>
            <label>
              不透明度
              <input type="number" min="0" max="1" step="0.05" defaultValue={element.getOpacity()}
                onBlur={(event) => void commit(() => setElementTransform(editor, element.getId(), { opacity: Number(event.target.value) }))} />
            </label>
          </div>
          <div className="mvc-editor-inspector-grid">
            <label>
              画面淡入
              <input type="number" min="0" step="0.05" defaultValue={fade.videoIn}
                onBlur={(event) => void commit(() => setElementFade(editor, element.getId(), { videoIn: Number(event.target.value) }))} />
            </label>
            <label>
              画面淡出
              <input type="number" min="0" step="0.05" defaultValue={fade.videoOut}
                onBlur={(event) => void commit(() => setElementFade(editor, element.getId(), { videoOut: Number(event.target.value) }))} />
            </label>
          </div>
        </>
      )}

      {isVisual && (
        <label>
          画面滤镜
          <select defaultValue={String(element.getProps().mediaFilter || "none")}
            onChange={(event) => void commit(() => setMediaFilter(editor, element.getId(), event.target.value))}>
            <option value="none">无</option>
            <option value="blackWhite">黑白</option>
            <option value="sepia">复古</option>
            <option value="cinematic">电影感</option>
            <option value="saturated">高饱和</option>
            <option value="bright">明亮</option>
            <option value="vibrant">鲜艳</option>
            <option value="cool">冷色</option>
            <option value="warm">暖色</option>
            <option value="softGlow">柔光</option>
            <option value="moody">情绪</option>
            <option value="dreamy">梦幻</option>
            <option value="dramatic">戏剧</option>
            <option value="faded">褪色</option>
          </select>
        </label>
      )}

      {visualTypes.has(element.getType()) && candidates.length > 0 && (
        <fieldset>
          <legend>转场</legend>
          <label>
            目标片段
            <select ref={transitionTargetRef} defaultValue={defaultTarget}>
              <option value="">请选择</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.id}</option>)}
            </select>
          </label>
          <div className="mvc-editor-inspector-grid">
            <label>
              类型
              <select defaultValue={transition?.kind || "none"} onChange={(event) => {
                const target = transitionTargetRef.current?.value;
                void commit(() => setTransition(editor, element.getId(), target, event.target.value, transition?.duration || 0.4));
              }}>
                <option value="none">无</option>
                <option value="fade">淡化</option>
                <option value="crossfade">交叉淡化</option>
              </select>
            </label>
            <label>
              时长
              <input type="number" min="0.05" step="0.05" defaultValue={transition?.duration || 0.4}
                onBlur={(event) => transition && void commit(() => setTransition(editor, element.getId(), transition.toElementId, transition.kind, Number(event.target.value)))} />
            </label>
          </div>
          <small className="mvc-editor-preview-note">Twick 当前不实时显示片段间转场；导出成片会按这里的设置渲染。</small>
        </fieldset>
      )}

      {matchingAssets.length > 0 && (
        <label>
          替换素材（保留剪辑参数）
          <select value={String(element.getMetadata()?.assetId || "")} onChange={(event) => {
            const asset = matchingAssets.find((candidate) => candidate.id === event.target.value);
            if (asset) void commit(() => replaceElementAsset(editor, element.getId(), asset));
          }}>
            <option value="">选择素材</option>
            {matchingAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select>
        </label>
      )}

      <dl>
        <dt>元素 ID</dt><dd>{element.getId()}</dd>
        <dt>素材 ID</dt><dd>{String(element.getMetadata()?.assetId || "—")}</dd>
      </dl>
      {error && <p className="mvc-editor-inspector-error">{error}</p>}
    </aside>
  );
}
