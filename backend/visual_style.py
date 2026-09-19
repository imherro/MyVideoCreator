"""One style contract for all new image/video jobs; existing task snapshots stay frozen."""
import json
import re
from pathlib import Path

PRESETS={p['name']:p['prompt'] for p in json.loads((Path(__file__).resolve().parent.parent/'shared'/'visual_styles.json').read_text(encoding='utf-8'))}
START='[项目视觉风格]'
END='[/项目视觉风格]'


def style_context(document):
    name=str(document.get('style') or '').strip()
    bible=document.get('filmBible') or {}
    return {'version':'visual-style/v2','name':name,'description':PRESETS.get(name,name),
            'bibleStyle':bible.get('style') or {},'continuity':bible.get('continuity') or {}}


def style_conflicts(context):
    """Conservative detection; do not rewrite the saved Bible or references."""
    name = context.get('name') or ''
    tone = str((context.get('bibleStyle') or {}).get('visualTone') or '')
    if any(t in name for t in ('2D','漫画','动漫','卡通','水墨','粘土','绘本')) and any(t in tone for t in ('以电影写实','真实皮肤','真人写实','真实人类肤质')):
        return ['Bible 视觉基调仍含写实要求；本次采用当前项目风格，旧视觉基调留在快照中，请在创作约束中审核更新。']
    return []


def compile_visual_style(document, kind, value, context=None):
    result=dict(value)
    if kind not in ('image','video','storyboard'):return result
    context=context if context is not None else style_context(document)
    # Only replace our delimited block; never edit creative descriptions or dialogue.
    prompt=re.sub(re.escape(START)+r'.*?'+re.escape(END),'',str(result.get('prompt') or ''),flags=re.S).strip()
    if not prompt:return result
    warnings=style_conflicts(context)
    lines=[START,'项目风格：'+(context['name'] or '未指定'),'风格描述：'+(context['description'] or '按镜头要求')]
    if kind == 'storyboard':
        for key,label in (('bibleStyle','视觉圣经风格'),('continuity','一致性约束')):
            if context.get(key):lines.append(label+'：'+json.dumps(context[key],ensure_ascii=False,sort_keys=True,separators=(',',':')))
    else:
        # Narrative continuity/avoidItems are planning inputs, not per-frame rendering rules.
        # Keep the full snapshot above for inspection; never truncate user shot text.
        style=context.get('bibleStyle') or {}
        for key,label in (('visualTone','视觉基调'),('colorLighting','色彩光线'),('cameraLanguage','镜头语言'),('palette','色板'),('lighting','布光')):
            if key=='visualTone' and warnings:continue
            if style.get(key):lines.append(label+'：'+str(style[key]))
        # Exclude clearly editorial rules only; retain unclassified prohibitions.
        avoid=[str(x) for x in style.get('avoidItems',[]) if not any(t in str(x) for t in ('付费','集数','拆分','合并','剧情反转','创作剧本','时长单位'))]
        if avoid:lines.append('避免：'+'；'.join(dict.fromkeys(avoid)))
    lines.extend(['当前项目风格是最终渲染风格；历史设定或参考图的写实/漫画媒介风格与之冲突时，以当前项目风格为准。保留人物身份、身体结构、服装造型、道具特征与本镜动作，不照搬参考图的旧渲染风格。',END])
    result['visual_style_projection']={'version':1,'scope':kind,'excludedFields':[] if kind=='storyboard' else ['continuity','style.avoidItems.editorial'],'warnings':warnings,'reason':'全局剧情承接与改编禁忌供规划使用；镜头约束由绑定资产和用户描述提供'}
    result.update(prompt=prompt+'\n\n'+'\n'.join(lines),visual_style=context)
    return result
