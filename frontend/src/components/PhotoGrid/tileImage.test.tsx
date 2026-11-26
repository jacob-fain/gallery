// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PREVIEW_IMAGE_PROPS, RETRY_DELAYS_MS, RETRY_INTERVAL_MS, TILE_IMAGE_PROPS } from './tileImage';

function Tile({ src }: { src: string }) {
  return <img alt="tile" src={src} srcSet={`${src} 600w`} {...TILE_IMAGE_PROPS} />;
}

function tile() {
  return screen.getByAltText('tile') as HTMLImageElement;
}

// Calls that set a source, which is what starts a load in a browser.
function loadsStarted(spy: MockInstance<Element['setAttribute']>) {
  return spy.mock.calls.filter(([name]) => name === 'src').map(([, value]) => value);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('grid tile images', () => {
  it('stay shown when they load, marked as loaded for the fade over the preview', () => {
    render(<Tile src="https://s3.test/a.webp" />);
    expect(tile().dataset.loaded).toBeUndefined();
    fireEvent.load(tile());
    expect(tile().dataset.failed).toBeUndefined();
    expect(tile().dataset.loaded).toBe('');
  });

  it('count an image already loaded when it mounts as loaded', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(600);
    render(<Tile src="https://s3.test/a.webp" />);
    expect(tile().dataset.loaded).toBe('');
  });

  it('do not count a cancelled download, which has no sources, as failed', () => {
    render(<img alt="tile" {...TILE_IMAGE_PROPS} />);
    fireEvent.error(tile());
    expect(tile().dataset.failed).toBeUndefined();
  });

  it('hide a failed load and retry it, then show it when it loads', () => {
    render(<Tile src="https://s3.test/a.webp" />);
    const img = tile();
    const setAttribute = vi.spyOn(img, 'setAttribute');

    fireEvent.error(img);
    expect(img.dataset.failed).toBe('');
    expect(loadsStarted(setAttribute)).toEqual([]);

    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual(['https://s3.test/a.webp']);
    expect(img.getAttribute('srcset')).toBe('https://s3.test/a.webp 600w');

    fireEvent.load(img);
    expect(img.dataset.failed).toBeUndefined();
    expect(img.dataset.loaded).toBe('');
  });

  it.each([2, 3])('recover after %i failures in a row, retrying the same URL with growing delays', (failures) => {
    render(<Tile src="https://s3.test/a.webp" />);
    const img = tile();
    const setAttribute = vi.spyOn(img, 'setAttribute');
    for (let i = 0; i < failures; i++) {
      fireEvent.error(img);
      // Not before its delay.
      act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[i] - 1));
      expect(loadsStarted(setAttribute)).toHaveLength(i);
      act(() => vi.advanceTimersByTime(1));
      expect(loadsStarted(setAttribute)).toHaveLength(i + 1);
    }
    expect(new Set(loadsStarted(setAttribute))).toEqual(new Set(['https://s3.test/a.webp']));
    fireEvent.load(img);
    expect(img.dataset.failed).toBeUndefined();

    // A later failure starts the delays over.
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toHaveLength(failures + 1);
  });

  it('keep retrying every 30 s after the quick retries, but only while on screen', () => {
    render(<Tile src="https://s3.test/a.webp" />);
    const img = tile();
    for (const delay of RETRY_DELAYS_MS) {
      fireEvent.error(img);
      act(() => vi.advanceTimersByTime(delay));
    }
    const setAttribute = vi.spyOn(img, 'setAttribute');
    const rect = vi.spyOn(img, 'getBoundingClientRect');

    rect.mockReturnValue({ top: 2000, bottom: 2300 } as DOMRect);
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_INTERVAL_MS * 2));
    expect(loadsStarted(setAttribute)).toEqual([]);

    rect.mockReturnValue({ top: 100, bottom: 400 } as DOMRect);
    act(() => vi.advanceTimersByTime(RETRY_INTERVAL_MS));
    expect(loadsStarted(setAttribute)).toEqual(['https://s3.test/a.webp']);

    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_INTERVAL_MS));
    expect(loadsStarted(setAttribute)).toHaveLength(2);
  });

  it('give a new src its own retry', () => {
    const { rerender } = render(<Tile src="https://s3.test/a.webp" />);
    const img = tile();
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    fireEvent.error(img);

    rerender(<Tile src="https://s3.test/a-fresh.webp" />);
    const setAttribute = vi.spyOn(img, 'setAttribute');
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual(['https://s3.test/a-fresh.webp']);
  });

  it('leave a src that changed before the retry to load by itself', () => {
    const { rerender } = render(<Tile src="https://s3.test/a.webp" />);
    const img = tile();
    fireEvent.error(img);

    rerender(<Tile src="https://s3.test/a-fresh.webp" />);
    const setAttribute = vi.spyOn(img, 'setAttribute');
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual([]);
    expect(img.getAttribute('src')).toBe('https://s3.test/a-fresh.webp');
  });

  it('stop the download of an image removed before it loaded', async () => {
    const { unmount } = render(<Tile src="https://s3.test/a.webp" />);
    const img = tile();
    fireEvent.error(img);
    unmount();
    await act(async () => {});
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.hasAttribute('srcset')).toBe(false);

    // Nor is a removed image retried.
    const setAttribute = vi.spyOn(img, 'setAttribute');
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual([]);
  });

  it('keep the source of a removed image that had loaded', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const { unmount } = render(<Tile src="https://s3.test/a.webp" />);
    const img = tile();
    unmount();
    await act(async () => {});
    expect(img.getAttribute('src')).toBe('https://s3.test/a.webp');
  });

  it('keep loading when StrictMode releases and reattaches the ref', async () => {
    render(
      <StrictMode>
        <Tile src="https://s3.test/a.webp" />
      </StrictMode>
    );
    await act(async () => {});
    expect(tile().getAttribute('src')).toBe('https://s3.test/a.webp');
  });
});

describe('grid tile previews', () => {
  function preview(src?: string) {
    const { container } = render(<img src={src} {...PREVIEW_IMAGE_PROPS} />);
    return container.querySelector<HTMLImageElement>('img[data-preview]')!;
  }

  it('are hidden from assistive technology', () => {
    const img = preview('https://s3.test/a-thumb.webp');
    expect(img.alt).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
  });

  it('are marked shown once loaded, and failed only when a load with a source failed', () => {
    const img = preview('https://s3.test/a-thumb.webp');
    fireEvent.error(img);
    expect(img.dataset.failed).toBe('');
    fireEvent.load(img);
    expect(img.dataset.shown).toBe('');
    expect(img.dataset.failed).toBeUndefined();

    const cancelled = preview();
    fireEvent.error(cancelled);
    expect(cancelled.dataset.failed).toBeUndefined();
  });
});
