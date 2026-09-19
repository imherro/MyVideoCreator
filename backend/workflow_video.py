"""Resolve a frozen workflow video using only its declared upstream results."""
import copy
from .motion_references import compile_motion_input


def resolve_deferred_video(job, provider, upstream_results):
    value=copy.deepcopy(job['input'])
    deferred=value.get('deferred_video')
    if not deferred or deferred.get('resolved') or job.get('provider_job_id'):
        return value
    document=copy.deepcopy(deferred['document'])
    nodes={n['id']:n for n in document.get('nodes',[])}
    for source in deferred['sources']:
        result=upstream_results.get(source['job_id']) or {}
        images=[a for a in result.get('assets',[]) if a.get('kind')=='image' and a.get('id')]
        if not images:
            raise ValueError(f"上游图片节点 {source['node_id']} 已完成但没有返回图片，无法继续生成视频")
        if source['node_id'] not in nodes:
            raise ValueError('工作流快照缺少上游图片节点，请重新提交')
        nodes[source['node_id']]['data'].update(assetId=images[0]['id'],stale=False)
    value=compile_motion_input(document,job['node_id'],'video',value,job['project_id'],provider)
    value['deferred_video']={**deferred,'resolved':True}
    return value
