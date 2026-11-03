// Files editor: CodeMirror 5, lazily loaded, one instance at a time.
// Imperative on purpose: CodeMirror owns its DOM. The view component calls
// open()/save()/close() and reads the dirty state it is told about.

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

let cmLoad = null;
let instance = null; // { path, name, cm, orig, callbacks }

const asset = (path) => `${CM_BASE}/${path}?v=${CM_VERSION}`;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadStyle(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`failed to load ${href}`));
    document.head.appendChild(link);
  });
}

function loadCodemirror() {
  if (cmLoad) return cmLoad;
  const core = window.CodeMirror
    ? Promise.resolve()
    : loadScript(asset('codemirror.min.js'))
        .then(() => loadScript(asset('addon/mode/simple.min.js')))
        .then(() => Promise.all(CM_MODES.map((m) => loadScript(asset(`mode/${m}.min.js`)))));
  cmLoad = loadStyle(asset('codemirror.min.css')).then(() => core);
  return cmLoad;
}

export function modeFor(name) {
  const n = String(name || '').toLowerCase();
  if (MODE_BY_NAME[n]) return MODE_BY_NAME[n];
  const ext = n.includes('.') ? n.split('.').pop() : '';
  return MODE_BY_EXT[ext] || null;
}

export const isOpen = () => !!instance;
export const current = () => instance;
export const value = () => (instance ? instance.cm.getValue() : '');

// open(host, { path, name, text, onDirty, onSave, onClose }) -> true on success
export async function open(host, opts) {
  try {
    await loadCodemirror();
  } catch (err) {
    return { error: `editor failed to load — ${err.message}` };
  }
  host.innerHTML = '';
  const cm = window.CodeMirror(host, {
    value: opts.text,
    mode: modeFor(opts.name),
    theme: 'macmini',
    lineNumbers: true,
    lineWrapping: false,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    viewportMargin: 20,
    extraKeys: {
      'Cmd-S': () => opts.onSave(),
      'Ctrl-S': () => opts.onSave(),
      Esc: () => opts.onClose(),
      Tab: (c) => c.replaceSelection('  ', 'end'),
    },
  });
  instance = { path: opts.path, name: opts.name, cm, orig: opts.text };
  cm.on('change', () => opts.onDirty(cm.getValue() !== instance.orig));
  cm.focus();
  return { ok: true };
}

export function markSaved(text) {
  if (instance) instance.orig = text;
}

export function destroy() {
  if (!instance) return;
  instance.cm.getWrapperElement().remove();
  instance = null;
}
