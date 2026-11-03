// Card detail modal: editable fields, docs links, markdown body and comments.
// Alpine component; the markup lives in index.html next to the board.

import Alpine from '../alpine.js';
import { api } from './api.js';
import { inlineEdit } from './edit.js?v=kanban20';
import { loadPurify, renderBody, toggleTask } from './markdown.js?v=kanban20';
import * as attention from '../attention.js?v=attention7';

const AUTHOR_KEY = 'opsboard.commentAuthor';
const PAGE = 5;

let instance = null;

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '—');

const relStamp = (iso) => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Math.round((Date.now() - t) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

function html(el, text, interactive) {
  renderBody(el, text || '', !!interactive);
  return el.innerHTML;
}

export function cardDetail() {
  return {
    open: false,
    id: null,
    card: null,
    lanes: [],
    opnames: [],
    editing: false,
    previewOn: true,
    msg: '',
    msgError: false,
    form: { title: '', owner: '', opname: '', status: '', docs: '', body: '' },
    comments: [],
    commentsShown: PAGE,
    newCommentIds: [],
    commentAuthor: 'Kix',
    commentBody: '',
    commentPreview: false,
    seq: 0,
    timer: 0,

    init() {
      instance = this;
      try { this.commentAuthor = localStorage.getItem(AUTHOR_KEY) || 'Kix'; } catch { /* storage blocked */ }
      this.timer = setInterval(() => this.sync(), 3000);
    },

    destroy() {
      instance = null;
      clearInterval(this.timer);
    },

    // ---- open / close ----
    async openCard(id, { edit = false } = {}) {
      if (this.open && this.id === id) {
        if (edit && !this.editing) this.setEditing(true);
        return;
      }
      const seq = ++this.seq;
      this.id = id;
      this.card = null;
      this.editing = false;
      this.previewOn = true;
      this.msg = '';
      this.comments = [];
      this.commentsShown = PAGE;
      this.commentBody = '';
      this.open = true;
      document.body.classList.add('kbd-open');
      this.$nextTick(() => { this.$el.scrollTop = 0; });
      this.loadOpnames();
      try {
        const [card] = await Promise.all([api.getCard(id), loadPurify()]);
        if (seq !== this.seq) return;
        this.paint(card);
        if (edit) this.setEditing(true);
        this.loadComments();
      } catch (err) {
        if (seq !== this.seq) return;
        this.msg = err.message;
        this.msgError = true;
      }
    },

    close() {
      if (!this.open) return;
      if (this.editing && this.card && this.form.body !== (this.card.body || '')
        && !window.confirm('Discard unsaved changes to this card?')) return;
      this.open = false;
      this.editing = false;
      this.id = null;
      this.seq++;
      document.body.classList.remove('kbd-open');
      if (openId() === null && /card-\d+/.test(location.hash)) history.replaceState(null, '', '#/kanban');
    },

    closeFromBackdrop(event) {
      if (event.target === this.$refs.backdrop) this.close();
    },

    setMsg(text, isError) {
      this.msg = text || '';
      this.msgError = !!isError;
    },

    paint(card) {
      this.card = card;
      this.form = {
        title: card.title,
        owner: card.owner || '',
        opname: card.opname || '',
        status: String(card.lane_id),
        docs: (card.docs || []).join(', '),
        body: card.body || '',
      };
      this.lanes = this.currentLanes();
      if (!this.editing) this.markRead(card);
    },

    markRead(card) {
      const sig = [card.updated_at, card.title, card.owner, card.opname, card.archived_at,
        card.comment_count || 0, card.body_preview || '',
        card.body_tasks ? `${card.body_tasks.done}/${card.body_tasks.total}` : ''].join('|');
      attention.markRead('kanban', card.id, sig, card.lane_id);
    },

    currentLanes() {
      const view = document.getElementById('kanban-view')?._x_dataStack?.[0];
      return view?.data?.lanes || this.lanes || [];
    },

    loadOpnames() {
      api.opnames().then((ops) => { this.opnames = ops || []; }).catch(() => {});
    },

    // ---- fields ----
    async patch(changes, okMsg) {
      try {
        const card = await api.patchCard(this.card.id, changes);
        this.paint(card);
        this.setMsg(okMsg || `saved ${new Date().toLocaleTimeString([], { hour12: false })}`);
        this.refreshBoard();
        return true;
      } catch (err) {
        this.setMsg(err.message, true);
        return false;
      }
    },

    refreshBoard() {
      const view = document.getElementById('kanban-view')?._x_dataStack?.[0];
      view?.refresh(true);
    },

    editTitle(event) {
      event.stopPropagation();
      inlineEdit(event.currentTarget, this.card.title, this, (value) => {
        if (value && value !== this.card.title) this.patch({ title: value });
      });
    },

    commitOwner() {
      const value = this.form.owner.trim();
      if (this.card && value !== (this.card.owner || '')) this.patch({ owner: value || null });
    },

    commitOpname() {
      const value = this.form.opname.replace(/\s+/g, ' ').trim();
      if (this.card && value !== (this.card.opname || '')) {
        this.patch({ opname: value || null }, value ? `op: ${value}` : 'op cleared');
      }
    },

    commitStatus() {
      this.patch({ status: Number(this.form.status) });
    },

    commitDocs() {
      const refs = this.form.docs.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
      this.patch({ docs: refs }, refs.length ? `linked ${refs.length} doc(s)` : 'doc links cleared');
    },

    toggleArchive() {
      this.patch({ archived: !this.card.archived_at });
    },

    setEditing(on) {
      this.editing = on;
      if (on) {
        this.form.body = this.card.body || '';
        this.$nextTick(() => {
          this.$refs.body?.focus();
          this.$refs.body?.setSelectionRange(0, 0);
        });
      }
    },

    async saveBody() {
      if (await this.patch({ body: this.form.body })) this.setEditing(false);
    },

    get dirty() {
      return this.editing && this.card && this.form.body !== (this.card.body || '');
    },

    // ---- markdown ----
    get bodyHtml() {
      if (!this.card || !(this.card.body || '').trim()) return '';
      const box = document.createElement('div');
      return html(box, this.card.body, true);
    },

    get previewHtml() {
      if (!this.form.body.trim()) return '';
      const box = document.createElement('div');
      return html(box, this.form.body, false);
    },

    onBodyTask(event) {
      const cb = event.target;
      if (!cb.matches?.('input[type="checkbox"][data-task]')) return;
      const next = toggleTask(this.card.body || '', Number(cb.dataset.task), cb.checked);
      if (next !== null) this.patch({ body: next }, cb.checked ? 'checked ✓' : 'unchecked');
    },

    // ---- comments ----
    loadComments() {
      if (this.id === null) return;
      api.comments(this.id).then((list) => {
        this.newCommentIds = attention.newComments('kanban', this.id, list).map(Number);
        this.comments = list.slice().sort((a, b) => {
          const ta = new Date(a.created_at).getTime() || 0;
          const tb = new Date(b.created_at).getTime() || 0;
          return tb - ta || b.id - a.id;
        });
        this.commentsShown = Math.min(PAGE, this.comments.length);
      }).catch((err) => this.setMsg(err.message, true));
    },

    get visibleComments() {
      return this.comments.slice(0, this.commentsShown);
    },

    get moreComments() {
      return Math.max(0, this.comments.length - this.commentsShown);
    },

    growComments() {
      this.commentsShown = Math.min(this.comments.length, this.commentsShown + PAGE);
    },

    commentHtml(comment) {
      const box = document.createElement('div');
      return html(box, comment.body, false);
    },

    rel(iso) { return relStamp(iso); },
    full(iso) { return fmt(iso); },

    async postComment() {
      const body = this.commentBody.trim();
      const author = this.commentAuthor.trim();
      if (!body || !author) { this.setMsg('author and comment required', true); return; }
      try {
        await api.addComment(this.id, { author, body });
        localStorage.setItem(AUTHOR_KEY, author);
        this.commentBody = '';
        this.commentPreview = false;
        this.setMsg('');
        this.loadComments();
        this.refreshBoard();
      } catch (err) {
        this.setMsg(err.message, true);
      }
    },

    async deleteComment(comment, button) {
      if (!button.classList.contains('armed')) {
        button.classList.add('armed');
        setTimeout(() => button.classList.remove('armed'), 2500);
        return;
      }
      try {
        await api.deleteComment(this.id, comment.id);
        this.loadComments();
      } catch (err) {
        this.setMsg(err.message, true);
      }
    },

    get commentPreviewHtml() {
      if (!this.commentBody.trim()) return '';
      const box = document.createElement('div');
      return html(box, this.commentBody, false);
    },

    // ---- board sync ----
    sync() {
      if (!this.open || this.id === null || !this.card || this.editing) return;
      const view = document.getElementById('kanban-view')?._x_dataStack?.[0];
      const fresh = (view?.data?.cards || []).find((c) => c.id === this.id);
      if (fresh && fresh.updated_at !== this.card.updated_at) {
        const id = this.id;
        api.getCard(id).then((card) => {
          if (this.id === id && !this.editing) this.paint(card);
        }).catch(() => {});
      }
    },

    onEscape(event) {
      if (event.key !== 'Escape' || !this.open) return;
      if (event.target.classList?.contains('kb-inline')) return;
      event.preventDefault();
      this.close();
    },

    fmt,
  };
}

export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('cardDetail', cardDetail);
  Alpine.mutateDom(() => { el.setAttribute('x-data', 'cardDetail'); });
  Alpine.initTree(el);
}

export const openId = () => (instance?.open ? instance.id : null);

export function openCard(id, opts = {}) {
  instance?.openCard(id, opts);
}

export function closeCard() {
  if (instance?.open) instance.close();
}

// Called after each board poll: refresh the lanes and let the modal re-read.
export function syncCards(cards) {
  if (!instance?.open) return;
  instance.lanes = instance.currentLanes();
  void cards;
}
