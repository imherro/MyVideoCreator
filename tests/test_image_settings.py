import copy
import pytest
from backend.image_settings import resolve_image_settings


@pytest.mark.parametrize('ratio,size', [('16:9', '2048x1152'), ('9:16', '1152x2048'), ('1:1', '2048x2048')])
def test_legacy_size_does_not_change_historical_frame(ratio, size):
    value = {'resolution': '720x1280', 'size': '512x512', 'seed': 42}
    old = copy.deepcopy(value)
    spec = resolve_image_settings({'ratio': ratio}, value, {'type': 'volcengine_ark'})
    assert spec['size'] == size
    assert spec['seed'] is None
    assert value == old


def test_explicit_local_size_and_seed_override():
    document = {'ratio': '16:9', 'videoResolution': '720p'}
    spec = resolve_image_settings(document, {'imageSettings': {'sizeMode': 'custom', 'size': '1536x864', 'seed': 23}}, {'type': 'maestro'})
    assert spec['size'] == '1536x864' and spec['seed'] == 23
    spec = resolve_image_settings(document, {'imageSettings': {'sizeMode': 'video'}}, {'type': 'maestro'})
    assert spec['size'] == '1280x720'


@pytest.mark.parametrize('settings', [
    {'sizeMode': 'custom', 'size': '720x1280'},
    {'sizeMode': 'custom', 'size': '1281x720'},
    {'sizeMode': 'custom', 'size': '16384x9216'},
    {'seed': 1.5}, {'seed': -2}, {'seed': 2147483648},
])
def test_reject_invalid_local_settings(settings):
    with pytest.raises(ValueError):
        resolve_image_settings({'ratio': '16:9'}, {'imageSettings': settings}, {'type': 'maestro'})


@pytest.mark.parametrize('kind', ['volcengine_ark', 'hc_atom', 'runninghub', 'openai'])
def test_cloud_rejects_unimplemented_overrides_instead_of_ignoring_them(kind):
    for settings in ({'sizeMode': 'video'}, {'seed': 42}):
        with pytest.raises(ValueError):
            resolve_image_settings({'ratio': '16:9'}, {'imageSettings': settings}, {'type': kind})


def test_comfy_requires_template_placeholders_before_exposing_controls():
    spec = resolve_image_settings({}, {}, {'type': 'comfy', 'workflow': {}})
    assert not spec['seedSupported'] and len(spec['sizeOptions']) == 1
    spec = resolve_image_settings({}, {}, {'type': 'comfy', 'workflow': {'seed': '{{seed}}', 'width': '{{width}}', 'height': '{{height}}'}})
    assert spec['seedSupported'] and len(spec['sizeOptions']) == 3
