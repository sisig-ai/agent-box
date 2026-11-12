"use client";

// Filter bar for the Ops Board: chips, the two-stage add/edit menu, and the
// is/is-not toggle. Ported from static/js/kanban/filter-bar.js.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FIELDS, UPDATED_PRESETS, fieldValues, valueLabel, type Condition,
} from "@/lib/filters";
import type { Card, Lane } from "@/lib/api";

interface FilterBarProps {
  filters: Condition[];
  lanes: Lane[];
  cards: Card[];
  laneNames: Record<number, string>;
  onChange: (list: Condition[]) => void;
}

export function FilterBar({ filters, lanes, cards, laneNames, onChange }: FilterBarProps) {
  const [stage, setStage] = useState<"" | "field" | "values">("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [field, setField] = useState("lane");
  const [values, setValues] = useState<string[]>([]);
  const [negate, setNegate] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // click outside closes the menu
  useEffect(() => {
    if (!stage) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const closeMenu = () => {
    setStage("");
    setEditIndex(null);
    setValues([]);
    setNegate(false);
  };

  const openNew = () => {
    if (stage) { closeMenu(); return; }
    setStage("field");
    setEditIndex(null);
    setField("lane");
    setValues([]);
    setNegate(false);
  };

  const openEdit = (index: number) => {
    const cond = filters[index];
    setStage("values");
    setEditIndex(index);
    setField(cond.field);
    setValues([...cond.values]);
    setNegate(cond.negate);
  };

  const pickField = (id: string) => {
    setStage("values");
    setField(id);
    setValues([]);
    setNegate(false);
    setEditIndex(null);
  };

  const commit = (nextValues: string[], nextNegate: boolean) => {
    const list = filters.map((cond) => ({ ...cond, values: [...cond.values] }));
    if (editIndex == null) {
      if (!nextValues.length) return;
      list.push({ field, negate: nextNegate, values: nextValues });
    } else if (nextValues.length) {
      list[editIndex] = { field, negate: nextNegate, values: nextValues };
    } else {
      list.splice(editIndex, 1);
    }
    onChange(list);
    if (!nextValues.length) closeMenu();
  };

  const toggleValue = (value: string) => {
    const next = values.includes(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
    setValues(next);
    commit(next, negate);
  };

  const toggleNegate = () => {
    if (editIndex == null && !values.length) {
      setNegate((v) => !v);
      return;
    }
    const next = !negate;
    setNegate(next);
    commit(values, next);
  };

  const remove = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const options = useMemo(
    () => fieldValues(field, { lanes, cards }, values)
      .map(([value, label]) => ({ value, label, checked: values.includes(value) })),
    [field, lanes, cards, values],
  );

  const menuTitle = FIELDS.find((f) => f.id === field)?.label.toLowerCase() || "";

  return (
    <div className={`kb-filters${filters.length ? " active" : ""}`} ref={menuRef}>
      {filters.map((cond, index) => (
        <button
          key={`${cond.field}-${index}`}
          type="button"
          className="kb-chip"
          title="Edit this filter"
          onClick={() => openEdit(index)}
        >
          <span className="kb-chip-field">
            {FIELDS.find((f) => f.id === cond.field)?.label.toLowerCase()}
          </span>
          <span className="kb-chip-op">{cond.negate ? "is not" : "is"}</span>
          <span className="kb-chip-value">
            {cond.values.map((v) => valueLabel(cond, v, { laneNames })).join(", ")}
          </span>
          <span
            className="kb-chip-x"
            title="Remove this filter"
            onClick={(e) => { e.stopPropagation(); remove(index); }}
          >×</span>
        </button>
      ))}
      <button
        type="button"
        className="kb-filter-add"
        title="Add a filter condition; conditions must all match"
        onClick={openNew}
      >+ filter</button>
      {stage === "field" && (
        <div className="kb-fm">
          <div className="kb-fm-title">Filter by</div>
          {FIELDS.map((f) => (
            <button key={f.id} type="button" className="kb-fm-field" onClick={() => pickField(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      {stage === "values" && (
        <div className="kb-fm">
          <div className="kb-fm-head">
            <span className="kb-fm-title">{menuTitle}</span>
            <button
              type="button"
              className="kb-fm-neg"
              title='Flip between "is" and "is not"'
              onClick={toggleNegate}
            >{negate ? "is not" : "is"}</button>
          </div>
          {field !== "updated" ? (
            <div className="kb-fm-list">
              {options.map((option) => (
                <label key={option.value} className="kb-fm-opt">
                  <input
                    type="checkbox"
                    checked={option.checked}
                    onChange={() => toggleValue(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="kb-fm-list">
              {UPDATED_PRESETS.map(([id, label]) => (
                <label key={id} className="kb-fm-opt">
                  <input
                    type="radio"
                    name="kb-fm-updated"
                    checked={values[0] === id}
                    onChange={() => { setValues([id]); commit([id], negate); }}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <div className="kb-fm-date">
                <span className="kb-fm-title">on</span>
                <input
                  type="date"
                  value={(values[0] || "").startsWith("on:") ? values[0].slice(3) : ""}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const preset = `on:${e.target.value}`;
                    setValues([preset]);
                    commit([preset], negate);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
