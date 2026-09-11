import {
  AudioElement,
  ImageElement,
  VideoElement,
  type Size,
  type TrackElement,
} from "@twick/timeline";
import type { MediaItem } from "@twick/video-editor";
import type { EditorAsset } from "./editorDocument";

export const TWICK_MEDIA_DRAG_TYPE = "application/x-twick-media";

export function assetToMediaItem(asset: EditorAsset): MediaItem {
  const duration = Number(asset.metadata?.duration);
  return {
    id: asset.id,
    name: asset.name,
    type: asset.kind,
    url: asset.url,
    previewUrl: asset.metadata?.thumbnail_url,
    thumbnail: asset.metadata?.thumbnail_url,
    duration: Number.isFinite(duration) && duration > 0 ? duration * 1000 : undefined,
    width: Number(asset.metadata?.width) || undefined,
    height: Number(asset.metadata?.height) || undefined,
    source: "user",
    origin: "my-video-creator",
    metadata: { ...asset.metadata, assetId: asset.id, title: asset.name },
  };
}

export function assetToTwickElement(
  asset: EditorAsset,
  resolution: Size,
): TrackElement {
  let element: TrackElement;
  if (asset.kind === "video") {
    element = new VideoElement(asset.url, resolution);
  } else if (asset.kind === "audio") {
    element = new AudioElement(asset.url);
  } else if (asset.kind === "image") {
    element = new ImageElement(asset.url, resolution);
  } else {
    throw new Error(`不支持加入剪辑器的素材类型：${asset.kind}`);
  }
  element.setName(asset.name);
  element.setMetadata({
    assetId: asset.id,
    assetSource: "my-video-creator",
  });
  element.setProps({ ...element.getProps(), srcAssetId: asset.id });
  return element;
}
