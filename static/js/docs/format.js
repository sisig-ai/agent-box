// Small formatting helpers shared by the docs explorer and its flat list.

export const docPath = (prefix) =>
  '/api/docs/' + prefix.split('/').map(encodeURIComponent).join('/');

export const tagLabel = (tags) => (tags || []).join(' · ');

export const fmtTime = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—'
    : date.toLocaleString([], {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
};
