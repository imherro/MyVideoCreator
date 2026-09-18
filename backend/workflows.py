"""Project graph validation and dependency-aware execution snapshots."""
def topological(nodes,edges):
    ids={n['id'] for n in nodes}
    if len(ids)!=len(nodes): raise ValueError('画布存在重复节点编号')
    children={n:[] for n in ids}; degree={n:0 for n in ids}
    for edge in edges:
        source,target=edge.get('source'),edge.get('target')
        if source not in ids or target not in ids: raise ValueError('连线引用了不存在的节点')
        children[source].append(target); degree[target]+=1
    ready=sorted(n for n in ids if degree[n]==0); result=[]
    while ready:
        current=ready.pop(0);result.append(current)
        for child in children[current]:
            degree[child]-=1
            if degree[child]==0: ready.append(child)
    if len(result)!=len(ids): raise ValueError('画布包含循环连线，请先解除循环后执行')
    return result

def execution_plan(document,selected=None,include_descendants=False,exact=False):
    from .shot_composition import execution_edges, needs_composition
    # Visual Bible nodes and edges are a managed canvas projection. They are
    # never execution dependencies; generation reads shot.assetBindings.
    managed_visual_ids={
        node.get('id') for node in document.get('nodes',[])
        if node.get('data',{}).get('managed') is True
        and node.get('data',{}).get('kind')=='visual_asset'
    }
    nodes=[node for node in document.get('nodes',[]) if node.get('id') not in managed_visual_ids]
    edges=[
        edge for edge in execution_edges(document)
        if edge.get('source') not in managed_visual_ids
        and edge.get('target') not in managed_visual_ids
        and edge.get('data',{}).get('origin') not in ('composition_output','composition_source')
        and not (
            edge.get('data',{}).get('managed') is True
            and edge.get('data',{}).get('origin')=='visual_binding'
        )
    ]
    order=topological(nodes,edges);mapping={n['id']:n for n in nodes}
    parents={n:[] for n in mapping}
    for edge in edges: parents[edge['target']].append(edge['source'])
    optional_images={s.get('imageNode') or (s.get('pipeline') or {}).get('imageNodeId') for s in document.get('shots',[]) if not needs_composition(document,s)}
    wanted=set(selected or [n for n in order if n not in optional_images])
    if not wanted<=mapping.keys(): raise ValueError('选中的节点不存在')
    if exact:
        if not selected: raise ValueError('精确批量执行必须指定节点')
        return [(mapping[n],parents[n]) for n in order if n in wanted]
    if include_descendants:
        pending=list(wanted)
        while pending:
            current=pending.pop()
            for edge in edges:
                if edge['source']==current and edge['target'] not in wanted:
                    wanted.add(edge['target']);pending.append(edge['target'])
    pending=list(wanted)
    while pending:
        for parent in parents[pending.pop()]:
            if parent not in wanted: wanted.add(parent);pending.append(parent)
    return [(mapping[n],parents[n]) for n in order if n in wanted]
