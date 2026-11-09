"""Page head: metadata, fonts, stylesheets and the one classic script."""

from htpy import head, link, meta, script, title

from .. import theme

STYLES = [
    ("base.css", None),
    ("header.css", "clockpill2"),
    ("telemetry.css", "procs3"),
    ("power-alerts.css", "compact1"),
    ("scanner.css", None),
    ("fleet.css", None),
    ("brief.css", None),
    ("schedule.css", None),
    ("shell.css", "ascii13"),
    ("files.css", None),
    ("editor.css", None),
    ("kanban.css", "filters1"),
    ("kanban-search.css", "kanban20"),
    ("kanban-detail.css", "subtasks1"),
    ("modal.css", "clockpill1"),
    ("ascii.css", "ascii12"),
    ("ascii-views.css", "ascii12"),
    ("ascii-content.css", "ascii13"),
    ("ascii-board.css", "subtasks1"),
    ("ascii-progress.css", "progress1"),
    ("docs.css", "author1"),
    ("tables.css", "tables1"),
    ("logs.css", "alpine1"),
    ("ascii-attention.css", "attention9"),
    ("theme-picker.css", "theme1"),
    ("pwa.css", "pwa1"),
]


def _stylesheet(name: str, version: str | None) -> object:
    href = f"/static/css/{name}" + (f"?v={version}" if version else "")
    return link(rel="stylesheet", href=href)


def document_head(active_theme: str | None = None) -> object:
    """The head, ending with the active theme's overlay so it loads last.

    ``tui.css`` is not in ``STYLES`` any more: it is the classic-386 theme's
    overlay, and the theme registry owns it.
    """
    theme_id = active_theme or theme.read_theme()
    theme_css = theme.css_for(theme_id) or theme.css_for(theme.DEFAULT_THEME)
    return head[
        meta(charset="UTF-8"),
        meta(name="viewport", content="width=device-width, initial-scale=1, viewport-fit=cover"),
        meta(name="color-scheme", content="dark"),
        meta(name="theme-color", content="#080b09"),
        meta(name="format-detection", content="telephone=no"),
        link(rel="manifest", href="/manifest.webmanifest"),
        meta(name="mobile-web-app-capable", content="yes"),
        meta(name="apple-mobile-web-app-capable", content="yes"),
        meta(name="apple-mobile-web-app-status-bar-style", content="black-translucent"),
        meta(name="apple-mobile-web-app-title", content="macmini"),
        link(rel="icon", href="/icons/favicon.svg", type="image/svg+xml"),
        link(rel="icon", href="/icons/favicon-32.png", sizes="32x32", type="image/png"),
        link(rel="apple-touch-icon", href="/icons/apple-touch-icon.png?v=ascii2"),
        script(src="/static/vendor/marked.min.js"),
        link(
            rel="preload",
            href="/static/fonts/FiraCodeNerdFontMono-Regular.woff2?v=nf3.4.0",
            **{"as": "font"},
            type="font/woff2",
            crossorigin=True,
        ),
        title["macmini"],
        *[_stylesheet(name, version) for name, version in STYLES],
        link(rel="stylesheet", href=theme_css, **{"data-theme-css": theme_id}),
    ]
