// Card-level behaviour for the board: search decoration, opening, inline
// fields, delete, and drag/drop. Methods run with the board component as `this`.

import { api } from './api.js';
import { armDelete, inlineEdit } from './edit.js?v=kanban20';
import * as attention from '../attention.js?v=attention8';
import { markedParts } from './search.js';

const signature = (card) => [
  card.updated_at, card.title, card.owner, card.opname, card.archived_at,
  card.comment_count || 0, card.body_preview || '',
  card.body_tasks ? `${card.body_tasks.done}/${card.body_tasks.total}` : '',
].join('|');

export const cardActions = {
  cardHit(card) {
    return this.hits[card.id] || null;
  },

  cardSemantic(card) {
    return this.semantic[card.id] || null;
  },

  isSemantic(card) {
    return this.searching && !this.hits[card.id] && !!this.semantic[card.id];
  },

  titleParts(card) {
    const hit = this.hits[card.id];
    return markedParts(hit?.title_marked || card.title);
  },

  cardSnippet(card) {
    const hit = this.hits[card.id];
    if (!hit || !hit.snippet) return null;
    return { parts: markedParts(hit.snippet), comment: hit.snippet_source === 'comment' };
  },

  isUnread(card) {
    return this.unread.has(card.id);
  },

  openCard(card) {
    this.markRead(card);
    location.hash = `#/kanban/card-${card.id}`;
  },

  // A drag never opens the card: some browsers emit a click right after dragend.
  onCardClick(event, card) {
    if (this.dragId !== null || Date.now() - this.dragEnd < 350) return;
    if (event.target.closest('input, button, a, .kb-owner, .kb-opname')) return;
    this.openCard(card);
  },

  markRead(card) {
    const latest = (this.data?.cards || []).find((c) => c.id === card.id) || card;
    attention.markRead('kanban', latest.id, signature(latest), latest.lane_id);
    this.unread.delete(latest.id);
  },

  editOwner(event, card) {
    event.stopPropagation();
    inlineEdit(event.currentTarget, card.owner || '', this, (value) => {
      if (value !== (card.owner || '')) this.mutate(() => api.patchCard(card.id, { owner: value || null }));
    });
  },

  removeCard(card) {
    this.mutate(() => api.deleteCard(card.id));
  },

  armDelete(el, action) {
    armDelete(el, action);
  },

  canDrag(card) {
    return this.group !== 'owner' && !this.searching && !card.archived_at;
  },

  onDragStart(event, card) {
    this.dragId = card.id;
    this.busy++;
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(card.id));
  },

  onDragEnd(event) {
    event.currentTarget.classList.remove('dragging');
    this.busy = Math.max(0, this.busy - 1);
    this.dragId = null;
    this.dragEnd = Date.now();
  },

  onDragOver(event) {
    if (this.dragId === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('over');
  },

  onDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('over');
  },

  dropIndex(list, y) {
    const others = [...list.querySelectorAll('.kb-card:not(.dragging)')];
    const i = others.findIndex((node) => {
      const r = node.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? others.length : i;
  },

  onDrop(event, laneId) {
    event.preventDefault();
    const list = event.currentTarget;
    list.classList.remove('over');
    const id = this.dragId;
    if (id === null) return;
    const index = this.dropIndex(list, event.clientY);
    this.dragId = null;
    this.busy = Math.max(0, this.busy - 1);
    this.mutate(() => api.patchCard(id, { status: laneId, position: index }));
  },
};
