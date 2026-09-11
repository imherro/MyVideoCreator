from backend.workflows import execution_plan

def test_branch_includes_required_ancestors_but_not_unrelated_descendants():
    doc={'nodes':[{'id':x} for x in ('story','image','video','sound','other')],'edges':[{'source':'story','target':'image'},{'source':'image','target':'video'},{'source':'sound','target':'video'},{'source':'story','target':'other'}]}
    plan=execution_plan(doc,['image'],True)
    ids=[node['id'] for node,_ in plan]
    assert set(ids)=={'story','image','video','sound'}
    assert ids.index('story')<ids.index('image')<ids.index('video')
    assert ids.index('sound')<ids.index('video')
    assert {n['id'] for n,_ in execution_plan(doc,['image'])}=={'story','image'}
