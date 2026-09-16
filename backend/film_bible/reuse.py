"""Reuse production visual identities without rewriting approved versions."""
import copy
import json
import unicodedata


def name_key(name):
    return ''.join(unicodedata.normalize('NFKC', str(name)).casefold().split())


def available_cards(visual):
    versions = visual.get('versions') or {}
    cards = {cid: card for cid, card in (visual.get('cards') or {}).items()
             if not card.get('deletedAt') and card.get('status') != 'deprecated'
             and versions.get(card.get('currentVersionId'), {}).get('status') not in (None, 'deprecated')}
    return {cid: card for cid, card in cards.items()
            if not card.get('parentCardId') or card['parentCardId'] in cards}


def visual_catalog(visual):
    result = []
    for cid, card in available_cards(visual).items():
        version = visual['versions'][card['currentVersionId']]
        result.append({'key': cid, 'kind': card['kind'], 'name': card['name'],
                       'parent_key': card.get('parentCardId') or '',
                       'description': version.get('spec', {}).get('description', ''),
                       'attributes': version.get('spec', {}).get('attributes', []),
                       'invariants': version.get('invariants', []),
                       'aliases': card.get('aliases') or [],
                       'versionId': version['id'], 'status': version['status'],
                       'hasReference': bool(version.get('references'))})
    return result


def visual_user_prompt(script, existing):
    if existing is None:
        return script
    return script + '\n\n[整部作品已有视觉资产，可跨集复用]\n' + json.dumps(visual_catalog(existing), ensure_ascii=False) + '''
先识别本集实际需要的已有角色、场景、道具和状态。同一身份必须复用其 key，保留已有外观与 invariants；不得仅因换集而重建卡片。简称、别名、称谓改变不代表新人物；同一角色的化形、性别外观或年龄变化应建立关联状态，不重建基础身份。
输出 cards 只含本集需要的实体及状态的基础父卡；复用项沿用给定 key 和 parent_key，仍按 Schema 填写描述。已有资产的描述和已确认参考图由系统保留，不会被生成文本覆盖。
确实新增的实体使用新的语义 key。已有角色换装、持续伤势或场景昼夜变化等，使用新的状态卡，并以已有基础卡 key 作为 parent_key；动作或临时情绪不是新资产。
后续镜头和对白必须使用这些 key。不要根据已有资产清单给本集增加剧本中没有的人物或剧情。'''


def normalize_reusable_visual(value, existing, provider_id='', model_id=''):
    from .validate import normalize_visual_bible
    if existing is None:
        return normalize_visual_bible(value, provider_id, model_id)
    # A new state can point straight to an existing parent omitted by the model.
    value = copy.deepcopy(value)
    catalog = {item['key']: item for item in visual_catalog(existing)}
    if isinstance(value, dict) and isinstance(value.get('cards'), list):
        keys = {item.get('key') for item in value['cards'] if isinstance(item, dict)}
        for item in list(value['cards']):
            parent = item.get('parent_key') if isinstance(item, dict) else None
            if parent in catalog and parent not in keys:
                value['cards'].append({k: v for k, v in catalog[parent].items()
                                       if k not in ('versionId', 'status', 'hasReference', 'aliases')})
                keys.add(parent)
    fresh, keys = normalize_visual_bible(value, provider_id, model_id)
    merged = copy.deepcopy(existing)
    merged.setdefault('cards', {}); merged.setdefault('versions', {})
    available = available_cards(existing)
    resolved = {}
    # Parents must resolve before their states so parent identity is part of matching.
    for key, (cid, vid) in sorted(keys.items(), key=lambda item: bool(fresh['cards'][item[1][0]].get('parentCardId'))):
        card, version = fresh['cards'][cid], fresh['versions'][vid]
        parent = card.get('parentCardId')
        parent_pair = resolved.get(parent)
        if key in (existing.get('cards') or {}):
            candidate = available.get(key)
            if not candidate or candidate['kind'] != card['kind'] or (candidate.get('parentCardId') or None) != (parent_pair[0] if parent_pair else None):
                raise ValueError(f'已有视觉卡 {key} 不可复用或父级/类型不匹配')
        else:
            matches = [old for old in available.values() if old['kind'] == card['kind']
                       and name_key(card['name']) in {name_key(n) for n in [old['name'], *(old.get('aliases') or [])]}
                       and (old.get('parentCardId') or None) == (parent_pair[0] if parent_pair else None)]
            if len(matches) > 1:
                raise ValueError(f'视觉资产 {card["name"]} 存在多个同名候选，请明确沿用清单中的 key')
            candidate = matches[0] if matches else None
        if candidate:
            pair = (candidate['id'], candidate['currentVersionId'])
        else:
            if parent_pair:
                card['parentCardId'] = parent_pair[0]
                version['parentVersionId'] = parent_pair[1]
            merged['cards'][cid] = card; merged['versions'][vid] = version
            pair = (cid, vid)
        resolved[cid] = pair
        keys[key] = pair
    return merged, keys
