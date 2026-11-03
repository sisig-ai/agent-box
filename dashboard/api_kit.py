"""Small helpers shared by the FastAPI routers.

Errors keep the contract the UI and the MCP tools expect: a JSON body of
``{"error": "..."}`` with the status the domain exception carries.
"""

from fastapi import Request
from fastapi.responses import JSONResponse


def error(message: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


async def json_body(request: Request, allowed: tuple[str, ...] | None = None) -> dict | None:
    """The JSON object in the request body, or None when it is missing/not an object."""
    try:
        body = await request.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    if allowed is not None:
        unknown = sorted(set(body) - set(allowed))
        if unknown:
            return {"__unknown__": unknown}
    return body
