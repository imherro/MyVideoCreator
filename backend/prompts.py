"""Original production prompts, independent of reference application source."""
TEMPLATES = {
    'text': '你是中文短片编剧。根据用户需求写可拍摄的剧本，保留指定角色、人名、对白和结局。控制角色与场景数量，以可见动作推进情节，遵守目标时长。输出中文，不输出思考过程。',
    'storyboard': '你是短片分镜导演。将剧本转成连续镜头，每镜一个主要动作。角色、服装、地点保持连续；不得添加未要求的对白。镜头时长总和应符合用户要求。每镜填写 id、duration、scene、characters、action、camera、audio、image_prompt、video_prompt。image_prompt 必须描述本镜动作发生前的首帧，不得提前画出动作完成后的结果。对影响剧情的状态明确写出，例如灯熄灭、门关闭、手尚未接触；不要仅靠省略暗示初始状态。对“尚未发生”的可见状态，必须在 image_prompt 写出正向状态和排除项：例如灯完全熄灭、无任何发光、无光晕、无亮色指示；手与物体保持明确距离、尚未接触。video_prompt 从该首帧状态开始，描述随后发生的一个主要动作、最终状态与运镜。相邻镜头的初始状态要承接上一镜最终状态；同一事件不重复发生。提交前逐镜核对 image_prompt 与 video_prompt 的起止状态一致。仅输出 JSON 对象 {"title":"片名","shots":[...]}，所有人类可读字段使用简体中文。',
    'image': '描述一个确定的电影画面：主体、位置、动作瞬间、环境、构图、光线、材质。身份参考只锁定角色外观，构图参考只锁定空间与姿态，风格独立指定。不要把草稿纸、分镜标注或边框画入成片。',
    'video': '描述镜头内可实现的动作、起止状态、摄影机运动和声音。已有首帧时着重描述后续变化，不重新设计人物外观。一个短镜头只安排一个主要事件。',
}
SHOT_SCHEMA = {'type':'object','additionalProperties':False,'required':['title','shots'],'properties':{'title':{'type':'string'},'shots':{'type':'array','minItems':1,'maxItems':100,'items':{'type':'object','additionalProperties':False,'required':['id','duration','scene','characters','action','camera','audio','image_prompt','video_prompt'],'properties':{**{k:{'type':'string'} for k in ['id','scene','characters','action','camera','audio','image_prompt','video_prompt']},'duration':{'type':'number','minimum':1,'maximum':30}}}}}}

def validate_shots(value,target_duration=None):
    if not isinstance(value,dict) or not isinstance(value.get('shots'),list) or not value['shots']:
        raise ValueError('分镜结果没有有效镜头，请缩短剧本或更换文本模型。')
    if len(value['shots']) > 100:
        raise ValueError('单次最多生成 100 个镜头，请按段制作。')
    if not isinstance(value.get('title'),str) or not value['title'].strip():raise ValueError('分镜缺少片名')
    for i, shot in enumerate(value['shots']):
        if not isinstance(shot,dict) or not str(shot.get('image_prompt','')).strip() or not str(shot.get('video_prompt','')).strip():
            raise ValueError(f'第 {i+1} 镜缺少图像或视频提示词。')
        for field in ('scene','characters','action','camera','audio','image_prompt','video_prompt'):
            if not isinstance(shot.get(field),str) or not shot[field].strip():raise ValueError(f'第 {i+1} 镜的 {field} 字段缺失或为空，请明确填写；没有时填写“无”')
        duration = float(shot.get('duration',5))
        if not 1 <= duration <= 30:
            raise ValueError(f'第 {i+1} 镜时长超出 1–30 秒范围。')
        shot['id'] = f'shot-{i+1:03d}'
        shot['duration'] = duration
    if target_duration is not None:
        target=float(target_duration)
        if not 1<=target<=3000:raise ValueError('目标时长应为 1–3000 秒')
        actual=sum(shot['duration'] for shot in value['shots'])
        if abs(actual-target)>.5:raise ValueError(f'镜头总时长为 {actual:g} 秒，要求 {target:g} 秒；请重新分配每镜时长，误差不超过 0.5 秒')
    return value
