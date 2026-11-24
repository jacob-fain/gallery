import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ThemeContext } from './contexts/theme';

// The API client reads window.location at import time.
vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const { PublicApp } = await import('./App');

const render = (path: string) =>
  renderToStaticMarkup(
    createElement(
      ThemeContext.Provider,
      { value: { theme: 'light', toggleTheme: () => {} } },
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(PublicApp)),
    ),
  );

// Rendering a lazy route starts its import without waiting for it, so
// whether the page module finished loading before the run ended changed from
// run to run, and the coverage totals with it.
afterAll(async () => {
  await Promise.all([import('./pages/Gallery'), import('./pages/AllPhotos')]);
});

const title = (html: string) => html.match(/<title>(.*?)<\/title>/)?.[1];

describe('public routes', () => {
  it('match each page by path', () => {
    expect(title(render('/'))).toBe('Jacob Fain Photography');
    expect(title(render('/galleries'))).toBe('Galleries | Jacob Fain Photography');
    expect(title(render('/photos'))).toBe('Photos | Jacob Fain Photography');
  });

  it('send a gallery slug to the gallery page, not the not-found page', () => {
    const html = render('/g/some-slug');
    expect(html).not.toContain('Page not found');
    expect(html).toContain('Loading...');
  });

  it('fall back to the not-found page for unknown paths', () => {
    for (const path of ['/nope', '/g', '/g/a/b']) {
      expect(title(render(path))).toBe('Page not found | Jacob Fain Photography');
    }
  });

  it('render links as plain hrefs from the navbar', () => {
    const html = render('/');
    expect(html).toContain('href="/galleries"');
    expect(html).toContain('href="/photos"');
  });
});
