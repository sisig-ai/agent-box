from flask import Flask, jsonify, send_from_directory

from dashboard.config import MAX_UPLOAD_MB, STATIC_DIR
from dashboard.db import init_db
from dashboard.fs_api import bp as fs_bp
from dashboard.notes_api import bp as notes_bp
from dashboard.shell.api import bp as shell_bp
from dashboard.telemetry_api import bp as telemetry_bp

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": f"upload too large (max {MAX_UPLOAD_MB} MB)"}), 413


init_db()
app.register_blueprint(notes_bp)
app.register_blueprint(telemetry_bp)
app.register_blueprint(fs_bp)
app.register_blueprint(shell_bp)


# ---------------- Landing page ----------------


@app.get("/")
@app.get("/index.html")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/config.json")
def config():
    return send_from_directory(STATIC_DIR, "config.json")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)
