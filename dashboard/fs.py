"""Host filesystem operations: list, stat, download, upload, create, delete.

Classic SFTP-style browser over the host filesystem. Every operation takes
plain Python values and returns a Flask response; the blueprint in ``fs_api``
only pulls those values off the request. Path helpers live in ``fs_paths``.
"""

import contextlib
import mimetypes
import os
import shutil
from datetime import datetime

from flask import jsonify, send_file

from .config import FS_HOME
from .fs_paths import fs_body_path, fs_entry, fs_error, fs_norm, fs_places, fs_safe_name

try:
    import grp as _grp
    import pwd as _pwd
except ImportError:  # non-POSIX — owner/group names simply stay blank
    _pwd = _grp = None


def list_directory(path_raw):
    """Directory contents (defaults to ~)."""
    p = fs_norm(path_raw)
    if not p.exists():
        return fs_error("no such path", 404)
    if not p.is_dir():
        return fs_error("not a directory", 400)
    try:
        with os.scandir(p) as it:
            entries = [e for e in (fs_entry(p / n.name) for n in it) if e is not None]
    except NotADirectoryError:
        return fs_error("not a directory", 400)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"sorry, could not read that directory ({exc.strerror})", 500)
    # Folders first, then case-insensitive by name. Hidden entries are returned
    # tagged so the UI can toggle them without re-fetching.
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    parent = None if p.parent == p else str(p.parent)
    return jsonify(
        {
            "path": str(p),
            "name": p.name or "/",
            "parent": parent,
            "home": str(FS_HOME),
            "places": fs_places(),
            "entries": entries,
            "total": len(entries),
        }
    )


def stat_path(path_raw):
    """One entry plus owner/permissions/mime detail."""
    p = fs_norm(path_raw)
    info = fs_entry(p)
    if info is None:
        return fs_error("no such path", 404)
    if info["is_link"]:
        try:
            info["link_target"] = os.readlink(p)
        except OSError:
            info["link_target"] = None
    info["mime"] = mimetypes.guess_type(p.name)[0] or (
        "inode/directory" if info["is_dir"] else "application/octet-stream"
    )
    info["mtime_iso"] = (
        datetime.fromtimestamp(info["mtime"]).astimezone().isoformat(timespec="seconds")
    )
    if info["type"] != "link":
        try:
            st = p.stat()
            info["ctime"] = st.st_ctime
            info["ctime_iso"] = (
                datetime.fromtimestamp(st.st_ctime).astimezone().isoformat(timespec="seconds")
            )
            if hasattr(st, "st_birthtime"):
                info["btime"] = st.st_birthtime
                info["btime_iso"] = (
                    datetime.fromtimestamp(st.st_birthtime)
                    .astimezone()
                    .isoformat(timespec="seconds")
                )
            info["uid"] = st.st_uid
            info["gid"] = st.st_gid
            if _pwd is not None:
                with contextlib.suppress(KeyError):
                    info["owner"] = _pwd.getpwuid(st.st_uid).pw_name
            if _grp is not None:
                with contextlib.suppress(KeyError):
                    info["group"] = _grp.getgrgid(st.st_gid).gr_name
        except OSError:
            pass
    return jsonify(info)


def download_file(path_raw):
    """Stream one file as an attachment."""
    p = fs_norm(path_raw)
    if not p.exists():
        return fs_error("no such file", 404)
    if p.is_dir():
        return fs_error("cannot download a directory", 400)
    if not os.access(p, os.R_OK):
        return fs_error("permission denied", 403)
    return send_file(p, as_attachment=True, download_name=p.name, conditional=True)


def upload_files(target_raw, overwrite_raw, files):
    """Multipart upload into ``target_raw``; return {"saved", "count"}."""
    target = fs_norm(target_raw)
    if not target.is_dir():
        return fs_error("upload target is not a directory", 400)
    overwrite = str(overwrite_raw).lower() in ("1", "true", "yes")
    incoming = []
    for f in files:
        name = fs_safe_name(f.filename)
        if not name:
            return fs_error("invalid file name", 400)
        incoming.append((name, f))
    if not incoming:
        return fs_error("no files in the request", 400)
    if not overwrite:
        for name, _ in incoming:
            if (target / name).exists():
                return fs_error(f"already exists: {name}", 409)
    for name, _ in incoming:
        if (target / name).is_dir():
            return fs_error(f"a directory is named {name}", 409)
    saved = []
    try:
        for name, f in incoming:
            dest = target / name
            f.save(dest)
            saved.append(str(dest))
    except OSError as exc:
        return fs_error(f"upload failed: {exc.strerror or exc}", 500)
    return jsonify({"saved": saved, "count": len(saved)})


def make_dir(body):
    """Create one folder from {path} or {parent, name}."""
    p = fs_body_path(body)
    if p is None:
        return fs_error("a name is required", 400)
    if p.exists():
        return fs_error("already exists", 409)
    try:
        p.mkdir(parents=True, exist_ok=False)
    except FileNotFoundError:
        return fs_error("parent directory does not exist", 404)
    except FileExistsError:
        return fs_error("already exists", 409)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not create folder: {exc.strerror or exc}", 500)
    return jsonify(fs_entry(p))


def touch_file(body):
    """Create an empty file from {path} or {parent, name}."""
    p = fs_body_path(body)
    if p is None:
        return fs_error("a name is required", 400)
    if p.exists():
        return fs_error("already exists", 409)
    if not p.parent.is_dir():
        return fs_error("parent directory does not exist", 404)
    try:
        with open(p, "x"):
            pass
    except FileExistsError:
        return fs_error("already exists", 409)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not create file: {exc.strerror or exc}", 500)
    return jsonify(fs_entry(p))


def rename_entry(body):
    """Rename within the same folder from {path, name}."""
    src = fs_norm(body.get("path"))
    if not src.exists():
        return fs_error("no such path", 404)
    name = fs_safe_name(body.get("name"))
    if name is None:
        return fs_error("a valid new name is required", 400)
    dest = src.parent / name
    if dest == src:
        return jsonify(fs_entry(src))
    if dest.exists():
        return fs_error("already exists", 409)
    try:
        os.rename(src, dest)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not rename: {exc.strerror or exc}", 500)
    return jsonify(fs_entry(dest))


def delete_entry(path_raw):
    """Remove a file, symlink, or folder (recursive); refuses home/root/ancestors."""
    p = fs_norm(path_raw)
    if p == FS_HOME:
        return fs_error("refusing to delete the home directory", 400)
    if not p.exists() and not p.is_symlink():
        return fs_error("no such path", 404)
    try:
        if p.is_symlink():
            p.unlink()  # remove the link, never what it points at
        else:
            real = p.resolve()
            if real.parent == real or real == FS_HOME or real in FS_HOME.parents:
                return fs_error("refusing to delete this path", 400)
            if p.is_dir():
                shutil.rmtree(p)
            else:
                p.unlink()
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not delete: {exc.strerror or exc}", 500)
    return jsonify({"deleted": str(p)})
