// Progress Bars view: shared 0-100 bars, nested children, free-form k-v fields.
// Rendered from /api/progress; every write goes back through the same API so
// humans in the UI and agents over REST/MCP see one consistent set.
import { $, esc } from "../dom.js";
import { openModal } from "../modal.js";
import * as attention from "../attention.js?v=attention7";

const API = "/api/progress";
const POLL_MS = 10000;

let bars = [];
let total = 0;
let loaded = false;
let started = false;
let attentionPending = false;
let editingId = null;
let dialog, form, fieldsBox, errorBox;

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
const pctText = (n) => {
  const v = clamp(n);
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
};

function flatten(list, depth = 0, out = []) {
  for (const bar of list || []) {
    out.push({ ...bar, _depth: depth });
    flatten(bar.children || [], depth + 1, out);
  }
  return out;
}

function findBar(id, list = bars) {
  for (const bar of list || []) {
    if (bar.id === id) return bar;
    const hit = findBar(id, bar.children || []);
    if (hit) return hit;
  }
  return null;
}

function subtreeIds(bar) {
  return flatten([bar]).map((node) => node.id);
}

function fieldsHtml(fields) {
  const entries = Object.entries(fields || {});
  if (!entries.length) return "";
  const pairs = entries.map(([key, value]) => {
    const shown = value === null || value === undefined || value === "" ? "—" : value;
    return `<dt>${esc(key)}</dt><dd>${esc(shown)}</dd>`;
  });
  return `<dl class="pb-fields">${pairs.join("")}</dl>`;
}

function cardHtml(bar, depth = 0) {
  const kids = bar.children || [];
  const done = clamp(bar.percent) >= 100;
  return `
<article class="pb-card${done ? " is-done" : ""}" data-id="${bar.id}" data-depth="${depth}">
  <div class="pb-card-head">
    <div class="pb-heading">
      <span class="pb-name">${esc(bar.title)}</span>
      ${bar.owner ? `<span class="pb-owner">${esc(bar.owner)}</span>` : ""}
      ${done ? '<span class="pb-done-tag">done</span>' : ""}
    </div>
    <div class="pb-actions">
      <button type="button" class="pb-act" data-act="child" data-id="${bar.id}" title="Add a nested bar">+ child</button>
      <button type="button" class="pb-act" data-act="edit" data-id="${bar.id}" title="Edit this bar">edit</button>
      <button type="button" class="pb-act" data-act="delete" data-id="${bar.id}" title="Delete this bar">del</button>
    </div>
  </div>
  <div class="pb-meter-row">
    <span class="pb-pct">${pctText(bar.percent)}</span>
    <span class="pb-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${clamp(bar.percent)}" aria-label="${esc(bar.title)}"><i style="width:${clamp(bar.percent)}%"></i></span>
  </div>
  ${fieldsHtml(bar.fields)}
  ${kids.length ? `<div class="pb-children">${kids.map((kid) => cardHtml(kid, depth + 1)).join("")}</div>` : ""}
</article>`;
}

function render() {
  const grid = $("progress-grid");
  if (!grid) return;
  if (!bars.length) {
    grid.innerHTML = '<p class="pb-empty">// no progress bars yet — [+ bar] to start one</p>';
  } else {
    grid.innerHTML = bars.map((bar) => cardHtml(bar)).join("");
  }
  const roots = bars.length;
  const clock = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  $("progress-status").textContent = `synced ${clock}`;
  $("progress-count").textContent =
    `${roots} top-level · ${total} bar${total === 1 ? "" : "s"} · shared with agents`;
  runAttention();
}

async function refresh() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    bars = data.bars || [];
    total = data.count ?? flatten(bars).length;
    loaded = true;
    render();
  } catch (err) {
    $("progress-status").textContent = `load failed — ${err.message}`;
  }
}

