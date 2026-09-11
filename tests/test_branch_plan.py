from backend.workflows import execution_plan

def test_branch_includes_required_ancestors_but_not_unrelated_descendants():
    doc={'nodes':[{'id':x} for x in ('story','image','video','sound','other')],'edges':[{'source':'story','target':'image'},{'source':'image','target':'video'},{'source':'sound','target':'video'},{'source':'story','target':'other'}]}
    plan=execution_plan(doc,['image'],True)
    ids=[node['id'] for node,_ in plan]
    assert set(ids)=={'story','image','video','sound'}
    assert ids.index('story')<ids.index('image')<ids.index('video')
    assert ids.index('sound')<ids.index('video')
    assert {n['id'] for n,_ in execution_plan(doc,['image'])}=={'story','image'}

def test_managed_visual_projection_never_becomes_an_execution_dependency():
    doc={
        'nodes':[
            {'id':'story','data':{'kind':'storyboard'}},
            {'id':'visual','data':{'kind':'visual_asset','managed':True,'visualVersionId':'vv-1'}},
            {'id':'image','data':{'kind':'image'}},
            {'id':'video','data':{'kind':'video'}},
        ],
        'edges':[
            {'id':'story-image','source':'story','target':'image'},
            {'id':'visual-image','source':'visual','target':'image','data':{'managed':True,'origin':'visual_binding','kind':'character'}},
            {'id':'image-video','source':'image','target':'video'},
        ],
    }
    plan=execution_plan(doc,['image'],True)
    assert [node['id'] for node,_ in plan]==['story','image','video']
    assert dict((node['id'],parents) for node,parents in plan)['image']==['story']
