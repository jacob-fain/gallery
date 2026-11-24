import { afterEach } from 'vitest';

// Runs for every test file. Node-environment files have no window and need
// none of this.
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  // Testing Library unmounts after each test on its own only when the runner
  // exposes globals, which this config does not.
  afterEach(cleanup);

  // jsdom has no layout, so it implements no media queries. Every query
  // reports no match, which is the desktop, light-mode default.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
}
