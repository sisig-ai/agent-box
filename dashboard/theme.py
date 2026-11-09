"""Theme registry and persistence for the dashboard skin.

``static/themes.json`` is the list of installable looks; each entry carries an
id, a display name and the overlay stylesheet that renders it, loaded after
every base sheet so a theme can restyle anything. ``static/config.json``
records the chosen id under ``theme``. ``read_theme`` feeds the page route so
the first paint already carries the saved theme, and ``POST /api/theme``
rewrites the choice.
"""

import json
import re
from pathlib import Path

from . import config

THEMES_PATH = config.STATIC_DIR / "themes.json"
CONFIG_PATH = config.STATIC_DIR / "config.json"
DEFAULT_THEME = "classic-386"
_THEME_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


class ThemeError(Exception):
    """A request the theme registry refuses; ``status`` is the HTTP code."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def themes():
    """Installed themes, in display order: id, name, css href."""
    entries = json.loads(THEMES_PATH.read_text(encoding="utf-8"))
    out = []
    for entry in entries:
        theme_id = entry.get("id", "")
        css = entry.get("css", "")
        if not _THEME_ID.match(theme_id) or not css.startswith("/static/css/"):
            continue
        out.append({"id": theme_id, "name": entry.get("name", theme_id), "css": css})
    return out


def theme_ids():
    return {entry["id"] for entry in themes()}


def css_for(theme_id):
    """The overlay stylesheet for an installed theme, or None when unknown."""
    for entry in themes():
        if entry["id"] == theme_id:
            return entry["css"]
    return None


def read_theme():
    """Theme saved in ``config.json``, or the default when it is missing."""
    try:
        theme = json.loads(CONFIG_PATH.read_text(encoding="utf-8")).get("theme")
    except (OSError, ValueError):
        return DEFAULT_THEME
    return theme if theme in theme_ids() else DEFAULT_THEME


def set_theme(theme):
    """Persist the choice into ``config.json``, keeping every other key."""
    if not isinstance(theme, str) or not _THEME_ID.match(theme) or theme not in theme_ids():
        raise ThemeError("unknown theme")
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ThemeError("config.json is unreadable", 500) from exc
    data["theme"] = theme
    _write_config(data)
    return theme


def _write_config(data):
    """Replace ``config.json`` atomically so a torn write cannot lose it."""
    tmp = Path(f"{CONFIG_PATH}.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(CONFIG_PATH)
