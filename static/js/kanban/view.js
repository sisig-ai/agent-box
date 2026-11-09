// Ops Board: lanes, cards, filters, search, drag/drop and a 3s poll.
// Alpine component. Card behaviour is in card-actions.js, the filter menu in
// filter-bar.js, and the card modal in detail.js.

import Alpine from '../alpine.js';
import { api } from './api.js?v=movelane1';
import { cardDetail, closeCard, openCard, syncCards } from './detail.js?v=subtasks4';
import { inlineEdit } from './edit.js?v=kanban20';
import * as attention from '../attention.js?v=attention8';
import { activeOp, loadFilters, matches, saveFilters } from './filters.js';
import { cardActions } from './card-actions.js?v=movelane1';
import { filterBar } from './filter-bar.js?v=negate1';

const POLL_MS = 3000;
const GROUP_KEY = 'opsboard.group';

let instance = null;

export function boardView() {
  return {
    data: null,
    archived: null,
    archivedLoad: null,
    laneNames: {},
    filters: loadFilters(),
    group: 'lane',
    status: 'loading…',
    statusError: false,
    busy: 0,
    dragId: null,
    dragEnd: 0,
    unread: new Set(),
    attentionPending: true,
    q: '',
    hits: {},
    semantic: {},
    searchTotal: 0,
    searchNote: '',
    searchError: '',
    seq: 0,
    searchTimer: 0,
    sig: '',
    searchSig: '',
    filterStage: '',
    filterIndex: null,
    filterField: 'lane',
    filterValues: [],
    filterNegate: false,
    addLaneOpen: false,
    laneDraft: '',
    add: {},
    timer: 0,

    ...cardActions,
    ...filterBar,
    saveFilters,

    init() {
      instance = this;
      try { this.group = localStorage.getItem(GROUP_KEY) === 'owner' ? 'owner' : 'lane'; } catch { /* storage blocked */ }
      this.refresh(true).then(() => this.syncHash());
      this.timer = setInterval(() => this.poll(), POLL_MS);
      this.onVisible = () => {
        if (!document.hidden && document.body.dataset.view === 'kanban') this.enter({ soft: true });
      };
      this.onHash = () => this.syncHash();
      document.addEventListener('visibilitychange', this.onVisible);
      window.addEventListener('hashchange', this.onHash);
    },

    destroy() {
      if (instance === this) instance = null;
      clearInterval(this.timer);
      document.removeEventListener('visibilitychange', this.onVisible);
      window.removeEventListener('hashchange', this.onHash);
    },

    poll() {
      if (document.body.dataset.view !== 'kanban' || document.hidden) return;
      this.refresh();
    },

    enter(opts = {}) {
      this.attentionPending = true;
      if (!this.data) return;
      if (opts.soft && this.busy) return;
      return this.refresh(opts.soft ? undefined : true).then(() => this.runAttention());
    },

    syncHash() {
      const m = location.hash.match(/^#(?:\/kanban\/)?card-(\d+)(\/edit)?$/);
      if (!m) { closeCard(); return; }
      const id = Number(m[1]);
      const card = (this.data?.cards || []).find((c) => c.id === id);
      if (card) this.markRead(card);
      openCard(id, { edit: !!m[2] });
    },

    // ---- data ----
    async refresh(force) {
      if (this.busy && !force) return;
      try {
        const data = await api.board();
        const sig = JSON.stringify(data);
        this.data = data;
        this.laneNames = Object.fromEntries((data.lanes || []).map((lane) => [lane.id, lane.name]));
        if (force) this.archived = null;
        if (this.q) {
          await this.ensureArchived();
          await this.runSearch(this.q, true);
        } else {
          this.archived = null;
        }
        if (sig !== this.sig || this.searchSignature() !== this.searchSig || force) {
          this.sig = sig;
          this.searchSig = this.searchSignature();
          this.$nextTick(() => this.runAttention());
        }
        syncCards(this.archived ? data.cards.concat(this.archived) : data.cards);
        this.setStatus(`synced ${new Date().toLocaleTimeString([], { hour12: false })}`);
      } catch (err) {
        this.setStatus(`sync failed: ${err.message}`, true);
      }
    },

    // Archived cards are not in the board payload; fetch them once per search.
    async ensureArchived() {
      if (!this.q) { this.archived = null; return; }
      if (this.archived) return;
      if (!this.archivedLoad) {
        this.archivedLoad = api.archived()
          .then((rows) => { this.archived = rows; })
          .catch(() => { this.archived = []; })
          .finally(() => { this.archivedLoad = null; });
      }
      await this.archivedLoad;
    },

    async mutate(fn) {
      try { await fn(); } catch (err) { this.setStatus(err.message, true); }
      await this.refresh(true);
    },

    setStatus(text, isError) {
      this.status = text;
      this.statusError = !!isError;
    },

    // ---- computeds ----
    get pool() {
      const all = this.data?.cards || [];
      return this.archived ? all.concat(this.archived) : all;
    },

    get doneLane() {
      return (this.data?.lanes || []).find((lane) => lane.name.toLowerCase() === 'done') || null;
    },

    // Every card the server would move for this lane: live, top-level.
    laneLiveCards(laneId) {
      return (this.data?.cards || []).filter(
        (card) => card.lane_id === laneId && !card.archived_at && !card.parent_id,
      );
    },

    laneOf(card) {
      return card.archived_at && this.doneLane ? this.doneLane.id : card.lane_id;
    },

    get searching() {
      return this.q !== '';
    },

    filtered(cards) {
      if (!this.searching) return cards;
      return cards.filter((card) => this.hits[card.id] || this.semantic[card.id]);
    },

    get matchingCards() {
      const list = this.filtered(this.pool.filter((card) => matches(this.filters, card, (c) => this.laneOf(c))));
      return list.sort((a, b) => (a.archived_at ? 1 : 0) - (b.archived_at ? 1 : 0));
    },

    cardsFor(laneId) {
      return this.matchingCards.filter((card) => this.laneOf(card) === laneId);
    },

    get ownerColumns() {
      const byOwner = new Map();
      for (const card of this.matchingCards) {
        const key = (card.owner || '').trim();
        if (!byOwner.has(key)) byOwner.set(key, []);
        byOwner.get(key).push(card);
      }
      const named = [...byOwner.keys()].filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      return [...named, ...(byOwner.has('') ? [''] : [])]
        .map((key) => ({ key, name: key ? `@${key}` : 'unassigned', cards: byOwner.get(key) || [] }));
    },

    get countText() {
      const lanes = this.data?.lanes || [];
      const total = this.pool.length;
      const shown = this.matchingCards.length;
      const archivedCount = lanes.reduce((n, lane) => n + (lane.archived_count || 0), 0);
      const unit = this.group === 'owner' ? `${this.ownerColumns.length} owners` : `${lanes.length} lanes`;
      return `${shown === total ? total : `${shown}/${total}`} card${total === 1 ? '' : 's'} · ${unit}`
        + (archivedCount ? ` · ${archivedCount} archived` : '')
        + (this.filters.length ? ` · ${this.filters.length} filter${this.filters.length === 1 ? '' : 's'}` : '')
        + (this.searchNote ? ` · ${this.searchNote}` : '');
    },

    // ---- search ----
    onSearchInput() {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.runSearch(this.q), 180);
    },

    searchSignature() {
      return `${this.q}|${this.searchTotal}|${Object.keys(this.hits).sort().join(',')}|${Object.keys(this.semantic).sort().join(',')}|${this.searchNote}`;
    },

    async runSearch(raw, quiet = false) {
      const wanted = String(raw || '').trim();
      const seq = ++this.seq;
      if (wanted.length < 2) {
        this.q = '';
        this.hits = {};
        this.semantic = {};
        this.searchTotal = 0;
        this.searchError = '';
        this.searchNote = '';
        this.archived = null;
        return;
      }
      this.q = wanted;
      try {
        const res = await api.search(wanted, { limit: 200, archived: 'include' });
        if (seq !== this.seq) return;
        this.hits = Object.fromEntries((res.cards || []).map((row) => [row.card_id, row]));
        this.searchTotal = res.total ?? Object.keys(this.hits).length;
        this.searchError = '';
      } catch (err) {
        if (seq !== this.seq) return;
        this.hits = {};
        this.searchTotal = 0;
        this.searchError = err.message;
      }
      if (!quiet) this.searchNote = this.noteText();
      this.loadSemantic(wanted, seq);
    },

    async loadSemantic(query, seq) {
      try {
        const res = await api.semantic(query, { limit: 10, archived: 'exclude' });
        if (seq !== this.seq) return;
        this.semantic = Object.fromEntries((res.hits || []).map((hit) => [hit.id, hit]));
        this.searchNote = this.noteText();
      } catch (err) {
        if (seq !== this.seq) return;
        this.semantic = {};
        this.searchNote = this.noteText(`semantic unavailable: ${err.message}`);
      }
    },

    noteText(extra = '') {
      if (!this.q) return '';
      if (this.searchError) return `search failed: ${this.searchError}`;
      const hitCount = Object.keys(this.hits).length;
      const archived = Object.values(this.hits).filter((row) => row.archived_at).length;
      const semantic = Object.keys(this.semantic).length;
      return `search “${this.q}” · ${this.searchTotal} match${this.searchTotal === 1 ? '' : 'es'}`
        + (archived ? ` · ${archived} archived` : '')
        + (this.searchTotal > hitCount ? ` · showing ${hitCount}` : '')
        + (semantic ? ` · ${semantic} semantic` : '')
        + (extra ? ` · ${extra}` : '');
    },

    clearSearch() {
      this.q = '';
      this.hits = {};
      this.semantic = {};
      this.searchTotal = 0;
      this.searchError = '';
      this.searchNote = '';
      this.archived = null;
    },

    // ---- lanes ----
    editLaneName(event, lane) {
      inlineEdit(event.currentTarget, lane.name, this, (value) => {
        if (value && value !== lane.name) this.mutate(() => api.patchLane(lane.id, { name: value }));
      });
    },

    deleteLane(lane) {
      this.mutate(() => api.deleteLane(lane.id));
    },

    async addLane() {
      const name = this.laneDraft.trim();
      this.addLaneOpen = false;
      this.laneDraft = '';
      if (name) await this.mutate(() => api.addLane(name));
    },

    addArm(laneId) {
      return this.addState(laneId);
    },

    addState(laneId) {
      if (!this.add[laneId]) this.add[laneId] = { open: false, title: '', owner: '', opname: '' };
      return this.add[laneId];
    },

    openAdd(laneId) {
      const form = this.addState(laneId);
      form.open = true;
      form.title = '';
      form.owner = '';
      form.opname = activeOp(this.filters) || '';
      this.busy++;
      this.$nextTick(() => {
        const input = this.$el.querySelector(`.kb-add-form[data-lane-id="${laneId}"] input`);
        input?.focus();
      });
    },

    closeAdd(laneId) {
      const form = this.addState(laneId);
      if (!form.open) return;
      form.open = false;
      this.busy = Math.max(0, this.busy - 1);
    },

    async submitAdd(laneId) {
      const form = this.addState(laneId);
      const title = form.title.trim();
      if (!title) return;
      const card = { title, owner: form.owner.trim() || null, status: laneId };
      if (form.opname.trim()) card.opname = form.opname.trim();
      this.closeAdd(laneId);
      await this.mutate(() => api.addCard(card));
    },

    // ---- attention ----
    runAttention() {
      if (!this.attentionPending || !this.data) return;
      this.attentionPending = false;
      const nodes = new Map();
      this.$el.querySelectorAll('#kanban-board .kb-card[data-id]').forEach((node) => {
        nodes.set(Number(node.dataset.id), node);
      });
      const items = (this.data.cards || [])
        .filter((card) => !card.archived_at)
        .map((card) => ({ id: card.id, el: nodes.get(card.id) || null, sig: cardSignature(card), lane: card.lane_id }));
      this.unread = attention.unreadIds('kanban', items);
      const laneNames = new Map(this.data.lanes.map((lane) => [lane.id, lane.name]));
      attention.visit('kanban', items, {
        allIds: items.map((item) => item.id),
        laneName: (id) => laneNames.get(Number(id)),
        laneEl: (id) => this.$el.querySelector(`.kb-lane[data-lane-id="${id}"]`),
        keepUnread: true,
      });
    },
  };
}

function cardSignature(card) {
  return [
    card.updated_at, card.title, card.owner, card.opname, card.archived_at,
    card.comment_count || 0, card.body_preview || '',
    card.body_tasks ? `${card.body_tasks.done}/${card.body_tasks.total}` : '',
  ].join('|');
}

export function enter() {
  instance?.enter({ soft: true });
}

export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('boardView', boardView);
  Alpine.data('cardDetail', cardDetail);
  delete el._x_ignore;
  delete el._x_ignoreSelf;
  Alpine.mutateDom(() => {
    el.removeAttribute('x-ignore');
    el.setAttribute('x-data', 'boardView');
  });
  Alpine.initTree(el);
}
