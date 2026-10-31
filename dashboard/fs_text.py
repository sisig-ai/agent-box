"""Read and write text files for the Files tab inline editor.

Binary and oversized files are refused here so the browser never edits
something a text editor cannot handle; the caller falls back to download.
Write is in place, so file mode and ownership are kept.
"""

import os

from flask import jsonify

from .fs_paths import fs_error, fs_norm

# One editable file ceiling; larger files fall back to download.
FS_EDIT_MAX = 2 * 1024 * 1024


def read_text_file(path_raw):
    """Return one UTF-8 text file for the editor, or a refusal status."""
    p = fs_norm(path_raw)
    if not p.exists():
        return fs_error("no such file", 404)
    if p.is_dir():
        return fs_error("cannot edit a directory", 400)
    if not p.is_file():
        return fs_error("not a regular file", 400)
    if not os.access(p, os.R_OK):
        return fs_error("permission denied", 403)
    try:
        if p.stat().st_size > FS_EDIT_MAX:
            return fs_error("file too large to edit", 413)
        data = p.read_bytes()
        mtime = p.stat().st_mtime
    except OSError as exc:
        return fs_error(f"could not read file ({exc.strerror or exc})", 500)
    if b"\x00" in data:
        return fs_error("binary file", 415)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return fs_error("binary file", 415)
    return jsonify(
        {"path": str(p), "name": p.name, "text": text, "size": len(data), "mtime": mtime}
    )


def write_text_file(body):
    """Overwrite one existing text file, in place, from the editor."""
    content = body.get("content")
    if not isinstance(content, str):
        return fs_error("content is required", 400)
    p = fs_norm(body.get("path"))
    if not p.exists():
        return fs_error("no such file", 404)
    if p.is_dir() or not p.is_file():
        return fs_error("not a regular file", 400)
    if not os.access(p, os.W_OK):
        return fs_error("permission denied", 403)
    try:
        with open(p, "w", encoding="utf-8", newline="") as fh:
            fh.write(content)
        st = p.stat()
    except OSError as exc:
        return fs_error(f"could not save file ({exc.strerror or exc})", 500)
    return jsonify({"path": str(p), "size": st.st_size, "mtime": st.st_mtime})
