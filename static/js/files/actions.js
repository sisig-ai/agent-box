// Files explorer actions: navigation, create/rename/delete, upload, drag-drop.
import { $ } from "../dom.js";
import {
  state,
  refs,
  render,
  renderBreadcrumb,
  renderPlaces,
  clearSelection,
  setStatus,
} from "./render.js";
import { api, xhrUpload } from "./api.js";
import { openModal } from "../modal.js";
import { openEditor, closeEditor, editorIsOpen } from "./editor.js";

/* ----- Data access ----- */
async function load(path) {
  const url = "/api/fs/list" + (path ? "?path=" + encodeURIComponent(path) : "");
  setStatus("loading…");
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "could not open folder (" + res.status + ")", true);
      return false;
    }
    state.cwd = data.path;
    state.home = data.home;
    state.parentPath = data.parent;
    state.entries = data.entries || [];
    refs.pathLabel.textContent = state.cwd;
    refs.pathLabel.title = state.cwd;
    clearSelection();
    renderBreadcrumb();
    renderPlaces(data.places);
    render();
    setStatus("opened " + state.cwd);
    return true;
  } catch (err) {
    setStatus("network error", true);
    return false;
  }
}

export async function cd(path) {
  if (!(await closeEditor())) return;
  clearSelection();
  load(path);
}

export function goUp() {
  if (state.parentPath) cd(state.parentPath);
}

export async function openEntry(e) {
  if (!e || e.is_dir) {
    if (e) cd(e.path);
    return;
  }
  setStatus("opening " + e.name + "…");
  let res;
  try {
    res = await fetch("/api/fs/read?path=" + encodeURIComponent(e.path));
  } catch (err) {
    setStatus("network error", true);
    return;
  }
  if (res.status === 413 || res.status === 415) {
    const d = await res.json().catch(() => ({}));
    setStatus((d.error || "not editable") + " — downloading " + e.name);
    download(e);
    return;
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    setStatus(d.error || "could not open file (" + res.status + ")", true);
    return;
  }
  const d = await res.json();
  if (await openEditor(d.path, d.name, d.text)) setStatus("editing " + d.name);
}

export function download(e) {
  if (!e || e.is_dir) return;
  const a = document.createElement("a");
  a.href = "/api/fs/download?path=" + encodeURIComponent(e.path);
  a.download = e.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus("downloading " + e.name + "…");
}

/* ----- Create / rename / delete ----- */
export async function newFolder() {
  const name = await openModal({
    title: "New folder",
    input: true,
    value: "untitled folder",
    ok: "Create",
  });
  if (name == null) return;
  const r = await api("/api/fs/mkdir", "POST", { parent: state.cwd, name });
  if (r) {
    await load(state.cwd);
    setStatus("created folder " + r.name);
  }
}

export async function newFile() {
  const name = await openModal({
    title: "New empty file",
    input: true,
    value: "untitled.txt",
    ok: "Create",
  });
  if (name == null) return;
  const r = await api("/api/fs/touch", "POST", { parent: state.cwd, name });
  if (r) {
    await load(state.cwd);
    setStatus("created file " + r.name);
  }
}

export async function renameEntry(e) {
  const name = await openModal({ title: "Rename", input: true, value: e.name, ok: "Rename" });
  if (name == null || name === e.name) return;
  const r = await api("/api/fs/rename", "POST", { path: e.path, name });
  if (r) {
    await load(state.cwd);
    setStatus("renamed to " + r.name);
  }
}

export async function deleteEntry(e) {
  const ok = await openModal({
    title: e.is_dir ? "Delete folder?" : "Delete " + (e.type === "link" ? "symlink" : "file") + "?",
    text: e.is_dir
      ? "“" + e.name + "” and everything inside it will be deleted."
      : "“" + e.name + "” will be deleted.",
    ok: "Delete",
    danger: true,
  });
  if (!ok) return;
  const r = await api("/api/fs?path=" + encodeURIComponent(e.path), "DELETE");
  if (r) {
    if (state.selected && state.selected.path === e.path) clearSelection();
    await load(state.cwd);
    setStatus("deleted " + e.name);
  }
}

/* ----- Upload (XHR for progress; sequential; confirm on collision) ----- */
function uploadFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  uploadQueue(list);
}

async function uploadQueue(list) {
  let done = 0;
  for (const f of list) {
    const clash = state.entries.some((e) => e.name === f.name);
    let overwrite = false;
    if (clash) {
      const ok = await openModal({
        title: "Overwrite file?",
        text: "“" + f.name + "” already exists in this folder.",
        ok: "Overwrite",
        danger: true,
      });
      if (!ok) continue;
      overwrite = true;
    }
    const res = await xhrUpload(f, overwrite, (pct) => {
      setStatus("uploading " + f.name + " — " + pct + "%");
    });
    if (res) done++;
  }
  refs.uploadInput.value = "";
  if (done) {
    await load(state.cwd);
    setStatus("uploaded " + done + " file" + (done === 1 ? "" : "s"));
  }
}

/* ----- Wiring ----- */
function wire() {
  $("files-up").addEventListener("click", goUp);
  $("files-home").addEventListener("click", () => {
    if (state.home) cd(state.home);
  });
  $("files-refresh").addEventListener("click", async () => {
    if (state.cwd && (await closeEditor())) load(state.cwd);
  });
  $("files-hidden").addEventListener("click", (e) => {
    state.showHidden = !state.showHidden;
    e.currentTarget.classList.toggle("toggled", state.showHidden);
    render();
  });
  $("files-mkdir").addEventListener("click", newFolder);
  $("files-touch").addEventListener("click", newFile);
  $("files-upload").addEventListener("click", () => refs.uploadInput.click());
  refs.uploadInput.addEventListener("change", () => uploadFiles(refs.uploadInput.files));

  document.querySelectorAll(".files-table thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir *= -1;
      else {
        state.sortKey = key;
        state.sortDir = 1;
      }
      render();
    });
  });

  refs.listWrap.addEventListener("dragover", (e) => {
    e.preventDefault();
    refs.listWrap.classList.add("dragover");
  });
  refs.listWrap.addEventListener("dragleave", (e) => {
    if (!refs.listWrap.contains(e.relatedTarget)) refs.listWrap.classList.remove("dragover");
  });
  refs.listWrap.addEventListener("drop", (e) => {
    e.preventDefault();
    refs.listWrap.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.view !== "files" || modalOpen()) return;
    if (editorIsOpen()) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "Backspace") {
      e.preventDefault();
      goUp();
    } else if (e.key === "Enter" && state.selected) {
      e.preventDefault();
      if (state.selected.is_dir) cd(state.selected.path);
      else openEntry(state.selected);
    } else if (e.key === "Delete" && state.selected) {
      e.preventDefault();
      deleteEntry(state.selected);
    } else if (e.key.toLowerCase() === "r" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      load(state.cwd);
    }
  });
}

function modalOpen() {
  return !$("fs-modal").hidden;
}

export function initFiles() {
  if (state.inited) return;
  state.inited = true;
  wire();
  load(null); // server defaults to ~
}
