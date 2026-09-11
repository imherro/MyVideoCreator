import json
from .models import VISUAL_BIBLE_SCHEMA,BOUND_STORYBOARD_SCHEMA,VISUAL_EXTRACTOR_PROMPT,STORYBOARD_DIRECTOR_PROMPT
from .validate import normalize_visual_bible,normalize_bound_storyboard

def _json(text,label):
    value=text.strip()
    if value.startswith('```'):
        value=value[value.find('\n')+1:]
        if value.rstrip().endswith('```'):value=value.rstrip()[:-3].rstrip()
    starts=[position for position in (value.find('{'),value.find('[')) if position>=0]
    if not starts:raise ValueError(label+'没有返回 JSON 值')
    try:return json.JSONDecoder().raw_decode(value[min(starts):])[0]
    except json.JSONDecodeError as exc:raise ValueError(label+' JSON 格式无效') from exc

def _visual(value):
    if isinstance(value,list):return {'cards':value}
    if isinstance(value,dict) and not isinstance(value.get('cards'),list):
        for key in ('visual_bible','visualBible','entities'):
            if isinstance(value.get(key),list):return {'cards':value[key]}
    return value

def extract_storyboard(script,target_duration,provider_id,model_id,request):
    """One user action, two internal text passes. No media provider is called."""
    visual_text=request(VISUAL_EXTRACTOR_PROMPT,script,VISUAL_BIBLE_SCHEMA,'提取视觉圣经')
    try:
        bible,key_ids=normalize_visual_bible(_visual(_json(visual_text,'视觉圣经')),provider_id,model_id);visual_repair_count=0
    except (ValueError,TypeError) as exc:
        repair=script+'\n\n上次视觉圣经未通过校验：'+str(exc)+'\n请修正并输出完整 JSON。上次结果：\n'+visual_text[:24000]
        visual_text=request(VISUAL_EXTRACTOR_PROMPT,repair,VISUAL_BIBLE_SCHEMA,'修正视觉圣经')
        try:bible,key_ids=normalize_visual_bible(_visual(_json(visual_text,'视觉圣经')),provider_id,model_id);visual_repair_count=1
        except (ValueError,TypeError) as final:raise ValueError('视觉圣经修正后仍不符合要求：'+str(final)) from final
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
    return {'text':json.dumps(storyboard,ensure_ascii=False),'filmBible':{'visual':bible},**storyboard,
      'repair_count':visual_repair_count+repair_count,'visual_repair_count':visual_repair_count,'storyboard_repair_count':repair_count}
