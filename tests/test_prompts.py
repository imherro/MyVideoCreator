from backend.prompts import TEMPLATES


def test_storyboard_prompt_requires_visible_negative_constraints_for_initial_states():
    prompt=TEMPLATES['storyboard']
    assert '无任何发光' in prompt
    assert '无光晕' in prompt
    assert '尚未接触' in prompt
