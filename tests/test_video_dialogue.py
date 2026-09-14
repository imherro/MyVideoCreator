from backend.video_dialogue import MARKER, compile_shot_video_input, compile_video_prompt


def shot():
    return {
        'id': 'shot-001', 'uid': 'shot-uid',
        'pipeline': {'videoNodeId': 'video-node'},
        'video_prompt': '机器人抬头，镜头缓慢推进。',
        'dialogues': [
            {'id': 'd1', 'characterCardId': 'robot', 'characterName': '球球', 'emotion': '坚定', 'text': '下一步直接拔电源。'},
            {'id': 'd2', 'characterCardId': 'human', 'characterName': '林岚', 'emotion': '', 'text': '你确定吗？'},
        ],
    }


def test_video_prompt_contains_every_exact_dialogue_and_direction():
    value = compile_video_prompt('机器人抬头，镜头缓慢推进。', shot())
    assert '球球（坚定）说：“下一步直接拔电源。”' in value
    assert '林岚说：“你确定吗？”' in value
    assert '口型' in value and '不得改词' in value and '不生成字幕' in value


def test_video_prompt_projection_replaces_older_projection_without_duplication():
    once = compile_video_prompt('基础动作', shot())
    twice = compile_video_prompt(once, shot())
    assert twice == once
    assert twice.count(MARKER) == 1


def test_video_job_compiles_dialogue_for_existing_node_and_records_projection():
    value = compile_shot_video_input({'shots': [shot()]}, 'video-node', 'video', {'prompt': '旧节点提示词'})
    assert value['prompt'].startswith('旧节点提示词')
    assert value['dialogue_projection']['shotUid'] == 'shot-uid'
    assert value['dialogue_projection']['dialogues'][0]['text'] == '下一步直接拔电源。'


def test_non_video_and_unbound_nodes_are_unchanged():
    original = {'prompt': '保持不变'}
    assert compile_shot_video_input({'shots': [shot()]}, 'video-node', 'image', original) == original
    assert compile_shot_video_input({'shots': [shot()]}, 'other-node', 'video', original) == original
