// Apply the saved theme before first paint to avoid a flash of the wrong theme.
try {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  }
} catch (e) {
  // Storage blocked: keep the default theme.
}
