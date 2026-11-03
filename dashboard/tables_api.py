"""Tables API (FastAPI): Airtable-shaped CRUD over tables, columns and records.

All store calls run in the threadpool. Errors are {"error": ...} via the
app-level TableError handler.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import table_records, table_views, tables
from .table_types import TableError

router = APIRouter()


async def _body(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise TableError("request body must be a JSON object")
    return body


def _flag(params: dict, name: str) -> bool:
    raw = params.get(name)
    return raw is not None and raw.strip().lower() in {"1", "true", "yes", "on"}


@router.get("/api/tables")
async def list_tables(
    request: Request,
    order_by: str = "name",
    order: str = "asc",
):
    include = _flag(dict(request.query_params), "include_archived")
    return await run_in_threadpool(tables.list_tables, include, order_by, order)


@router.post("/api/tables")
async def create_table(request: Request):
    body = await _body(request)
    table = await run_in_threadpool(tables.create_table, body.get("name"), body.get("description"))
    return JSONResponse(status_code=201, content=table)


@router.get("/api/tables/{table_ref}")
async def get_table(
    table_ref: str,
    limit: str = "100",
    offset: str = "0",
    order_by: str | None = None,
    order: str = "asc",
    include_archived: str = "",
    view: str | None = None,
):
    """One table for direct clients: schema, columns and the first records page.

    Same query parameters as /records, so a script can page through a table with
    one URL: ?limit=100&offset=200&order_by=Name&order=desc.
    """
    try:
        size, start = int(limit), int(offset)
    except ValueError:
        raise TableError("limit and offset must be numbers") from None
    schema = await run_in_threadpool(tables.get_table, table_ref)
    page = await run_in_threadpool(
        table_records.list_records,
        table_ref,
        include_archived=include_archived.strip().lower() in {"1", "true", "yes", "on"},
        limit=max(1, min(size, 500)),
        offset=max(0, start),
        order_by=order_by,
        order=order,
        view=view,
    )
    return {**schema, **page}


@router.post("/api/tables/{table_ref}")
async def append_record(table_ref: str, request: Request):
    """Append one record: POST values straight at the table URL."""
    body = await _body(request)
    values = body.get("values", body)
    record = await run_in_threadpool(table_records.create_record, table_ref, values)
    return JSONResponse(status_code=201, content=record)


@router.patch("/api/tables/{table_ref}")
async def update_table(table_ref: str, request: Request):
    body = await _body(request)
    return await run_in_threadpool(
        tables.update_table,
        table_ref,
        name=body.get("name"),
        description=body.get("description"),
        archived=body.get("archived"),
    )


@router.delete("/api/tables/{table_ref}")
async def delete_table(table_ref: str):
    return await run_in_threadpool(tables.delete_table, table_ref)


@router.get("/api/tables/{table_ref}/columns")
async def list_columns(table_ref: str, order_by: str = "position", order: str = "asc"):
    return await run_in_threadpool(tables.list_columns, table_ref, order_by, order)


@router.post("/api/tables/{table_ref}/columns")
async def create_column(table_ref: str, request: Request):
    body = await _body(request)
    column = await run_in_threadpool(
        tables.create_column,
        table_ref,
        body.get("name"),
        body.get("type"),
        body.get("subtype"),
        body.get("config"),
        body.get("position"),
    )
    return JSONResponse(status_code=201, content=column)


@router.patch("/api/tables/{table_ref}/columns/{column_ref}")
async def update_column(table_ref: str, column_ref: str, request: Request):
    body = await _body(request)
    return await run_in_threadpool(
        tables.update_column,
        table_ref,
        column_ref,
        name=body.get("name"),
        column_type=body.get("type"),
        subtype=body.get("subtype"),
        config=body.get("config"),
        position=body.get("position"),
        clear_values=bool(body.get("clear_values")),
    )


@router.delete("/api/tables/{table_ref}/columns/{column_ref}")
async def delete_column(table_ref: str, column_ref: str):
    return await run_in_threadpool(tables.delete_column, table_ref, column_ref)


@router.get("/api/tables/{table_ref}/records")
async def list_records(
    table_ref: str,
    limit: str = "100",
    offset: str = "0",
    order_by: str | None = None,
    order: str = "asc",
    include_archived: str = "",
    view: str | None = None,
):
    try:
        size, start = int(limit), int(offset)
    except ValueError:
        raise TableError("limit and offset must be numbers") from None
    return await run_in_threadpool(
        table_records.list_records,
        table_ref,
        include_archived=include_archived.strip().lower() in {"1", "true", "yes", "on"},
        limit=max(1, min(size, 500)),
        offset=max(0, start),
        order_by=order_by,
        order=order,
        view=view,
    )


@router.post("/api/tables/{table_ref}/records")
async def create_record(table_ref: str, request: Request):
    body = await _body(request)
    values = body.get("values", body)
    record = await run_in_threadpool(table_records.create_record, table_ref, values)
    return JSONResponse(status_code=201, content=record)


@router.get("/api/tables/{table_ref}/records/{record_id}")
async def get_record(table_ref: str, record_id: str):
    return await run_in_threadpool(table_records.get_record, table_ref, record_id)


@router.patch("/api/tables/{table_ref}/records/{record_id}")
async def update_record(table_ref: str, record_id: str, request: Request):
    body = await _body(request)
    values = body.pop("values", None)
    archived = body.pop("archived", None)
    if body:
        values = {**(values or {}), **body}
    return await run_in_threadpool(
        table_records.update_record, table_ref, record_id, values=values, archived=archived
    )


@router.delete("/api/tables/{table_ref}/records/{record_id}")
async def delete_record(table_ref: str, record_id: str):
    return await run_in_threadpool(table_records.delete_record, table_ref, record_id)


# ---------------- views ----------------


@router.get("/api/tables/{table_ref}/views")
async def list_views(table_ref: str):
    return await run_in_threadpool(table_views.list_views, table_ref)


@router.post("/api/tables/{table_ref}/views")
async def create_view(table_ref: str, request: Request):
    body = await _body(request)
    view = await run_in_threadpool(
        table_views.create_view, table_ref, body.get("name"), body.get("config")
    )
    return JSONResponse(status_code=201, content=view)


@router.patch("/api/tables/{table_ref}/views/{view_ref}")
async def update_view(table_ref: str, view_ref: str, request: Request):
    body = await _body(request)
    return await run_in_threadpool(
        table_views.update_view,
        table_ref,
        view_ref,
        name=body.get("name"),
        config=body.get("config") if "config" in body else None,
        position=body.get("position"),
    )


@router.delete("/api/tables/{table_ref}/views/{view_ref}")
async def delete_view(table_ref: str, view_ref: str):
    return await run_in_threadpool(table_views.delete_view, table_ref, view_ref)
