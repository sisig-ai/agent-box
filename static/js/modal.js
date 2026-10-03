// Shared prompt/confirm modal used by the files explorer.
import { $ } from './dom.js';

const modal = $('fs-modal'), modalTitle = $('fs-modal-title'), modalText = $('fs-modal-text'),
      modalInput = $('fs-modal-input'), modalOk = $('fs-modal-ok'), modalCancel = $('fs-modal-cancel');
let modalResolve = null;

export function openModal(opts) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    modalTitle.textContent = opts.title || '';
    modalText.hidden = !opts.text;
    modalText.textContent = opts.text || '';
    modalInput.hidden = !opts.input;
    modalInput.value = opts.input ? (opts.value || '') : '';
    modalInput.placeholder = opts.placeholder || '';
    modalOk.textContent = opts.ok || 'OK';
    modalOk.classList.toggle('danger', !!opts.danger);
    modal.hidden = false;
    if (opts.input) setTimeout(() => { modalInput.focus(); modalInput.select(); }, 0);
    else modalOk.focus();
  });
}

function closeModal(value) {
  if (modal.hidden) return;
  modal.hidden = true;
  const r = modalResolve;
  modalResolve = null;
  if (r) r(value);
}

modalOk.addEventListener('click', () => closeModal(modalInput.hidden ? true : modalInput.value.trim()));
modalCancel.addEventListener('click', () => closeModal(null));
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(null); });
modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); modalOk.click(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeModal(null); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal && !modal.hidden) closeModal(null);
});
