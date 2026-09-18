"""Task-scoped short references; never fuzzy-match generated identifiers."""
import copy
import json


def reference_map(events, chapters):
    return {'version':1,
            'events':{f'E{n:03d}':value for n,value in enumerate(dict.fromkeys(events),1)},
            'chapters':{f'C{n:03d}':value for n,value in enumerate(dict.fromkeys(chapters),1)}}


def freeze_references(prompt, schema, mapping):
    for group in ('events','chapters'):
        for short,real in mapping[group].items():
            prompt=prompt.replace(json.dumps(real),json.dumps(short))
    instruction='\n引用规则：sourceEventIds 只填写本次输入的 E 编号，sourceChapterRefs 只填写 C 编号。不要输出数据库长 ID，不得改写或自行补造编号。'
    if not prompt.endswith(instruction):prompt+=instruction
    schema=copy.deepcopy(schema)
    schema['properties']['adaptationPlan']['properties']['sourceEventIds']['items']={'type':'string','enum':list(mapping['events'])}
    schema['properties']['episodePlans']['items']['properties']['sourceChapterRefs']['items']={'type':'string','enum':list(mapping['chapters'])}
    return prompt,schema


def decode_references(value, marker):
    mapping=marker.get('referenceMap')
    if not mapping:return value  # Frozen historical tasks retain their original protocol.
    if mapping.get('version')!=1:raise ValueError('不支持的改编引用映射版本')
    result=copy.deepcopy(value)
    def decode(refs, group, path):
        if not isinstance(refs,list):raise ValueError(f'{path} 必须是编号数组')
        allowed=set(marker.get('sourceEventIds' if group=='events' else 'sourceChapterIds') or [])
        table=mapping[group]
        invalid=[str(ref)[:80] for ref in refs if not isinstance(ref,str) or ref not in table or table[ref] not in allowed]
        if invalid:raise ValueError(f'{path} 引用了 {len(invalid)} 个无效编号：'+', '.join(invalid[:10])+'；生成结果已保留，尚未写入工作台')
        return [table[ref] for ref in refs]
    if isinstance(result,dict):
        plan=result.get('adaptationPlan')
        if isinstance(plan,dict) and 'sourceEventIds' in plan:
            plan['sourceEventIds']=decode(plan['sourceEventIds'],'events','adaptationPlan.sourceEventIds')
        for index,plan in enumerate(result.get('episodePlans') or []):
            if isinstance(plan,dict) and 'sourceChapterRefs' in plan:
                plan['sourceChapterRefs']=decode(plan['sourceChapterRefs'],'chapters',f'episodePlans[{index}].sourceChapterRefs')
    return result
