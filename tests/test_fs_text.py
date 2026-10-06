"""Filesystem inline-editor API: read one text file, write one in place."""


def test_read_happy_round_trips(client, home):
    f = home / "note.md"
    f.write_text("# hi\n", encoding="utf-8")
    r = client.get("/api/fs/read", query_string={"path": str(f)})
    assert r.status_code == 200
    body = r.get_json()
    assert body["path"] == str(f)
    assert body["name"] == "note.md"
    assert body["text"] == "# hi\n"
    assert body["size"] == len(b"# hi\n")


def test_read_binary_nul_is_415(client, home):
    f = home / "blob.bin"
    f.write_bytes(b"abc\x00def")
    r = client.get("/api/fs/read", query_string={"path": str(f)})
    assert r.status_code == 415
    assert r.get_json() == {"error": "binary file"}


def test_read_non_utf8_is_415(client, home):
    f = home / "latin1.txt"
    f.write_bytes(b"\xff\xfe x")
    r = client.get("/api/fs/read", query_string={"path": str(f)})
    assert r.status_code == 415
    assert r.get_json() == {"error": "binary file"}


def test_read_directory_is_400(client, home):
    d = home / "dir"
    d.mkdir()
    r = client.get("/api/fs/read", query_string={"path": str(d)})
    assert r.status_code == 400
    assert r.get_json() == {"error": "cannot edit a directory"}


def test_read_missing_is_404(client, home):
    r = client.get("/api/fs/read", query_string={"path": str(home / "nope.txt")})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no such file"}


def test_read_oversized_is_413(client, home, monkeypatch):
    from dashboard import fs_text

    monkeypatch.setattr(fs_text, "FS_EDIT_MAX", 4)
    f = home / "big.txt"
    f.write_text("too long")
    r = client.get("/api/fs/read", query_string={"path": str(f)})
    assert r.status_code == 413
    assert r.get_json() == {"error": "file too large to edit"}


def test_write_happy_replaces_content(client, home):
    f = home / "note.md"
    f.write_text("old", encoding="utf-8")
    r = client.put("/api/fs/write", json={"path": str(f), "content": "new\n"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["path"] == str(f)
    assert body["size"] == len(b"new\n")
    assert f.read_bytes() == b"new\n"


def test_write_preserves_mode(client, home):
    f = home / "script.sh"
    f.write_text("#!/bin/sh\n")
    f.chmod(0o755)
    r = client.put("/api/fs/write", json={"path": str(f), "content": "#!/bin/sh\necho hi\n"})
    assert r.status_code == 200
    assert (f.stat().st_mode & 0o777) == 0o755


def test_write_missing_is_404(client, home):
    r = client.put("/api/fs/write", json={"path": str(home / "nope.txt"), "content": "x"})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no such file"}


def test_write_directory_is_400(client, home):
    d = home / "dir"
    d.mkdir()
    r = client.put("/api/fs/write", json={"path": str(d), "content": "x"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "not a regular file"}


def test_write_without_content_is_400(client, home):
    f = home / "note.txt"
    f.write_text("x")
    r = client.put("/api/fs/write", json={"path": str(f)})
    assert r.status_code == 400
    assert r.get_json() == {"error": "content is required"}
