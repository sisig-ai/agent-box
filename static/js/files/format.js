// Small formatters and the XHR upload used by the files explorer.

export const fileIcon = (entry) => {
  if (entry.is_link) return 'l';
  if (entry.is_dir) return 'd';
  return entry.type === 'other' ? '?' : '-';
};

export const fmtSize = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? String(v) : v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
};

export const fmtTime = (sec) => {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })} `
    + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// XHR rather than fetch: upload progress needs onprogress.
export function xhrUpload(cwd, file, overwrite, onProgress) {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append('path', cwd);
    if (overwrite) fd.append('overwrite', '1');
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/fs/upload');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* keep {} */ }
      resolve(xhr.status >= 200 && xhr.status < 300 ? data : { error: data.error || `upload failed (${xhr.status})` });
    };
    xhr.onerror = () => resolve({ error: 'upload failed — network error' });
    xhr.send(fd);
  });
}
