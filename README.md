<h1 align="center">agent-box</h1>

<p align="center">
  <strong>An all-in-one dashboard for agents and humans to collaborate on work.</strong>
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/views-6-171914?style=flat-square" alt="views: 6"></a>
  <a href="#mcp-access"><img src="https://img.shields.io/badge/mcp-streamable_http-171914?style=flat-square" alt="MCP: streamable HTTP"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-171914?style=flat-square" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="#what-is-this">What is this</a> ·
  <a href="#views">Views</a> ·
  <a href="#customize">Customize</a> ·
  <a href="#mcp-access">MCP access</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#development">Development</a>
</p>

agent-box is a single-page dashboard that runs on one host. Humans use it in a browser. Agents use the same data through an MCP endpoint. Both sides read and write the same board, notes, and progress state.

## What is this

One Flask app serves the page, the HTTP API, and the MCP endpoint. State lives in one SQLite file. There is no build step. You edit a file, save it, and refresh the browser.

Use it to run a small team on one machine. A person triages work on the board. An agent picks up a card, posts progress, and updates the daily note. The human sees each change without a sync job.

## Views

- **Ops Board.** A kanban board with lanes, cards, comments, search, and archive. Drag cards between lanes. Agents move the same cards through MCP.
- **Daily Sitrep.** A markdown note per day with a weekly schedule beside it. Tasks use `- [ ]` lines. Ticks persist when agents append updates.
- **Stack.** A service scanner for the host. It lists each service from `static/config.json` and probes its port.
- **Files.** A filesystem explorer with an inline editor. Browse, edit, upload, and download files on the host.
- **Shell.** A real terminal on the host in the browser. It runs over tmux, so sessions survive a refresh.
- **Progress.** Shared progress bars with nested bars and key-value fields. Humans and agents update the same bars.

A live telemetry strip shows CPU, memory, and power on every view. The shell runs on a WebSocket beside the main app.

## Customize

Two edits cover most setups.

1. Set the title. Open `static/config.json` and set `title`. The header, the sidebar, and the browser tab use that value. Copy `static/config.example.json` as a starting point.
2. Set the stack page. Edit the `services` list in the same file. Each entry has a name, an icon, a short description, a color, and a port.

The theme is plain CSS. Files in `static/css/` load in order from `static/index.html`. The last files win. Add one stylesheet at the end to reskin the dashboard. Keep element ids and classes stable, because the JavaScript queries them.

## MCP access

The MCP endpoint is `POST /mcp` on the same port. Transport is Streamable HTTP. It is stateless, with one JSON-RPC message per POST. Tools cover the board, the sitrep and schedule, and progress bars.

Read `static/llm.txt` before you connect an agent. It documents each tool, the date rules, and the write conventions. New agent work should use MCP. The HTTP API remains for scripts.

Register the endpoint once:

```bash
claude mcp add --transport http agent-box http://HOST:5555/mcp
```

Replace `HOST` with the host name or private address. The dashboard has no authentication. Run it only on a private network or tailnet.

## Quick start

You need Python 3.11 or newer.

```bash
git clone https://github.com/sisig-ai/agent-box.git
cd agent-box
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp static/config.example.json static/config.json
.venv/bin/gunicorn --workers 1 --threads 8 --bind 0.0.0.0:5555 app:app
```

Open http://localhost:5555 in a browser. Edit `static/config.json` to set your title and services. State is created under `data/` on first run.

For a phone, open the page in Safari and choose Add to Home Screen. The manifest and service worker are included. The layout switches to a bottom tab bar on small screens.

## Development

```bash
make check    # ruff, pytest, node tests, line budget
npm run lint  # eslint and prettier check
npm run format
```

Python uses Ruff. JavaScript uses ESLint. CSS and HTML use Prettier. Each source file stays at or below 300 lines. Tests live in `tests/`.

## License

MIT. See [LICENSE](./LICENSE).
