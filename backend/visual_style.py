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
    return {'version':'visual-style/v1','name':name,'description':PRESETS.get(name,name),
            'bibleStyle':bible.get('style') or {},'continuity':bible.get('continuity') or {}}


def compile_visual_style(document, kind, value, context=None):
    result=dict(value)
    if kind not in ('image','video','storyboard'):return result
    context=context if context is not None else style_context(document)
    # Only replace our delimited block; never edit creative descriptions or dialogue.
    prompt=re.sub(re.escape(START)+r'.*?'+re.escape(END),'',str(result.get('prompt') or ''),flags=re.S).strip()
    if not prompt:return result
    lines=[START,'项目风格：'+(context['name'] or '未指定'),'风格描述：'+(context['description'] or '按镜头要求')]
    for key,label in (('bibleStyle','视觉圣经风格'),('continuity','一致性约束')):
        if context.get(key):lines.append(label+'：'+json.dumps(context[key],ensure_ascii=False,sort_keys=True,separators=(',',':')))
    lines.extend(['保持角色身份、动作、对白和参考素材用途不变；将上述风格落实到材质、光线、色彩与画面表现。',END])
    result.update(prompt=prompt+'\n\n'+'\n'.join(lines),visual_style=context)
    return result
