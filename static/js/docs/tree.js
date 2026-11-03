// Prefix tree for the Docs explorer.
//
// The server builds the tree (/api/docs/tree): every folder with its recursive
// count and at most five docs. "show N more" lazily fetches that folder's
// remainder, so the page never holds the whole corpus to draw one folder.
//
// docs.js owns the state; this module only renders it and asks back through the
// handlers it is given (select a doc, change the scope, report a failure).

export function createTree(ctx) {
  const { el, api, state, $, setStatus, selectDoc, setScope, LIST_LIMIT } = ctx;

  function saveCollapsed() {
    try {
      localStorage.setItem('docs.collapsed', JSON.stringify([...state.collapsed]));
    } catch { /* storage blocked */ }
  }

  function collapse(path, open) {
    if (open) state.collapsed.add(path); else state.collapsed.delete(path);
    saveCollapsed();
    render();
  }

// The tree comes from /api/docs/tree: every folder with its recursive count and
// at most five docs. "show N more" lazily fetches that folder's remainder, so
// the page never has to hold the whole corpus to render one folder.
function treeDocRow(doc, depth) {
  const item = el('li', 'docs-tree-doc');
  const row = el('div', 'docs-tree-row');
  row.style.paddingLeft = `${depth * 0.8 + 1.1}rem`;
  const leaf = el('button', 'docs-tree-name is-doc', doc.name || doc.prefix.split('/').pop());
  leaf.title = `${doc.prefix}${doc.author ? ` · @${doc.author}` : ''}`;
  if (state.current && state.current.prefix === doc.prefix) leaf.classList.add('open');
  leaf.addEventListener('click', () => selectDoc(doc.prefix));
  row.append(el('span', 'docs-tree-twist', '·'), leaf);
  if (doc.card_count) row.append(el('span', 'docs-tree-cards', `⧉${doc.card_count}`));
  item.append(row);
  return item;
}

function folderNode(folder, depth) {
  const item = el('li', 'docs-tree-folder');
  const open = !state.collapsed.has(folder.path);
  const row = el('div', 'docs-tree-row');
  row.style.paddingLeft = `${depth * 0.8}rem`;
  const twist = el('button', 'docs-tree-twist', open ? '▾' : '▸');
  twist.title = open ? 'Collapse' : 'Expand';
  twist.addEventListener('click', (e) => {
    e.stopPropagation();
    collapse(folder.path, open);
  });
  const label = el('button', 'docs-tree-name', folder.name);
  label.title = `Scope to ${folder.path}/`;
  if (state.prefix === folder.path) label.classList.add('scoped');
  label.addEventListener('click', () => setScope(state.prefix === folder.path ? '' : folder.path));
  row.append(twist, label, el('span', 'docs-tree-count', String(folder.total)));
  item.append(row);
  if (!open) return item;

  for (const child of folder.folders) item.append(folderNode(child, depth + 1));

  const cached = state.folderDocs.get(folder.path);
  const docs = cached || folder.docs;
  for (const doc of docs) item.append(treeDocRow(doc, depth));
  const more = cached ? 0 : folder.more;
  if (more > 0) {
    const button = el('button', 'docs-tree-more', `show ${more} more`);
    const wrap = el('li', 'docs-tree-more-row');
    wrap.style.paddingLeft = `${depth * 0.8 + 1.1}rem`;
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      button.disabled = true;
      button.textContent = 'loading…';
      try {
        const data = await api(`/api/docs?${new URLSearchParams({ prefix: folder.path, limit: String(LIST_LIMIT) })}`);
        const docs = data.docs.map((doc) => ({ ...doc, name: doc.prefix.split('/').pop() }));
        docs.sort((a, b) => a.name.localeCompare(b.name));
        state.folderDocs.set(folder.path, docs);
        render();
      } catch (err) {
        button.disabled = false;
        button.textContent = `show ${more} more`;
        setStatus(`load failed: ${err.message}`, true);
      }
    });
    wrap.append(button);
    item.append(wrap);
  }
  return item;
}

function render() {
  const host = $('docs-tree');
  if (!state.tree) return;
  const nodes = state.tree.folders.map((folder) => folderNode(folder, 0));
  for (const doc of state.tree.docs) {
    nodes.push(treeDocRow({ ...doc, name: doc.prefix.split('/').pop() }, 0));
  }
  if (state.tree.more > 0) {
    const button = el('button', 'docs-tree-more', `show ${state.tree.more} more at root`);
    const wrap = el('li', 'docs-tree-more-row');
    wrap.append(button);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const data = await api(`/api/docs?${new URLSearchParams({ limit: String(LIST_LIMIT) })}`);
        const roots = data.docs
          .filter((doc) => !doc.prefix.includes('/'))
          .map((doc) => ({ ...doc, name: doc.prefix }));
        roots.sort((a, b) => a.name.localeCompare(b.name));
        state.folderDocs.set('', roots);
        state.tree = { ...state.tree, docs: state.folderDocs.get(''), more: 0 };
        render();
      } catch (err) {
        button.disabled = false;
        setStatus(`load failed: ${err.message}`, true);
      }
    });
    wrap.append(button);
    nodes.push(wrap);
  }
  host.replaceChildren(...nodes);
  $('docs-tree-empty').hidden = state.view !== 'tree' || state.all.length > 0;
}



  return { render };
}
