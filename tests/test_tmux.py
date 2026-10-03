"""tmux backend over a mocked subprocess.run: argv shape and status mapping."""

import subprocess

import pytest
from tmux_runner import Runner, mk

import dashboard.shell.tmux as tmux


@pytest.fixture
def runner(monkeypatch):
    run = Runner()
    monkeypatch.setattr(tmux.subprocess, "run", run)
    return run


def test_tmux_run_invokes_bare_argv(runner):
    runner.responses = [mk(stdout=b"out")]
    result = tmux.tmux_run(["has-session", "-t", "s"])
    assert result.returncode == 0
    assert runner.calls == [["tmux", "has-session", "-t", "s"]]
    assert runner.kwargs[-1]["capture_output"] is True
    assert runner.kwargs[-1]["check"] is False
    assert runner.kwargs[-1]["timeout"] == 15


def test_tmux_has(runner):
    runner.responses = [mk(returncode=0)]
    assert tmux.tmux_has("s") is True
    runner.responses = [mk(returncode=1)]
    assert tmux.tmux_has("s") is False


def test_tmux_gone_fragments():
    assert tmux.tmux_gone("can't find session: dash-x")
    assert tmux.tmux_gone("no server running on /tmp/tmux")
    assert tmux.tmux_gone("failed to connect to server")
    assert not tmux.tmux_gone("permission denied")


def test_no_shell_interpolation_anywhere(runner):
    runner.responses = [
        mk(returncode=1),  # has-session: not present
        mk(),  # new-session
        mk(stdout=b"hello"),  # capture-pane
        mk(stdout=b"1 2 80 24 zsh\n"),  # display-message
        mk(),  # load-buffer
        mk(),  # paste-buffer
        mk(),  # delete-buffer
        mk(),  # send-keys
        mk(),  # resize-window
        mk(),  # kill-session
        mk(stdout=b"dash-abc 1 detached\n"),  # ls
    ]
    tmux.ensure_session("abc")
    tmux.paste_text("abc", "ls")
    tmux.send_key("abc", "Enter")
    tmux.resize_session("abc", 80, 24)
    tmux.kill_session("abc")
    tmux.list_sessions()
    for argv in runner.calls:
        # Every backend call runs tmux directly; no shell binary is the runner.
        # (tmux's own `-c <cwd>` flag is not shell interpolation.)
        assert argv[0] == "tmux"
        assert "sh" not in argv


# ---------------- ensure_session ----------------


def test_ensure_session_reuses_existing(runner):
    runner.responses = [mk(returncode=0)]
    status, info = tmux.ensure_session("abc", 80, 24)
    assert status == "ok"
    assert info == {"id": "abc", "session": "dash-abc", "cols": 80, "rows": 24, "cwd": "~"}
    assert runner.calls == [["tmux", "has-session", "-t", "dash-abc"]]


def test_ensure_session_creates_and_retries_capture(runner, monkeypatch):
    runner.responses = [mk(returncode=1), mk()]
    snapshots = [{"id": "abc", "alive": False}, {"id": "abc", "alive": True, "text": "ready"}]
    seen = []

    def fake_capture(sid):
        seen.append(sid)
        return snapshots.pop(0)

    monkeypatch.setattr(tmux, "capture_pane", fake_capture)
    status, _ = tmux.ensure_session("abc", 90, 30)
    assert status == "ok"
    assert len(seen) == 2
    assert runner.calls[1] == [
        "tmux",
        "new-session",
        "-d",
        "-s",
        "dash-abc",
        "-x",
        "90",
        "-y",
        "30",
        "-c",
        tmux.SHELL_HOME,
        "/bin/zsh",
        "-l",
    ]


def test_ensure_session_new_failure_truncates(runner):
    runner.responses = [mk(returncode=1), mk(returncode=1, stderr=b"e" * 600)]
    status, msg = tmux.ensure_session("abc")
    assert status == "error"
    assert msg == "e" * 500


def test_ensure_session_timeout(runner):
    runner.responses = [mk(returncode=1), subprocess.TimeoutExpired("tmux", 15)]
    assert tmux.ensure_session("abc") == ("error", "shell command timed out")


# ---------------- capture_pane ----------------


def test_capture_pane_alive(runner):
    runner.responses = [mk(stdout=b"hi"), mk(stdout=b"3 4 120 40 zsh\n")]
    assert tmux.capture_pane("abc") == {
        "id": "abc",
        "alive": True,
        "text": "hi",
        "cursor_x": 3,
        "cursor_y": 4,
        "cols": 120,
        "rows": 40,
        "cmd": "zsh",
    }


def test_capture_pane_gone(runner):
    runner.responses = [mk(returncode=1)]
    assert tmux.capture_pane("abc") == {"id": "abc", "alive": False}


def test_capture_pane_no_server_running(runner):
    runner.responses = [mk(stdout=b"no server running on /tmp/x")]
    assert tmux.capture_pane("abc") == {"id": "abc", "alive": False}


