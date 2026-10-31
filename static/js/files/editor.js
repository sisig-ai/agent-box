// Files inline editor: lazy CodeMirror load, open/save/close/download.
import { $ } from '../dom.js';
import { state, setStatus } from './render.js';
import { openModal } from '../modal.js';

const CM_VERSION = '5.65.16';
const CM_BASE = '/static/vendor/codemirror';
const CM_MODES = [
  'markdown', 'javascript', 'python', 'shell', 'xml', 'css', 'yaml', 'sql',
  'clike', 'toml', 'dockerfile', 'properties', 'go', 'rust', 'diff',
];

const MODE_BY_NAME = { dockerfile: 'dockerfile' };
const MODE_BY_EXT = {
  md: 'markdown', markdown: 'markdown',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: { name: 'javascript', typescript: true }, tsx: { name: 'javascript', typescript: true },
  json: { name: 'javascript', json: true },
  py: 'python', pyw: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', plist: 'xml',
  css: 'css', scss: 'css', less: 'css',
  yml: 'yaml', yaml: 'yaml',
  sql: 'sql',
  c: 'clike', h: 'clike', cc: 'clike', cpp: 'clike', cxx: 'clike', hpp: 'clike', java: 'clike',
  toml: 'toml',
  ini: 'properties', conf: 'properties', cfg: 'properties', env: 'properties', properties: 'properties',
  go: 'go',
  rs: 'rust',
  diff: 'diff', patch: 'diff',
};

const panel = $('files-editor');
const host = $('files-editor-host');
const nameEl = $('files-editor-name');
const dirtyEl = $('files-editor-dirty');
const editorStatusEl = $('files-editor-status');
const breadcrumbEl = $('files-breadcrumb');
const listWrapEl = $('files-list-wrap');
const infoEl = document.querySelector('.files-info');

let cmLoad = null;

function asset(path) {
  return CM_BASE + '/' + path + '?v=' + CM_VERSION;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

function loadStyle(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error('failed to load ' + href));
    document.head.appendChild(link);
  });
}

function loadCodemirror() {
  if (cmLoad) return cmLoad;
  const core = window.CodeMirror
    ? Promise.resolve()
    : loadScript(asset('codemirror.min.js'))
        .then(() => loadScript(asset('addon/mode/simple.min.js')))
        .then(() => Promise.all(CM_MODES.map(m => loadScript(asset('mode/' + m + '.min.js')))));
  cmLoad = loadStyle(asset('codemirror.min.css')).then(() => core);
  return cmLoad;
}

export function modeFor(name) {
  const n = String(name || '').toLowerCase();
  if (MODE_BY_NAME[n]) return MODE_BY_NAME[n];
  const ext = n.includes('.') ? n.split('.').pop() : '';
  return MODE_BY_EXT[ext] || null;
}

export function editorIsOpen() {
  return !!state.editor;
}

function setDirty(on) {
  state.editor.dirty = on;
  dirtyEl.hidden = !on;
}

export async function openEditor(path, name, text) {
  try {
    await loadCodemirror();
  } catch (err) {
    setStatus('editor failed to load — ' + err.message, true);
    return false;
  }
  state.editor = { path, name, cm: null, orig: text, dirty: false };
  nameEl.textContent = name;
  nameEl.title = path;
  editorStatusEl.textContent = path;
  dirtyEl.hidden = true;
  breadcrumbEl.hidden = true;
  listWrapEl.hidden = true;
  if (infoEl) infoEl.hidden = true;
  panel.hidden = false;
  host.innerHTML = '';
  const cm = window.CodeMirror(host, {
    value: text,
    mode: modeFor(name),
    theme: 'agent-box',
    lineNumbers: true,
    lineWrapping: false,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    viewportMargin: 20,
    extraKeys: {
      'Cmd-S': save,
      'Ctrl-S': save,
      Esc: closeEditor,
      Tab: (c) => c.replaceSelection('  ', 'end'),
    },
  });
  state.editor.cm = cm;
  cm.on('change', () => setDirty(cm.getValue() !== state.editor.orig));
  setStatus('editing ' + name);
  cm.focus();
  return true;
}

export async function save() {
  if (!state.editor) return;
  const cm = state.editor.cm;
  const content = cm.getValue();
  editorStatusEl.textContent = 'saving…';
  let res;
  try {
    res = await fetch('/api/fs/write', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.editor.path, content }),
    });
  } catch (err) {
    editorStatusEl.textContent = 'save failed — network error';
    setStatus('save failed — network error', true);
    return;
  }
  if (!state.editor || state.editor.cm !== cm) return;
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = d.error || ('save failed (' + res.status + ')');
    editorStatusEl.textContent = msg;
    setStatus(msg, true);
    return;
  }
  state.editor.orig = content;
  setDirty(cm.getValue() !== content);
  editorStatusEl.textContent = 'saved ' + state.editor.name;
  setStatus('saved ' + state.editor.name);
}

export async function closeEditor() {
  if (!state.editor) return true;
  if (state.editor.dirty) {
    const ok = await openModal({
      title: 'Discard changes?',
      text: '“' + state.editor.name + '” has unsaved changes.',
      ok: 'Discard', danger: true,
    });
    if (!ok) return false;
  }
  const cm = state.editor.cm;
  if (cm) cm.getWrapperElement().remove();
  state.editor = null;
  host.innerHTML = '';
  panel.hidden = true;
  breadcrumbEl.hidden = false;
  listWrapEl.hidden = false;
  if (infoEl) infoEl.hidden = false;
  setStatus('editor closed');
  return true;
}

export function downloadCurrent() {
  if (!state.editor) return;
  const cm = state.editor.cm;
  const blob = new Blob([cm.getValue()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.editor.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$('files-editor-save').addEventListener('click', save);
$('files-editor-close').addEventListener('click', closeEditor);
$('files-editor-download').addEventListener('click', downloadCurrent);
