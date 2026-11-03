// Board search helpers shared with the board component.
// The component owns the query state; this module only splits the server's
// \x01…\x02 hit markers into runs the template can render.

export function markedParts(text) {
  return String(text || '')
    .split(/\x01|\x02/)
    .map((part, i) => ({ text: part, mark: i % 2 === 1 }))
    .filter((part) => part.text);
}
