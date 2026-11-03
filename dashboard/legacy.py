"""Flask sub-app for the routes not yet migrated to FastAPI.

The ASGI app mounts this at ``/`` after its own routes, so the dashboard keeps
working while the routers move. This module and Flask itself disappear once the
last blueprint is converted.
"""


def create_legacy_app():
    from flask import Flask, jsonify, send_from_directory

    from . import (  # noqa: F401  (routes on kanban_bp)
        config,
        db,
        kanban_comments_api,
        kanban_search_api,
    )
    from .docs_api import bp as docs_bp
    from .fs_api import bp as fs_bp
    from .kanban_api import bp as kanban_bp
    from .logs_api import router  # noqa: F401  (native now; import keeps the package coherent)
    from .mcp import bp as mcp_bp
    from .notes_api import bp as notes_bp
    from .progress_api import bp as progress_bp
    from .shell.api import bp as shell_bp

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_MB * 1024 * 1024

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": f"upload too large (max {config.MAX_UPLOAD_MB} MB)"}), 413

    @app.get("/<path:filename>")
    def static_files(filename):
        return send_from_directory(config.STATIC_DIR, filename)

    db.init_db()
    app.teardown_appcontext(db.close_db)
    for blueprint in (notes_bp, fs_bp, shell_bp, kanban_bp, progress_bp, docs_bp, mcp_bp):
        app.register_blueprint(blueprint)
    return app
