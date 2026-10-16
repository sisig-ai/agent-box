export function installGmgnViewport() {
  const viewport = document.querySelector('meta[name="viewport"]');
  const original = viewport.content;
  const fixed = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const active = () => document.body.dataset.view === 'gmgn'
    || document.documentElement.classList.contains('gmgn-app');
  const update = () => { viewport.content = active() ? fixed : original; };
  const stopGesture = (event) => {
    if (active()) event.preventDefault();
  };
  const stopPinch = (event) => {
    if (active() && event.touches.length > 1) event.preventDefault();
  };
  for (const type of ['gesturestart', 'gesturechange']) {
    document.addEventListener(type, stopGesture, { passive: false });
  }
  for (const type of ['touchstart', 'touchmove']) {
    document.addEventListener(type, stopPinch, { passive: false });
  }
  window.addEventListener('hashchange', update);
  update();
}
