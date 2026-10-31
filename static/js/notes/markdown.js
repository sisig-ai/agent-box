// Markdown preview pipeline shared by the Daily Brief and the weekly schedule.
// `marked` is the vendored classic script (window.marked), loaded before the
// modules — no import, no build step.

/* Shared markdown-preview sanitizer. Markdown is user-authored and this
   stack is unauthenticated, so strip active content before innerHTML.
   Denylist (not a strict allowlist) so innocuous markup — notably
   marked's task-list <input type="checkbox"> — survives. */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  body
    .querySelectorAll("script, style, iframe, object, embed, link, meta, base, form")
    .forEach((el) => el.remove());
  const urlAttrs = ["href", "src", "xlink:href"];
  body.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (urlAttrs.includes(name)) {
        const value = attr.value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        if (/^(javascript|data|vbscript):/.test(value)) el.removeAttribute(attr.name);
      }
    }
  });
  return body.innerHTML;
}

// Render markdown into `el`, sanitized, and re-enable the task-list checkboxes
// marked renders disabled so the preview stays clickable.
export function renderMarkdown(el, raw) {
  el.innerHTML = sanitizeHtml(marked.parse(raw, { breaks: true, gfm: true }));
  el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.disabled = false;
  });
}
