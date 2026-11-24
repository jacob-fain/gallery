// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ThemeContext } from '../../contexts/theme';
import Navbar from './Navbar';

function renderNavbar(path = '/') {
  const user = userEvent.setup();
  render(
    <ThemeContext.Provider value={{ theme: 'light', toggleTheme: () => {} }}>
      <MemoryRouter initialEntries={[path]}>
        <Navbar />
        <Routes>
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/galleries" element={<p>Galleries page</p>} />
          <Route path="/photos" element={<p>Photos page</p>} />
          <Route path="/g/:slug" element={<p>Gallery page</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeContext.Provider>
  );
  const button = screen.getByRole('button', { name: 'Menu' });
  const menu = document.getElementById('site-menu')!;
  return { user, button, menu };
}

describe('Navbar phone menu', () => {
  it('opens from the menu button and moves focus to the first item', async () => {
    const { user, button, menu } = renderNavbar();
    expect(menu.hidden).toBe(true);

    await user.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hidden).toBe(false);
    expect(document.activeElement).toBe(within(menu).getByRole('link', { name: 'Galleries' }));
  });

  it('closes again from a second tap on the button', async () => {
    const { user, button, menu } = renderNavbar();
    await user.click(button);
    await user.click(button);
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and hands focus back to the button', async () => {
    const { user, button, menu } = renderNavbar();
    await user.click(button);

    await user.keyboard('{Escape}');

    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('stays open for other keys', async () => {
    const { user, button, menu } = renderNavbar();
    await user.click(button);
    await user.keyboard('a');
    expect(menu.hidden).toBe(false);
  });

  it('closes on a tap outside the menu', async () => {
    const { user, button, menu } = renderNavbar();
    await user.click(button);

    await user.click(screen.getByText('Home page'));

    expect(menu.hidden).toBe(true);
  });

  it('stays open on a tap inside the menu', async () => {
    const { user, button, menu } = renderNavbar();
    await user.click(button);
    await user.pointer({ keys: '[MouseLeft>]', target: menu });
    expect(menu.hidden).toBe(false);
  });

  it('closes when one of its links is followed', async () => {
    const { user, button, menu } = renderNavbar();
    await user.click(button);

    await user.click(within(menu).getByRole('link', { name: 'Photos' }));

    expect(screen.getByText('Photos page')).toBeTruthy();
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Navbar links', () => {
  it('lists Galleries, then Photos, in the bar and in the phone menu', () => {
    const { menu } = renderNavbar();
    const links = screen.getAllByRole('link', { hidden: true }).filter((a) => a.textContent !== 'Jacob Fain');

    expect(links.filter((a) => !menu.contains(a)).map((a) => a.textContent)).toEqual(['Galleries', 'Photos']);
    expect(links.filter((a) => menu.contains(a)).map((a) => a.textContent)).toEqual(['Galleries', 'Photos']);
  });

  it('marks the current page in the bar and in the menu, and only that page', () => {
    renderNavbar('/photos');

    const current = screen
      .getAllByRole('link', { hidden: true })
      .filter((a) => a.getAttribute('aria-current') === 'page')
      .map((a) => a.textContent);
    expect(current).toEqual(['Photos', 'Photos']);
  });

  it('marks Galleries current on a gallery page, in the bar and in the menu', () => {
    const { menu } = renderNavbar('/g/iceland');

    const links = screen.getAllByRole('link', { hidden: true });
    const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Galleries', 'Galleries']);
    expect(current.filter((a) => menu.contains(a))).toHaveLength(1);
    for (const a of current) expect(a.className).toMatch(/active/);
    const photos = links.filter((a) => a.textContent === 'Photos');
    for (const a of photos) expect(a.className).not.toMatch(/active/);
  });

  it('marks Galleries current on the galleries list', () => {
    renderNavbar('/galleries');
    const current = screen
      .getAllByRole('link', { hidden: true })
      .filter((a) => a.getAttribute('aria-current') === 'page')
      .map((a) => a.textContent);
    expect(current).toEqual(['Galleries', 'Galleries']);
  });

  it('marks no page on the home page', () => {
    renderNavbar('/');
    const links = screen.getAllByRole('link', { hidden: true });
    expect(links.some((a) => a.hasAttribute('aria-current'))).toBe(false);
  });

  it('has no Buy me a coffee link, which lives in the footer', () => {
    renderNavbar();
    const nav = screen.getByRole('navigation');
    expect(nav.querySelector('a[href*="buymeacoffee"]')).toBeNull();
    expect(nav.textContent?.toLowerCase()).not.toContain('coffee');
  });
});
