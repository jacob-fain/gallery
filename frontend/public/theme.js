// Applies the theme before first paint so the page never flashes the wrong
// one. Mirrors readAndMigrateChoice and resolveTheme in src/contexts/theme.ts:
// a saved choice wins, otherwise the operating system's preference. The
// legacy 'theme' key was written on every first visit, so only its 'dark' is
// a real choice; it moves to 'theme-choice' and the legacy key is removed.
(function () {
  var choice = null;
  try {
    var current = localStorage.getItem('theme-choice');
    var legacy = localStorage.getItem('theme');
    if (current === 'dark' || current === 'light') {
      choice = current;
    } else if (legacy === 'dark') {
      choice = 'dark';
    }
    if (legacy !== null) {
      if (choice) localStorage.setItem('theme-choice', choice);
      localStorage.removeItem('theme');
    }
  } catch (e) {
    // Storage blocked: fall back to the operating system's preference.
  }
  var dark =
    choice === 'dark' ||
    (choice === null &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
