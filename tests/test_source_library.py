import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import store as s
from backend.app import app
from backend.source_library import replace_events, split_chapters
from backend.worker import Worker


@pytest.fixture(scope="module")
def source_client():
    with TestClient(app) as client:
        app.state.worker.stop()
        status = client.get("/api/auth/status").json()
        endpoint = "/api/auth/login" if status["configured"] else "/api/auth/setup"
        response = client.post(endpoint, json={"password": "integration-test-only"})
        assert response.status_code == 200, response.text
        yield client


def new_production(client):
    production = client.post(
        "/api/productions", json={"name": "Phase 2 原著资料库"}
    ).json()
    episode = client.post(
        f'/api/productions/{production["id"]}/episodes', json={"title": "第一集"}
    ).json()
    return production, episode


def test_chapter_split_accepts_markdown_and_chinese_headings():
    assert split_chapters("# 第一幕\n雨夜。\n## 第二幕\n天亮。") == [
        ("第一幕", "雨夜。"),
        ("第二幕", "天亮。"),
    ]
    assert split_chapters("题记\n第十二章 重逢\n多年后。") == [
        ("前言", "题记"),
        ("第十二章 重逢", "多年后。"),
    ]


def test_import_120_chapters_and_create_recoverable_text_jobs_only(source_client):
    client = source_client
    production, episode = new_production(client)
    content = "\n".join(f"第{number}章 测试\n第 {number} 章发生的事件。" for number in range(1, 121))
    imported = client.post(
        f'/api/productions/{production["id"]}/sources/import',
        json={"title": "长篇测试", "type": "txt", "metadata": {}, "content": content},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["chapter_count"] == 120

    chapters = client.get(
        f'/api/productions/{production["id"]}/chapters'
    ).json()
    assert len(chapters) == 120
    assert len({chapter["id"] for chapter in chapters}) == 120
    assert all(chapter["source_id"] == imported.json()["id"] for chapter in chapters)
    searched = client.get(
        f'/api/productions/{production["id"]}/chapters', params={"q": "第 120 章"}
    ).json()
    assert len(searched) == 1 and searched[0]["chapter_no"] == 120

    first_chapter = chapters[0]
    saved = client.put(
        f'/api/productions/{production["id"]}/chapters/{first_chapter["id"]}',
        json={
            "title": "修订后的第一章", "content": first_chapter["content"] + "\n补充。",
            "revision": first_chapter["revision"],
        },
    )
    assert saved.status_code == 200 and saved.json()["revision"] == 2
    stale = client.put(
        f'/api/productions/{production["id"]}/chapters/{first_chapter["id"]}',
        json={"title": "旧页面覆盖", "content": "不应保存", "revision": 1},
    )
    assert stale.status_code == 409
    chapters = client.get(f'/api/productions/{production["id"]}/chapters').json()
    assert chapters[0]["title"] == "修订后的第一章"

    body = {
        "project_id": episode["id"],
        "chapter_ids": [chapter["id"] for chapter in chapters],
        "provider": "local",
        "model": "",
        "allow_cloud": False,
        "submission_id": "phase2-batch-120",
    }
    first = client.post(
        f'/api/productions/{production["id"]}/source-extractions', json=body
    )
    second = client.post(
        f'/api/productions/{production["id"]}/source-extractions', json=body
    )
    assert first.status_code == second.status_code == 200
    assert [item["id"] for item in first.json()["jobs"]] == [
        item["id"] for item in second.json()["jobs"]
    ]
    jobs = first.json()["jobs"]
    assert len(jobs) == 120
    assert {item["kind"] for item in jobs} == {"text"}
    assert all(item["input"]["stage"] == "source_analysis" for item in jobs)
    assert all(item["input"]["source_event_extraction"]["chapterId"] in body["chapter_ids"] for item in jobs)
    with s.db() as connection:
        kinds = connection.execute(
            "SELECT DISTINCT kind FROM jobs WHERE project_id=?", (episode["id"],)
        ).fetchall()
        assert [row["kind"] for row in kinds] == ["text"]
        connection.execute(
            "UPDATE jobs SET status='cancelled' WHERE project_id=?", (episode["id"],)
        )


def test_invalid_or_stale_extraction_preserves_existing_events(source_client, monkeypatch):
    client = source_client
    production, episode = new_production(client)
    source = client.post(
        f'/api/productions/{production["id"]}/sources',
        json={"title": "事务测试", "type": "manual", "metadata": {}},
    ).json()
    chapter = client.post(
        f'/api/productions/{production["id"]}/sources/{source["id"]}/chapters',
        json={"title": "第一章", "content": "阿青走进雨中的车站。"},
    ).json()
    extraction = client.post(
        f'/api/productions/{production["id"]}/source-extractions',
        json={
            "project_id": episode["id"],
            "chapter_ids": [chapter["id"]],
            "provider": "local",
            "model": "",
            "allow_cloud": False,
            "submission_id": "phase2-atomic-invalid",
        },
    ).json()["jobs"][0]
    now = time.time()
    with s.db() as connection:
        connection.execute(
            "INSERT INTO source_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "source-event-existing", production["id"], chapter["id"], 1,
                s.dumps(["阿青"]), "旧事件", "medium", "紧张", s.dumps({"weather": "rain"}),
                extraction["id"], now, now,
            ),
        )
    s.job_update(extraction["id"], status="running")
    running = {**extraction, "status": "running"}
    monkeypatch.setattr(Worker, "_chat_text", lambda *_args, **_kwargs: '{"events":[{"summary":""}]}')
    with pytest.raises(ValueError, match="校验失败"):
        Worker().text(running, {"url": "http://unused", "local": True})
    assert client.get(
        f'/api/productions/{production["id"]}/source-events?chapter_id={chapter["id"]}'
    ).json()[0]["summary"] == "旧事件"

    saved = client.put(
        f'/api/productions/{production["id"]}/chapters/{chapter["id"]}',
        json={"title": chapter["title"], "content": chapter["content"] + " 天亮了。", "revision": chapter["revision"]},
    )
    assert saved.status_code == 200, saved.text
    with pytest.raises(ValueError, match="章节已在提取期间更新"):
        replace_events(running, [{
            "characters": ["阿青"], "summary": "新事件", "importance": "high",
            "emotion": "期待", "continuity": {"weather": "clear"},
        }])
    assert client.get(
        f'/api/productions/{production["id"]}/source-events?chapter_id={chapter["id"]}'
    ).json()[0]["summary"] == "旧事件"


