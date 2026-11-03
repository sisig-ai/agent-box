// Cells: display formatting and click-to-edit for each column type.

export const cellActions = {
  display(record, column) {
    const value = record.values[column.name];
    if (value === null || value === undefined || value === '') return '';
    if (column.type === 'bool') return value ? '✓' : '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  },

  isEditing(record, column) {
    return !!this.editing && this.editing.record === record.id && this.editing.column === column.name;
  },

  canEdit(column) {
    return !column.computed;
  },

  beginEdit(record, column) {
    if (!this.canEdit(column)) return;
    if (column.type === 'bool') {
      this.setCell(record, column, !record.values[column.name]);
      return;
    }
    this.editing = { record: record.id, column: column.name };
    let value = record.values[column.name];
    if (Array.isArray(value)) value = value.join(', ');
    this.draft = value === null || value === undefined ? '' : String(value);
    this.$nextTick(() => {
      const input = this.$el.querySelector('.tbl-cell-input');
      if (input) {
        input.focus();
        if (input.select) input.select();
      }
    });
  },

  cancelEdit() {
    this.editing = null;
  },

  commitEdit(record, column) {
    if (!this.editing) return;
    const raw = this.draft;
    this.editing = null;
    let value = raw;
    if (column.type === 'number') value = raw.trim() === '' ? null : Number(raw);
    else if (column.type === 'multi_select') value = raw.split(',').map((v) => v.trim()).filter(Boolean);
    else if (column.type === 'ref') value = raw.trim() === '' ? null : Number(raw);
    else if (column.type === 'timestamp') value = raw.trim() || null;
    else value = raw.trim() === '' ? null : raw;
    this.setCell(record, column, value);
  },

  async setCell(record, column, value) {
    if (!this.table) return;
    try {
      const updated = await this.api(
        `/api/tables/${this.table.id}/records/${record.id}`,
        { method: 'PATCH', body: JSON.stringify({ values: { [column.name]: value } }) },
      );
      const index = this.records.findIndex((row) => row.id === record.id);
      if (index >= 0) this.records[index] = updated;
      this.status = `saved ${column.name}`;
      this.failed = false;
    } catch (err) {
      this.failed = true;
      this.status = `${column.name}: ${err.message}`;
    }
  },
};
