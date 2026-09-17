"""One read-only image specification resolver for UI previews and submissions.

Legacy node.resolution was overwritten at submission. Only the explicit
imageSettings field opts into a size override; old projects retain their frame.
"""
import re

IMAGE_SIZES = {
    '21:9': '2048x864', '16:9': '2048x1152', '4:3': '2048x1536',
    '1:1': '2048x2048', '3:4': '1536x2048', '9:16': '1152x2048',
}


def resolve_image_settings(document, value, provider):
    panorama = value.get('imagePurpose') == 'panorama'
    ratio = '2:1' if panorama else str(document.get('ratio') or '16:9')
    if not panorama and ratio not in IMAGE_SIZES:
        raise ValueError('请先设置项目图像画幅比例')
    if panorama and provider.get('type') == 'runninghub':
        raise ValueError('当前 RunningHub 适配器尚未支持 2:1 全景出图，请选择支持像素尺寸的图像服务或上传全景图')
    settings = value.get('imageSettings') or {}
    if not isinstance(settings, dict):
        raise ValueError('图像生成设置格式无效')
    mode = settings.get('sizeMode') or 'project'
    workflow = str(provider.get('workflow') or '')
    local_size = provider.get('type') == 'maestro' or (
        provider.get('type') == 'comfy' and '{{width}}' in workflow and '{{height}}' in workflow
    )
    seed_supported = provider.get('type') == 'maestro' or (
        provider.get('type') == 'comfy' and '{{seed}}' in str(provider.get('workflow') or '')
    )
    choices = [{'value': 'project', 'label': '跟随项目画幅 · 推荐尺寸'}]
    if local_size:
        choices += [{'value': 'video', 'label': '与项目视频像素一致'},
                    {'value': 'custom', 'label': '自定义像素尺寸'}]
    if mode not in {item['value'] for item in choices}:
        raise ValueError('当前图像适配器未开放此尺寸选项，请选择跟随项目画幅；不会静默覆盖尺寸')
    size = '3072x1536' if panorama else IMAGE_SIZES.get(ratio, '2048x2048')
    if mode == 'video':
        # Video output uses a short-edge resolution and the project frame.
        short = {'480p': 480, '720p': 720, '1080p': 1080}.get(document.get('videoResolution'), 720)
        a, b = (int(part) for part in ratio.split(':'))
        width, height = (round(short * a / b), short) if a >= b else (short, round(short * b / a))
        size = f'{width // 8 * 8}x{height // 8 * 8}'
    elif mode == 'custom':
        size = str(settings.get('size') or '')
        if not re.fullmatch(r'\d{3,4}x\d{3,4}', size):
            raise ValueError('图像尺寸请输入宽x高，例如 1280x720')
        width, height = map(int, size.split('x'))
        if not all(256 <= n <= 4096 and n % 8 == 0 for n in (width, height)):
            raise ValueError('图像宽高应为 256–4096，且为 8 的倍数')
        a, b = (int(part) for part in ratio.split(':'))
        if abs(width / height / (a / b) - 1) > .02:
            raise ValueError('自定义图片尺寸须与项目画幅一致（允许像素对齐误差）')
    seed = settings.get('seed', value.get('seed', -1))
    if isinstance(seed, bool) or not isinstance(seed, int) or not -1 <= seed <= 2147483647:
        raise ValueError('随机种子应为 -1 或 0–2147483647 的整数')
    if not seed_supported and 'seed' in settings and seed != -1:
        raise ValueError('当前图像适配器未实现固定随机种子，请改用随机生成')
    return {
        'version': 'image-settings/v1', 'sizeMode': mode, 'ratio': ratio, 'size': size,
        'seedSupported': seed_supported, 'seed': seed if seed_supported else None,
        'sizeOptions': choices,
        'sizeNote': ('全景原图固定使用 2:1；取景输出另行跟随项目画幅。' if panorama else
                    'RunningHub 按 2K 档位出图，实际像素以生成结果为准。'
                     if provider.get('type') == 'runninghub' else
                     '图像尺寸独立于视频输出分辨率；画幅跟随项目。'),
    }
