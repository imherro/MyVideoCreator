"""Deterministic reference responsibilities; never infer changes from prose."""

def version_constraints(chain):
    lines = []
    if len(chain) > 1:
        lines.append('版本链表示同一实体，不是多个角色或场景。当前状态明确指定的变化优先；未明确变化的身份与结构继承基础版本，不混合两套服装或身体形态。')
    for index, (card, version) in enumerate(chain):
        rules = list(dict.fromkeys(str(r).strip() for r in version.get('invariants', []) if str(r).strip()))
        if rules:
            scope = '当前版本约束' if index == len(chain)-1 else '基础版本约束（仅继承未被当前状态明确改变的部分）'
            lines.append(f"{card.get('name',card['id'])}｜{scope}：" + '；'.join(rules))
    return lines


def actor_reference_indices(entries):
    """Resolve an ancestor to its unique most-specific bound state, not list order.

    Sibling states cannot be silently assigned to an unspecified base actor.
    Explicit state IDs remain individually addressable.
    """
    candidates = {}
    for index, chain in entries:
        for card, _ in chain:
            candidates.setdefault(card['id'], []).append((index, chain))
    resolved, ambiguous = {}, set()
    for card_id, options in candidates.items():
        specific = [(idx, chain) for idx, chain in options if not any(
            chain[-1][1]['id'] in [v['id'] for _, v in other[:-1]] for _, other in options)]
        indices = {idx for idx, _ in specific}
        if len(indices) == 1:
            resolved[card_id] = indices.pop()
        else:
            ambiguous.add(card_id)
    return resolved, ambiguous


def shared_identity_lines(entries):
    groups = {}
    for index, chain in entries:
        groups.setdefault(chain[0][0]['id'], []).append((index, chain))
    lines = []
    for items in groups.values():
        if len({i for i, _ in items}) < 2:
            continue
        refs = '、'.join(f'@图片{i}' for i, _ in items)
        lines.append(f'{refs}属于同一身份的不同版本，不能因此复制出额外人物；具体出场状态及变化顺序以本镜描述为准，不混合各版本外观。')
    return lines
