// Trello-style card detail modal: editable title / owner / opname / lane, timestamps,
// and the markdown body (rendered view, or Write + live Preview editor).
// Deep-linkable: #/kanban/card-<id> opens it, #/kanban/card-<id>/edit opens
// straight into the editor (board.js routes the hash here).
import { api } from "./api.js?v=kanban20";
import { inlineEdit } from "./edit.js?v=kanban20";
import { loadPurify, renderBody, toggleTask } from "./markdown.js?v=kanban20";
import { buildComments, paintComments, resetComments } from "./comments.js?v=kanban28";

const ui = {};
const st = { card: null, id: null, editing: false, seq: 0, ctx: null, busy: { busy: 0 } };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";

function build() {
  ui.backdrop = el("div", "kbd-backdrop");
  ui.backdrop.hidden = true;
  const modal = el("div", "kbd-modal");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const head = el("div", "kbd-head");
  ui.id = el("span", "kbd-id");
  ui.title = el("h3", "kbd-title kb-card-title");
  ui.title.id = "kbd-title";
  ui.title.title = "Click to edit the title";
  modal.setAttribute("aria-labelledby", "kbd-title");
  ui.close = el("button", "kb-icon kbd-close", "×");
  ui.close.title = "Close (Esc)";
  head.append(ui.id, ui.title, ui.close);

  const meta = el("div", "kbd-meta");
  const laneLab = el("label", "kbd-field", "Lane");
  ui.status = el("select", "kbd-status");
  laneLab.append(ui.status);
  const ownerLab = el("label", "kbd-field", "Owner");
  ui.owner = el("input", "kbd-owner");
  ui.owner.placeholder = "unassigned";
  ui.owner.maxLength = 100;
  ownerLab.append(ui.owner);
  const opLab = el("label", "kbd-field kbd-op-field", "Op");
  ui.opname = el("input", "kbd-opname");
  ui.opname.placeholder = "no operation";
  ui.opname.maxLength = 100;
  ui.opname.title = "Operation name, e.g. Operation Valhalla (blank clears)";
  ui.opname.setAttribute("list", "kbd-opname-list");
  ui.opList = el("datalist");
  ui.opList.id = "kbd-opname-list";
  opLab.append(ui.opname, ui.opList);
  ui.times = el("span", "kbd-times");
  ui.archive = el("button", "kb-archive-btn kbd-archive");
  meta.append(laneLab, ownerLab, opLab, ui.times, ui.archive);

  const sec = el("div", "kbd-section");
  sec.append(el("span", "kbd-section-label", "Description"));
  ui.edit = el("button", "brief-btn kbd-edit-btn", "✎ Edit");
  ui.previewToggle = el("button", "brief-btn kbd-preview-toggle toggled", "Preview");
  ui.previewToggle.title = "Show/hide the live preview";
  sec.append(ui.previewToggle, ui.edit);

  ui.view = el("div", "kbd-view kbd-md");
  ui.editor = el("div", "kbd-editor split");
  ui.text = el("textarea", "kbd-text");
  ui.text.spellcheck = false;
  ui.text.placeholder =
    "Markdown: ## Goal, - [ ] tasks, ```code```, | tables |, [links](https://…)";
  ui.preview = el("div", "kbd-preview kbd-md");
  ui.editor.append(ui.text, ui.preview);

  const foot = el("div", "kbd-foot");
  ui.msg = el("span", "kbd-msg");
  ui.cancel = el("button", "brief-btn", "Cancel");
  ui.save = el("button", "brief-btn kbd-save", "Save");
  ui.save.title = "Save (⌘/Ctrl+Enter)";
  ui.foot = el("div", "kbd-foot-actions");
  ui.foot.append(ui.cancel, ui.save);
  foot.append(ui.msg, ui.foot);

  modal.append(head, meta, sec, ui.view, ui.editor, foot, buildComments());
  ui.backdrop.append(modal);
  document.body.append(ui.backdrop);
  wire();
}

function setMsg(text, isError) {
  ui.msg.textContent = text || "";
  ui.msg.classList.toggle("err", !!isError);
}

