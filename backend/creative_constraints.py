"""Draft-only creative constraints; applying remains an explicit user action."""
import json

FIELDS = ('summary', 'worldEra', 'visualTone', 'colorLighting', 'cameraLanguage', 'characterSceneConsistency', 'avoidItems')
SCHEMA = {'type':'object','properties':{key:{'type':'string','maxLength':6000} for key in FIELDS},'required':list(FIELDS),'additionalProperties':False}
SYSTEM = """你是影视编剧顾问，为全作品起草简洁、可执行的创作约束，不生成剧本或视觉资产。
依据输入已有原著、剧本、改编策划和用户约束，区分确定事实与建议。缺少依据的内容明确标为【建议】，不发明人物能力、禁令或世界观事实。资料不足时只给少量建议。
保留已有手工约束的含义，冲突以用户已有约束为准，需调整的内容标为【待确认】，不能擅自覆盖设定。
summary 写故事方向、叙事节奏、对白口吻及改编边界；worldEra 写人物与世界规则；characterSceneConsistency 写跨集一致性要求；avoidItems 每行一项。
视觉字段只补充有依据的表达，不另定画幅、分辨率、时长，不改项目视觉风格，不代替角色定妆或声音绑定。无信息字段可为空。视觉基调、色彩光线、镜头语言各建议不超过120字，只写全片通用的视觉规则，不列举整部剧情和各场次，不重复人物资产外观。故事、剧情承接和禁忌分别放入对应字段。项目当前 style 是明确用户选择，已有约束中的旧渲染风格与之冲突时，提出符合当前 style 的新视觉草稿；保留人物身份、服装造型与物理结构，说明建议更新旧风格参考图，不要求自动重生成。建议和待确认事项明确标注，不把未确定事项写成事实。每项简洁，不输出推理过程，只返回符合 Schema 的 JSON。"""

def validate_draft(raw):
    value=json.loads(raw)
    if not isinstance(value,dict) or set(value)!=set(FIELDS):
        raise ValueError('创作约束草稿字段不完整，请重新起草；原有约束未改变')
    for key in FIELDS:
        if not isinstance(value[key],str) or len(value[key])>6000:
            raise ValueError('创作约束草稿字段无效：'+key)
    if not any(value.values()):raise ValueError('创作约束草稿为空；原有约束未改变')
    return value

def context_for_draft(c,state):
    pid=state['project']['production_id']
    doc=state['document']; bible=doc.get('filmBible') or {}
    chapters=[dict(r) for r in c.execute("""SELECT ch.title,ch.content FROM source_chapters ch JOIN source_documents sd ON sd.id=ch.source_id
        WHERE sd.production_id=? AND NOT EXISTS(SELECT 1 FROM deleted_items d WHERE (d.kind='source' AND d.item_id=sd.id) OR (d.kind='chapter' AND d.item_id=ch.id)) ORDER BY sd.created,ch.sort_order""",(pid,))]
    scripts=[dict(r) for r in c.execute("""SELECT p.episode_no,e.title,e.body FROM episode_scripts e JOIN projects p ON p.id=e.project_id WHERE p.production_id=?
        AND NOT EXISTS(SELECT 1 FROM deleted_items d WHERE d.kind='project' AND d.item_id=p.id) ORDER BY p.episode_no""",(pid,))]
    events=[dict(r) for r in c.execute("""SELECT e.chapter_id,e.summary,e.continuity FROM source_events e JOIN source_chapters ch ON ch.id=e.chapter_id JOIN source_documents sd ON sd.id=ch.source_id WHERE e.production_id=? AND NOT EXISTS(SELECT 1 FROM deleted_items d WHERE (d.kind='source' AND d.item_id=sd.id) OR (d.kind='chapter' AND d.item_id=ch.id)) ORDER BY ch.sort_order,e.event_order""",(pid,))]
    context={'name':state['production']['name'],'style':doc.get('style'),'existing':{k:bible.get(k,{}) for k in ('story','style','continuity')},'adaptation':state['production_context'].get('adaptationPlan'), 'episodePlans':state['production_context'].get('episodePlans',[]),'events':events,'chapters':chapters,'scripts':scripts}
    encoded=json.dumps(context,ensure_ascii=False)
    if len(encoded)>160000:raise ValueError('现有原著与剧本过长，请先手动提炼共享设定；本次未提交 AI 任务')
    return encoded
