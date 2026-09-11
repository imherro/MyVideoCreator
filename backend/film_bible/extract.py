import json
from .models import VISUAL_BIBLE_SCHEMA,BOUND_STORYBOARD_SCHEMA,VISUAL_EXTRACTOR_PROMPT,STORYBOARD_DIRECTOR_PROMPT
from .validate import normalize_visual_bible,normalize_bound_storyboard

def _json(text,label):
    start=text.find('{');end=text.rfind('}')
    if start<0 or end<start:raise ValueError(label+'没有返回 JSON 对象')
    try:return json.loads(text[start:end+1])
    except json.JSONDecodeError as exc:raise ValueError(label+' JSON 格式无效') from exc

def extract_storyboard(script,target_duration,provider_id,model_id,request):
    """One user action, two internal text passes. No media provider is called."""
    raw_bible=_json(request(VISUAL_EXTRACTOR_PROMPT,script,VISUAL_BIBLE_SCHEMA,'提取视觉圣经'),'视觉圣经')
    bible,key_ids=normalize_visual_bible(raw_bible,provider_id,model_id)
    allowed=[{'key':item['source']['key'],'kind':item['kind'],'name':item['name'],'spec':bible['versions'][item['currentVersionId']]['spec']} for item in bible['cards'].values()]
    duration=f'\n镜头总时长必须为 {target_duration} 秒，误差不超过 0.5 秒。' if target_duration else ''
    user='剧本：\n'+script+'\n\n只允许引用以下视觉卡：\n'+json.dumps(allowed,ensure_ascii=False)+duration
    text=request(STORYBOARD_DIRECTOR_PROMPT,user,BOUND_STORYBOARD_SCHEMA,'基于视觉圣经拆解分镜')
    try:storyboard=normalize_bound_storyboard(_json(text,'分镜'),bible,key_ids,target_duration);repair_count=0
    except (ValueError,TypeError) as exc:
        repair=user+'\n\n上次分镜未通过绑定校验：'+str(exc)+'\n请保持剧情并修正完整 JSON。上次结果：\n'+text[:24000]
        text=request(STORYBOARD_DIRECTOR_PROMPT,repair,BOUND_STORYBOARD_SCHEMA,'修正分镜视觉绑定')
        try:storyboard=normalize_bound_storyboard(_json(text,'分镜'),bible,key_ids,target_duration);repair_count=1
        except (ValueError,TypeError) as final:raise ValueError('分镜修正后仍不符合要求：'+str(final)) from final
    return {'text':json.dumps(storyboard,ensure_ascii=False),'filmBible':{'visual':bible},**storyboard,'repair_count':repair_count}