async function patch(changes, okMsg) {
  try {
    st.card = await api.patchCard(st.card.id, changes);
    setMsg(okMsg || `saved ${new Date().toLocaleTimeString([], { hour12: false })}`);
    st.ctx?.onChange();
    return true;
  } catch (e) {
    setMsg(e.message, true);
    return false;
  } finally {
    paint();
  }
}

function dirty() {
  return st.editing && st.card && ui.text.value !== (st.card.body || "");
}

function setEditing(on) {
  st.editing = on;
  ui.backdrop.classList.toggle("editing", on);
  if (on) {
    ui.text.value = st.card.body || "";
    renderBody(ui.preview, ui.text.value, false);
    setTimeout(() => {
      ui.text.focus();
      ui.text.setSelectionRange(0, 0);
      ui.text.scrollTop = 0;
    }, 0);
  }
  paint();
}

// Lane <select>; the board may load after a deep-linked modal, so polls repaint it.
function paintLanes() {
  const lanes = st.ctx?.lanes() || [];
  const sig = JSON.stringify([st.card?.lane_id, lanes.map((l) => [l.id, l.name])]);
  if (!st.card || document.activeElement === ui.status || sig === ui.status.dataset.sig) return;
  ui.status.dataset.sig = sig;
  ui.status.replaceChildren(
    ...lanes.map((l) => {
      const o = el("option", "", l.name);
      o.value = l.id;
      o.selected = l.id === st.card.lane_id;
      return o;
    }),
  );
}

function paint() {
  const c = st.card;
  if (!c) return;
  ui.id.textContent = `#${c.id}`;
  if (!ui.title.dataset.editing) ui.title.textContent = c.title;
  paintLanes();
  if (document.activeElement !== ui.owner) ui.owner.value = c.owner || "";
  if (document.activeElement !== ui.opname) ui.opname.value = c.opname || "";
  ui.opname.classList.toggle("set", !!c.opname);
  ui.times.textContent =
    `created ${fmt(c.created_at)} · updated ${fmt(c.updated_at)}` +
    (c.archived_at ? ` · archived ${fmt(c.archived_at)}` : "");
  ui.archive.textContent = c.archived_at ? "Restore" : "Archive";
  ui.archive.title = c.archived_at
    ? "Put the card back on the board"
    : "Hide the card from the board (kept)";
  ui.edit.hidden = st.editing;
  ui.previewToggle.hidden = !st.editing;
  ui.view.hidden = st.editing;
  ui.editor.hidden = !st.editing;
  ui.foot.hidden = !st.editing;
  paintComments(c);
  if (!st.editing) {
    if ((c.body || "").trim()) renderBody(ui.view, c.body, true);
    else
      ui.view.replaceChildren(
        el("p", "kbd-empty", "No description yet — click ✎ Edit to add one."),
      );
  }
}

function wire() {
  let downOnBackdrop = false;
  ui.backdrop.addEventListener("mousedown", (e) => {
    downOnBackdrop = e.target === ui.backdrop;
  });
  ui.backdrop.addEventListener("click", (e) => {
    if (e.target === ui.backdrop && downOnBackdrop) requestClose();
  });
  ui.close.addEventListener("click", () => requestClose());
  ui.title.addEventListener("click", () =>
    inlineEdit(
      ui.title,
      st.card.title,
      st.busy,
      (v) => v && v !== st.card.title && patch({ title: v }),
    ),
  );
  ui.status.addEventListener("change", () => patch({ status: Number(ui.status.value) }));
  const commitOwner = () => {
    const v = ui.owner.value.trim();
    if (st.card && v !== (st.card.owner || "")) patch({ owner: v || null });
  };
  ui.owner.addEventListener("blur", commitOwner);
  ui.owner.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.owner.blur();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      ui.owner.value = st.card.owner || "";
      ui.owner.blur();
    }
  });
  const commitOp = () => {
    const v = ui.opname.value.replace(/\s+/g, " ").trim();
    if (st.card && v !== (st.card.opname || ""))
      patch({ opname: v || null }, v ? `op: ${v}` : "op cleared");
  };
  ui.opname.addEventListener("blur", commitOp);
  ui.opname.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.opname.blur();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      ui.opname.value = st.card.opname || "";
      ui.opname.blur();
    }
  });
  ui.archive.addEventListener("click", () => patch({ archived: !st.card.archived_at }));
  ui.edit.addEventListener("click", () => setEditing(true));
  ui.previewToggle.addEventListener("click", () => {
    const on = ui.editor.classList.toggle("split");
    ui.previewToggle.classList.toggle("toggled", on);
  });
  let t = null;
  ui.text.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => renderBody(ui.preview, ui.text.value, false), 120);
  });
  ui.text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ui.save.click();
    }
  });
  ui.cancel.addEventListener("click", () => {
    setEditing(false);
    setMsg("");
  });
  ui.save.addEventListener("click", async () => {
    if (await patch({ body: ui.text.value })) setEditing(false);
  });
  ui.view.addEventListener("change", (e) => {
    const cb = e.target;
    if (!cb.matches?.('input[type="checkbox"][data-task]')) return;
    const next = toggleTask(st.card.body || "", Number(cb.dataset.task), cb.checked);
    if (next !== null) patch({ body: next }, cb.checked ? "checked ✓" : "unchecked");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || ui.backdrop.hidden) return;
    if (e.target.classList?.contains("kb-inline")) return; // title edit handles its own Esc
    e.preventDefault();
    requestClose();
  });
}

