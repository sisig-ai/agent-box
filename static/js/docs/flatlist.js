// Flat explorer mode: one line per doc, sortable by prefix, updated or author.
// The rows share the grid with the header so the columns line up.

export function sortedDocs(state, docs) {
  const { key, dir } = state.sort;
  const value = (doc) => {
    if (key === 'prefix') return doc.prefix.toLowerCase();
    if (key === 'author') return (doc.author || '').toLowerCase();
    return new Date(doc.updated_at).getTime() || 0;
  };
  return docs.slice().sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === right) return a.prefix.localeCompare(b.prefix);
    return (left < right ? -1 : 1) * dir;
  });
}

export function sortHeader(state, el, setSort) {
  const row = el('li', 'docs-flat-row docs-flat-head');
  for (const [key, label] of [['prefix', 'prefix'], ['updated', 'updated'], ['author', 'author']]) {
    const btn = el('button', 'docs-sort', label);
    btn.classList.toggle('active', state.sort.key === key);
    if (state.sort.key === key) {
      btn.append(el('span', 'docs-sort-arrow', state.sort.dir === 1 ? '▲' : '▼'));
    }
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      setSort(key);
    });
    const cell = el('span', `docs-flat-cell is-${key}`);
    cell.append(btn);
    row.append(cell);
  }
  return row;
}

export function flatRow(doc, state, el, fmtTime, tagLabel, onOpen) {
  const row = el('li', 'docs-flat-row');
  row.dataset.prefix = doc.prefix;
  if (state.current && state.current.prefix === doc.prefix) row.classList.add('selected');
  const prefixCell = el('span', 'docs-flat-cell is-prefix');
  prefixCell.append(el('span', 'docs-flat-prefix', doc.prefix));
  if (doc.card_count) prefixCell.append(el('span', 'docs-tree-cards', `⧉${doc.card_count}`));
  if (doc.tags && doc.tags.length) {
    prefixCell.append(el('span', 'docs-flat-tags', tagLabel(doc.tags)));
  }
  row.append(prefixCell);
  row.append(el('span', 'docs-flat-cell is-updated', fmtTime(doc.updated_at)));
  row.append(el('span', 'docs-flat-cell is-author', doc.author ? `@${doc.author}` : '—'));
  row.title = `${doc.prefix}\n${doc.author || 'no author'} · ${fmtTime(doc.updated_at)}`;
  row.addEventListener('click', () => onOpen(doc.prefix));
  return row;
}
