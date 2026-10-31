"""Dashboard application package.

``create_app()`` builds the Flask app: config, schema init, blueprints, the 413
upload handler, and the landing/static routes. Flask is imported inside the
factory so the telemetry collector can import package submodules without
loading Flask (M2 decoupling, known-issue #5).
"""


def create_app():
    from flask import Flask, jsonify, request, send_from_directory

    from . import config, db
    from .fs_api import bp as fs_bp
    from .kanban_api import bp as kanban_bp
    from .mcp import bp as mcp_bp
    from .notes_api import bp as notes_bp
    from .progress_api import bp as progress_bp
    from .shell.api import bp as shell_bp
    from .telemetry_api import bp as telemetry_bp

    app = Flask(__name__, static_folder=str(config.STATIC_DIR), static_url_path="/static")
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_MB * 1024 * 1024

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": f"upload too large (max {config.MAX_UPLOAD_MB} MB)"}), 413

    @app.after_request
    def cache_control(response):
        """Long immutable cache for versioned assets; revalidate entry points."""
        path = request.path
        if path.startswith(("/static/fonts/", "/static/vendor/")):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path in ("/", "/index.html", "/config.json"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    db.init_db()
    app.teardown_appcontext(db.close_db)
    app.register_blueprint(notes_bp)
    app.register_blueprint(telemetry_bp)
    app.register_blueprint(fs_bp)
    app.register_blueprint(shell_bp)
    app.register_blueprint(kanban_bp)
    app.register_blueprint(progress_bp)
    app.register_blueprint(mcp_bp)

    @app.get("/")
    @app.get("/index.html")
    def index():
        return send_from_directory(config.STATIC_DIR, "index.html")

    @app.get("/config.json")
    def config_json():
        return send_from_directory(config.STATIC_DIR, "config.json")

    @app.get("/<path:filename>")
    def static_files(filename):
        return send_from_directory(config.STATIC_DIR, filename)

    return app
