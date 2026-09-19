"""Fixed layout for newly submitted character-reference images only."""
LAYOUT = 'character-sheet/v1'
PROMPT = """角色定妆设定板：固定 1:1 正方形画幅，上下两排。上排三个面部特写：正面、四分之三侧面、纯侧面；下排四个完整全身视角：正面、四分之三侧面、侧面、背面。各视角间留少量空隙，面部清晰，全身从头顶到脚底完整不裁切，自然站立。
七个视图均为同一角色、同一服装及当前身体状态，五官、年龄、发型、头饰、体型、配饰和结构一致；不得为补齐视图而增加不存在的手臂或身体部件。干净白色或浅灰背景，柔和均匀布光，无文字、水印、装饰或剧情场景。项目风格决定表现方式，版式保持不变。
若使用基础角色参考，保留未改变的身份与结构，当前状态明确指定的服装、身体形态变化优先；所有七视图统一为当前状态。"""
REFERENCE_RULE = '若角色参考为多视角设定板，各视图属于同一身份；只提取外观和结构，不复制拼版、分栏、白底或额外人物，出场人数与构图以本镜为准。'

def prepare_character_sheet(document,value):
    marker=value.get('visual_reference')
    if not isinstance(marker,dict):return value
    visual=(document.get('filmBible') or {}).get('visual') or {}
    version=(visual.get('versions') or {}).get(marker.get('versionId')) or {}
    card=(visual.get('cards') or {}).get(version.get('cardId')) or {}
    if card.get('kind') not in ('character','character_state'):return value
    result=dict(value)
    result.update(imagePurpose='character_sheet',character_sheet_version=LAYOUT)
    prompt=str(value.get('prompt') or '')
    result['prompt']=prompt if PROMPT in prompt else prompt+'\n\n'+PROMPT
    return result
