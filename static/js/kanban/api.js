// Thin JSON client for /api/kanban. Every call resolves to the parsed body or
// throws an Error carrying the server's {"error"} message.
async function call(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty / non-JSON body */ }
  if (!res.ok) throw new Error((data && data.error) || `${method} ${path} → HTTP ${res.status}`);
  return data;
}

export const api = {
  board: () => call('GET', '/api/kanban'),
  addCard: (card) => call('POST', '/api/kanban/cards', card),
  patchCard: (id, changes) => call('PATCH', `/api/kanban/cards/${id}`, changes),
  deleteCard: (id) => call('DELETE', `/api/kanban/cards/${id}`),
  archiveDone: () => call('POST', '/api/kanban/archive-done'),
  addLane: (name) => call('POST', '/api/kanban/lanes', { name }),
  patchLane: (id, changes) => call('PATCH', `/api/kanban/lanes/${id}`, changes),
  deleteLane: (id) => call('DELETE', `/api/kanban/lanes/${id}`),
};
