"""Guard the hand-off from a state-sensitive still to video generation."""
import re

_VISIBLE_PRE_ACTION_STATE = re.compile(
    r"完全熄灭|熄灭|无任何发光|无光晕|未接触|尚未接触|保持明确距离|门关闭|尚未开启|未开启"
)


def requires_initial_state_review(prompt):
    return bool(_VISIBLE_PRE_ACTION_STATE.search(str(prompt or "")))


def unreviewed_image_sources(document, video_node_id, include_pending=False):
    """Return direct image parents that still require a human first-frame check.

    `include_pending` is used by the worker after an upstream image job has
    completed. The saved canvas may not yet have received that browser event,
    but its image node still describes a state-sensitive opening frame.
    """
    nodes = {str(node.get("id")): node for node in document.get("nodes", [])}
    sources = []
    for edge in document.get("edges", []):
        if str(edge.get("target")) != str(video_node_id):
            continue
        source = nodes.get(str(edge.get("source")), {})
        data = source.get("data", {})
        if data.get("kind") != "image" or not requires_initial_state_review(data.get("prompt")):
            continue
        if data.get("state_reviewed"):
            continue
        if include_pending or data.get("assetId"):
            sources.append(str(data.get("label") or source.get("id") or "分镜图"))
    return sources


def require_video_source_reviews(document, video_node_id, include_pending=False):
    shot = next((shot for shot in document.get('shots', [])
                 if (shot.get('videoNode') or (shot.get('pipeline') or {}).get('videoNodeId')) == video_node_id), {})
    if (shot.get('videoReferenceMode') or document.get('videoReferenceMode')) == 'multimodal':
        return
    sources = unreviewed_image_sources(document, video_node_id, include_pending)
    if sources:
        raise ValueError("请先在关联分镜图中确认首帧状态，再生成视频：" + "、".join(sources))
