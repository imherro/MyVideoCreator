import copy
from backend.visual_style import compile_visual_style
from backend.reference_compiler import _constraint_lines


def test_projection_keeps_snapshot_and_shot_text_but_excludes_whole_plot():
    doc={'style':'2D漫画','filmBible':{'style':{'visualTone':'以电影写实为视觉基底', 'colorLighting':'冷蓝光', 'avoidItems':['不得出现手臂','不得设置付费卡点']},'continuity':{'characterSceneConsistency':'第二季剧情'*1000}}}
    original=copy.deepcopy(doc)
    source={'prompt':'不要手臂。人物说：你好。','asset_ids':['a','b']}
    result=compile_visual_style(doc,'video',source)
    assert result['prompt'].startswith(source['prompt'])
    assert '第二季剧情' not in result['prompt'] and '付费卡点' not in result['prompt']
    assert '不得出现手臂' in result['prompt'] and '冷蓝光' in result['prompt']
    assert '以电影写实为视觉基底' not in result['prompt']
    assert result['visual_style_projection']['warnings']
    assert result['visual_style']['continuity']==doc['filmBible']['continuity']
    assert doc==original and result['asset_ids']==source['asset_ids']
    assert compile_visual_style(doc,'video',result)==result
    assert '第二季剧情' in compile_visual_style(doc,'storyboard',source)['prompt']


def test_same_asset_revision_replaced_state_inherits_and_deduplicates():
    card={'id':'robot','name':'机器人'}
    old={'spec':{'description':'旧版本','attributes':[{'name':'外壳','value':'银色'}]},'invariants':['不要手臂']}
    new={'spec':{'description':'新版本','attributes':[{'name':'外壳','value':'白色'}]},'invariants':['不要手臂']}
    state={'id':'wet','name':'湿身机器人'}
    delta={'spec':{'description':'被雨淋湿','attributes':[{'name':'污渍','value':'泥点'}]},'invariants':['不要手臂']}
    prompt='\n'.join(_constraint_lines(1,'character',[(card,old),(card,new),(state,delta)]))
    assert '旧版本' not in prompt and '银色' not in prompt
    assert all(t in prompt for t in ['图1','新版本','白色','被雨淋湿','泥点'])
    assert prompt.count('不要手臂')==1
