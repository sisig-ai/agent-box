"use client";

// Card detail modal: editable fields, docs links, markdown body and comments.
// Ported from static/js/kanban/detail.js + subtasks.js.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  opsboardApi, type Card, type Comment, type Lane, type Opname, type Subtask,
} from "@/lib/api";
import { renderMarkdown, toggleTask } from "@/lib/markdown";
import { cardSignature, markRead, newComments } from "@/lib/attention";
import { relStamp, fmtTime } from "@/lib/format";
import { useModal } from "@/components/modal-provider";
import { DashboardButton } from "@/components/block/dashboard-shell";

const AUTHOR_KEY = "opsboard.commentAuthor";
const PAGE = 5;

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString([], {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}) : "—");

interface CardModalProps {
  cardId: number;
  lanes: Lane[];
  boardCards: Card[];
  opnames: Opname[];
  onClose: () => void;
  onRefresh: () => void;
  onOpenCard: (id: number) => void;
  onDocClick: (prefix: string) => void;
}

export function CardModal(props: CardModalProps) {
  const { cardId, lanes, boardCards } = props;
  const [card, setCard] = useState<Card | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [previewOn, setPreviewOn] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgError, setMsgError] = useState(false);
  const [form, setForm] = useState({ title: "", owner: "", opname: "", status: "", docs: "", body: "" });
  const [titleEditing, setTitleEditing] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsShown, setCommentsShown] = useState(PAGE);
  const [newCommentIds, setNewCommentIds] = useState<number[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("Kix");
  const [commentPreview, setCommentPreview] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const openModal = useModal();

  const setMsgState = useCallback((text: string, isError = false) => {
    setMsg(text);
    setMsgError(isError);
  }, []);

  /* ---- load ---- */

  const paint = useCallback((fresh: Card) => {
    setCard(fresh);
    setSubtasks(fresh.subtasks || subtasks);
    setForm({
      title: fresh.title,
      owner: fresh.owner || "",
      opname: fresh.opname || "",
      status: String(fresh.lane_id),
      docs: (fresh.docs || []).join(", "),
      body: fresh.body || "",
    });
  }, [subtasks]);

  useEffect(() => {
    let cancelled = false;
    const seq = ++seqRef.current;
    setCard(null);
    setEditing(false);
    setMsgState("");
    setComments([]);
    setCommentsShown(PAGE);
    setCommentBody("");
    try { setCommentAuthor(localStorage.getItem(AUTHOR_KEY) || "Kix"); } catch { /* storage blocked */ }
    (async () => {
      try {
        const fresh = await opsboardApi.getCard(cardId);
        if (cancelled || seq !== seqRef.current) return;
        paint(fresh);
        markRead("kanban", fresh.id, cardSignature(fresh as unknown as Record<string, unknown>), fresh.lane_id);
        // comments
        try {
          const list = await opsboardApi.comments(cardId);
          if (cancelled || seq !== seqRef.current) return;
          setNewCommentIds(newComments("kanban", cardId, list).map(Number));
          const sorted = list.slice().sort((a, b) => {
            const ta = new Date(a.created_at).getTime() || 0;
            const tb = new Date(b.created_at).getTime() || 0;
            return tb - ta || b.id - a.id;
          });
          setComments(sorted);
          setCommentsShown(Math.min(PAGE, sorted.length));
        } catch { /* comments optional */ }
      } catch (err) {
        if (!cancelled) setMsgState((err as Error).message, true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const seqRef = useRef(0);

  /* ---- live sync: board poll delivers a newer updated_at → repaint ---- */

  const boardCopy = useMemo(() => boardCards, [boardCards]);
  useEffect(() => {
    if (!card || editing) return;
    const fresh = boardCopy.find((c) => c.id === card.id);
    if (fresh && fresh.updated_at !== card.updated_at) {
      const id = card.id;
      opsboardApi.getCard(id).then((latest) => {
        if (latest.id === id) paint(latest);
      }).catch(() => {});
    }
  }, [boardCopy, card, editing, paint]);

  /* ---- patch helper ---- */

  const patch = useCallback(async (changes: Record<string, unknown>, okMsg?: string) => {
    if (!card) return false;
    try {
      const updated = await opsboardApi.patchCard(card.id, changes as Partial<Card>);
      paint(updated);
      setMsgState(okMsg || `saved ${new Date().toLocaleTimeString([], { hour12: false })}`);
      props.onRefresh();
      return true;
    } catch (err) {
      setMsgState((err as Error).message, true);
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, paint, props.onRefresh]);

  /* ---- close ---- */

  const close = useCallback(async () => {
    if (editing && card && form.body !== (card.body || "")) {
      const ok = await openModal({
        title: "Discard unsaved changes to this card?",
        ok: "Discard",
        danger: true,
      });
      if (!ok) return;
    }
    seqRef.current++;
    props.onClose();
  }, [editing, card, form.body, openModal, props]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(document.activeElement as HTMLElement)?.closest?.(".kbd-modal")) {
        // handled by the input-level Esc; only close when focus is not in the modal
      }
      if (e.key === "Escape" && !((document.activeElement as HTMLElement)?.closest?.(".kbd-modal, input, textarea, select"))) {
        e.preventDefault();
        void close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /* ---- body ---- */

  const bodyHtml = useMemo(() => {
    if (!card || !(card.body || "").trim()) return "";
    return renderMarkdown(card.body);
  }, [card]);

  const previewHtml = useMemo(() => {
    if (!form.body.trim()) return "";
    return renderMarkdown(form.body);
  }, [form.body]);

  const setEditingOn = useCallback((on: boolean) => {
    setEditing(on);
    if (on) {
      setForm((f) => ({ ...f, body: card?.body || "" }));
      setTimeout(() => {
        bodyRef.current?.focus();
        bodyRef.current?.setSelectionRange(0, 0);
      }, 0);
    }
  }, [card]);

  const saveBody = useCallback(async () => {
    if (await patch({ body: form.body })) setEditing(false);
  }, [patch, form.body]);

  const onBodyTask = useCallback((e: React.ChangeEvent<HTMLDivElement>) => {
    const cb = e.target as HTMLInputElement;
    if (!cb.matches?.('input[type="checkbox"][data-task]')) return;
    if (!card) return;
    const next = toggleTask(card.body || "", Number(cb.dataset.task), cb.checked);
    if (next !== null) void patch({ body: next }, cb.checked ? "checked ✓" : "unchecked");
  }, [card, patch]);

  /* ---- comments ---- */

  const visibleComments = comments.slice(0, commentsShown);
  const moreComments = Math.max(0, comments.length - commentsShown);

  const postComment = useCallback(async () => {
    const body = commentBody.trim();
    const author = commentAuthor.trim();
    if (!body || !author) { setMsgState("author and comment required", true); return; }
    try {
      await opsboardApi.addComment(cardId, { author, body });
      try { localStorage.setItem(AUTHOR_KEY, author); } catch { /* storage blocked */ }
      setCommentBody("");
      setCommentPreview(false);
      setMsgState("");
      const list = await opsboardApi.comments(cardId);
      setNewCommentIds(newComments("kanban", cardId, list).map(Number));
      const sorted = list.slice().sort((a, b) => {
        const ta = new Date(a.created_at).getTime() || 0;
        const tb = new Date(b.created_at).getTime() || 0;
        return tb - ta || b.id - a.id;
      });
      setComments(sorted);
      props.onRefresh();
    } catch (err) {
      setMsgState((err as Error).message, true);
    }
  }, [commentBody, commentAuthor, cardId, props, setMsgState]);

  const commentHtml = useCallback((body: string) => renderMarkdown(body), []);

  /* ---- subtasks ---- */

  const addSubtask = useCallback(async () => {
    const title = await openModal({
      title: "new subtask",
      input: true,
      value: "",
      ok: "Add",
    });
    if (title == null || !String(title).trim()) return;
    try {
      const sub = await opsboardApi.addSubtask(cardId, { title: String(title).trim() });
      setSubtasks((prev) => [...prev, sub]);
      setMsgState(`subtask #${sub.id} added`);
      props.onRefresh();
    } catch (err) {
      setMsgState((err as Error).message, true);
    }
  }, [openModal, cardId, props, setMsgState]);

  const deleteSubtask = useCallback(async (sub: Subtask) => {
    const ok = await openModal({
      title: `Delete subtask “${sub.title}”?`,
      ok: "delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await opsboardApi.deleteSubtask(cardId, sub.id);
      setSubtasks((prev) => prev.filter((item) => item.id !== sub.id));
      setMsgState(`subtask #${sub.id} deleted`);
      props.onRefresh();
    } catch (err) {
      setMsgState((err as Error).message, true);
    }
  }, [openModal, cardId, props, setMsgState]);

  /* ---- two-click comment delete ---- */

  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [armedComment, setArmedComment] = useState<number | null>(null);
  const onDeleteComment = useCallback((comment: Comment) => {
    if (armedComment === comment.id) {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      setArmedComment(null);
      opsboardApi.deleteComment(cardId, comment.id)
        .then(async () => {
          const list = await opsboardApi.comments(cardId);
          const sorted = list.slice().sort((a, b) => {
            const ta = new Date(a.created_at).getTime() || 0;
            const tb = new Date(b.created_at).getTime() || 0;
            return tb - ta || b.id - a.id;
          });
          setComments(sorted);
          setCommentsShown((s) => Math.min(s, sorted.length));
          props.onRefresh();
        })
        .catch((err) => setMsgState((err as Error).message, true));
      return;
    }
    setArmedComment(comment.id);
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = setTimeout(() => setArmedComment(null), 2500);
  }, [armedComment, cardId, props, setMsgState]);

  /* ---- docs commit ---- */

  const commitDocs = useCallback(() => {
    const refs = form.docs.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
    void patch({ docs: refs }, refs.length ? `linked ${refs.length} doc(s)` : "doc links cleared");
  }, [form.docs, patch]);

  const dirty = editing && card && form.body !== (card.body || "");

  if (loadError) return null;

  return (
    <div
      className={`kbd-backdrop open`}
      ref={modalRef}
      onClick={(e) => { if (e.target === e.currentTarget) void close(); }}
    >
      <div
        className="kbd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kbd-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kbd-head">
          <span className="kbd-id">#{cardId}</span>
          {titleEditing ? (
            <input
              className="kbd-title-input"
              value={form.title}
              maxLength={500}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setTitleEditing(false);
                  if (form.title.trim() && form.title !== card?.title) void patch({ title: form.title.trim() });
                }
                if (e.key === "Escape") { setTitleEditing(false); setForm((f) => ({ ...f, title: card?.title || "" })); }
              }}
              onBlur={() => {
                setTitleEditing(false);
                if (form.title.trim() && form.title !== card?.title) void patch({ title: form.title.trim() });
              }}
            />
          ) : (
            <h3
              className="kbd-title"
              id="kbd-title"
              title="Click to edit the title"
              onClick={() => setTitleEditing(true)}
            >
              {card?.title || "loading…"}
            </h3>
          )}
          <button type="button" className="kb-icon kbd-close" title="Close (Esc)" onClick={() => void close()}>×</button>
        </div>
        <div className="kbd-meta">
          <label className="kbd-field">
            Lane
            <select
              className="kbd-status"
              value={form.status}
              onChange={(e) => {
                setForm({ ...form, status: e.target.value });
                void patch({ status: e.target.value });
              }}
            >
              {lanes.map((lane) => <option key={lane.id} value={String(lane.id)}>{lane.name}</option>)}
            </select>
          </label>
          <label className="kbd-field">
            Owner
            <input
              className="kbd-owner"
              value={form.owner}
              maxLength={100}
              placeholder="unassigned"
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
              onBlur={() => {
                const value = form.owner.trim();
                if (card && value !== (card.owner || "")) void patch({ owner: value || null });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
          </label>
          <label className="kbd-field kbd-op-field">
            Op
            <input
              className="kbd-opname"
              list="kbd-opname-list"
              value={form.opname}
              maxLength={100}
              placeholder="no operation"
              onChange={(e) => setForm({ ...form, opname: e.target.value })}
              onBlur={() => {
                const value = form.opname.replace(/\s+/g, " ").trim();
                if (card && value !== (card.opname || "")) {
                  void patch({ opname: value || null }, value ? `op: ${value}` : "op cleared");
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
            <datalist id="kbd-opname-list">
              {props.opnames.map((op) => <option key={op.opname} value={op.opname} />)}
            </datalist>
          </label>
          <span className="kbd-times">
            {card ? `created ${fmt(card.created_at)} · updated ${fmt(card.updated_at)}${card.archived_at ? ` · archived ${fmt(card.archived_at)}` : ""}` : ""}
          </span>
          <button
            type="button"
            className="kb-archive-btn kbd-archive"
            onClick={() => void patch({ archived: !card?.archived_at } as Record<string, unknown>)}
          >
            {card?.archived_at ? "Restore" : "Archive"}
          </button>
        </div>
        <div className="kbd-docs">
          <span className="kbd-section-label">Docs</span>
          <div className="kbd-doc-list">
            {(card?.docs || []).map((prefix) => (
              <a
                key={prefix}
                className="kbd-doc"
                href={`#/docs/${prefix}`}
                title={`Open ${prefix}`}
                onClick={(e) => {
                  e.preventDefault();
                  props.onDocClick(prefix);
                }}
              >{prefix}</a>
            ))}
            {!(card?.docs || []).length && <span className="kbd-doc none">no docs linked</span>}
          </div>
          <input
            className="kbd-doc-input"
            value={form.docs}
            placeholder="doc prefixes, comma separated"
            title="Docs this card points at: handoffs/x.md, specs/y.md (blank clears)"
            onChange={(e) => setForm({ ...form, docs: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
            onBlur={commitDocs}
          />
        </div>
        <div className="kbd-section">
          <span className="kbd-section-label">Description</span>
          {editing ? (
            <>
              <button
                type="button"
                className={`kbd-preview-toggle${previewOn ? " toggled" : ""}`}
                title="Show/hide the live preview"
                onClick={() => setPreviewOn((v) => !v)}
              >Preview</button>
              <button
                type="button"
                className="kbd-save-btn"
                title="Save (⌘/Ctrl+Enter)"
                onClick={() => void saveBody()}
              >Save</button>
              <button
                type="button"
                className="kbd-cancel-btn"
                onClick={() => { setEditing(false); setMsgState(""); }}
              >Cancel</button>
            </>
          ) : (
            <button type="button" className="kbd-edit-btn" onClick={() => setEditingOn(true)}>✎ Edit</button>
          )}
        </div>
        {!editing && (
          <div
            className="kbd-view kbd-md"
            onChange={onBodyTask}
            dangerouslySetInnerHTML={{
              __html: enableTasks(bodyHtml),
            }}
          />
        )}
        {editing && (
          <div className={`kbd-editor${previewOn ? " split" : ""}`}>
            <textarea
              ref={bodyRef}
              className="kbd-text"
              spellCheck={false}
              value={form.body}
              placeholder="Markdown: ## Goal, - [ ] tasks, fenced code, | tables |, [links](https://…)"
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void saveBody(); }
              }}
            />
            {previewOn && (
              <div className="kbd-preview kbd-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </div>
        )}
        {dirty && <div className="kbd-dirty-hint">unsaved</div>}
        {card && card.parent_id != null && (
          <div className="kbd-section">
            <button
              type="button"
              className="kbd-parent-link"
              onClick={() => props.onOpenCard(card.parent_id!)}
            >↳ subtask of #{card.parent_id}</button>
          </div>
        )}
        <div className="kbd-section kbd-subtask-head">
          <span className="kbd-section-label">{subtasks.length ? `Subtasks (${subtasks.length})` : "Subtasks"}</span>
          <button type="button" className="kbd-add-subtask" title="Add a subtask under this card" onClick={() => void addSubtask()}>+ subtask</button>
        </div>
        <div className="kbd-subtasks">
          {subtasks.map((sub) => (
            <div key={sub.id} className="kbd-subtask">
              <button type="button" className="kbd-subtask-title" title="Open this subtask" onClick={() => props.onOpenCard(sub.id)}>
                {sub.title}
              </button>
              <span className="kbd-subtask-meta">
                <span className="kbd-subtask-lane">{sub.status}</span>
                {!!sub.comment_count && <span>c:{sub.comment_count}</span>}
                {(sub.docs || []).length > 0 && <span>docs:{sub.docs.length}</span>}
              </span>
              <button type="button" className="kb-icon danger kbd-subtask-del" title="Delete this subtask" onClick={() => void deleteSubtask(sub)}>×</button>
            </div>
          ))}
          {!subtasks.length && <p className="kbd-empty">No subtasks yet.</p>}
        </div>
        <div className="kbd-foot">
          <span className={`kbd-msg${msgError ? " err" : ""}`}>{msg}</span>
        </div>
        <div className="kbc-wrap">
          <div className="kbd-section">
            <span className="kbd-section-label">{comments.length ? `Comments (${comments.length})` : "Comments"}</span>
          </div>
          <div className="kbc-list">
            {!comments.length && <p className="kbd-empty">No comments yet.</p>}
            {visibleComments.map((comment) => (
              <div key={comment.id} className={`kbc-item${newCommentIds.includes(comment.id) ? " is-new" : ""}`}>
                <div className="kbc-meta">
                  <span className="kbc-author-name">{comment.author}</span>
                  <span className="kbc-time" title={fmt(comment.created_at)}>{relStamp(comment.created_at)}</span>
                  <button
                    type="button"
                    className={`kb-icon kbc-del${armedComment === comment.id ? " armed" : ""}`}
                    title="Delete comment (click twice)"
                    onClick={() => onDeleteComment(comment)}
                  >×</button>
                </div>
                <div className="kbc-body kbd-md" dangerouslySetInnerHTML={{ __html: commentHtml(comment.body) }} />
              </div>
            ))}
            {moreComments > 0 && (
              <button
                type="button"
                className="kbc-more"
                title="Show the next 5 older comments"
                onClick={() => setCommentsShown((s) => Math.min(comments.length, s + PAGE))}
              >Load More ({moreComments})</button>
            )}
          </div>
          <div className="kbc-form">
            {!commentPreview ? (
              <textarea
                className="kbc-text"
                value={commentBody}
                placeholder="Add a comment (markdown) — ⌘/Ctrl+Enter to post"
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void postComment(); }
                }}
              />
            ) : (
              <div className="kbc-preview kbd-md" dangerouslySetInnerHTML={{ __html: commentHtml(commentBody) }} />
            )}
            <div className="kbc-row">
              <input
                className="kbc-author"
                value={commentAuthor}
                placeholder="author"
                maxLength={100}
                onChange={(e) => setCommentAuthor(e.target.value)}
              />
              <button
                type="button"
                className={`kbc-preview-btn${commentPreview ? " toggled" : ""}`}
                title="Preview this comment as rendered markdown"
                onClick={() => setCommentPreview((v) => !v)}
              >{commentPreview ? "write" : "preview"}</button>
              <button type="button" className="kbc-post" onClick={() => void postComment()}>Comment</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Enable task checkboxes in rendered card bodies: strip marked's `disabled`
// and number each checkbox so clicks can find their markdown line.
function enableTasks(html: string): string {
  let i = 0;
  return html.replace(/<input([^>]*?)type="checkbox"([^>]*?)>/g, (_m, before: string, after: string) => {
    const attrs = `${before}${after}`
      .replace(/\sdisabled(="")?/g, "")
      .replace(/\schecked(="")?/g, ' checked=""');
    return `<input${attrs} type="checkbox" data-task="${i++}">`;
  });
}
