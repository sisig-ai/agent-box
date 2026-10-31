"""Filesystem explorer API: listing, stat, CRUD, upload, download, delete guards."""

import io


def _upload(client, target, filename, content=b"x", overwrite=None):
    data = {"path": str(target), "file": (io.BytesIO(content), filename)}
    if overwrite is not None:
        data["overwrite"] = overwrite
    return client.post("/api/fs/upload", data=data, content_type="multipart/form-data")


# ---------------- list ----------------


def test_list_default_home_folders_first(client, home):
    (home / "sub").mkdir()
    (home / "note.txt").write_text("hi")
    r = client.get("/api/fs/list")
    assert r.status_code == 200
    body = r.get_json()
    assert body["path"] == str(home)
    assert body["home"] == str(home)
    assert [e["name"] for e in body["entries"]] == ["sub", "note.txt"]
    assert body["total"] == 2
    assert body["truncated"] is False


def test_list_missing_is_404(client):
    r = client.get("/api/fs/list", query_string={"path": "/no/such/dir-xyz"})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no such path"}


def test_list_not_a_directory_is_400(client, home):
    f = home / "file.txt"
    f.write_text("x")
    r = client.get("/api/fs/list", query_string={"path": str(f)})
    assert r.status_code == 400
    assert r.get_json() == {"error": "not a directory"}


def test_list_entry_metadata_shape(client, home):
    (home / "note.txt").write_text("hi")
    entry = client.get("/api/fs/list").get_json()["entries"][0]
    assert set(entry) >= {
        "name",
        "path",
        "type",
        "is_dir",
        "is_link",
        "size",
        "mtime",
        "mode",
        "hidden",
        "readable",
        "writable",
    }
    assert entry["type"] == "file"
    assert entry["size"] == 2
    assert entry["hidden"] is False


# ---------------- stat ----------------


def test_stat_mime_and_times(client, home):
    f = home / "note.txt"
    f.write_text("hello")
    body = client.get("/api/fs/stat", query_string={"path": str(f)}).get_json()
    assert body["size"] == 5
    assert body["mime"] == "text/plain"
    assert body["type"] == "file"
    assert body["mtime_iso"] and body["ctime_iso"]


def test_stat_symlink_link_target(client, home):
    target = home / "target.txt"
    target.write_text("t")
    link = home / "link.txt"
    link.symlink_to(target)
    body = client.get("/api/fs/stat", query_string={"path": str(link)}).get_json()
    assert body["is_link"] is True
    assert body["type"] == "link"
    assert body["link_target"] == str(target)


def test_stat_missing_is_404(client, home):
    r = client.get("/api/fs/stat", query_string={"path": str(home / "nope")})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no such path"}


# ---------------- mkdir / touch ----------------


def test_mkdir_happy_and_conflict(client, home):
    r = client.post("/api/fs/mkdir", json={"parent": str(home), "name": "new"})
    assert r.status_code == 200
    assert r.get_json()["is_dir"] is True
    again = client.post("/api/fs/mkdir", json={"parent": str(home), "name": "new"})
    assert again.status_code == 409
    assert again.get_json() == {"error": "already exists"}


def test_mkdir_path_form(client, home):
    r = client.post("/api/fs/mkdir", json={"path": str(home / "direct")})
    assert r.status_code == 200
    assert (home / "direct").is_dir()


def test_touch_happy_and_conflict(client, home):
    r = client.post("/api/fs/touch", json={"parent": str(home), "name": "a.txt"})
    assert r.status_code == 200
    assert r.get_json()["type"] == "file"
    again = client.post("/api/fs/touch", json={"parent": str(home), "name": "a.txt"})
    assert again.status_code == 409


def test_touch_missing_parent_is_404(client, home):
    r = client.post("/api/fs/touch", json={"parent": str(home / "missing"), "name": "y"})
    assert r.status_code == 404
    assert r.get_json() == {"error": "parent directory does not exist"}


def test_create_requires_name_is_400(client):
    r = client.post("/api/fs/mkdir", json={})
    assert r.status_code == 400
    assert r.get_json() == {"error": "a name is required"}


# ---------------- rename ----------------


def test_rename_happy(client, home):
    (home / "a.txt").write_text("x")
    r = client.post("/api/fs/rename", json={"path": str(home / "a.txt"), "name": "b.txt"})
    assert r.status_code == 200
    assert r.get_json()["name"] == "b.txt"
    assert (home / "b.txt").exists()
    assert not (home / "a.txt").exists()


def test_rename_same_name_is_noop(client, home):
    f = home / "a.txt"
    f.write_text("x")
    r = client.post("/api/fs/rename", json={"path": str(f), "name": "a.txt"})
    assert r.status_code == 200
    assert r.get_json()["name"] == "a.txt"