function addFieldRow(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "pb-field-row";
  const k = document.createElement("input");
  k.type = "text";
  k.className = "pb-field-key";
  k.placeholder = "field";
  k.value = key;
  const v = document.createElement("input");
  v.type = "text";
  v.className = "pb-field-value";
  v.placeholder = "value";
  v.value = value;
  const del = document.createElement("button");
  del.type = "button";
  del.className = "pb-field-del";
  del.textContent = "×";
  del.title = "Remove this field";
  del.addEventListener("click", () => row.remove());
  row.append(k, v, del);
  fieldsBox.append(row);
  return row;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function openDialog(bar, parentId = null) {
  editingId = bar ? bar.id : null;
  $("progress-dialog-title").textContent = bar ? "edit bar" : "new bar";
  $("pb-title").value = bar ? bar.title : "";
  $("pb-percent").value = bar ? clamp(bar.percent) : "";
  $("pb-owner").value = (bar && bar.owner) || "";

  const select = $("pb-parent");
  select.innerHTML = '<option value="">— none (top level) —</option>';
  const blocked = bar ? new Set(subtreeIds(bar)) : new Set();
  for (const node of flatten(bars)) {
    if (blocked.has(node.id)) continue;
    const opt = document.createElement("option");
    opt.value = String(node.id);
    opt.textContent = `${"· ".repeat(node._depth)}${node.title}`;
    select.append(opt);
  }
  const chosen = bar ? bar.parent_id : parentId;
  select.value = chosen == null ? "" : String(chosen);

  fieldsBox.innerHTML = "";
  for (const [key, value] of Object.entries((bar && bar.fields) || {})) {
    addFieldRow(key, value == null ? "" : String(value));
  }
  errorBox.hidden = true;
  dialog.showModal();
  $("pb-title").focus();
  $("pb-title").select();
}

async function submit(event) {
  event.preventDefault();
  const title = $("pb-title").value.trim();
  if (!title) {
    showError("title is required");
    return;
  }
  const percent = $("pb-percent").value === "" ? 0 : Number($("pb-percent").value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    showError("percent must be between 0 and 100");
    return;
  }

  const fields = {};
  for (const row of fieldsBox.querySelectorAll(".pb-field-row")) {
    const key = row.querySelector(".pb-field-key").value.trim();
    if (!key) continue;
    fields[key] = row.querySelector(".pb-field-value").value;
  }

  const parent = $("pb-parent").value;
  const body = {
    title,
    percent,
    owner: $("pb-owner").value.trim() || null,
    fields,
    parent_id: parent ? Number(parent) : null,
  };
  const isEdit = editingId != null;
  try {
    const res = await fetch(isEdit ? `${API}/${editingId}` : API, {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.error || `HTTP ${res.status}`);
      return;
    }
    dialog.close();
    await refresh();
  } catch (err) {
    showError(`save failed — ${err.message}`);
  }
}

async function removeBar(id) {
  const bar = findBar(id);
  if (!bar) return;
  const kids = flatten(bar.children || []).length;
  const ok = await openModal({
    title: "delete progress bar",
    text: kids
      ? `“${bar.title}” and its ${kids} nested bar${kids === 1 ? "" : "s"} will be deleted.`
      : `“${bar.title}” will be deleted.`,
    ok: "delete",
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await fetch(`${API}/${id}${kids ? "?cascade=1" : ""}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    await refresh();
  } catch (err) {
    $("progress-status").textContent = `delete failed — ${err.message}`;
  }
}

function barSignature(bar) {
  return [bar.updated_at, bar.title, bar.percent, bar.owner, JSON.stringify(bar.fields || {})].join(
    "|",
  );
}

// Esc marked the bars read: confirm briefly; the next poll restores "synced".
document.addEventListener("attention:dismissed", (e) => {
  if (document.body.dataset.view !== "progress") return;
  const n = e.detail?.count || 0;
  const s = $("progress-status");
  if (s) s.textContent = n ? `marked ${n} bar${n === 1 ? "" : "s"} read` : "all caught up";
});

// Draw the eye to bars that changed since the last visit; the meter itself
// shimmers in addition to the card.
function runAttention() {
  if (!attentionPending || !loaded) return;
  attentionPending = false;
  const nodes = new Map();
  document.querySelectorAll("#progress-grid .pb-card[data-id]").forEach((node) => {
    nodes.set(Number(node.dataset.id), node);
  });
  const items = flatten(bars)
    .map((bar) => ({ id: bar.id, el: nodes.get(bar.id), sig: barSignature(bar) }))
    .filter((item) => item.el);
  attention.visit("progress", items, {
    allIds: flatten(bars).map((bar) => bar.id),
    meter: (el) => el.querySelector(".pb-meter"),
  });
}

export function enterProgress(opts = {}) {
  attentionPending = true;
  if (opts.refresh || loaded) refresh().finally(runAttention);
  else runAttention();
}

export function initProgress() {
  if (started) return;
  started = true;

  dialog = $("progress-dialog");
  form = $("progress-form");
  fieldsBox = $("pb-fields");
  errorBox = $("pb-error");
  if (!dialog || !form) return;

  $("progress-add").addEventListener("click", () => openDialog(null));
  $("progress-refresh").addEventListener("click", refresh);
  $("pb-add-field").addEventListener("click", () => addFieldRow().querySelector("input").focus());
  $("pb-cancel").addEventListener("click", () => dialog.close());
  form.addEventListener("submit", submit);
  dialog.addEventListener("close", () => {
    editingId = null;
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && document.body.dataset.view === "progress")
      enterProgress({ refresh: true });
  });

  $("progress-grid").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-act]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const bar = findBar(id);
    if (btn.dataset.act === "edit" && bar) openDialog(bar);
    else if (btn.dataset.act === "child") openDialog(null, id);
    else if (btn.dataset.act === "delete") removeBar(id);
  });

  refresh();
  setInterval(() => {
    if (document.body.dataset.view === "progress" && dialog && !dialog.open) refresh();
  }, POLL_MS);
}
