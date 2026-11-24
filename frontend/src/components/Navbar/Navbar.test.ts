import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ThemeContext } from '../../contexts/theme';

// The API client, pulled in through the contact modal, reads window.location
// at import time.
vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const { default: Navbar } = await import('./Navbar');

const render = () =>
  renderToStaticMarkup(
    createElement(
      ThemeContext.Provider,
      { value: { theme: 'light', toggleTheme: () => {} } },
      createElement(MemoryRouter, null, createElement(Navbar)),
    ),
  );

describe('Navbar', () => {
  it('renders a closed menu button that controls the menu panel', () => {
    const html = render();
    expect(html).toContain('aria-label="Menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="site-menu"');
    expect(html).toMatch(/<div id="site-menu"[^>]* hidden=""/);
  });

  it('lists the pages and a labelled theme toggle in the menu', () => {
    const menu = render().split('id="site-menu"')[1];
    expect(menu).toContain('Galleries');
    expect(menu).toContain('All Photos');
    expect(menu).toContain('<span>Theme</span>');
    expect(menu).toContain('aria-label="Theme: switch to dark mode"');
  });
});
