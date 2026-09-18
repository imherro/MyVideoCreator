import copy
import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import store as s
from backend.app import app
from backend.worker import Worker
from backend.adaptation import validate_adaptation_bundle


@pytest.fixture(scope="module")
def adaptation_client():
    with TestClient(app) as client:
        app.state.worker.stop()
        status = client.get("/api/auth/status").json()
        endpoint = "/api/auth/login" if status["configured"] else "/api/auth/setup"
        response = client.post(endpoint, json={"password": "integration-test-only"})
        assert response.status_code == 200, response.text
        yield client


def setup_production(client, count=60):
    production = client.post("/api/productions", json={"name": "Phase 3 连载剧"}).json()
    episode = client.post(
        f'/api/productions/{production["id"]}/episodes', json={"title": "第一集"}
    ).json()
    source = client.post(
        f'/api/productions/{production["id"]}/sources',
        json={"title": "原著", "type": "manual", "metadata": {}},
    ).json()
    chapter = client.post(
        f'/api/productions/{production["id"]}/sources/{source["id"]}/chapters',
        json={"title": "第一章", "content": "阿青发现父亲留下的密信，并决定进城追查。"},
    ).json()
    adaptation = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    adaptation["adaptationPlan"] = {
        "status": "draft",
        "format": {"episodeCount": count, "targetDuration": 60, "ratio": "9:16", "platform": "红果短剧"},
        "storyCore": {"premise": "追查密信", "theme": "信任", "protagonist": "阿青", "goal": "找到真相", "stakes": "家族安危"},
        "storyArc": {"opening": "发现密信", "development": "追查线索", "turningPoint": "盟友背叛", "climax": "当面对质", "ending": "真相揭晓"},
        "adaptationStrategy": {"audience": "短剧用户", "tone": "悬疑", "changes": "压缩支线", "constraints": "保持主线"},
        "sourceEventIds": [],
    }
    adaptation["episodePlans"] = [{
        "episodeNo": number, "sourceChapterRefs": [chapter["id"]],
        "logline": f"阿青追查第 {number} 条线索", "coreConflict": "真相与信任冲突",
        "emotionalBeat": "疑虑加深", "hook": f"第 {number} 集开场疑点",
        "cliffhanger": f"第 {number} 集结尾出现新证据", "paywallRole": "none",
        "targetDuration": 60, "status": "draft",
    } for number in range(1, count + 1)]
    adaptation["episodePlans"][min(2, count - 1)]["paywallRole"] = "conversion"
    adaptation["monetizationPlan"] = {
        "mode": "free_then_paid", "freeEpisodes": min(3, count), "firstPaywallEpisode": min(4, count + 1),
        "beats": [{"episodeNo": min(3, count), "type": "pre_paywall_hook", "setup": "盟友失踪",
            "cliffhanger": "密信另有夹层", "expectedEmotion": "迫切", "rationale": "推动追更"}],
    }
    return production, episode, chapter, adaptation


def save_and_approve(client, production, adaptation):
    saved = client.put(
        f'/api/productions/{production["id"]}/adaptation',
        json={key: adaptation[key] for key in ("revision", "adaptationPlan", "episodePlans", "monetizationPlan")},
    )
    assert saved.status_code == 200, saved.text
    reviewed = client.post(
        f'/api/productions/{production["id"]}/adaptation/review',
        json={"revision": saved.json()["revision"]},
    )
    assert reviewed.status_code == 200, reviewed.text
    approved = client.post(
        f'/api/productions/{production["id"]}/adaptation/approve',
        json={"revision": reviewed.json()["revision"]},
    )
    assert approved.status_code == 200, approved.text
    return approved.json()