export function setupDetail(ctx) {
  st.ctx = ctx;
}

// Suggestions for the Op input (every opname, archived cards included).
function loadOpnames() {
  api
    .opnames()
    .then((ops) => {
      ui.opList.replaceChildren(
        ...ops.map((o) => {
          const n = el("option");
          n.value = o.opname;
          return n;
        }),
      );
    })
    .catch(() => {});
}
export const openId = () => (ui.backdrop && !ui.backdrop.hidden ? st.id : null);

export async function openCard(id, { edit = false } = {}) {
  if (!ui.backdrop) build();
  if (openId() === id) {
    if (edit && st.card && !st.editing) setEditing(true);
    else if (edit) st.wantEdit = true;
    return;
  }
  const seq = ++st.seq;
  st.wantEdit = edit;
  st.id = id;
  st.card = null;
  st.editing = false;
  resetComments();
  ui.backdrop.classList.remove("editing");
  ui.backdrop.hidden = false;
  ui.backdrop.scrollTop = 0;
  document.body.classList.add("kbd-open");
  ui.id.textContent = `#${id}`;
  ui.title.textContent = "loading…";
  ui.view.replaceChildren();
  ui.editor.hidden = true;
  ui.foot.hidden = true;
  setMsg("");
  loadOpnames();
  try {
    const [card] = await Promise.all([api.getCard(id), loadPurify()]);
    if (seq !== st.seq) return;
    st.card = card;
    st.ctx?.onRead?.(card);
    if (st.wantEdit) setEditing(true);
    else paint();
  } catch (e) {
    if (seq !== st.seq) return;
    ui.title.textContent = `card #${id}`;
    setMsg(e.message, true);
  }
}

export function requestClose() {
  if (ui.backdrop?.hidden !== false) return;
  if (dirty() && !window.confirm("Discard unsaved changes to this card?")) return;
  closeCard();
  st.ctx?.onClose();
}

export function closeCard() {
  if (!ui.backdrop || ui.backdrop.hidden) return;
  if (document.activeElement === ui.owner) ui.owner.blur();
  if (document.activeElement === ui.opname) ui.opname.blur();
  ui.backdrop.hidden = true;
  document.body.classList.remove("kbd-open");
  st.editing = false;
  st.id = null;
  st.seq++;
}

// Called after each board poll: pull agent edits into an open, unedited card.
export function syncFromBoard(cards) {
  const id = openId();
  if (id === null || !st.card) return;
  paintLanes();
  if (st.editing || ui.title.dataset.editing) return;
  const fresh = cards.find((c) => c.id === id);
  if (fresh && fresh.updated_at !== st.card.updated_at) {
    api
      .getCard(id)
      .then((card) => {
        if (openId() === id && !st.editing) {
          st.card = card;
          st.ctx?.onRead?.(card);
          paint();
        }
      })
      .catch(() => {});
  }
}
