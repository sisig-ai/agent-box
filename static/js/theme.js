// Theme picker: lives on the theme dialog, opened from the header clock.
// One fetch of /api/themes fills the list; choosing swaps the overlay
// <link data-theme-css> in place — the sheet loads after every base sheet, so
// the repaint is instant and no reload is needed — then persists the choice.

import Alpine from './alpine.js';

export function themePicker() {
  return {
    themes: [],
    active: document.documentElement.dataset.theme || '',
    busy: false,

    init() {
      fetch('/api/themes', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
          this.themes = data.themes || [];
          if (data.active) this.active = data.active;
        })
        .catch(() => { this.themes = []; });
    },

    open() {
      this.$root.showModal();
    },

    // Swap the overlay link in place; keep the choice even if the save fails,
    // so the look always matches what the user picked.
    apply(id, css) {
      this.active = id;
      document.documentElement.dataset.theme = id;
      const link = document.querySelector('link[data-theme-css]');
      if (link) {
        link.href = css;
        link.dataset.themeCss = id;
      }
    },

    async chooseTheme(theme) {
      if (!theme || theme.id === this.active || this.busy) return;
      this.busy = true;
      try {
        const res = await fetch('/api/theme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: theme.id }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        // Saved state and the live look may diverge until the next reload.
      }
      this.apply(theme.id, theme.css);
      this.busy = false;
    },
  };
}

Alpine.data('themePicker', themePicker);
