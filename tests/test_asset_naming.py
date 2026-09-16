from backend.providers.common import _registered_asset_name


def test_generated_asset_name_uses_shot_label_and_version():
    job = {"input": {"label": "shot-006 · 视频"}}
    assert _registered_asset_name(job, "生成结果.mp4", ".mp4", 1) == "镜头 06 · 视频 · V2.mp4"


def test_explicit_asset_name_wins_over_provider_generic_name():
    job = {"input": {"output_name": "球球 · 主参考图 · V1.png", "label": "ignored"}}
    assert _registered_asset_name(job, "Seedream 生成图.png", ".png") == "球球 · 主参考图 · V1.png"


def test_uploaded_or_specific_provider_names_stay_unchanged():
    job = {"input": {"label": "shot-001 · 视频"}}
    assert _registered_asset_name(job, "导演导入.mp4", ".mp4") == "导演导入.mp4"
