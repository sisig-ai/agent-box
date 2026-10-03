// Daily Brief panel: markdown canvas wired to /api/brief (autosaved per day).
import { makeNotePanel } from './note-panel.js';

makeNotePanel({
  root: 'brief', api: '/api/brief',
  editor: 'brief-editor', preview: 'brief-preview',
  dateInput: 'brief-date', dateLabel: 'brief-date-label',
  saveState: 'brief-save-state', wordcount: 'brief-wordcount',
  prev: 'brief-prev', next: 'brief-next', today: 'brief-today',
});
