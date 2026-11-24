// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScrollRestorer, { RESTORE_TIMEOUT_MS } from './ScrollRestorer';

// jsdom has no layout: the page height and the scroll position are whatever
// the test sets, and scrollTo moves the position as a browser would.
let pageHeight = 0;
let scrollY = 0;
const scrollTo = vi.fn((_x: number, y: number) => {
  scrollY = Math.max(0, Math.min(y, pageHeight - window.innerHeight));
  window.dispatchEvent(new Event('scroll'));
});

function scrollBy(y: number) {
  scrollY = y;
  window.dispatchEvent(new Event('scroll'));
}

const router: { navigate?: NavigateFunction } = {};
function Navigator() {
  const navigate = useNavigate();
  useEffect(() => {
    router.navigate = navigate;
  }, [navigate]);
  return null;
}

function renderSite(path = '/photos') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ScrollRestorer />
      <Navigator />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

async function go(to: string | number) {
  await act(async () => {
    if (typeof to === 'number') await router.navigate!(to);
    else await router.navigate!(to);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  pageHeight = 10_000;
  scrollY = 0;
  scrollTo.mockClear();
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => pageHeight });
  vi.stubGlobal('scrollTo', scrollTo);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ScrollRestorer', () => {
  it('starts a new navigation at the top', async () => {
    renderSite();
    scrollBy(3000);

    await go('/g/smith');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    expect(scrollY).toBe(0);
  });

  it('returns to the position an entry was left at on Back and Forward', async () => {
    renderSite();
    scrollBy(3000);
    await go('/g/smith');
    scrollBy(1200);

    await go(-1);
    expect(scrollY).toBe(3000);

    await go(1);
    expect(scrollY).toBe(1200);
  });

  it('waits for the page to grow tall enough before restoring', async () => {
    renderSite();
    scrollBy(3000);
    await go('/g/smith');

    // The grid has not loaded: the page is one screen tall.
    pageHeight = window.innerHeight;
    scrollTo.mockClear();
    await go(-1);
    act(() => vi.advanceTimersByTime(500));
    expect(scrollTo).not.toHaveBeenCalled();

    pageHeight = 6000;
    act(() => vi.advanceTimersByTime(100));
    expect(scrollTo).toHaveBeenCalledWith(0, 3000);
    expect(scrollY).toBe(3000);
  });

  it('gives up waiting after the timeout and scrolls as far as the page allows', async () => {
    renderSite();
    scrollBy(3000);
    await go('/g/smith');

    pageHeight = 2000;
    scrollTo.mockClear();
    await go(-1);
    act(() => vi.advanceTimersByTime(RESTORE_TIMEOUT_MS - 100));
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(200));
    expect(scrollTo).toHaveBeenCalledWith(0, 3000);
    expect(scrollY).toBe(2000 - window.innerHeight);
  });

  it('leaves the page alone once the visitor scrolls while it loads', async () => {
    renderSite();
    scrollBy(3000);
    await go('/g/smith');

    pageHeight = window.innerHeight;
    scrollTo.mockClear();
    await go(-1);
    window.dispatchEvent(new Event('wheel'));
    pageHeight = 6000;
    act(() => vi.advanceTimersByTime(RESTORE_TIMEOUT_MS * 2));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("returns to the tab's first entry after a reload", () => {
    // The router keys a tab's first entry "default" in every document.
    window.history.replaceState(null, '', '/g/smith');
    const site = () => (
      <BrowserRouter>
        <ScrollRestorer />
      </BrowserRouter>
    );
    const first = render(site());
    scrollBy(900);
    window.dispatchEvent(new Event('pagehide'));
    first.unmount();

    // A reload keeps the entry's history state and session storage.
    scrollY = 0;
    render(site());
    expect(scrollY).toBe(900);

    // A different first entry, as when a link is opened in a new tab, starts at the top.
    cleanup();
    window.history.replaceState(null, '', '/g/smith');
    render(site());
    expect(scrollY).toBe(0);
  });

  it('turns off the browser restoration while mounted', () => {
    window.history.scrollRestoration = 'auto';
    const { unmount } = renderSite();
    expect(window.history.scrollRestoration).toBe('manual');
    unmount();
    expect(window.history.scrollRestoration).toBe('auto');
  });
});