def test_new_adaptation_job_short_refs_round_trip_to_real_database_ids(adaptation_client):
    from backend.adaptation import apply_adaptation_generation
    client=adaptation_client
    production,episode,chapter,adaptation=setup_production(client,count=1)
    saved=client.put(f'/api/productions/{production["id"]}/adaptation',json={k:adaptation[k] for k in ('revision','adaptationPlan','episodePlans','monetizationPlan')})
    assert saved.status_code==200
    eid=s.uid('source-event-');now=time.time()
    with s.db() as c:
        c.execute('INSERT INTO source_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(eid,production['id'],chapter['id'],1,'[]','发现密信','high','警觉','{}',None,now,now))
    response=client.post(f'/api/productions/{production["id"]}/adaptation/generate',json={'project_id':episode['id'],'provider':'local','model':'','submission_id':'short-ref-roundtrip'})
    assert response.status_code==200,response.text
    job=response.json();marker=job['input']['adaptation_generation']
    assert marker['referenceMap']['events']=={'E001':eid}
    assert eid not in job['input']['prompt'] and chapter['id'] not in job['input']['prompt']
    generated={k:copy.deepcopy(adaptation[k]) for k in ('adaptationPlan','episodePlans','monetizationPlan')}
    generated['adaptationPlan'].pop('status');generated['adaptationPlan']['sourceEventIds']=['E001']
    for plan in generated['episodePlans']:
        plan.pop('status');plan['sourceChapterRefs']=['C001']
    s.job_update(job['id'],status='running')
    apply_adaptation_generation(job,generated)
    final=client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert final['adaptationPlan']['sourceEventIds']==[eid]
    assert final['episodePlans'][0]['sourceChapterRefs']==[chapter['id']]


def test_generated_plan_repairs_optional_monetization_outside_episode_range():
    generated = {
        'adaptationPlan': {
            'format': {'episodeCount': 1, 'targetDuration': 15, 'ratio': '16:9', 'platform': '通用短视频'},
            'storyCore': {'premise': '', 'theme': '', 'protagonist': '', 'goal': '', 'stakes': ''},
            'storyArc': {'opening': '', 'development': '', 'turningPoint': '', 'climax': '', 'ending': ''},
            'adaptationStrategy': {'audience': '', 'tone': '', 'changes': '', 'constraints': ''},
            'sourceEventIds': [],
        },
        'episodePlans': [{
            'episodeNo': 1, 'sourceChapterRefs': [], 'logline': '', 'coreConflict': '',
            'emotionalBeat': '', 'hook': '', 'cliffhanger': '', 'paywallRole': 'none',
            'targetDuration': 15,
        }],
        'monetizationPlan': {
            'mode': 'free_then_paid', 'freeEpisodes': 8, 'firstPaywallEpisode': 4,
            'beats': [
                {'episodeNo': 1, 'type': 'hook', 'setup': '', 'cliffhanger': '', 'expectedEmotion': '', 'rationale': ''},
                {'episodeNo': 3, 'type': 'paywall', 'setup': '', 'cliffhanger': '', 'expectedEmotion': '', 'rationale': ''},
            ],
        },
    }
    result = validate_adaptation_bundle(generated, generated=True)
    assert result['monetizationPlan']['freeEpisodes'] == 1
    assert result['monetizationPlan']['firstPaywallEpisode'] == 2
    assert [beat['episodeNo'] for beat in result['monetizationPlan']['beats']] == [1]
    # EP02 is the sentinel for “the single-episode series has no paid episode”.
    # Saving the generated plan manually must keep accepting that value.
    assert validate_adaptation_bundle(result)['monetizationPlan']['firstPaywallEpisode'] == 2


def test_manual_plan_still_rejects_invalid_first_paywall_episode():
    manual = {
        'adaptationPlan': {
            'status': 'draft',
            'format': {'episodeCount': 1, 'targetDuration': 15, 'ratio': '16:9', 'platform': '通用短视频'},
            'storyCore': {}, 'storyArc': {}, 'adaptationStrategy': {}, 'sourceEventIds': [],
        },
        'episodePlans': [{
            'episodeNo': 1, 'sourceChapterRefs': [], 'logline': '', 'coreConflict': '',
            'emotionalBeat': '', 'hook': '', 'cliffhanger': '', 'paywallRole': 'none',
            'targetDuration': 15, 'status': 'draft',
        }],
        'monetizationPlan': {
            'mode': 'free_then_paid', 'freeEpisodes': 1, 'firstPaywallEpisode': 4, 'beats': [],
        },
    }
    with pytest.raises(ValueError, match='首个付费集编号无效'):
        validate_adaptation_bundle(manual)


def test_60_episode_plan_and_paywall_are_canonical_editable_and_no_job_is_automatic(adaptation_client):
    client = adaptation_client
    production, episode, chapter, adaptation = setup_production(client)
    saved = client.put(
        f'/api/productions/{production["id"]}/adaptation',
        json={key: adaptation[key] for key in ("revision", "adaptationPlan", "episodePlans", "monetizationPlan")},
    )
    assert saved.status_code == 200, saved.text
    loaded = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert len(loaded["episodePlans"]) == 60
    assert all(plan["sourceChapterRefs"] == [chapter["id"]] for plan in loaded["episodePlans"])
    assert loaded["monetizationPlan"]["beats"][0]["cliffhanger"] == "密信另有夹层"
    assert loaded["adaptationPlan"]["status"] == "draft"
    assert client.get(f'/api/projects/{episode["id"]}/jobs').json() == []

    edited = copy.deepcopy(loaded)
    edited["episodePlans"][2]["hook"] = "阿青在门缝发现血迹"
    edited["monetizationPlan"]["beats"][0]["rationale"] = "强化第三集转付费动机"
    result = client.put(
        f'/api/productions/{production["id"]}/adaptation',
        json={key: edited[key] for key in ("revision", "adaptationPlan", "episodePlans", "monetizationPlan")},
    )
    assert result.status_code == 200
    assert result.json()["episodePlans"][2]["hook"] == "阿青在门缝发现血迹"
    assert result.json()["episodePlans"][2]["status"] == "draft"
    assert client.get(f'/api/projects/{episode["id"]}/jobs').json() == []


def test_script_generation_uses_saved_plans_without_approval_and_selected_set_isolated(adaptation_client, monkeypatch):
    client = adaptation_client
    production, episode, _, adaptation = setup_production(client)
    saved = client.put(
        f'/api/productions/{production["id"]}/adaptation',
        json={key: adaptation[key] for key in ("revision", "adaptationPlan", "episodePlans", "monetizationPlan")},
    ).json()
    # No review/approve call: saved draft plans are immediately usable.
    assert saved["adaptationPlan"]["status"] == "draft"

    body = {"episode_nos": [5, 8, 12], "provider": "local", "model": "", "allow_cloud": False, "submission_id": "phase3-selected-batch"}
    first = client.post(f'/api/productions/{production["id"]}/script-generations',json=body)
    second = client.post(f'/api/productions/{production["id"]}/script-generations',json=body)
    assert first.status_code == second.status_code == 200, first.text
    assert [job["id"] for job in first.json()["jobs"]] == [job["id"] for job in second.json()["jobs"]]
    duplicate = client.post(f'/api/productions/{production["id"]}/script-generations', json={
        **body, 'episode_nos': [6, 5], 'submission_id': 'duplicate-different-batch',
    })
    assert duplicate.status_code == 409, duplicate.text
    assert '本集剧本已在排队或生成中' in duplicate.json()['detail']
    # The earlier unblocked selection in the same batch is rolled back too.
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/6').json()['revision'] == 0
    statuses = client.get(f'/api/productions/{production["id"]}/job-statuses').json()
    assert {job['id'] for job in statuses} == {job['id'] for job in first.json()['jobs']}
    assert all(job['status'] == 'queued' and 'prompt' not in job['input'] for job in statuses)
    assert {job["kind"] for job in first.json()["jobs"]} == {"text"}
    assert {job["scope"] for job in first.json()["jobs"]} == {"episode"}
    assert {job["input"]["episode_script_generation"]["episodeNo"] for job in first.json()["jobs"]} == {5, 8, 12}
    assert {job["input"]["schema_version"] for job in first.json()["jobs"]} == {"episode-script/v1"}
    assert all(job["input"]["system_prompt"] and job["input"]["response_schema"] for job in first.json()["jobs"])

    worker = Worker()
    generated = {
        "title": "生成集", "synopsis": "阿青继续追查", "body": "内景 夜\n阿青：我会找到答案。",
        "estimatedDuration": 60, "characters": ["阿青"], "scenes": ["旧屋"], "props": ["密信"],
    }
    monkeypatch.setattr(worker,"_chat_text",lambda *_args,**_kwargs:json.dumps(generated,ensure_ascii=False))
    for job in first.json()["jobs"]:
        s.job_update(job["id"],status="running")
        result = worker.text({**job,"status":"running"},{"url":"http://unused","local":True})
        assert result["script"]["status"] == "review"
        s.job_update(job["id"],status="succeeded",result=result)

    retried = client.post(f'/api/productions/{production["id"]}/script-generations', json={
        **body, 'episode_nos': [5], 'submission_id': 'retry-after-script-completed',
    })
    assert retried.status_code == 200, retried.text
    assert retried.json()['jobs'][0]['id'] != first.json()['jobs'][0]['id']
    s.job_update(retried.json()['jobs'][0]['id'], status='cancelled')

    scripts = client.get(f'/api/productions/{production["id"]}/scripts').json()
    changed = {item["episodeNo"] for item in scripts if item["script"] and item["script"]["body"]}
    assert changed == {5, 8, 12}
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/13').json()["revision"] == 0
    with s.db() as connection:
        assert {row["kind"] for row in connection.execute(
            "SELECT DISTINCT kind FROM jobs WHERE project_id IN (SELECT id FROM projects WHERE production_id=?)",
            (production["id"],),
        )} == {"text"}


def test_canonical_script_projects_to_canvas_and_canvas_edit_cannot_replace_it(adaptation_client):
    client = adaptation_client
    production, _, _, adaptation = setup_production(client, count=2)
    with s.db() as connection:
        row = connection.execute("SELECT shared_context FROM productions WHERE id=?", (production["id"],)).fetchone()
        context = json.loads(row["shared_context"])
        context["generationPolicy"]["text"] = {"providerId": "ark-for-script", "modelId": "doubao-seed"}
        connection.execute("UPDATE productions SET shared_context=? WHERE id=?", (s.dumps(context), production["id"]))
    approved = save_and_approve(client, production, adaptation)
    virtual = client.get(f'/api/productions/{production["id"]}/episode-scripts/2').json()
    payload = {
        "revision": virtual["revision"], "title": "第二集", "synopsis": "追查仓库",
        "body": "外景 日\n阿青推开仓库大门。", "estimatedDuration": 60,
        "sourceChapterRefs": approved["episodePlans"][1]["sourceChapterRefs"],
        "storyGoal": approved["episodePlans"][1]["coreConflict"],
        "paywallBeat": {"role": "none", "hook": "门锁已开", "cliffhanger": "脚步声逼近"},
        "characters": ["阿青"], "scenes": ["仓库"], "props": ["密信"],
    }
    saved = client.put(f'/api/productions/{production["id"]}/episode-scripts/2',json=payload)
    assert saved.status_code == 200, saved.text
    project_id = saved.json()["project_id"]
    projected = client.get(f'/api/projects/{project_id}').json()
    node = next(item for item in projected["document"]["nodes"] if item["data"].get("canonicalScriptProjection"))
    assert node["data"]["text"] == payload["body"]
    assert node["data"]["provider"] == "ark-for-script"
    assert node["data"]["model"] == "doubao-seed"
    assert node["data"]["generationPolicyInherited"] is True
    node["data"]["text"] = "从画布篡改"
    put = client.put(f'/api/projects/{project_id}',json={
        "name": projected["name"], "revision": projected["revision"],
        "production_revision": projected["production_revision"], "document": projected["document"],
    })
    assert put.status_code == 200, put.text
    reopened = client.get(f'/api/projects/{project_id}').json()
    projection = next(item for item in reopened["document"]["nodes"] if item["data"].get("canonicalScriptProjection"))
    assert projection["data"]["text"] == payload["body"]
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/2').json()["body"] == payload["body"]

    current_script = client.get(f'/api/productions/{production["id"]}/episode-scripts/2').json()
    cleared = client.put(f'/api/productions/{production["id"]}/episode-scripts/2',json={
        **payload, "revision": current_script["revision"], "body": "",
    })
    assert cleared.status_code == 200, cleared.text
    cleared_project = client.get(f'/api/projects/{project_id}').json()
    assert not any(item["data"].get("canonicalScriptProjection") for item in cleared_project["document"]["nodes"])
    assert not any(item["data"].get("text") == payload["body"] for item in cleared_project["document"]["nodes"])

    stale_canvas = copy.deepcopy(cleared_project["document"])
    stale_canvas["nodes"].append({
        "id": node["id"], "type": "media", "position": {"x": 80, "y": 80},
        "data": {"kind": "text", "text": payload["body"], "canonicalScriptProjection": True},
    })
    stale_put = client.put(f'/api/projects/{project_id}',json={
        "name": cleared_project["name"], "revision": cleared_project["revision"],
        "production_revision": cleared_project["production_revision"], "document": stale_canvas,
    })
    assert stale_put.status_code == 200, stale_put.text
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/2').json()["body"] == ""
    after_stale_put = client.get(f'/api/projects/{project_id}').json()
    assert not any(item["data"].get("text") == payload["body"] for item in after_stale_put["document"]["nodes"])


def test_canvas_script_becomes_the_canonical_episode_script_and_can_bypass_planning(adaptation_client):
    client = adaptation_client
    project = client.post('/api/projects',json={'name':'画布快速创作','duration':15}).json()
    node_id='canvas-script-draft'
    project['document']['nodes'].append({
        'id':node_id,'type':'media','position':{'x':80,'y':80},
        'data':{'kind':'text','label':'画布剧本','text':'内景 日\n女孩推开门。'},
    })
    stored=client.put(f'/api/projects/{project["id"]}',json={
        'name':project['name'],'revision':project['revision'],
        'production_revision':project['production_revision'],'document':project['document'],
    })
    assert stored.status_code==200,stored.text
    script=client.get(f'/api/productions/{project["production_id"]}/episode-scripts/1').json()
    saved=client.put(f'/api/productions/{project["production_id"]}/episode-scripts/1',json={
        'revision':script['revision'],'title':'第一集','synopsis':'','body':'内景 日\n女孩推开门。',
        'estimatedDuration':15,'sourceChapterRefs':[],'storyGoal':'','paywallBeat':{},
        'characters':[],'scenes':[],'props':[],'canvasNodeId':node_id,
    })
    assert saved.status_code==200,saved.text
    assert saved.json()['metadata']['origin']=='canvas'
    projected=client.get(f'/api/projects/{project["id"]}').json()
    projection=next(node for node in projected['document']['nodes'] if node['id']==node_id)
    assert projection['data']['canonicalScriptProjection'] is True
    assert projection['data']['scriptOrigin']=='canvas'
    # A saved canvas-origin draft can generate a storyboard immediately.
    projected['document']['nodes'].append({
        'id':'single-user-storyboard','type':'media','position':{'x':400,'y':80},
        'data':{'kind':'storyboard','label':'分镜规划','provider':'local','model':'','prompt':'将已保存剧本拆成分镜'},
    })
    projected['document']['edges'].append({'id':'script-to-board','source':node_id,'target':'single-user-storyboard'})
    stored=client.put(f'/api/projects/{project["id"]}',json={
        'name':projected['name'],'revision':projected['revision'],
        'production_revision':projected['production_revision'],'document':projected['document'],
    })
    assert stored.status_code==200,stored.text
    queued=client.post(f'/api/projects/{project["id"]}/run',json={
        'node_ids':['single-user-storyboard'],'exact':True,'submission_id':'single-user-canvas-storyboard',
    })
    assert queued.status_code==200,queued.text
    assert queued.json()['count']==1
    s.job_update(queued.json()['job_ids'][0],status='cancelled')
    # Old clients can still use the historical endpoints; the new UI never does.
    reviewed=client.post(f'/api/productions/{project["production_id"]}/episode-scripts/1/review',json={'revision':saved.json()['revision']})
    assert reviewed.status_code==200,reviewed.text
    approved=client.post(f'/api/productions/{project["production_id"]}/episode-scripts/1/approve',json={'revision':reviewed.json()['revision']})
    assert approved.status_code==200,approved.text
    assert approved.json()['status']=='approved'


def test_project_put_cannot_persist_a_second_copy_of_production_adaptation(adaptation_client):
    client = adaptation_client
    production, episode, _, adaptation = setup_production(client, count=2)
    canonical = save_and_approve(client, production, adaptation)
    project = client.get(f'/api/projects/{episode["id"]}').json()
    project["document"]["adaptationPlan"] = {"forged": True}
    project["document"]["episodePlans"] = [{"forged": True}]
    project["document"]["monetizationPlan"] = {"forged": True}
    saved = client.put(f'/api/projects/{episode["id"]}', json={
        "name": project["name"], "revision": project["revision"],
        "production_revision": project["production_revision"], "document": project["document"],
    })
    assert saved.status_code == 200, saved.text
    reopened = client.get(f'/api/projects/{episode["id"]}').json()
    assert all(key not in reopened["document"] for key in ("adaptationPlan", "episodePlans", "monetizationPlan"))
    with s.db() as connection:
        stored = json.loads(connection.execute('SELECT document FROM projects WHERE id=?',(episode["id"],)).fetchone()["document"])
    assert all(key not in stored for key in ("adaptationPlan", "episodePlans", "monetizationPlan"))
    current = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert current["adaptationPlan"] == canonical["adaptationPlan"]
    assert current["episodePlans"] == canonical["episodePlans"]
    assert current["monetizationPlan"] == canonical["monetizationPlan"]


def test_source_edit_marks_approved_plan_and_derived_script_stale_without_ai_call(adaptation_client):
    client = adaptation_client
    production, _, chapter, adaptation = setup_production(client, count=1)
    approved = save_and_approve(client, production, adaptation)
    virtual = client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()
    script = client.put(f'/api/productions/{production["id"]}/episode-scripts/1',json={
        "revision": virtual["revision"], "title": "第一集", "synopsis": "密信出现", "body": "阿青读信。",
        "estimatedDuration": 60, "sourceChapterRefs": [chapter["id"]], "storyGoal": "查明真相",
        "paywallBeat": {}, "characters": ["阿青"], "scenes": ["旧屋"], "props": ["密信"],
    }).json()
    reviewed = client.post(f'/api/productions/{production["id"]}/episode-scripts/1/review',json={"revision": script["revision"]}).json()
    approved_script = client.post(f'/api/productions/{production["id"]}/episode-scripts/1/approve',json={"revision": reviewed["revision"]})
    assert approved_script.status_code == 200, approved_script.text
    before_jobs = sum(len(item["jobs"]) if isinstance(item,dict) and "jobs" in item else 0 for item in [])
    edited = client.put(f'/api/productions/{production["id"]}/chapters/{chapter["id"]}',json={
        "title": chapter["title"], "content": chapter["content"] + "\n密信被烧毁。", "revision": chapter["revision"],
    })
    assert edited.status_code == 200, edited.text
    stale = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert stale["adaptationPlan"]["status"] == "stale"
    assert stale["episodePlans"][0]["status"] == "stale"
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()["status"] == "stale"
    with s.db() as connection:
        assert connection.execute(
            "SELECT COUNT(*) value FROM jobs WHERE project_id IN (SELECT id FROM projects WHERE production_id=?)",
            (production["id"],),
        ).fetchone()["value"] == before_jobs


def test_appending_episode_preserves_completed_sibling_and_generates_only_new_plan(adaptation_client, monkeypatch):
    client = adaptation_client
    production, episode, chapter_one, adaptation = setup_production(client, count=1)
    approved = save_and_approve(client, production, adaptation)

    virtual = client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()
    script = client.put(f'/api/productions/{production["id"]}/episode-scripts/1', json={
        'revision': virtual['revision'], 'title': '第一集', 'synopsis': '第一章完成',
        'body': '内景 夜\n阿青读完密信。', 'estimatedDuration': 60,
        'sourceChapterRefs': [chapter_one['id']], 'storyGoal': '找到真相', 'paywallBeat': {},
        'characters': ['阿青'], 'scenes': ['旧屋'], 'props': ['密信'],
    }).json()
    reviewed_script = client.post(
        f'/api/productions/{production["id"]}/episode-scripts/1/review', json={'revision': script['revision']}
    ).json()
    client.post(
        f'/api/productions/{production["id"]}/episode-scripts/1/approve', json={'revision': reviewed_script['revision']}
    )

    project = client.get(f'/api/projects/{episode["id"]}').json()
    project['document']['nodes'].append({
        'id': 'finished-video', 'type': 'media', 'position': {'x': 0, 'y': 0},
        'data': {'kind': 'video', 'assetId': 'asset-finished-ep01'},
    })
    stored = client.put(f'/api/projects/{episode["id"]}', json={
        'name': project['name'], 'revision': project['revision'],
        'production_revision': project['production_revision'], 'document': project['document'],
    })
    assert stored.status_code == 200, stored.text

    with s.db() as connection:
        source_id = connection.execute('SELECT source_id FROM source_chapters WHERE id=?', (chapter_one['id'],)).fetchone()['source_id']
    chapter_two = client.post(
        f'/api/productions/{production["id"]}/sources/{source_id}/chapters',
        json={'title': '第二章', 'content': '阿青进入城中，发现新的证人。'},
    ).json()
    current = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert current['protectedEpisodeNos'] == [1]
    current['adaptationPlan']['format']['episodeCount'] = 2
    current['episodePlans'].append({
        'episodeNo': 2, 'sourceChapterRefs': [chapter_two['id']], 'logline': '', 'coreConflict': '',
        'emotionalBeat': '', 'hook': '', 'cliffhanger': '', 'paywallRole': 'none',
        'targetDuration': 60, 'status': 'draft',
    })
    appended = client.put(f'/api/productions/{production["id"]}/adaptation', json={
        key: current[key] for key in ('revision', 'adaptationPlan', 'episodePlans', 'monetizationPlan')
    })
    assert appended.status_code == 200, appended.text
    assert appended.json()['episodePlans'][0] == approved['episodePlans'][0]
    assert appended.json()['episodePlans'][1]['status'] == 'draft'
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()['status'] == 'approved'

    whole = client.post(f'/api/productions/{production["id"]}/adaptation/generate', json={
        'project_id': episode['id'], 'provider': 'local', 'model': '', 'submission_id': 'blocked-whole-regeneration',
    })
    assert whole.status_code == 409

    now = time.time()
    with s.db() as connection:
        connection.execute('''INSERT INTO source_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''', (
            s.uid('source-event-'), production['id'], chapter_two['id'], 1, s.dumps(['阿青']),
            '阿青进入城中并找到证人', 'high', '紧张', s.dumps({}), None, now, now,
        ))
    queued = client.post(f'/api/productions/{production["id"]}/adaptation/episodes/2/generate', json={
        'project_id': episode['id'], 'provider': 'local', 'model': '', 'submission_id': 'generate-only-episode-two',
    })
    assert queued.status_code == 200, queued.text
    job = queued.json()
    assert job['scope'] == 'production'
    assert job['input']['stage'] == 'adaptation_episode_generation'
    assert job['input']['schema_version'] == 'episode-plan/v2'
    continuity = job['input']['continuity_context']
    assert continuity['immediatePreviousAvailable'] is True
    assert continuity['previousEpisodes'][0]['evidence'] == 'completed_script'
    assert continuity['previousEpisodes'][0]['script']['body'] == script['body']
    assert script['body'].splitlines()[-1] in job['input']['prompt']
    assert '承接前集结尾' in job['input']['system_prompt']

    generated = {
        'episodeNo': 2, 'sourceChapterRefs': [chapter_two['id']],
        'logline': '阿青进城寻找证人', 'coreConflict': '证人与追兵的冲突',
        'emotionalBeat': '希望转为紧张', 'hook': '证人突然出现', 'cliffhanger': '追兵包围客栈',
        'paywallRole': 'none', 'targetDuration': 60,
    }
    worker = Worker()
    monkeypatch.setattr(worker, '_chat_text', lambda *_args, **_kwargs: json.dumps(generated, ensure_ascii=False))
    s.job_update(job['id'], status='running')
    result = worker.text({**job, 'status': 'running'}, {'url': 'http://unused', 'local': True})
    assert result['episodePlan']['episodeNo'] == 2
    after = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert after['episodePlans'][0] == approved['episodePlans'][0]
    assert after['episodePlans'][1]['status'] == 'review'
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()['status'] == 'approved'

    # Updating EP02's source must not stale the frozen shared story or EP01.
    s.job_update(job['id'], status='succeeded', result=result)
    edited = client.put(f'/api/productions/{production["id"]}/chapters/{chapter_two["id"]}', json={
        'title': chapter_two['title'], 'content': chapter_two['content'] + '\n证人藏在客栈。', 'revision': chapter_two['revision'],
    })
    assert edited.status_code == 200, edited.text
    stale = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert stale['adaptationPlan']['status'] == 'approved'
    assert [plan['status'] for plan in stale['episodePlans']] == ['approved', 'stale']
    assert client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()['status'] == 'approved'
    queued = client.post(f'/api/productions/{production["id"]}/adaptation/episodes/2/generate', json={
        'project_id': episode['id'], 'provider': 'local', 'model': '', 'submission_id': 'regenerate-only-episode-two',
    })
    assert queued.status_code == 200, queued.text
    job = queued.json()
    s.job_update(job['id'], status='running')
    # A changed prior script must reject results composed against older continuity.
    with s.db() as connection:
        connection.execute('UPDATE episode_scripts SET body=? WHERE project_id=?', ('changed ending', episode['id']))
    with pytest.raises(ValueError, match='前集剧本'):
        worker.text({**job, 'status': 'running'}, {'url': 'http://unused', 'local': True})
    with s.db() as connection:
        connection.execute('UPDATE episode_scripts SET body=? WHERE project_id=?', (script['body'], episode['id']))
    worker.text({**job, 'status': 'running'}, {'url': 'http://unused', 'local': True})
    current = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert [plan['status'] for plan in current['episodePlans']] == ['approved', 'review']
    accepted = client.post(f'/api/productions/{production["id"]}/adaptation/episodes/2/approve', json={'revision': current['revision']})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()['adaptationPlan']['status'] == 'approved'
    scripts = client.post(f'/api/productions/{production["id"]}/script-generations', json={
        'episode_nos': [2], 'provider': 'local', 'model': '', 'submission_id': 'script-after-episode-two-approved',
    })
    assert scripts.status_code == 200, scripts.text
    assert len(scripts.json()['jobs']) == 1
    assert scripts.json()['jobs'][0]['input']['episode_script_generation']['episodeNo'] == 2


@pytest.mark.parametrize('change_shared_content', [False, True])
def test_legacy_repair_requires_recorded_approval_and_unchanged_content(adaptation_client, change_shared_content):
    from backend.adaptation import _persist_production_context, _stale_scripts, repair_legacy_protected_adaptation
    client = adaptation_client
    production, episode, chapter, adaptation = setup_production(client, count=2)
    approved = save_and_approve(client, production, adaptation)
    with s.db() as connection:
        project = connection.execute('SELECT * FROM projects WHERE id=?', (episode['id'],)).fetchone()
        document = json.loads(project['document'])
        document['nodes'].append({'id': 'done', 'data': {'kind': 'video', 'assetId': 'video'}})
        connection.execute('UPDATE projects SET document=? WHERE id=?', (s.dumps(document), episode['id']))
        connection.execute("UPDATE episode_scripts SET status='approved',body='finished script' WHERE project_id=?", (episode['id'],))
        row = connection.execute('SELECT * FROM productions WHERE id=?', (production['id'],)).fetchone()
        context = json.loads(row['shared_context'])
        context['adaptationPlan']['status'] = 'stale'
        for plan in context['episodePlans']:
            plan['status'] = 'stale'
        if change_shared_content:
            context['adaptationPlan']['storyCore']['goal'] = 'different goal'
        _persist_production_context(connection, row, context)
        _stale_scripts(connection, production['id'])
        # EP02 has already regenerated; historical repair must not approve it.
        row = connection.execute('SELECT * FROM productions WHERE id=?', (production['id'],)).fetchone()
        context['episodePlans'][1]['status'] = 'review'
        _persist_production_context(connection, row, context)
        repaired = repair_legacy_protected_adaptation(connection)
        assert (production['id'] in repaired) is (not change_shared_content)
        assert production['id'] not in repair_legacy_protected_adaptation(connection)
    result = client.get(f'/api/productions/{production["id"]}/adaptation').json()
    assert result['adaptationPlan']['status'] == ('stale' if change_shared_content else 'approved')
    assert result['episodePlans'][1]['status'] == 'review'
    script = client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()
    assert script['status'] == ('stale' if change_shared_content else 'approved')
    assert script['body'] == 'finished script'
    if not change_shared_content:
        assert result['episodePlans'][0] == approved['episodePlans'][0]


def test_production_job_statuses_include_old_active_sibling_jobs_without_large_payloads(adaptation_client):
    client = adaptation_client
    production, first, _, _ = setup_production(client, count=2)
    second = client.post(f'/api/productions/{production["id"]}/episodes', json={'title': '第二集'}).json()
    other = client.post('/api/projects', json={'name': '其他作品'}).json()
    records = []
    for index in range(205):
        job_id = s.uid('status-test-')
        records.append((job_id, job_id, first['id'], 'node', 'text', 'succeeded',
            s.dumps({'prompt': 'large input', 'stage': 'script_generation'}), index + 10, index + 10))
    active_id = s.uid('status-test-')
    other_id = s.uid('status-test-')
    marker = {'stage': 'script_generation', 'episode_script_generation': {'episodeNo': 2, 'productionId': production['id']}}
    records.extend([
        (active_id, active_id, second['id'], 'episode-script:' + second['id'], 'text', 'running', s.dumps(marker), 1, 1),
        (other_id, other_id, other['id'], 'node', 'text', 'running', '{}', 999, 999),
    ])
    with s.db() as connection:
        connection.executemany('''INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated)
            VALUES(?,?,?,?,?,?,?,?,?)''', records)
    response = client.get(f'/api/productions/{production["id"]}/job-statuses')
    assert response.status_code == 200, response.text
    jobs = response.json()
    assert len(jobs) == 201
    assert {job['id'] for job in jobs if job['status'] == 'running'} == {active_id}
    assert other_id not in {job['id'] for job in jobs}
    assert next(job for job in jobs if job['id'] == active_id)['input'] == marker
    assert all('prompt' not in job['input'] and 'result' not in job for job in jobs)


def test_saved_draft_scripts_supply_continuity_and_noop_save_keeps_stale(adaptation_client):
    from backend.adaptation import episode_continuity_context
    client = adaptation_client
    production, episode, chapter, adaptation = setup_production(client, count=2)
    saved_plan = client.put(f'/api/productions/{production["id"]}/adaptation', json={
        key: adaptation[key] for key in ("revision", "adaptationPlan", "episodePlans", "monetizationPlan")
    })
    assert saved_plan.status_code == 200
    original = client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()
    payload = {"revision": original["revision"], "title": "第一集", "synopsis": "门外来客",
        "body": "阿青：请进。", "estimatedDuration": 15, "sourceChapterRefs": [chapter["id"]],
        "storyGoal": "开门", "paywallBeat": {}, "characters": ["阿青"], "scenes": ["门口"], "props": []}
    saved = client.put(f'/api/productions/{production["id"]}/episode-scripts/1', json=payload).json()
    with s.db() as c:
        context = json.loads(c.execute('SELECT shared_context FROM productions WHERE id=?', (production['id'],)).fetchone()[0])
        evidence = episode_continuity_context(c, production['id'], 2, context)
    assert evidence['previousEpisodes'][0]['evidence'] == 'saved_script'
    assert evidence['previousEpisodes'][0]['script']['body'] == payload['body']
    noop = client.put(f'/api/productions/{production["id"]}/episode-scripts/1', json={**payload, 'revision': saved['revision']}).json()
    assert noop['revision'] == saved['revision']
    # A source change invalidates draft content too, not just old approved work.
    from backend.adaptation import mark_adaptation_stale
    with s.db() as c:
        mark_adaptation_stale(c, production['id'], chapter_ids=[chapter['id']])
    stale = client.get(f'/api/productions/{production["id"]}/episode-scripts/1').json()
    assert stale['status'] == 'stale'
    noop = client.put(f'/api/productions/{production["id"]}/episode-scripts/1', json={**payload, 'revision': stale['revision']}).json()
    assert noop['status'] == 'stale' and noop['revision'] == stale['revision']
    updated = client.put(f'/api/productions/{production["id"]}/episode-scripts/1', json={**payload, 'revision': stale['revision'], 'body': '阿青打开门，发现来者是父亲。'}).json()
    assert updated['status'] == 'draft' and updated['revision'] > stale['revision']
    with s.db() as c:
        assert c.execute('SELECT count(*) FROM episode_script_revisions WHERE project_id=?', (episode['id'],)).fetchone()[0] >= 2
    assert client.get(f'/api/projects/{episode["id"]}/jobs').json() == []


@pytest.mark.parametrize('fault,message', [('shared', '故事核心'), ('episode', 'hook'), ('stale', '规划需要更新'), ('reference', '引用')])
def test_single_user_generation_still_validates_saved_content(adaptation_client, fault, message):
    client = adaptation_client
    production, episode, chapter, adaptation = setup_production(client, count=2)
    saved = client.put(f'/api/productions/{production["id"]}/adaptation', json={
        key: adaptation[key] for key in ("revision", "adaptationPlan", "episodePlans", "monetizationPlan")
    })
    assert saved.status_code == 200
    with s.db() as c:
        row = c.execute('SELECT shared_context FROM productions WHERE id=?', (production['id'],)).fetchone()
        context = json.loads(row[0])
        if fault == 'shared': context['adaptationPlan']['storyCore'] = {}
        if fault == 'episode': context['episodePlans'][0]['hook'] = ''
        if fault == 'stale': context['episodePlans'][0]['status'] = 'stale'
        if fault == 'reference': context['episodePlans'][0]['sourceChapterRefs'] = ['missing-chapter']
        c.execute('UPDATE productions SET shared_context=? WHERE id=?', (s.dumps(context), production['id']))
    result = client.post(f'/api/productions/{production["id"]}/script-generations', json={
        'episode_nos': [1], 'provider': 'local', 'model': '', 'submission_id': 'single-user-validation-' + fault,
    })
    assert result.status_code == 400, result.text
    assert message in result.json()['detail']
    assert client.get(f'/api/projects/{episode["id"]}/jobs').json() == []


def test_single_user_ready_episode_ignores_incomplete_sibling_and_protects_finished(adaptation_client):
    client = adaptation_client
    production, episode, chapter, adaptation = setup_production(client, count=2)
    adaptation['episodePlans'][1]['hook'] = ''
    saved = client.put(f'/api/productions/{production["id"]}/adaptation', json={
        key: adaptation[key] for key in ("revision", "adaptationPlan", "episodePlans", "monetizationPlan")
    })
    assert saved.status_code == 200
    result = client.post(f'/api/productions/{production["id"]}/script-generations', json={
        'episode_nos': [1], 'provider': 'local', 'model': '', 'submission_id': 'single-user-sibling-ready',
    })
    assert result.status_code == 200, result.text
    s.job_update(result.json()['jobs'][0]['id'], status='cancelled')
    with s.db() as c:
        row = c.execute('SELECT document FROM projects WHERE id=?', (episode['id'],)).fetchone()
        doc = json.loads(row[0])
        doc['nodes'].append({'id':'finished-video','data':{'kind':'video','assetId':'finished-asset'}})
        c.execute('UPDATE projects SET document=? WHERE id=?', (s.dumps(doc), episode['id']))
    result = client.post(f'/api/productions/{production["id"]}/script-generations', json={
        'episode_nos': [1], 'provider': 'local', 'model': '', 'submission_id': 'single-user-finished-protected',
    })
    assert result.status_code == 400 and '已有成片' in result.json()['detail']
