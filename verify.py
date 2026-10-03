"""Functional verification in a disposable database; production notes untouched."""

import io
import os
import tempfile
from pathlib import Path


def main():
    with tempfile.TemporaryDirectory() as folder:
        # Point the app at a throwaway data dir / fs home *before* importing it,
        # so config is read from the environment instead of patched globals.
        os.environ["DASH_DATA_DIR"] = folder
        os.environ["DASH_DB_PATH"] = str(Path(folder) / "briefs.db")
        os.environ["DASH_FS_HOME"] = str(Path(folder) / "fs-home")

        import app
        from dashboard import config
        from dashboard.db import init_db
        from dashboard.telemetry_store import record_telemetry_snapshot

        init_db()
        c = app.app.test_client()

        for route in ["/api/brief"]:
            put = c.put(route, json={"date": "2026-10-01", "content": "# Native check\n\n- saved"})
            assert put.status_code == 200
            assert c.get(route + "?date=2026-10-01").json["content"].startswith("# Native")
            assert len(c.get(route + "/list").json) == 1
            assert c.delete(route + "?date=2026-10-01").status_code == 200
            assert c.get(route + "?date=2026-10-01").json["content"] == ""

        sched = {"week": "2026-10-01", "content": "# Week"}
        assert c.put("/api/schedule", json=sched).status_code == 200
        assert c.get("/api/schedule?week=2026-10-01").json["content"] == "# Week"
        assert c.delete("/api/schedule?week=2026-10-01").status_code == 200

        record_telemetry_snapshot(
            15.2, 42.1, {"used_bytes": 123, "total_bytes": 456}, None, None, 8.4
        )
        h = c.get("/api/stats/history?seconds=60").json
        assert 15.2 in h["cpu"] and 42.1 in h["temp"] and 8.4 in h["pwr"]
        assert c.get("/api/stats").status_code == 503
        bad_input = c.post("/api/shell/input", json={"id": "bad;command", "text": "no"})
        bad_key = c.post("/api/shell/key", json={"id": "bad;command", "key": "Enter"})
        assert bad_input.status_code == 400
        assert bad_key.status_code == 400

        # Filesystem explorer, sandboxed to a throwaway "home"
        fs = config.FS_HOME
        (fs / "sub").mkdir(parents=True)
        (fs / "note.txt").write_text("hello")
        assert c.get("/api/fs/list").json["path"] == str(fs)
        assert c.get("/api/fs/list?path=/no/such/dir").status_code == 404
        assert c.post("/api/fs/mkdir", json={"parent": str(fs), "name": "new"}).status_code == 200
        assert c.post("/api/fs/touch", json={"parent": str(fs), "name": "a.txt"}).status_code == 200
        renamed = c.post("/api/fs/rename", json={"path": str(fs / "a.txt"), "name": "b.txt"})
        assert renamed.status_code == 200 and renamed.json["name"] == "b.txt"

        up = c.post(
            "/api/fs/upload",
            data={"path": str(fs), "file": (io.BytesIO(b"up"), "up.bin")},
            content_type="multipart/form-data",
        )
        assert up.status_code == 200
        dup = c.post(
            "/api/fs/upload",
            data={"path": str(fs), "file": (io.BytesIO(b"x"), "up.bin")},
            content_type="multipart/form-data",
        )
        assert dup.status_code == 409
        assert c.get(f"/api/fs/download?path={fs / 'up.bin'}").data == b"up"
        note_stat = c.get(f"/api/fs/stat?path={fs / 'note.txt'}")
        assert note_stat.json["size"] == 5
        assert c.delete(f"/api/fs?path={fs / 'new'}").status_code == 200
        assert c.delete(f"/api/fs?path={fs}").status_code == 400  # home guard
        assert c.delete("/api/fs?path=/").status_code == 400  # root guard

        print(
            "Notes, schedule, telemetry history, stale-data, shell-ID and filesystem checks passed."
        )


if __name__ == "__main__":
    main()