def test_capture_pane_timeout(runner):
    runner.responses = [subprocess.TimeoutExpired("tmux", 15)]
    assert tmux.capture_pane("abc") == {
        "id": "abc",
        "alive": False,
        "error": "shell command timed out",
    }


def test_capture_pane_display_message_bad_rc(runner):
    runner.responses = [mk(stdout=b"hi"), mk(returncode=1)]
    assert tmux.capture_pane("abc") == {"id": "abc", "alive": False}


def test_capture_pane_dims_fallback_on_garbage(runner):
    runner.responses = [mk(stdout=b"hi"), mk(stdout=b"not numbers\n")]
    snap = tmux.capture_pane("abc")
    assert (snap["cursor_x"], snap["cursor_y"], snap["cols"], snap["rows"], snap["cmd"]) == (
        0,
        0,
        80,
        24,
        "",
    )


# ---------------- paste_text ----------------


def test_paste_text_rejects_bad_input(runner):
    assert tmux.paste_text("abc", "") == ("bad", "id and non-empty text required")
    assert tmux.paste_text("abc", 5) == ("bad", "id and non-empty text required")
    too_long = "x" * (tmux.INPUT_MAX + 1)
    assert tmux.paste_text("abc", too_long) == ("bad", f"text too long (max {tmux.INPUT_MAX})")
    assert runner.calls == []


def test_paste_text_ok_uses_three_calls(runner):
    runner.responses = [mk(), mk(), mk()]
    assert tmux.paste_text("abc", "ls") == ("ok", None)
    assert runner.calls[0] == ["tmux", "load-buffer", "-b", "buf-abc", "-"]
    assert runner.calls[1] == ["tmux", "paste-buffer", "-b", "buf-abc", "-t", "dash-abc"]
    assert runner.calls[2] == ["tmux", "delete-buffer", "-b", "buf-abc"]


def test_paste_text_gone(runner):
    runner.responses = [mk(), mk(returncode=1, stderr=b"can't find session: dash-abc"), mk()]
    assert tmux.paste_text("abc", "ls") == ("gone", "no such shell session")


def test_paste_text_error_truncates(runner):
    runner.responses = [mk(), mk(returncode=1, stderr=b"x" * 500), mk()]
    status, msg = tmux.paste_text("abc", "ls")
    assert status == "error"
    assert msg == "x" * 300


def test_paste_text_timeout(runner):
    runner.responses = [mk(), subprocess.TimeoutExpired("tmux", 15)]
    assert tmux.paste_text("abc", "ls") == ("error", "shell command timed out")


# ---------------- send_key ----------------


def test_send_key_rejects_unknown(runner):
    assert tmux.send_key("abc", "Nope") == ("bad", "unknown shell id or key")
    assert runner.calls == []


def test_send_key_ok(runner):
    runner.responses = [mk()]
    assert tmux.send_key("abc", "Enter") == ("ok", None)
    assert runner.calls[0] == ["tmux", "send-keys", "-t", "dash-abc", "Enter"]


def test_send_key_gone_and_error(runner):
    runner.responses = [mk(returncode=1, stderr=b"can't find session")]
    assert tmux.send_key("abc", "Enter") == ("gone", "no such shell session")
    runner.responses = [mk(returncode=1, stderr=b"boom")]
    assert tmux.send_key("abc", "Enter") == ("error", "send-keys failed")


def test_send_key_timeout(runner):
    runner.responses = [subprocess.TimeoutExpired("tmux", 15)]
    assert tmux.send_key("abc", "Enter") == ("error", "shell command timed out")


# ---------------- resize / kill / list ----------------


def test_resize_session_ok_and_gone(runner):
    runner.responses = [mk()]
    assert tmux.resize_session("abc", 100, 40) == ("ok", {"cols": 100, "rows": 40})
    assert runner.calls[0] == [
        "tmux",
        "resize-window",
        "-t",
        "dash-abc",
        "-x",
        "100",
        "-y",
        "40",
    ]
    runner.responses = [mk(returncode=1)]
    assert tmux.resize_session("abc", 100, 40) == ("gone", "no such shell session")


def test_kill_session_ok_and_timeout(runner):
    runner.responses = [mk()]
    assert tmux.kill_session("abc") == ("ok", {"id": "abc"})
    assert runner.calls[0] == ["tmux", "kill-session", "-t", "dash-abc"]
    runner.responses = [subprocess.TimeoutExpired("tmux", 15)]
    assert tmux.kill_session("abc") == ("error", "shell command timed out")


def test_list_sessions_filters_non_dashboard(runner):
    stdout = (
        b"dash-abc 111 attached\ndash-bad;id 222 detached\nother 333 x\ndash-def 444 detached\n"
    )
    runner.responses = [mk(stdout=stdout)]
    assert tmux.list_sessions() == {
        "sessions": [
            {"id": "abc", "session": "dash-abc", "info": "111 attached"},
            {"id": "def", "session": "dash-def", "info": "444 detached"},
        ]
    }


def test_list_sessions_timeout(runner):
    runner.responses = [subprocess.TimeoutExpired("tmux", 15)]
    assert tmux.list_sessions() is None
