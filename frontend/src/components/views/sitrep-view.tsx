"use client";

// Daily Sitrep + weekly schedule. Ported from the old Alpine brief view
// (static/js/notes/brief.js + dashboard/page/panels_notes.py): markdown editor
// with a 900ms autosave, clickable task checkboxes in the preview, the
// markdown toolbar, and the Mon–Sun schedule column on the right.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { notesApi } from "@/lib/api";
import {
  parseSchedule,
  rebaseToggle,
  renderMarkdown,
  taskLines,
  toggleTask,
  type ParsedSchedule,
} from "@/lib/markdown";
import { fmtDayLabel, fmtWeek, shiftDate, shiftWeek, syncedAt, todayStr, weekStart } from "@/lib/format";
import { DashboardButton } from "@/components/block/dashboard-shell";
import "../sitrep.css";

const SAVE_DEBOUNCE_MS = 900;

/* Markdown toolbar specs: line-prefix, selection-wrap and insert. */
interface ToolSpec {
  line?: string;
  wrap?: [string, string];
  insert?: string;
  placeholder?: string;
}

const TOOLS: Record<string, ToolSpec> = {
  h1: { line: "# " },
  h2: { line: "## " },
  h3: { line: "### " },
  bold: { wrap: ["**", "**"], placeholder: "bold text" },
  italic: { wrap: ["*", "*"], placeholder: "italic text" },
  strike: { wrap: ["~~", "~~"], placeholder: "struck text" },
  code: { wrap: ["`", "`"], placeholder: "code" },
  codeblock: { wrap: ["\n```\n", "\n```\n"], placeholder: "code block" },
  quote: { line: "> " },
  ul: { line: "- " },
  ol: { line: "1. " },
  task: { line: "- [ ] " },
  hr: { insert: "\n---\n" },
  link: { wrap: ["[", "](https://)"], placeholder: "link text" },
  table: { insert: "\n| Column A | Column B |\n| --- | --- |\n| cell | cell |\n" },
};

const TOOLBAR: { md: string | null; title: string | null; body: string }[] = [
  { md: "h1", title: "Heading 1", body: "H1" },
  { md: "h2", title: "Heading 2", body: "H2" },
  { md: "h3", title: "Heading 3", body: "H3" },
  { md: null, title: null, body: "" },
  { md: "bold", title: "Bold (Ctrl/Cmd+B)", body: "B" },
  { md: "italic", title: "Italic (Ctrl/Cmd+I)", body: "I" },
  { md: "strike", title: "Strikethrough", body: "S" },
  { md: null, title: null, body: "" },
  { md: "code", title: "Inline code", body: "</>" },
  { md: "codeblock", title: "Code block", body: "```" },
  { md: "quote", title: "Blockquote", body: "❝" },
  { md: null, title: null, body: "" },
  { md: "ul", title: "Bullet list", body: "•" },
  { md: "ol", title: "Numbered list", body: "1." },
  { md: "task", title: "Task list", body: "☐" },
  { md: "hr", title: "Horizontal rule", body: "—" },
  { md: null, title: null, body: "" },
  { md: "link", title: "Link", body: "link" },
  { md: "table", title: "Table", body: "table" },
];

type SaveCls = "ready" | "saving" | "saved" | "error";

