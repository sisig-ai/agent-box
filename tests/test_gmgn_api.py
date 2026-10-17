"""GMGN tab route returns the runner feed."""

import json

import pytest


@pytest.fixture(autouse=True)
def stub_balance(monkeypatch):
    from dashboard import gmgn_api
    monkeypatch.setattr(gmgn_api, "load_balance", lambda now=None: None)


def test_gmgn_route_reads_runner_feed(client, monkeypatch, tmp_path):
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    sample = {
        "output": "\n".join([
            json.dumps({
                "ok": True,
                "loop": "migrated",
                "symbol": "Demo",
                "address": "Mint111",
                "status": "confirmed",
                "sol": 0.2,
                "price_usd": "0.0001",
            }),
            json.dumps({
                "ok": True,
                "step": "closed",
                "closed": True,
                "symbol": "Demo",
                "address": "Mint111",
                "sell": {
                    "quote_amount": "0.21",
                    "price_usd": "0.000107",
                    "timestamp": 1_700_000_000,
                },
            }),
            json.dumps({"event": "stop", "reason": "last3_all_negative"}),
        ])
    }
    (log_dir / "proc_test.json").write_text(json.dumps(sample))
    monkeypatch.setenv("GMGN_LOOP_LOG_DIR", str(log_dir))
    monkeypatch.setenv("GMGN_LOOP_EXTRA_LOG", str(tmp_path / "missing.log"))
    monkeypatch.setenv("GMGN_LOOP_EVENTS", str(tmp_path / "events.jsonl"))
    monkeypatch.setenv("GMGN_LOOP_LEDGER", str(tmp_path / "ledger.json"))
    monkeypatch.setenv("GMGN_LOOP_CLAIMS", str(tmp_path / "claims.json"))
    monkeypatch.setenv("GMGN_LOOP_SCREEN", str(tmp_path / "missing-screen.json"))
    (tmp_path / "events.jsonl").write_text(json.dumps({
        "kind": "open",
        "ts": 1_700_001_000,
        "symbol": "Live",
        "address": "MintOpen",
        "loop": "migrated",
        "sol": 0.2,
        "entry": "0.004",
    }) + "\n")
    monkeypatch.setenv("GMGN_NOW", "1700001000")
    from dashboard import gmgn_api
    gmgn_api._CACHE["body"] = None
    gmgn_api._CACHE["at"] = 0
    response = client.get("/api/gmgn")
    assert response.status_code == 200
    body = response.get_json()
    trades = [event for event in body["events"] if event["kind"] == "trade"]
    stops = [event for event in body["events"] if event["kind"] == "stop"]
    assert trades[0]["symbol"] == "Demo"
    assert trades[0]["sol"] == 0.2
    assert trades[0]["pnl_sol"] == 0.01
    assert stops[0]["reason"] == "last3_all_negative"
    assert body["open"][0]["symbol"] == "Live"
    assert body["open"][0]["address"] == "MintOpen"
    assert body["screen"] is None
    assert "h12" in body["pnl"] and "d1" in body["pnl"] and "d7" in body["pnl"]


def test_gmgn_route_returns_latest_screen(client, monkeypatch, tmp_path):
    monkeypatch.setenv("GMGN_LOOP_LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.setenv("GMGN_LOOP_EXTRA_LOG", str(tmp_path / "missing.log"))
    monkeypatch.setenv("GMGN_LOOP_EVENTS", str(tmp_path / "events.jsonl"))
    monkeypatch.setenv("GMGN_LOOP_LEDGER", str(tmp_path / "ledger.json"))
    monkeypatch.setenv("GMGN_LOOP_CLAIMS", str(tmp_path / "claims.json"))
    screen = tmp_path / "latest_screen.json"
    screen.write_text(json.dumps({
        "scan_at": 1_700_000_100,
        "seen": 1,
        "failed": 1,
        "skipped": 0,
        "passed": 0,
        "rows": [{
            "symbol": "SPX",
            "address": "MintFail",
            "age_min": 2.93,
            "holder_count": 1011,
            "volume_24h": 161611.53,
            "volume_per_holder": 159.8522,
            "result": "fail",
            "reason": "volume per holder $159.9 >= $100",
        }],
    }))
    monkeypatch.setenv("GMGN_LOOP_SCREEN", str(screen))
    monkeypatch.setenv("GMGN_NOW", "1700001000")
    from dashboard import gmgn_api
    gmgn_api._CACHE["body"] = None
    gmgn_api._CACHE["at"] = 0
    response = client.get("/api/gmgn")
    assert response.status_code == 200
    body = response.get_json()["screen"]
    assert body["failed"] == 1
    assert body["rows"][0]["symbol"] == "SPX"
    assert body["rows"][0]["reason"] == "volume per holder $159.9 >= $100"


def test_quote_usd_uses_exact_decimal():
    from dashboard.gmgn_api import quote_usd
    assert quote_usd("0.596435973", "106.38501728") == "63.45"


def test_route_attaches_balance(client, monkeypatch, tmp_path):
    monkeypatch.setenv("GMGN_LOOP_LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.setenv("GMGN_LOOP_EXTRA_LOG", str(tmp_path / "missing.log"))
    monkeypatch.setenv("GMGN_LOOP_EVENTS", str(tmp_path / "events.jsonl"))
    monkeypatch.setenv("GMGN_LOOP_LEDGER", str(tmp_path / "ledger.json"))
    monkeypatch.setenv("GMGN_LOOP_CLAIMS", str(tmp_path / "claims.json"))
    monkeypatch.setenv("GMGN_LOOP_SCREEN", str(tmp_path / "missing-screen.json"))
    from dashboard import gmgn_api
    gmgn_api._CACHE["body"] = None
    gmgn_api._CACHE["at"] = 0
    monkeypatch.setattr(gmgn_api, "load_balance", lambda now=None: {
        "sol": "0.596435973",
        "usd": "63.45",
        "price_usd": "106.38501728",
        "as_of": 1_700_000_000,
    })
    body = client.get("/api/gmgn").get_json()
    assert body["balance"]["usd"] == "63.45"
    assert body["balance"]["sol"] == "0.596435973"
