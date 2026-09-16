"""Resolve state-specific voices from the shot's explicit visual bindings."""
def voice_card_id(document, shot, dialogue):
    film = document.get('filmBible') or {}
    visual = film.get('visual') or {}
    cards, versions = visual.get('cards') or {}, visual.get('versions') or {}
    profiles = (film.get('voices') or {}).get('profiles') or {}
    cid = dialogue.get('characterCardId') or ''
    card = cards.get(cid) or {}
    base = card.get('parentCardId') if card.get('kind') == 'character_state' else cid
    candidates = set()
    if card.get('kind') == 'character_state' and cid in profiles:
        return cid
    for binding in (shot.get('assetBindings') or {}).get('characters') or []:
        state_id = (versions.get(binding.get('versionId')) or {}).get('cardId')
        state = cards.get(state_id) or {}
        if state.get('kind') == 'character_state' and state.get('parentCardId') == base and state_id in profiles:
            candidates.add(state_id)
    if len(candidates) > 1:
        raise ValueError('同一镜头绑定了多个不同音色的角色状态，请保留明确的说话状态')
    return next(iter(candidates), base or cid)


def resolved_voice(document, shot, dialogue):
    cid = voice_card_id(document, shot, dialogue)
    profile = (((document.get('filmBible') or {}).get('voices') or {}).get('profiles') or {}).get(cid) or {}
    selected = str(profile.get('defaultVersion') or '')
    if selected and selected != str(profile.get('version')):
        profile = (profile.get('lockedVersions') or {}).get(selected) or profile
    return cid, profile
