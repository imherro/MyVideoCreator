import pytest
from backend.state_review import require_video_source_reviews, unreviewed_image_sources


def document(asset=True, reviewed=False):
    return {
        'nodes': [
            {'id': 'image', 'data': {
                'kind': 'image', 'label': '第 1 镜 · 分镜图',
                'prompt': '机器人胸灯完全熄灭，无任何发光、无光晕',
                'assetId': 'frame' if asset else '',
                'state_reviewed': reviewed,
            }},
            {'id': 'video', 'data': {'kind': 'video'}},
        ],
        'edges': [{'source': 'image', 'target': 'video'}],
    }


def test_state_review_is_required_only_when_a_frame_is_ready():
    assert unreviewed_image_sources(document(asset=False), 'video') == []
    assert unreviewed_image_sources(document(), 'video') == ['第 1 镜 · 分镜图']
    with pytest.raises(ValueError, match='确认首帧状态'):
        require_video_source_reviews(document(), 'video')
    require_video_source_reviews(document(reviewed=True), 'video')


def test_worker_guard_includes_a_pending_generated_source():
    assert unreviewed_image_sources(document(asset=False), 'video', include_pending=True)
