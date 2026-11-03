// Cards that reference the open doc: the other half of the many-to-many
// binding between cards and docs. Rendered above the editor body.

export function paintBacklinks(host, doc, el) {
  if (!host) return;
  const cards = doc?.cards || [];
  host.hidden = !cards.length;
  if (!cards.length) {
    host.replaceChildren();
    return;
  }
  const label = el('span', 'docs-backlinks-label', `cards · ${cards.length}`);
  const list = el('div', 'docs-backlink-list');
  list.append(...cards.map((card) => {
    const link = el('a', 'docs-backlink', `#${card.id} ${card.title}`);
    link.href = `#/kanban/card-${card.id}`;
    link.title = `${card.title} · ${card.status}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      location.hash = `#/kanban/card-${card.id}`;
    });
    return link;
  }));
  host.replaceChildren(label, list);
}
