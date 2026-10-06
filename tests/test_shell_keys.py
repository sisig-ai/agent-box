"""Key spec composer: modifier parsing, allowlist, and flag safety."""

import pytest

from dashboard.shell.keys import resolve_key


@pytest.mark.parametrize(
    "spec,expected",
    [
        ("Enter", "Enter"),
        ("Escape", "Escape"),
        ("Backspace", "BSpace"),
        ("Delete", "DC"),
        ("C-c", "C-c"),
        ("M-x", "M-x"),
        ("C-M-x", "C-M-x"),
        ("C-Left", "C-Left"),
        ("M-Left", "M-Left"),
        ("S-Up", "S-Up"),
        ("C-S-Up", "C-S-Up"),
        ("S-Tab", "BTab"),
        ("C-S-Tab", "C-BTab"),
        ("C-/", "C-/"),
        ("7", "7"),
    ],
)
def test_resolve_key_accepts(spec, expected):
    assert resolve_key(spec) == expected


@pytest.mark.parametrize(
    "spec", ["", "Nope", "C-", "-", "C--", "X-y", "S-", None, 5, "C-Nope", "\x00"]
)
def test_resolve_key_rejects(spec):
    assert resolve_key(spec) is None


def test_send_key_composes_and_rejects(monkeypatch):
    from tmux_runner import Runner, mk

    import dashboard.shell.tmux as tmux

    run = Runner()
    run.responses = [mk()]
    monkeypatch.setattr(tmux.subprocess, "run", run)
    assert tmux.send_key("abc", "C-M-x") == ("ok", None)
    assert run.calls == [["tmux", "send-keys", "-t", "dash-abc", "C-M-x"]]
    assert tmux.send_key("abc", "Nope") == ("bad", "unknown shell id or key")
    assert len(run.calls) == 1
