// Small interaction helpers for the Kanban board.

// Swap a text node for an <input>; Enter/blur commits, Escape cancels.
// state.busy is held while editing so the poll never re-renders under you.
export function inlineEdit(node, value, state, commit) {
  if (node.dataset.editing) return;
  node.dataset.editing = "1";
  const input = document.createElement("input");
  input.className = "kb-inline";
  input.value = value;
  input.maxLength = node.classList.contains("kb-card-title") ? 500 : 100;
  const original = node.textContent;
  node.textContent = "";
  node.append(input);
  state.busy++;
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    state.busy = Math.max(0, state.busy - 1);
    delete node.dataset.editing;
    const v = input.value.trim();
    input.remove();
    node.textContent = save && v ? v : original;
    if (save) commit(v);
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    }
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

// Two-step confirm: first click arms the button for 3s, second click fires.
export function armDelete(btn, action, armedLabel = "delete?") {
  let timer = null;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    if (btn.classList.contains("armed")) {
      clearTimeout(timer);
      btn.classList.remove("armed");
      action();
      return;
    }
    btn.classList.add("armed");
    btn.dataset.label = btn.textContent;
    btn.textContent = typeof armedLabel === "function" ? armedLabel() : armedLabel;
    timer = setTimeout(() => {
      btn.classList.remove("armed");
      btn.textContent = btn.dataset.label;
    }, 3000);
  });
}
