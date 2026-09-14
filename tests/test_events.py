from backend.app import _event_cursor


def test_new_event_stream_starts_at_latest_event():
    assert _event_cursor(17_760) == 17_760


def test_recent_reconnect_replays_missed_events():
    assert _event_cursor(17_760, last_event_id="17750") == 17_750
    assert _event_cursor(17_760, after=17_755) == 17_755


def test_stale_reconnect_skips_unbounded_history():
    assert _event_cursor(17_760, last_event_id="100") == 17_760
    assert _event_cursor(17_760, after=0) == 17_760