def test_valid_extraction_atomically_replaces_events_with_chapter_ownership(source_client):
    client = source_client
    production, episode = new_production(client)
    source = client.post(
        f'/api/productions/{production["id"]}/sources',
        json={"title": "成功测试", "type": "manual", "metadata": {}},
    ).json()
    chapter = client.post(
        f'/api/productions/{production["id"]}/sources/{source["id"]}/chapters',
        json={"title": "开场", "content": "阿青推开门。"},
    ).json()
    job = client.post(
        f'/api/productions/{production["id"]}/source-extractions',
        json={
            "project_id": episode["id"], "chapter_ids": [chapter["id"]],
            "provider": "local", "model": "", "allow_cloud": False,
            "submission_id": "phase2-atomic-success",
        },
    ).json()["jobs"][0]
    s.job_update(job["id"], status="running")
    rows = replace_events({**job, "status": "running"}, [{
        "characters": ["阿青"], "summary": "阿青推开门", "importance": "high",
        "emotion": "警惕", "continuity": {"door": "open"},
    }])
    assert rows[0]["continuity"] == {"door": "open"}
    events = client.get(f'/api/productions/{production["id"]}/source-events').json()
    assert len(events) == 1
    assert events[0]["chapter_id"] == chapter["id"]
    assert events[0]["extraction_job_id"] == job["id"]
    assert events[0]["characters"] == ["阿青"]
