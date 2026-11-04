// Subtask actions for the card modal: add, open, delete.
// Methods only: a getter here would run at spread time, before state exists.

import { api } from './api.js?v=subtasks3';
import { openModal } from '../modal.js';

export const subtaskActions = {
    async addSubtask() {
      if (!this.card) return;
      const title = await openModal({
        title: 'new subtask',
        input: true,
        value: '',
        ok: 'Add',
      });
      if (title == null || !String(title).trim()) return;
      try {
        const sub = await api.addSubtask(this.card.id, { title: String(title).trim() });
        this.subtasks = [...this.subtasks, sub];
        this.setMsg(`subtask #${sub.id} added`);
        this.refreshBoard();
      } catch (err) {
        this.setMsg(err.message, true);
      }
    },

    openSubtask(sub) {
      location.hash = `#/kanban/card-${sub.id}`;
    },

    openParent() {
      if (this.card && this.card.parent_id) {
        location.hash = `#/kanban/card-${this.card.parent_id}`;
      }
    },

    async deleteSubtask(sub) {
      if (!this.card) return;
      const ok = await window.confirm(`Delete subtask “${sub.title}”?`);
      if (!ok) return;
      try {
        await api.deleteSubtask(this.card.id, sub.id);
        this.subtasks = this.subtasks.filter((item) => item.id !== sub.id);
        this.setMsg(`subtask #${sub.id} deleted`);
        this.refreshBoard();
      } catch (err) {
        this.setMsg(err.message, true);
      }
    }
};
