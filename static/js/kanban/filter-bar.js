// Filter bar behaviour for the board component: the chip list, the two-stage
// menu, and the op-chip shortcut. Pure state edits only; filters.js holds the
// matching rules and the labels.

import {
  FIELDS, UPDATED_PRESETS, fieldValues, hasOp, setOpFilter, valueLabel,
} from './filters.js';

export const filterBar = {
  setFilters(list) {
    this.filters = list;
    this.saveFilters(list);
  },

  filterValueOptions() {
    return fieldValues(this.filterField, { lanes: this.data?.lanes || [], cards: this.pool }, this.filterValues)
      .map(([value, label]) => ({ value, label, checked: this.filterValues.includes(value) }));
  },

  openFilterMenu(index = null) {
    if (index === null) {
      this.filterStage = 'field';
      this.filterIndex = null;
      this.filterField = 'lane';
      this.filterValues = [];
      this.filterNegate = false;
      return;
    }
    const cond = this.filters[index];
    this.filterStage = 'values';
    this.filterIndex = index;
    this.filterField = cond.field;
    this.filterValues = [...cond.values];
    this.filterNegate = cond.negate;
  },

  pickFilterField(field) {
    this.filterStage = 'values';
    this.filterField = field;
    this.filterValues = [];
    this.filterNegate = false;
    this.filterIndex = null;
  },

  commitFilter(values = this.filterValues, negate = this.filterNegate) {
    const list = this.filters.map((cond) => ({ ...cond, values: [...cond.values] }));
    if (this.filterIndex == null) {
      if (!values.length) return;
      list.push({ field: this.filterField, negate, values });
      this.filterIndex = list.length - 1;
    } else if (values.length) {
      list[this.filterIndex] = { field: this.filterField, negate, values };
    } else {
      list.splice(this.filterIndex, 1);
      this.filterIndex = null;
    }
    this.filterValues = values;
    this.filterNegate = negate;
    this.setFilters(list);
  },

  toggleFilterValue(value) {
    const values = this.filterValues.includes(value)
      ? this.filterValues.filter((v) => v !== value)
      : [...this.filterValues, value];
    this.commitFilter(values, this.filterNegate);
  },

  toggleFilterNegate() {
    if (this.filterIndex == null && !this.filterValues.length) {
      this.filterNegate = !this.filterNegate;
      return;
    }
    this.commitFilter(this.filterValues, !this.filterNegate);
  },

  removeFilter(index) {
    this.setFilters(this.filters.filter((_, i) => i !== index));
    this.filterStage = '';
  },

  closeFilterMenu() {
    this.filterStage = '';
  },

  setOp(opname) {
    this.setFilters(setOpFilter(this.filters, opname));
  },

  isOpActive(opname) {
    return hasOp(this.filters, opname);
  },

  filterMenuTitle() {
    return FIELDS.find((f) => f.id === this.filterField)?.label.toLowerCase() || '';
  },

  fieldLabel(field) {
    return FIELDS.find((f) => f.id === field)?.label || field;
  },

  chipValue(cond) {
    return cond.values.map((v) => valueLabel(cond, v, { laneNames: this.laneNames })).join(', ');
  },

  presetLabel(value) {
    return UPDATED_PRESETS.find(([id]) => id === value)?.[1] || value;
  },

  setUpdatedPreset(value) {
    this.commitFilter([value], this.filterNegate);
  },
};
