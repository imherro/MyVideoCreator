from backend.reference_roles import actor_reference_indices, shared_identity_lines, version_constraints


def pair(cid, vid, rules=()):
    return ({'id': cid, 'name': cid}, {'id': vid, 'invariants': list(rules)})


def test_base_and_state_resolve_independent_of_binding_order():
    base = pair('hero', 'base', ['黑袍'])
    state = pair('hero-female', 'female', ['女身白衣'])
    entries = [(1, [base]), (2, [base, state])]
    expected = ({'hero': 2, 'hero-female': 2}, set())
    assert actor_reference_indices(entries) == expected
    assert actor_reference_indices(list(reversed(entries))) == expected
    assert '不能因此复制出额外人物' in shared_identity_lines(entries)[0]


def test_sibling_states_are_ambiguous_but_explicit_states_remain_addressable():
    base = pair('hero', 'base')
    entries = [(1, [base]), (2, [base, pair('wet', 'wet-v')]), (3, [base, pair('hurt', 'hurt-v')])]
    resolved, ambiguous = actor_reference_indices(entries)
    assert ambiguous == {'hero'}
    assert resolved == {'wet': 2, 'hurt': 3}


def test_constraints_keep_origin_and_explicit_change_precedence():
    lines = version_constraints([pair('hero', 'base', ['黑袍']), pair('hero-female', 'female', ['女身白衣'])])
    assert '当前状态明确指定的变化优先' in lines[0]
    assert '仅继承未被当前状态明确改变的部分' in lines[1]
    assert '当前版本约束：女身白衣' in lines[2]
    assert version_constraints([pair('robot', 'robot-v', ['没有手臂', '没有手臂'])]) == ['robot｜当前版本约束：没有手臂']


def test_two_unrelated_people_keep_separate_references():
    entries = [(1, [pair('a','a-v')]), (2, [pair('b','b-v')])]
    assert actor_reference_indices(entries) == ({'a':1,'b':2},set())
    assert shared_identity_lines(entries) == []