export function SitrepView() {
  const [date, setDate] = useState(todayStr());
  const [content, setContent] = useState("");
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [saveState, setSaveState] = useState<{ text: string; cls: SaveCls }>({ text: "ready", cls: "ready" });

  const [schedWeek, setSchedWeek] = useState(weekStart(todayStr()));
  const [schedParsed, setSchedParsed] = useState<ParsedSchedule | null>(null);
  const [schedExtra, setSchedExtra] = useState("");
  const [schedEmpty, setSchedEmpty] = useState(true);
  const [schedEmptyText, setSchedEmptyText] = useState("// no schedule for this week yet");

  // The async save / checkbox flows read the freshest values the way the old
  // Alpine component read `this.*`; the state above is the render mirror.
  const live = useRef({ date: todayStr(), content: "", dirty: false, lastSaved: "" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempts = useRef(0);
  const loadSeq = useRef(0);
  const schedSeq = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const chip = useCallback((text: string, cls: SaveCls) => setSaveState({ text, cls }), []);

  const applyContent = useCallback((next: string) => {
    live.current.content = next;
    setContent(next);
  }, []);

  const applyDate = useCallback((next: string) => {
    live.current.date = next;
    setDate(next);
  }, []);

  /* ----- save loop ----- */

  function scheduleRetry() {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const delay = Math.min(3000 * 2 ** retryAttempts.current, 30000);
    retryAttempts.current = Math.min(retryAttempts.current + 1, 5);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      void save();
    }, delay);
  }

  async function save() {
    const { date: day, content: text, dirty } = live.current;
    if (text === live.current.lastSaved && !dirty) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    chip("saving…", "saving");
    try {
      await notesApi.putSitrep(day, text);
      live.current.lastSaved = text;
      live.current.dirty = false;
      retryAttempts.current = 0;
      chip(`saved ${syncedAt()}`, "saved");
    } catch {
      live.current.dirty = true;
      chip("save failed — retrying", "error");
      scheduleRetry();
    }
  }

  function onInputValue(value: string) {
    live.current.dirty = true;
    retryAttempts.current = 0;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    applyContent(value);
    chip("unsaved", "ready");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save();
    }, SAVE_DEBOUNCE_MS);
  }

  /* ----- sitrep ----- */

  async function load(dateStr: string) {
    const seq = ++loadSeq.current;
    if (live.current.dirty) await save();
    if (seq !== loadSeq.current) return; // a newer navigation won the race
    applyDate(dateStr);
    chip("loading…", "ready");
    try {
      const data = await notesApi.sitrep(dateStr);
      if (seq !== loadSeq.current) return;
      applyContent(data.content || "");
      live.current.lastSaved = data.content || "";
      live.current.dirty = false;
      chip(data.content ? "saved — entry loaded" : "saved — no entry yet", "saved");
    } catch {
      if (seq !== loadSeq.current) return;
      chip("load failed", "error");
    }
  }

  /* ----- toolbar ----- */

  function applyTool(spec: ToolSpec) {
    const el = editorRef.current;
    if (!el) return;
    if (spec.line) {
      const lineStart = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
      el.setRangeText(spec.line, lineStart, lineStart, "end");
    } else if (spec.insert) {
      el.setRangeText(spec.insert, el.selectionStart, el.selectionStart, "end");
    } else if (spec.wrap) {
      const [before, after] = spec.wrap;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const sel = el.value.slice(start, end) || spec.placeholder || "";
      el.setRangeText(before + sel + after, start, end, "end");
    }
    el.focus();
    onInputValue(el.value);
  }

  function onEditorKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === "s") {
      event.preventDefault();
      void save();
    }
    if (mod && event.key === "b") {
      event.preventDefault();
      applyTool(TOOLS.bold);
    }
    if (mod && event.key === "i") {
      event.preventDefault();
      applyTool(TOOLS.italic);
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const el = event.currentTarget;
      el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end");
      onInputValue(el.value);
    }
  }

  /* ----- task checkboxes in the preview ----- */

  async function onPreviewChange(event: ChangeEvent<HTMLDivElement>) {
    const cb = event.target as HTMLInputElement;
    if (!cb || cb.tagName !== "INPUT" || cb.type !== "checkbox") return;
    const box = previewRef.current;
    if (!box) return;
    const boxes = Array.from(box.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]'));
    const n = boxes.indexOf(cb);
    const checked = cb.checked;
    const base = live.current.content;
    const clickDate = live.current.date;
    if (n < 0 || boxes.length !== taskLines(base).length) {
      cb.checked = !checked;
      chip("checkbox not mapped — tick it in Edit", "error");
      return;
    }
    let next: string | null = null;
    if (live.current.dirty) {
      next = toggleTask(base, n, checked);
    } else {
      chip("syncing…", "saving");
      let fresh = base;
      try {
        const data = await notesApi.sitrep(clickDate);
        fresh = data.content || "";
      } catch {
        /* offline: use what we have */
      }
      if (live.current.date !== clickDate) return;
      if (live.current.content !== base) {
        next = toggleTask(live.current.content, n, checked);
      } else if (fresh === base) {
        next = toggleTask(base, n, checked);
      } else {
        next = rebaseToggle(base, fresh, n, checked);
        live.current.lastSaved = fresh;
        if (next === null) {
          applyContent(fresh);
          chip("sitrep changed elsewhere — reloaded, tick again", "error");
          return;
        }
      }
    }
    if (next === null) {
      cb.checked = !checked;
      return;
    }
    live.current.dirty = true;
    applyContent(next);
    await save();
  }

  /* ----- weekly schedule ----- */

  function applySchedule(week: string, text: string) {
    if (!text.trim()) {
      setSchedParsed(null);
      setSchedExtra("");
      setSchedEmpty(true);
      setSchedEmptyText("// no schedule for this week yet");
      return;
    }
    const parsed = parseSchedule(text, week);
    setSchedParsed(parsed);
    setSchedExtra(parsed.extra);
    setSchedEmpty(!parsed.mapped && !parsed.extra);
  }

  async function loadSchedule(dateStr: string) {
    const seq = ++schedSeq.current;
    const week = weekStart(dateStr);
    setSchedWeek(week);
    try {
      const data = await notesApi.schedule(week);
      if (seq !== schedSeq.current) return;
      applySchedule(week, data.content || "");
    } catch {
      if (seq !== schedSeq.current) return;
      setSchedParsed(null);
      setSchedExtra("");
      setSchedEmpty(true);
      setSchedEmptyText("// failed to load schedule");
    }
  }

  /* ----- derived ----- */

  const previewHtml = useMemo(() => (content.trim() ? renderMarkdown(content) : ""), [content]);
  const extraHtml = useMemo(() => (schedExtra ? renderMarkdown(schedExtra) : ""), [schedExtra]);

  const wordText = useMemo(() => {
    const text = content.trim();
    if (!text) return "";
    const words = text.split(/\s+/).filter(Boolean).length;
    return `${words} words · ${text.length} chars`;
  }, [content]);

  const todayOffset = useMemo(() => {
    const [wy, wm, wd] = schedWeek.split("-").map(Number);
    const [ty, tm, td] = todayStr().split("-").map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(wy, wm - 1, wd)) / 86400000);
  }, [schedWeek]);

  // marked renders task checkboxes disabled; the preview ticks them live.
  useEffect(() => {
    const box = previewRef.current;
    if (!box) return;
    box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.disabled = false;
    });
  }, [previewHtml, tab]);

  /* ----- boot + unload beacon ----- */

  useEffect(() => {
    void load(live.current.date);
    void loadSchedule(live.current.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const flush = () => {
      const { date: day, content: text, dirty } = live.current;
      if (!dirty) return;
      navigator.sendBeacon(
        "/api/sitrep",
        new Blob([JSON.stringify({ date: day, content: text })], { type: "application/json" }),
      );
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush(); // leaving the view with unsaved text: ship it, like the old beacon
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  /* ----- render ----- */

  return (
    <section className="sitrep" aria-label="Daily Sitrep and weekly schedule">
      <div className="sitrep-main">
        <div className="sitrep-head">
          <div className="sitrep-title">
            <h2>Daily Sitrep</h2>
            <span className="sitrep-date-label">{fmtDayLabel(date)}</span>
          </div>
          <div className="sitrep-nav">
            <DashboardButton size="sm" title="Previous day" aria-label="Previous day" onClick={() => void load(shiftDate(date, -1))}>‹</DashboardButton>
            <input
              type="date"
              aria-label="Sitrep date"
              value={date}
              onChange={(e) => {
                const next = e.target.value;
                if (next) void load(next);
              }}
            />
            <DashboardButton size="sm" title="Next day" aria-label="Next day" onClick={() => void load(shiftDate(date, 1))}>›</DashboardButton>
            <DashboardButton size="sm" title="Jump to today" onClick={() => void load(todayStr())}>today</DashboardButton>
          </div>
        </div>

        {tab === "edit" && (
          <div className="sitrep-toolbar" role="toolbar" aria-label="Markdown toolbar">
            {TOOLBAR.map((tool, index) =>
              tool.md ? (
                <button
                  key={index}
                  type="button"
                  className="tool-btn"
                  title={tool.title ?? undefined}
                  onClick={() => applyTool(TOOLS[tool.md!])}
                >
                  {tool.body}
                </button>
              ) : (
                <span key={index} className="tool-sep" />
              ),
            )}
          </div>
        )}

        <div className="sitrep-tabs">
          <button type="button" className={`tab-btn${tab === "preview" ? " active" : ""}`} onClick={() => setTab("preview")}>
            preview
          </button>
          <button type="button" className={`tab-btn${tab === "edit" ? " active" : ""}`} onClick={() => setTab("edit")}>
            edit
          </button>
        </div>

        <div className="sitrep-panes">
          {tab === "edit" ? (
            <textarea
              ref={editorRef}
              className="sitrep-editor"
              value={content}
              onChange={(e) => onInputValue(e.target.value)}
              onKeyDown={onEditorKey}
              placeholder="type today's sitrep… markdown supported. saved automatically."
              spellCheck={false}
            />
          ) : (
            <div ref={previewRef} className="sitrep-preview" onChange={onPreviewChange}>
              {previewHtml ? (
                <div className="sitrep-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <p className="sitrep-empty">// nothing written yet</p>
              )}
            </div>
          )}
        </div>

        <div className="sitrep-status">
          <span className={`sitrep-save-state ${saveState.cls}`}>{saveState.text}</span>
          <span className="sitrep-wordcount">{wordText}</span>
        </div>
      </div>

      <aside className="sitrep-schedule" aria-label="Weekly schedule">
        <div className="schedule-head">
          <div className="schedule-title">
            <h2>Schedule</h2>
            <span className="schedule-week-label">{fmtWeek(schedWeek)}</span>
          </div>
          <div className="schedule-nav">
            <DashboardButton size="sm" title="Previous week" aria-label="Previous week" onClick={() => void loadSchedule(shiftWeek(schedWeek, -1))}>‹</DashboardButton>
            <DashboardButton size="sm" title="Next week" aria-label="Next week" onClick={() => void loadSchedule(shiftWeek(schedWeek, 1))}>›</DashboardButton>
            <DashboardButton size="sm" title="This week" onClick={() => void loadSchedule(todayStr())}>now</DashboardButton>
          </div>
        </div>
        <div className="schedule-preview obsidian-dashboard-shell-scroll">
          {schedEmpty ? (
            <p className="schedule-empty">{schedEmptyText}</p>
          ) : (
            <>
              {schedParsed?.mapped && (
                <div className="schedule-calendar">
                  {schedParsed.days.map((day, index) => (
                    <div key={day.label} className={`cal-row${index === todayOffset ? " cal-today" : ""}`}>
                      <div className="cal-rowhead">{day.label}</div>
                      {day.items.length === 0 && <div className="cal-event cal-event-empty">—</div>}
                      {day.items.map((item, i) => (
                        <div key={i} className={`cal-event${item.done ? " done" : ""}`}>
                          {item.text}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {extraHtml && <div className="schedule-extra sitrep-md" dangerouslySetInnerHTML={{ __html: extraHtml }} />}
            </>
          )}
        </div>
      </aside>
    </section>
  );
}
