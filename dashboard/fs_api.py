"""Filesystem explorer API (FastAPI).

Blocking work (scandir, stat, read/write, shutil) runs in the threadpool; the
download path streams through FileResponse instead of reading into memory.
"""

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from . import fs, fs_text

router = APIRouter()


@router.get("/api/fs/list")
async def fs_list(path: str | None = None):
    """Directory contents (defaults to ~)."""
    return await run_in_threadpool(fs.list_directory, path)


@router.get("/api/fs/stat")
async def fs_stat(path: str | None = None):
    """One entry plus owner/permissions/mime detail."""
    return await run_in_threadpool(fs.stat_path, path)


@router.get("/api/fs/download")
async def fs_download(path: str | None = None):
    """Stream one file as an attachment."""
    target = await run_in_threadpool(fs.download_file, path)
    return FileResponse(target, filename=target.name)


@router.get("/api/fs/read")
async def fs_read(path: str | None = None):
    """One UTF-8 text file for the inline editor."""
    return await run_in_threadpool(fs_text.read_text_file, path)


@router.put("/api/fs/write")
async def fs_write(request: Request):
    """JSON {path, content}: overwrite one text file."""
    try:
        body = await request.json()
    except ValueError:
        body = {}
    return await run_in_threadpool(fs_text.write_text_file, body if isinstance(body, dict) else {})


@router.post("/api/fs/upload")
async def fs_upload(
    path: str = Form(...),
    overwrite: str = Form(""),
    file: list[UploadFile] | None = File(None),  # noqa: B008
):
    """Multipart {path: target dir, file: [...], overwrite?}."""
    return await run_in_threadpool(fs.upload_files, path, overwrite, file or [])


@router.post("/api/fs/mkdir")
async def fs_mkdir(request: Request):
    """JSON {path} or {parent, name}."""
    return await run_in_threadpool(fs.make_dir, await _json(request))


@router.post("/api/fs/touch")
async def fs_touch(request: Request):
    """JSON {path} or {parent, name}: create an empty file."""
    return await run_in_threadpool(fs.touch_file, await _json(request))


@router.post("/api/fs/rename")
async def fs_rename(request: Request):
    """JSON {path, name}: rename within the same folder."""
    return await run_in_threadpool(fs.rename_entry, await _json(request))


@router.delete("/api/fs")
async def fs_delete(path: str | None = None):
    """Remove a file, symlink, or folder (recursive)."""
    return await run_in_threadpool(fs.delete_entry, path)


async def _json(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}
