"""Tool registry: merges the tool modules and dispatches ``tools/call``."""

from .protocol import INVALID_PARAMS, RpcError
from .tools_board import TOOLS as BOARD_TOOLS
from .tools_comments import TOOLS as COMMENT_TOOLS
from .tools_docs import TOOLS as DOC_TOOLS
from .tools_lanes import TOOLS as LANE_TOOLS
from .tools_notes import TOOLS as NOTE_TOOLS
from .tools_progress import TOOLS as PROGRESS_TOOLS

_GROUPS = (BOARD_TOOLS, LANE_TOOLS, COMMENT_TOOLS, NOTE_TOOLS, PROGRESS_TOOLS, DOC_TOOLS)

_TOOLS = {}
for _group in _GROUPS:
    _TOOLS.update(_group)

NAMES = tuple(_TOOLS)


def definitions():
    """The ``tools/list`` payload, in registration order."""
    return [entry["spec"] for entry in _TOOLS.values()]


def call(name, arguments):
    entry = _TOOLS.get(name)
    if entry is None:
        raise RpcError(INVALID_PARAMS, f"unknown tool: {name}")
    return entry["handler"](arguments)
