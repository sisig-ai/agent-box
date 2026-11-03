"""Filesystem path helpers: normalisation, entry metadata, places, errors.

Split out of ``fs.py`` so both files stay under the 300-SLOC budget. Pure
Python, no shell interpolation — a crafted path can never become a command.
"""

import os
import stat
import tempfile
from pathlib import Path

from .config import FS_HOME


def fs_norm(raw):
    """Requested path -> absolute, lexically normalised Path. Empty -> ~."""
    if raw is None or not str(raw).strip():
        return Path(FS_HOME)
    s = str(raw).strip()
    s = s.replace("\x00", "")  # embedded NULs raise ValueError, not OSError
    if s == "~":
        s = str(FS_HOME)
    elif s.startswith("~/"):
        s = str(FS_HOME) + s[1:]
    if not os.path.isabs(s):
        s = os.path.join(str(FS_HOME), s)
    return Path(os.path.normpath(s))


def fs_safe_name(raw):
    """One path component (no separators/traversal). None when unsafe/empty."""
    name = os.path.basename(str(raw or "").replace("\\", "/")).strip()
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        return None
    return name


def fs_entry(path):
    """Stat one path (without following a final symlink). None if unreadable."""
    try:
        st = path.lstat()
    except OSError:
        return None
    is_link = stat.S_ISLNK(st.st_mode)
    try:
        is_dir = path.is_dir() if is_link else stat.S_ISDIR(st.st_mode)
        is_reg = path.is_file() if is_link else stat.S_ISREG(st.st_mode)
    except OSError:
        is_dir = is_reg = False
    kind = "link" if is_link else ("dir" if is_dir else ("file" if is_reg else "other"))
    return {
        "name": path.name or str(path),
        "path": str(path),
        "type": kind,
        "is_dir": is_dir,
        "is_link": is_link,
        "size": st.st_size,
        "mtime": st.st_mtime,
        "mode": stat.filemode(st.st_mode),
        "hidden": path.name.startswith("."),
        "readable": os.access(path, os.R_OK),
        "writable": os.access(path, os.W_OK),
    }


def fs_places():
    """Sidebar shortcut locations, only the ones that exist."""
    candidates = [
        ("Home", FS_HOME),
        ("Desktop", FS_HOME / "Desktop"),
        ("Documents", FS_HOME / "Documents"),
        ("Downloads", FS_HOME / "Downloads"),
        ("Root", Path("/")),
        ("Volumes", Path("/Volumes")),
        ("Temp", Path(tempfile.gettempdir())),
    ]
    seen, places = set(), []
    for name, path in candidates:
        try:
            exists = path.is_dir()
        except OSError:
            exists = False
        key = str(path)
        if exists and key not in seen:
            seen.add(key)
            places.append({"name": name, "path": key})
    return places


class FsError(Exception):
    """A filesystem refusal the router turns into {"error": ...} + status."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def fs_error(msg, code):
    raise FsError(msg, code)


def fs_body_path(body):
    """Resolve a create target from {path} or {parent, name}. None on bad input."""
    if body.get("path"):
        return fs_norm(body["path"])
    parent = body.get("parent")
    name = fs_safe_name(body.get("name"))
    if parent is not None and name:
        return fs_norm(parent) / name
    return None
