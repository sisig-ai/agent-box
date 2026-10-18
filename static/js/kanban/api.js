// Thin JSON client for /api/opsboard (Ops Board; /api/kanban is a deprecated alias). Every call resolves to the parsed body or
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
  board: () => call('GET', '/api/opsboard'),
  getCard: (id) => call('GET', `/api/opsboard/cards/${id}`),
  addCard: (card) => call('POST', '/api/opsboard/cards', card),
  patchCard: (id, changes) => call('PATCH', `/api/opsboard/cards/${id}`, changes),
  deleteCard: (id) => call('DELETE', `/api/opsboard/cards/${id}`),
  archiveDone: () => call('POST', '/api/opsboard/archive-done'),
  addLane: (name) => call('POST', '/api/opsboard/lanes', { name }),
  patchLane: (id, changes) => call('PATCH', `/api/opsboard/lanes/${id}`, changes),
  deleteLane: (id) => call('DELETE', `/api/opsboard/lanes/${id}`),
};
