"""Server-rendered page (htpy).

The dashboard ships no HTML files: the whole document is built from these
modules and returned as a string. Markup mirrors the long-running static page,
attribute for attribute, because the Alpine components bind to it by id.
"""

from .frame import document
from .panels_board import board
from .panels_docs import docs
from .panels_files import files
from .panels_logs import logs
from .panels_notes import sitrep
from .panels_progress import progress
from .panels_stack_shell import shell, stack
from .panels_tables import tables
from .panels_telemetry import telemetry


def render_page() -> str:
    return document(
        telemetry(),
        sitrep(),
        stack(),
        shell(),
        files(),
        board(),
        progress(),
        docs(),
        tables(),
        logs(),
    )
