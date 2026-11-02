"""JSON-RPC 2.0 plumbing for the MCP endpoint (Streamable HTTP, stateless)."""

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class RpcError(Exception):
    """A protocol-level failure, answered with a JSON-RPC error object."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message

    def payload(self, request_id):
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": self.code, "message": self.message},
        }


class ToolError(Exception):
    """A tool failure the model should read, not a protocol error."""


def result(request_id, value):
    return {"jsonrpc": "2.0", "id": request_id, "result": value}


def negotiate_version(requested):
    """Echo the client's version when we speak it, else advertise ours."""
    return requested if requested in SUPPORTED_VERSIONS else PROTOCOL_VERSION


def tool_spec(
    name,
    title,
    description,
    props=None,
    required=None,
    read_only=False,
    destructive=False,
):
    """One entry for ``tools/list``: name, UI title, schema, safety hints."""
    schema = {"type": "object", "properties": props or {}, "additionalProperties": False}
    if required:
        schema["required"] = list(required)
    return {
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": schema,
        "annotations": {
            "readOnlyHint": read_only,
            "destructiveHint": destructive,
            "openWorldHint": False,
        },
    }
