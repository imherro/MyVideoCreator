from backend import store as s


def test_event_queue_retains_only_recent_notifications(monkeypatch):
    monkeypatch.setattr(s, "EVENT_RETENTION", 5)
    s.init()
    with s.db() as connection:
        connection.execute("DELETE FROM events")
    for number in range(10):
        s.event("retention-project", {"type": "project", "revision": number})
    with s.db() as connection:
        rows = connection.execute("SELECT payload FROM events ORDER BY id").fetchall()
    assert len(rows) == 5
    assert '"revision": 5' in rows[0]["payload"]
    assert '"revision": 9' in rows[-1]["payload"]


def test_job_notifications_are_throttled_but_terminal_state_is_immediate(monkeypatch):
    emitted = []
    ticks = iter([100.0, 101.0, 102.0])
    monkeypatch.setattr(s.time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(s, "event", lambda project_id, payload: emitted.append((project_id, payload)))
    s._job_event_times.clear()

    assert s._notify_job("project-a", "job-a") is True
    assert s._notify_job("project-a", "job-a") is False
    assert s._notify_job("project-a", "job-a", force=True) is True
    assert emitted == [
        ("project-a", {"type": "job", "id": "job-a"}),
        ("project-a", {"type": "job", "id": "job-a"}),
    ]
