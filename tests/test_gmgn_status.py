import importlib.util
from pathlib import Path


def feed():
    path = Path.home()/'.hermes/skills/gmgn-migrated-loop/scripts/feed.py'
    spec = importlib.util.spec_from_file_location('feed_status_test', path)
    mod = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_stop_time_never_comes_from_log_mtime():
    f = feed()
    text = '{"event":"stop","reason":"insufficient"}\n{"event":"stop","reason":"stop_file","ts":123}'
    assert [s['ts'] for s in f.parse_text(text, 999)[2]] == [None, 123]


def test_live_status_does_not_use_history(monkeypatch, tmp_path):
    f = feed()
    monkeypatch.setattr(f, 'ROOT', tmp_path)
    monkeypatch.setattr(f, 'runner_pids', lambda: [123], raising=False)
    (tmp_path/'latest_screen.json').write_text('{"scan_at": 1000}')
    assert f.runner_status(now=1000)['state'] == 'running'
    (tmp_path/'STOP').touch()
    assert f.runner_status()['state'] == 'buys_blocked'
    (tmp_path/'STOP').unlink()
    (tmp_path/'risk_halt.json').write_text('{"reason":"two_catastrophes_12h"}')
    assert f.runner_status()['reason'] == 'two_catastrophes_12h'
    (tmp_path/'risk_halt.json').unlink()
    monkeypatch.setattr(f, 'runner_pids', lambda: [])
    assert f.runner_status()['state'] == 'not_running'
    monkeypatch.setattr(f, 'runner_pids', lambda: None)
    assert f.runner_status()['state'] == 'unknown'


def test_live_pids_with_old_scan_are_stalled(monkeypatch, tmp_path):
    f = feed()
    monkeypatch.setattr(f, 'ROOT', tmp_path)
    monkeypatch.setattr(f, 'runner_pids', lambda: [123])
    (tmp_path/'latest_screen.json').write_text('{"scan_at": 1000}')
    assert f.runner_status(now=1181)['state'] == 'stalled'
    assert f.runner_status(now=1100)['state'] == 'running'


def test_delayed_open_cannot_outlive_its_recorded_close(monkeypatch):
    f = feed()
    monkeypatch.setattr(f, 'claim_rows', lambda: [])
    opened = dict(kind='open', address='mint', ts=129, entry='1', sol=.2)
    closed = dict(kind='trade', address='mint', ts=106)
    assert f.open_positions([closed], [], [opened, closed]) == []
    rebuy = dict(opened, ts=150, buy_tx_hash='second-buy')
    assert f.open_positions([closed], [], [opened, closed, rebuy])[0]['ts'] == 150


def test_buy_identity_closes_even_when_timestamp_is_late(monkeypatch):
    f = feed()
    monkeypatch.setattr(f, 'claim_rows', lambda: [])
    buy = dict(address='mint', scan_at=129, price_usd='1', hash='buy-1')
    close = dict(address='mint', ts=106, buy_tx_hash='buy-1')
    assert f.open_positions([close], [buy], []) == []
