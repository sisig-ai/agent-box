// Doc references on a board card: nested, clickable, and they open the doc in
// the Docs view. Clicking a ref must not open the card underneath it.

export function appendDocRefs(node, card, doc = document) {
  if (!card.docs || !card.docs.length) return;
  const refs = doc.createElement('div');
  refs.className = 'kb-card-docs';
  for (const prefix of card.docs) {
    const item = doc.createElement('a');
    item.className = 'kb-doc';
    item.textContent = `↳ ${prefix}`;
    item.href = `#/docs/${prefix}`;
    item.title = `Open ${prefix}`;
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      doc.defaultView.location.hash = `#/docs/${prefix}`;
    });
    refs.append(item);
  }
  node.append(refs);
}
