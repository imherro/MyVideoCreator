from pathlib import Path

import pytest

from backend.editor_renderer import EditorRenderCompiler


def element(asset_id='asset-1', start=0, end=1):
    return {
        'id': 'element-1', 'type': 'image', 's': start, 'e': end,
        'props': {'srcAssetId': asset_id}, 'metadata': {'assetId': asset_id},
        'frame': {'x': 0, 'y': 0, 'size': [128, 128]},
    }


def test_editor_compiler_rejects_cross_project_assets(tmp_path):
    project = {'version': 2, 'tracks': [{'id': 'v1', 'name': 'V1', 'elements': [element()]}]}
    compiler = EditorRenderCompiler(
        'project-a', project, (128, 128), tmp_path,
        lambda _asset_id: {'id': 'asset-1', 'project_id': 'project-b', 'kind': 'image', 'absolute_path': str(tmp_path / 'x.png')},
        lambda _path: {},
    )
    with pytest.raises(ValueError, match='属于其他项目'):
        compiler.compile('ffmpeg', Path(tmp_path / 'out.mp4'))


@pytest.mark.parametrize('start,end', [(-1, 1), (1, 1), (0, 21601)])
def test_editor_compiler_rejects_invalid_element_ranges(tmp_path, start, end):
    project = {'version': 2, 'tracks': [{'id': 'v1', 'name': 'V1', 'elements': [element(start=start, end=end)]}]}
    with pytest.raises(ValueError, match='时间范围无效'):
        EditorRenderCompiler('project-a', project, (128, 128), tmp_path, lambda _: None, lambda _: {})