def test_rename_collision_is_409(client, home):
    (home / "a.txt").write_text("x")
    (home / "b.txt").write_text("y")
    r = client.post("/api/fs/rename", json={"path": str(home / "a.txt"), "name": "b.txt"})
    assert r.status_code == 409
    assert r.get_json() == {"error": "already exists"}


def test_rename_missing_is_404(client, home):
    r = client.post("/api/fs/rename", json={"path": str(home / "nope"), "name": "x"})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no such path"}


def test_rename_bad_name_is_400(client, home):
    (home / "a.txt").write_text("x")
    r = client.post("/api/fs/rename", json={"path": str(home / "a.txt"), "name": ".."})
    assert r.status_code == 400
    assert r.get_json() == {"error": "a valid new name is required"}


# ---------------- upload ----------------


def test_upload_happy_and_collision(client, home):
    r = _upload(client, home, "up.bin", b"up")
    assert r.status_code == 200
    assert r.get_json()["count"] == 1
    assert (home / "up.bin").read_bytes() == b"up"
    again = _upload(client, home, "up.bin", b"x")
    assert again.status_code == 409
    assert again.get_json() == {"error": "already exists: up.bin"}


def test_upload_overwrite_bypasses_collision(client, home):
    _upload(client, home, "up.bin", b"old")
    r = _upload(client, home, "up.bin", b"new", overwrite="1")
    assert r.status_code == 200
    assert (home / "up.bin").read_bytes() == b"new"


def test_upload_invalid_filename_is_400(client, home):
    r = _upload(client, home, "..")
    assert r.status_code == 400
    assert r.get_json() == {"error": "invalid file name"}


def test_upload_no_file_is_400(client, home):
    r = client.post("/api/fs/upload", data={"path": str(home)}, content_type="multipart/form-data")
    assert r.status_code == 400
    assert r.get_json() == {"error": "no files in the request"}


def test_upload_dir_name_collision_is_409(client, home):
    (home / "blocked").mkdir()
    r = _upload(client, home, "blocked", b"x", overwrite="1")
    assert r.status_code == 409
    assert r.get_json() == {"error": "a directory is named blocked"}


def test_upload_target_not_a_directory_is_400(client, home):
    f = home / "f.txt"
    f.write_text("x")
    r = _upload(client, f, "y.txt")
    assert r.status_code == 400
    assert r.get_json() == {"error": "upload target is not a directory"}


def test_upload_over_max_content_length_is_413(client, home):
    client.application.config["MAX_CONTENT_LENGTH"] = 8
    r = _upload(client, home, "big.bin", b"x" * 64)
    assert r.status_code == 413
    assert "upload too large" in r.get_json()["error"]


# ---------------- download ----------------


def test_download_happy(client, home):
    (home / "up.bin").write_bytes(b"up")
    r = client.get("/api/fs/download", query_string={"path": str(home / "up.bin")})
    assert r.status_code == 200
    assert r.data == b"up"


def test_download_directory_is_400(client, home):
    (home / "d").mkdir()
    r = client.get("/api/fs/download", query_string={"path": str(home / "d")})
    assert r.status_code == 400
    assert r.get_json() == {"error": "cannot download a directory"}


def test_download_missing_is_404(client, home):
    r = client.get("/api/fs/download", query_string={"path": str(home / "nope")})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no such file"}


# ---------------- delete ----------------


def test_delete_file(client, home):
    f = home / "a.txt"
    f.write_text("x")
    r = client.delete("/api/fs", query_string={"path": str(f)})
    assert r.status_code == 200
    assert r.get_json() == {"deleted": str(f)}
    assert not f.exists()


def test_delete_dir_recursive(client, home):
    d = home / "d"
    (d / "inner").mkdir(parents=True)
    (d / "inner" / "f.txt").write_text("x")
    assert client.delete("/api/fs", query_string={"path": str(d)}).status_code == 200
    assert not d.exists()


def test_delete_symlink_removes_link_only(client, home):
    target = home / "target.txt"
    target.write_text("keep")
    link = home / "link.txt"
    link.symlink_to(target)
    r = client.delete("/api/fs", query_string={"path": str(link)})
    assert r.status_code == 200
    assert not link.exists()
    assert target.exists()
    assert target.read_text() == "keep"


def test_delete_missing_is_404(client, home):
    r = client.delete("/api/fs", query_string={"path": str(home / "nope")})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no such path"}


def test_delete_home_guard(client, home):
    r = client.delete("/api/fs", query_string={"path": str(home)})
    assert r.status_code == 400
    assert r.get_json() == {"error": "refusing to delete the home directory"}


def test_delete_root_guard(client, home):
    r = client.delete("/api/fs", query_string={"path": "/"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "refusing to delete this path"}
