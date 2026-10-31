// Daily Sitrep panel: markdown canvas wired to /api/sitrep (autosaved per day).
import { makeNotePanel } from "./note-panel.js?v=sitrep2";

makeNotePanel({
  root: "brief",
  api: "/api/sitrep",
  editor: "brief-editor",
  preview: "brief-preview",
  dateInput: "brief-date",
  dateLabel: "brief-date-label",
  saveState: "brief-save-state",
  wordcount: "brief-wordcount",
  prev: "brief-prev",
  next: "brief-next",
  today: "brief-today",
});
