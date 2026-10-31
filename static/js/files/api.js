// Files API wrappers: JSON fetch + XHR upload (progress; sequential).
import { state, setStatus } from './render.js';

export async function api(url, method, body) {
  try {
    const opts = { method: method || 'GET' };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || ('request failed (' + res.status + ')'), true);
      return null;
    }
    return data;
  } catch (err) {
    setStatus('network error', true);
    return null;
  }
}

export function xhrUpload(file, overwrite, onProgress) {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append('path', state.cwd);
    if (overwrite) fd.append('overwrite', '1');
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/fs/upload');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round(ev.loaded / ev.total * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else { setStatus(data.error || ('upload failed (' + xhr.status + ')'), true); resolve(null); }
    };
    xhr.onerror = () => { setStatus('upload failed — network error', true); resolve(null); };
    xhr.send(fd);
  });
}
