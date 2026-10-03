"""HTTP blueprint for the filesystem explorer endpoints."""

from flask import Blueprint, request

from . import fs

bp = Blueprint("fs", __name__)


@bp.get("/api/fs/list")
def fs_list():
    """GET /api/fs/list?path=… — directory contents (defaults to ~)."""
    return fs.list_directory(request.args.get("path"))


@bp.get("/api/fs/stat")
def fs_stat():
    """GET /api/fs/stat?path=… — one entry plus owner/permissions/mime detail."""
    return fs.stat_path(request.args.get("path"))


@bp.get("/api/fs/download")
def fs_download():
    """GET /api/fs/download?path=… — stream one file as an attachment."""
    return fs.download_file(request.args.get("path"))


@bp.post("/api/fs/upload")
def fs_upload():
    """POST /api/fs/upload — multipart {path: target dir, file: […], overwrite?}."""
    return fs.upload_files(
        request.form.get("path"),
        request.form.get("overwrite", ""),
        request.files.getlist("file"),
    )


@bp.post("/api/fs/mkdir")
def fs_mkdir():
    """POST /api/fs/mkdir — JSON {path} or {parent, name}."""
    return fs.make_dir(request.get_json(silent=True) or {})


@bp.post("/api/fs/touch")
def fs_touch():
    """POST /api/fs/touch — JSON {path} or {parent, name}: create an empty file."""
    return fs.touch_file(request.get_json(silent=True) or {})


@bp.post("/api/fs/rename")
def fs_rename():
    """POST /api/fs/rename — JSON {path, name}: rename within the same folder."""
    return fs.rename_entry(request.get_json(silent=True) or {})


@bp.delete("/api/fs")
def fs_delete():
    """DELETE /api/fs?path=… — remove a file, symlink, or folder (recursive)."""
    return fs.delete_entry(request.args.get("path"))
