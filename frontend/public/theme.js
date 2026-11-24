// Applies the theme before first paint so the page never flashes the wrong
// one. Mirrors resolveTheme in src/contexts/theme.ts: a saved choice wins,
// otherwise the operating system's preference.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('theme');
  } catch (e) {
    // Storage blocked: fall back to the operating system's preference.
  }
  var dark =
    stored === 'dark' ||
    (stored !== 'light' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
