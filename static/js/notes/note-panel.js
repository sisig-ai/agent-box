// Daily-note panel factory: editor/toolbar/tabs/autosave/wordcount/date-nav.
import { $ } from "../dom.js";
import { renderMarkdown } from "./markdown.js";
import { taskLines, toggleTask, rebaseToggle } from "./tasks.js?v=sitrep2";

export function makeNotePanel(cfg) {
  const root = $(cfg.root);
  const editor = $(cfg.editor);
  const preview = $(cfg.preview);
  const dateInput = $(cfg.dateInput);
  const dateLabel = $(cfg.dateLabel);
  const saveState = $(cfg.saveState);
  const wordcount = $(cfg.wordcount);

  if (!root || !editor) return null; // panel missing — bail silently

  let currentDate = null;
  let saveTimer = null;
  let dirty = false;
  let lastSavedContent = "";

  const pad = (n) => String(n).padStart(2, "0");

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function shiftDate(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  function fmtLabel(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  function setState(state, text) {
    saveState.className = "brief-save-state " + state;
    saveState.textContent = text;
  }

  function countWords() {
    const t = editor.value.trim();
    if (!t) {
      wordcount.textContent = "";
      return;
    }
    const words = t.split(/\s+/).filter(Boolean).length;
    const chars = t.length;
    wordcount.textContent = `${words} words · ${chars} chars`;
  }

  function renderPreview() {
    if (typeof marked === "undefined") {
      preview.innerHTML =
        '<p class="brief-empty">// marked.js failed to load — preview unavailable</p>';
      return;
    }
    const raw = editor.value || "";
    if (!raw.trim()) {
      preview.innerHTML = '<p class="brief-empty">// nothing written yet</p>';
      return;
    }
    // Shared sanitizer + re-enable marked's disabled task-list checkboxes
    renderMarkdown(preview, raw);
  }

  async function loadBrief(dateStr, opts = {}) {
    if (dirty && !opts.force) {
      await saveNow(); // flush pending edits before switching days
    }
    currentDate = dateStr;
    dateInput.value = dateStr;
    dateLabel.textContent = fmtLabel(dateStr);
    setState("ready", "loading…");
    try {
      const res = await fetch(`${cfg.api}?date=${dateStr}`);
      const data = await res.json();
      editor.value = data.content || "";
      lastSavedContent = editor.value;
      dirty = false;
      renderPreview();
      countWords();
      setState("saved", `saved — ${data.content ? "entry loaded" : "no entry yet"}`);
      if (!data.content) {
        preview.innerHTML = '<p class="brief-empty">// no entry for this day yet</p>';
      }
    } catch (err) {
      setState("error", "load failed");
    }
  }

  async function saveNow() {
    if (!currentDate) return;
    const content = editor.value;
    if (content === lastSavedContent && !dirty) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    setState("saving", "saving…");
    try {
      const res = await fetch(cfg.api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: currentDate, content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastSavedContent = content;
      dirty = false;
      const now = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setState("saved", `saved ${now}`);
    } catch (err) {
      setState("error", "save failed — retrying");
      dirty = true;
    }
  }

  function scheduleSave() {
    dirty = true;
    renderPreview();
    countWords();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }

  /* ----- Toolbar: markdown insertion ----- */
  function wrapSelection(before, after = before, placeholder = "") {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const sel = editor.value.slice(start, end) || placeholder;
    editor.setRangeText(before + sel + after, start, end, "end");
    editor.focus();
    scheduleSave();
  }

  function linePrefix(prefix, placeholder = "") {
    const start = editor.selectionStart;
    const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
    editor.setRangeText(prefix, lineStart, lineStart, "end");
    editor.focus();
    scheduleSave();
  }

  const mdActions = {
    h1: () => linePrefix("# ", "Heading"),
    h2: () => linePrefix("## ", "Heading"),
    h3: () => linePrefix("### ", "Heading"),
    bold: () => wrapSelection("**", "**", "bold text"),
    italic: () => wrapSelection("*", "*", "italic text"),
    strike: () => wrapSelection("~~", "~~", "struck text"),
    code: () => wrapSelection("`", "`", "code"),
    codeblock: () => wrapSelection("\n```\n", "\n```\n", "code block"),
    quote: () => linePrefix("> "),
    ul: () => linePrefix("- "),
    ol: () => linePrefix("1. "),
    task: () => linePrefix("- [ ] "),
    hr: () => {
      const start = editor.selectionStart;
      editor.setRangeText("\n---\n", start, start, "end");
      editor.focus();
      scheduleSave();
    },
    link: () => wrapSelection("[", "](https://)", "link text"),
    table: () =>
      wrapSelection("\n| Column A | Column B |\n| --- | --- |\n| cell | cell |\n", "", ""),
  };

  root.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = mdActions[btn.dataset.md];
      if (action) action();
    });
  });

  /* ----- Tabs (Preview default; Edit is a separate mode) ----- */
  function setTab(tab) {
    root
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const isPreview = tab === "preview";
    editor.style.display = isPreview ? "none" : "block";
    preview.classList.toggle("visible", isPreview);
    root.querySelector(".brief-toolbar").style.display = isPreview ? "none" : "flex";
    if (isPreview) renderPreview();
    else editor.focus();
  }

  root.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  /* Clicking a task checkbox in preview flips that line's "[ ]"/"[x]" in the
     markdown and saves right away. Checkboxes map to source lines in order,
     skipping code fences (tasks.js). Without unsaved local edits, re-fetch
     first so a tick never clobbers a newer copy another writer just PUT. */
  preview.addEventListener("change", async (e) => {
    const cb = e.target;
    if (!cb || cb.tagName !== "INPUT" || cb.type !== "checkbox") return;
    const boxes = Array.from(preview.querySelectorAll('li input[type="checkbox"]'));
    const n = boxes.indexOf(cb);
    const checked = cb.checked;
    const date = currentDate;
    const base = editor.value;
    if (n < 0 || boxes.length !== taskLines(base).length) {
      cb.checked = !checked;
      setState("error", "checkbox not mapped — tick it in Edit");
      return;
    }
    let next = null;
    if (dirty) {
      next = toggleTask(base, n, checked); // local unsaved edits are newest
    } else {
      setState("saving", "syncing…");
      let fresh = base;
      try {
        const res = await fetch(`${cfg.api}?date=${date}`, { cache: "no-store" });
        if (res.ok) fresh = (await res.json()).content || "";
      } catch (err) {
        /* offline: fall back to what we have */
      }
      if (date !== currentDate) return; // day switched mid-flight
      if (editor.value !== base) {
        next = toggleTask(editor.value, n, checked);
      } else if (fresh === base) {
        next = toggleTask(base, n, checked);
      } else {
        next = rebaseToggle(base, fresh, n, checked);
        lastSavedContent = fresh;
        if (next === null) {
          // item gone/ambiguous upstream: show newest, no write
          editor.value = fresh;
          renderPreview();
          countWords();
          setState("error", "sitrep changed elsewhere — reloaded, tick again");
          return;
        }
      }
    }
    if (next === null) {
      cb.checked = !checked;
      return;
    }
    editor.value = next;
    dirty = true;
    renderPreview();
    countWords();
    await saveNow();
  });

  /* ----- Editor events ----- */
  editor.addEventListener("input", scheduleSave);

  editor.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "s") {
      e.preventDefault();
      saveNow();
    }
    if (mod && e.key === "b") {
      e.preventDefault();
      mdActions.bold();
    }
    if (mod && e.key === "i") {
      e.preventDefault();
      mdActions.italic();
    }
    // Tab inserts two spaces instead of leaving the field
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      editor.setRangeText("  ", start, editor.selectionEnd, "end");
      scheduleSave();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (dirty) {
      navigator.sendBeacon(
        cfg.api,
        new Blob([JSON.stringify({ date: currentDate, content: editor.value })], {
          type: "application/json",
        }),
      );
    }
  });

  /* ----- Date nav ----- */
  dateInput.addEventListener("change", () => {
    if (dateInput.value) loadBrief(dateInput.value);
  });
  $(cfg.prev).addEventListener("click", () => loadBrief(shiftDate(currentDate, -1)));
  $(cfg.next).addEventListener("click", () => loadBrief(shiftDate(currentDate, 1)));
  $(cfg.today).addEventListener("click", () => loadBrief(todayStr()));

  /* ----- Init ----- */
  setTab("preview"); // Preview is the default view; Edit is opt-in
  loadBrief(todayStr());
  return { reload: () => loadBrief(currentDate || todayStr()) };
}
