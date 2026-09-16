"""Compare generation meaning, not the monotonically increasing edit counter."""
import copy


def video_signature(value):
    keys=('provider','model','prompt','negative','negative_prompt','seed','frames','resolution','ratio','size',
          'shot_duration','planned_shot_duration','asset_ids','image_reference_sources','end_asset_id',
          'dialogue_projection','dialogue_audio','dialogue_audio_mode','motion_reference')
    result={key:copy.deepcopy(value.get(key)) for key in keys}
    params=copy.deepcopy(value.get('parameters') or {})
    params.setdefault('outputFormat','mp4')
    result['parameters']=params
    result['generation_mode']={key:(value.get('generation_mode') or {}).get(key) for key in ('requested','actual')}
    result['dialogue_mode']=(value.get('dialogue_mode') or {}).get('actual')
    result['voice_samples']=[{key:copy.deepcopy(sample.get(key)) for key in
        ('characterCardId','voiceCardId','voiceVersion','assetId','index','purpose','media')}
        for sample in value.get('voice_samples') or []]
    result['reference_manifest']=value.get('reference_manifest')
    return result


def matches_video_result(document,node,job,current_input):
    data=node.get('data') or {}
    if job.get('status')!='succeeded' or data.get('resultJob')!=job.get('id'):
        return False
    assets=(job.get('result') or {}).get('assets') or []
    if not assets or assets[0].get('id')!=data.get('assetId'):return False
    old=job.get('input') or {}
    compiler=old.get('motion_compiler') or {}
    if not compiler.get('version') or compiler.get('version')!=(current_input.get('motion_compiler') or {}).get('version'):
        return False
    ancestors=set();pending=[node['id']]
    while pending:
        target=pending.pop()
        for edge in document.get('edges') or []:
            if edge.get('target')==target and edge.get('source') not in ancestors:
                ancestors.add(edge['source']);pending.append(edge['source'])
    if any(n['id'] in ancestors and n.get('data',{}).get('stale') for n in document.get('nodes') or []):return False
    return video_signature(old)==video_signature(current_input)
