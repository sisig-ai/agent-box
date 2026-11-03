// Small shared helpers for the Docs view.

export async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Hit snippets carry the server's \x01…\x02 markers; split them into runs.
export function markedParts(text) {
  return String(text || '')
    .split(/\x01|\x02/)
    .map((part, i) => ({ text: part, mark: i % 2 === 1 }))
    .filter((part) => part.text);
}
