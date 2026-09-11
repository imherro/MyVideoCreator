import time
from .. import store as s

KINDS={'character','character_state','scene','scene_state','prop'}

def _text(value,label):
    result=str(value or '').strip()
    if not result:raise ValueError(label+'不能为空')
    return result

def normalize_visual_bible(value,provider_id='',model_id=''):
    if not isinstance(value,dict) or not isinstance(value.get('cards'),list) or not value['cards']:raise ValueError('视觉圣经没有有效卡片')
    raw={};semantic=set()
    for index,item in enumerate(value['cards']):
        if not isinstance(item,dict):raise ValueError(f'第 {index+1} 张视觉卡无效')
        key=_text(item.get('key'),f'第 {index+1} 张视觉卡 key');kind=item.get('kind');name=_text(item.get('name'),f'视觉卡 {key} 名称')
        if kind not in KINDS:raise ValueError(f'视觉卡 {key} 类型无效')
        if key in raw:raise ValueError(f'视觉卡 key 重复：{key}')
        semantic_key=(kind,name.casefold().replace(' ',''))
        if semantic_key in semantic:raise ValueError(f'存在重复语义视觉卡：{name}')
        semantic.add(semantic_key);raw[key]=item
    for key,item in raw.items():
        parent=str(item.get('parent_key') or '').strip()
        expected={'character_state':'character','scene_state':'scene'}.get(item['kind'])
        if expected:
            if parent not in raw or raw[parent].get('kind')!=expected:raise ValueError(f'视觉状态 {key} 的 parent_key 无效')
        elif parent:raise ValueError(f'基础视觉卡 {key} 不应设置 parent_key')
    cards={};versions={};keys={}
    for key,item in raw.items():
        card_id=s.uid('vc-');version_id=s.uid('vv-');keys[key]=(card_id,version_id)
        cards[card_id]={'id':card_id,'kind':item['kind'],'name':_text(item['name'],key),'parentCardId':None,'currentVersionId':version_id,'status':'active','source':{'type':'script_extraction','key':key}}
        versions[version_id]={'id':version_id,'cardId':card_id,'version':1,'parentVersionId':None,'status':'draft',
          'spec':{'description':_text(item.get('description'),f'视觉卡 {key} 描述'),'attributes':[{'name':_text(x.get('name'),'属性名'),'value':_text(x.get('value'),'属性值')} for x in item.get('attributes',[]) if isinstance(x,dict)]},
          'invariants':[_text(x,'锁定项') for x in item.get('invariants',[])], 'references':[], 'createdAt':time.time(),
          'provenance':{'source':'script_extraction','providerId':provider_id,'modelId':model_id}}
    for key,item in raw.items():
        parent=str(item.get('parent_key') or '').strip();card_id,version_id=keys[key]
        if parent:
            cards[card_id]['parentCardId']=keys[parent][0]
            versions[version_id]['parentVersionId']=keys[parent][1]
    return {'cards':cards,'versions':versions},keys

def normalize_bound_storyboard(value,bible,key_ids,target_duration=None):
    if not isinstance(value,dict) or not isinstance(value.get('shots'),list) or not value['shots']:raise ValueError('分镜结果没有有效镜头')
    cards=bible['cards'];versions=bible['versions'];shots=[]
    for index,item in enumerate(value['shots']):
        if not isinstance(item,dict):raise ValueError(f'第 {index+1} 镜无效')
        for field in ('scene','characters','action','emotion','camera','audio','image_prompt','video_prompt'):_text(item.get(field),f'第 {index+1} 镜 {field}')
        char_keys=item.get('character_keys');prop_keys=item.get('prop_keys');scene_key=str(item.get('scene_key') or '').strip()
        if not isinstance(char_keys,list) or not isinstance(prop_keys,list):raise ValueError(f'第 {index+1} 镜绑定格式无效')
        referenced=[*char_keys,*prop_keys,*([scene_key] if scene_key else [])]
        missing=[key for key in referenced if key not in key_ids]
        if missing:raise ValueError(f'第 {index+1} 镜存在悬空视觉引用：{", ".join(missing)}')
        for key in char_keys:
            if cards[key_ids[key][0]]['kind'] not in ('character','character_state'):raise ValueError(f'第 {index+1} 镜将非角色卡绑定为角色：{key}')
        for key in prop_keys:
            if cards[key_ids[key][0]]['kind']!='prop':raise ValueError(f'第 {index+1} 镜将非道具卡绑定为道具：{key}')
        if scene_key and cards[key_ids[scene_key][0]]['kind'] not in ('scene','scene_state'):raise ValueError(f'第 {index+1} 镜将非场景卡绑定为场景：{scene_key}')
        duration=float(item.get('duration',5))
        if not 1<=duration<=30:raise ValueError(f'第 {index+1} 镜时长超出 1–30 秒')
        shot={k:v for k,v in item.items() if k not in ('character_keys','scene_key','prop_keys')}
        shot.update(id=f'shot-{index+1:03d}',uid=s.uid('shot-'),order=index+1,duration=duration,pipeline={},assetBindings={
          'characters':[{'role':cards[key_ids[key][0]]['name'],'versionId':key_ids[key][1]} for key in char_keys],
          'scene':{'versionId':key_ids[scene_key][1]} if scene_key else None,
          'props':[{'role':cards[key_ids[key][0]]['name'],'versionId':key_ids[key][1]} for key in prop_keys]})
        shots.append(shot)
    if target_duration is not None:
        actual=sum(x['duration'] for x in shots);target=float(target_duration)
        if abs(actual-target)>.5:raise ValueError(f'镜头总时长为 {actual:g} 秒，要求 {target:g} 秒；请重新分配每镜时长，误差不超过 0.5 秒')
    return {'title':_text(value.get('title'),'分镜片名'),'shots':shots}
