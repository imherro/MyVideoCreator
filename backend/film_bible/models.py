VISUAL_BIBLE_SCHEMA={
 'type':'object','additionalProperties':False,'required':['cards'],'properties':{'cards':{'type':'array','minItems':1,'maxItems':100,'items':{
  'type':'object','additionalProperties':False,'required':['key','kind','name','parent_key','description','attributes','invariants'],'properties':{
   'key':{'type':'string'},'kind':{'type':'string','enum':['character','character_state','scene','scene_state','prop']},
   'name':{'type':'string'},'parent_key':{'type':'string'},'description':{'type':'string'},
   'attributes':{'type':'array','maxItems':30,'items':{'type':'object','additionalProperties':False,'required':['name','value'],'properties':{'name':{'type':'string'},'value':{'type':'string'}}}},
   'invariants':{'type':'array','maxItems':20,'items':{'type':'string'}}
 }}}}
}

BOUND_STORYBOARD_SCHEMA={
 'type':'object','additionalProperties':False,'required':['title','shots'],'properties':{'title':{'type':'string'},'shots':{'type':'array','minItems':1,'maxItems':100,'items':{
  'type':'object','additionalProperties':False,
  'required':['duration','scene','characters','action','emotion','camera','audio','image_prompt','video_prompt','character_keys','scene_key','prop_keys','dialogues'],
  'properties':{
   **{key:{'type':'string'} for key in ('scene','characters','action','emotion','camera','audio','image_prompt','video_prompt','scene_key')},
   'duration':{'type':'number','minimum':1,'maximum':30},
   'character_keys':{'type':'array','maxItems':20,'items':{'type':'string'}},
   'prop_keys':{'type':'array','maxItems':20,'items':{'type':'string'}}
   ,'dialogues':{'type':'array','maxItems':20,'items':{'type':'object','additionalProperties':False,'required':['character_key','text','emotion'],'properties':{
    'character_key':{'type':'string'},'text':{'type':'string'},'emotion':{'type':'string'}
   }}}
  }
 }}}
}

VISUAL_EXTRACTOR_PROMPT='''你是影视视觉圣经设计师。根据剧本提取跨镜头复用的视觉实体，只输出符合 Schema 的 JSON。
kind 只允许 character、character_state、scene、scene_state、prop。基础角色/场景/道具 parent_key 为空；角色状态必须指向 character，场景状态必须指向 scene。
只有跨多个镜头持续存在并影响连续性的变化才建立状态：服装、妆容、年龄阶段、持续伤势、污渍、湿身、昼夜、天气、季节、停电、破损等。动作、姿态、视线、表情和短暂情绪不能成为状态。
key 使用简短稳定的英文或拼音语义键。description 和 attributes 描述可见特征，invariants 写不可改变项。同一人物、场景或道具只能建立一个语义基础卡。本阶段只生成文字数据，禁止要求生成图片。'''

STORYBOARD_DIRECTOR_PROMPT='''你是短片分镜导演。根据剧本和已校验的视觉圣经生成连续镜头，只输出符合 Schema 的 JSON。
character_keys、scene_key、prop_keys 只能引用提供的视觉 key；不能新建近义角色、场景或状态。每镜围绕一个叙事目的，总时长符合要求。
emotion、动作、姿态、视线属于镜头变量。dialogues 逐条填写本镜对白，character_key 必须引用本镜角色基础卡或角色状态卡对应的 key；没有对白时使用空数组。image_prompt 描述可选构图预览的开场画面。video_prompt 独立描述开场状态、随后动作、最终状态、环境声与动作声；有对白时还必须逐字写入“角色名（情绪）说：\"台词原文\"”，不得只写“说出相应内容”或对白概要。不要在镜头提示词中重新设计人物、服装或场景。没有场景或道具绑定时使用空字符串或空数组。'''

from ..prompt_policy import VISUAL, STORYBOARD
VISUAL_EXTRACTOR_PROMPT += VISUAL
STORYBOARD_DIRECTOR_PROMPT += STORYBOARD
