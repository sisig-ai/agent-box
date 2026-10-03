"""macOS metrics mapping: power source, missing-power nulls, temp bounds, mem math."""

from types import SimpleNamespace

import psutil

from dashboard.macos_metrics import snapshot


def _mem(total=1000, available=400, free=300):
    return SimpleNamespace(total=total, available=available, free=free)


def _patch(monkeypatch, mem=None, cpu=10.0):
    monkeypatch.setattr(psutil, "virtual_memory", lambda: mem or _mem())
    monkeypatch.setattr(psutil, "cpu_percent", lambda: cpu)


def test_smc_source_maps_component_power(monkeypatch):
    _patch(monkeypatch)
    out = snapshot(
        {
            "sys_power": 8.4,
            "cpu_power": 1.2,
            "gpu_power": 0.5,
            "ane_power": 0.1,
            "all_power": 12.0,
            "temp": {"cpu_temp_avg": 42.16},
        }
    )
    assert out["platform"] == "macOS"
    assert out["power"]["source"] == "Apple SMC"
    assert out["power"]["total_w"] == 8.4
    assert (out["power"]["cpu_w"], out["power"]["gpu_w"], out["power"]["ane_w"]) == (1.2, 0.5, 0.1)
    assert "SMC" in out["power"]["note"]


def test_ioreport_source_when_no_sys_power(monkeypatch):
    _patch(monkeypatch)
    out = snapshot({"cpu_power": 1.0, "all_power": 9.0, "temp": {}})
    assert out["power"]["source"] == "Apple IOReport"
    assert out["power"]["total_w"] == 9.0


def test_missing_component_power_is_null_not_zero(monkeypatch):
    _patch(monkeypatch)
    out = snapshot({"sys_power": 8.4, "temp": {}})
    assert out["power"]["cpu_w"] is None
    assert out["power"]["gpu_w"] is None
    assert out["power"]["ane_w"] is None
    assert out["power"]["total_w"] == 8.4


def test_no_power_at_all_is_null(monkeypatch):
    _patch(monkeypatch)
    out = snapshot({})
    assert out["power"]["total_w"] is None
    assert out["power"]["cpu_w"] is None
    assert out["power"]["source"] == "Apple IOReport"


def test_low_sys_power_falls_back_to_all_power(monkeypatch):
    _patch(monkeypatch)
    out = snapshot({"sys_power": 0.001, "all_power": 5.0})
    assert out["power"]["source"] == "Apple IOReport"
    assert out["power"]["total_w"] == 5.0


def test_temp_bounds_and_garbage(monkeypatch):
    _patch(monkeypatch)
    assert snapshot({"temp": {"cpu_temp_avg": 42.16}})["cpu"]["temp_c"] == 42.2
    assert snapshot({"temp": {"cpu_temp_avg": 0.5}})["cpu"]["temp_c"] is None
    assert snapshot({"temp": {"cpu_temp_avg": "hot"}})["cpu"]["temp_c"] is None
    assert snapshot({"temp": {"cpu_temp_avg": float("nan")}})["cpu"]["temp_c"] is None


def test_mem_math(monkeypatch):
    _patch(monkeypatch, mem=_mem(total=1000, available=400, free=250))
    assert snapshot({})["mem"] == {
        "total_bytes": 1000,
        "used_bytes": 600,
        "free_bytes": 250,
        "available_bytes": 400,
        "util_percent": 60.0,
    }


def test_cpu_util_is_rounded(monkeypatch):
    _patch(monkeypatch, cpu=12.34)
    assert snapshot({})["cpu"]["util_percent"] == 12.3
