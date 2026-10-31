<h1 align="center">agent-box</h1>

<p align="center">
  <strong>One dashboard where people and agents work the same board, notes, and progress bars.</strong>
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/views-6-171914?style=flat-square" alt="views: 6"></a>
  <a href="#agents-connect-over-mcp"><img src="https://img.shields.io/badge/mcp-streamable_http-171914?style=flat-square" alt="MCP: streamable HTTP"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-171914?style=flat-square" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="#the-idea">The idea</a> ·
  <a href="#the-views">The views</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#agents-connect-over-mcp">Agents connect over MCP</a> ·
  <a href="#make-it-yours">Make it yours</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#development">Development</a>
</p>

## The idea

I run a few agents on a home server. They do real work, and I need to see it, steer it, and sometimes stop it. Chat logs do not scale for that. A board does.

agent-box is a single-page dashboard on one host. I open it in a browser. The agents reach the same data through an MCP endpoint. Both sides read and write one SQLite file. A card I drag is the card an agent updates a minute later. A task line I tick in the daily note stays ticked when the agent rewrites the rest of the entry.

One Flask app serves the page, the HTTP API, and the MCP endpoint. There is no build step. Edit a file, save, refresh.

## The views

Six views share the sidebar. A thin telemetry strip sits above all of them.

### Ops Board

This is where the work lives. Lanes are columns. Cards are jobs. Each card has an owner, an optional operation name that groups related cards, a markdown body, and a comment thread. Search runs full text across titles, bodies, comments, owners and operation names.

How I use it: I write a card, drag it into To Do, and name the agent that should pick it up. When a card lands in Done I archive it with one click. If the board gets noisy I filter by operation name.

How an agent uses it: it reads the board with `board_overview` or `search_cards`, claims a card by setting `owner`, and moves it between lanes with `update_card`. Progress goes in as comments with `add_comment`, so the body stays readable and the history stays intact. The body itself follows a fixed shape: Goal, Context, Agent, Status log, Findings, Next steps, Links. An agent reads the card before it rewrites the body and keeps anything I have already ticked.

The browser polls every few seconds while the tab is visible, so agent moves show up without a refresh. The poll pauses while I am dragging or editing.

### Daily Sitrep

One markdown note per day, with the week's schedule beside it. Dates are Manila time. Leaving the date off means today.

I use it as a morning read. Anything I should act on is a `- [ ]` task line on its own line. I tick it in the browser and the tick is saved back into the note as `- [x]`.

Agents append to the day's entry with `get_sitrep` and `put_sitrep`. The rule is simple: read first, keep my ticks, add your lines. The weekly schedule works the same way through `get_schedule` and `put_schedule`, keyed by Monday. Any date in the week resolves to that Monday.

### Stack

A landing page for the services on the host. Each tile comes from `static/config.json`: a name, an icon, a short description, a color, and a port. The page probes the port and shows whether the service answers.

This one is for people. I open it to check that everything is up, and I click a tile to jump to that service. Agents do not need it. Their view of the host is the MCP endpoint, not the tiles.

### Files

A file browser rooted at the home directory, with an inline editor. Browse, open, edit, save. Upload with a progress indicator. Download anything.

I use it to read what an agent wrote without opening a shell. A log, a report, a config an agent changed. Agents reach the same files through the HTTP file routes, though in practice they already have a shell on the host and rarely need these.

### Shell

A real terminal in the browser. It runs over tmux, so the session survives a page refresh and a dropped connection. Keys go through a small allowlist, so modifier combinations behave.

I use it when I want to see exactly what an agent sees: the process list, a stuck job, a disk filling up. It is also how I rescue a box from a phone. The shell has its own WebSocket next to the main app.

### Progress

Shared progress bars. Each bar has a title, a percent, an owner, and free-form key-value fields. Bars nest, so a batch job can carry a budget bar or per-stage bars underneath it.

Agents create a bar when a long job starts and update `percent` and the fields as it runs, for example `done`, `total`, and `cost`. I look at the Progress view instead of asking "how far along are you". Everyone shares one set of bars. There are no per-agent namespaces, which is the point: one place to look.

### The telemetry strip

CPU, temperature, memory, and power on the host, sampled once a second and shown on every view. A native collector writes the samples and the page reads them. It is the first thing I check when a build feels slow.

## Screenshots

Demo data on a throwaway stack. The live board holds real work.

<p align="center"><img src=".github/assets/board.png" width="880" alt="Ops Board: kanban lanes with demo cards, telemetry strip, and the terminal status bar"></p>

<p align="center"><img src=".github/assets/stack.png" width="880" alt="Stack: service scanner with the configured example service"></p>

<p align="center"><img src=".github/assets/sitrep.png" width="880" alt="Daily Sitrep: markdown note with task lines and the weekly schedule"></p>

<p align="center"><img src=".github/assets/progress.png" width="880" alt="Progress: shared progress bars with owners and percents"></p>

## Agents connect over MCP

The MCP endpoint is `POST /mcp` on the same port as the page. Transport is Streamable HTTP, stateless, one JSON-RPC message per POST. Tools cover the board, the sitrep and schedule, lanes, comments, and progress bars.

Register it once:

```bash
claude mcp add --transport http agent-box http://HOST:5555/mcp
```

Replace `HOST` with the machine name or its tailnet address.

Then hand the agent `static/llm.txt`. That file is the contract. It lists every tool with its arguments, the date rules, the card body shape, and the conventions that keep humans and agents from stepping on each other: set your name as owner, read before you rewrite, keep ticked items ticked, move finished cards to Done instead of deleting them, and put long jobs on a progress bar rather than in a comment. New agent work should go through MCP. The HTTP API stays for scripts and old routines.

There is no authentication. Run it on a private network or a tailnet, nowhere else.

## Make it yours

Two edits cover most setups.

1. Set the title. Open `static/config.json` and change `title`. The header, the sidebar, and the browser tab pick it up. Start from `static/config.example.json`.
2. Fill the Stack page. Edit the `services` list in the same file. Each entry needs a name, an icon, a short description, a color, and a port.

The theme is plain CSS. Stylesheets in `static/css/` load in the order listed in `static/index.html`, and later files win. Drop one stylesheet at the end to reskin everything. Leave element ids and classes alone, because the JavaScript looks them up.

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

Open http://localhost:5555. The SQLite state appears under `data/` on first run. Edit `static/config.json` for your title and services.

On a phone, open the page in Safari and choose Add to Home Screen. The manifest and service worker are included, and the layout switches to a bottom tab bar on small screens.

## Development

```bash
make check    # ruff, pytest, node tests, line budget
npm run lint  # eslint and prettier check
npm run format
```

Python is checked with Ruff. JavaScript with ESLint. CSS and HTML with Prettier. Every source file stays at or under 300 lines, and `make check` enforces it. Tests live in `tests/`.

## License

MIT. See [LICENSE](./LICENSE).
