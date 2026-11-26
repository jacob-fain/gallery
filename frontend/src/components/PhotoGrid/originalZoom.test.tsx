// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlideWithExif } from './gridItems';

vi.mock('../../api/client', () => ({ getPhotoOriginal: vi.fn() }));

const client = await import('../../api/client');
const { fittedWidth, maxZoomPixelRatio, useOriginalOnZoom, wantsOriginal, WEB_MAX_ZOOM_PIXEL_RATIO } = await import(
  './originalZoom'
);

const ORIGINAL = 'https://s3.test/a/original.jpg?sig';
const slide = (id: string, extra: Partial<SlideWithExif> = {}): SlideWithExif => ({
  src: `https://s3.test/${id}/web.webp`,
  srcSet: [
    { src: `https://s3.test/${id}/thumb.webp`, width: 600, height: 338 },
    { src: `https://s3.test/${id}/web.webp`, width: 1920, height: 1080 },
  ],
  width: 1920,
  height: 1080,
  alt: id,
  photoId: id,
  originalWidth: 7728,
  originalHeight: 4344,
  ...extra,
});
const slides = [slide('a'), slide('b')];

// An iPhone in portrait: the web size fills 358 CSS px, 1074 device px, so
// it is coarser than the screen past a zoom of about 1.79.
function phone() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
}

function setup(list = slides, index = 0, enabled = true) {
  return renderHook(({ list, index }) => useOriginalOnZoom(list, index, 'token', 'viewer-root', enabled), {
    initialProps: { list, index },
  });
}

const srcs = (s: SlideWithExif) => s.srcSet.map((c) => c.src);

beforeEach(() => {
  vi.resetAllMocks();
  phone();
  vi.mocked(client.getPhotoOriginal).mockResolvedValue({
    originalUrl: ORIGINAL,
    width: 7728,
    height: 4344,
    contentType: 'image/jpeg',
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(navigator, 'deviceMemory');
});

describe('when the original is wanted', () => {
  it('fits the slide as the lightbox does', () => {
    expect(fittedWidth({ width: 1920, height: 1080 }, { width: 390, height: 844 })).toBe(358);
    expect(fittedWidth({ width: 1280, height: 1920 }, { width: 844, height: 390 })).toBeCloseTo(238.67, 1);
  });

  it('only past one device pixel per web pixel, and never unzoomed', () => {
    expect(wantsOriginal(1, 358, 3, 1920)).toBe(false);
    expect(wantsOriginal(1.7, 358, 3, 1920)).toBe(false);
    expect(wantsOriginal(1.8, 358, 3, 1920)).toBe(true);
    // A desktop already past it at zoom 1 still waits for a zoom.
    expect(wantsOriginal(1, 1400, 2, 1920)).toBe(false);
    expect(wantsOriginal(1.01, 1400, 2, 1920)).toBe(true);
  });

  it('keeps the zoom limit, or grows it to one original pixel per device pixel', () => {
    expect(maxZoomPixelRatio(1920, undefined, 3)).toBe(WEB_MAX_ZOOM_PIXEL_RATIO);
    // A phone: the web size's limit already reaches past the original's pixels.
    expect(maxZoomPixelRatio(1920, 7728, 3)).toBeCloseTo((3 * 1920) / 7728, 6);
    // A desktop at 1x: deep enough to see each original pixel.
    expect(maxZoomPixelRatio(1920, 7728, 1)).toBe(1);
  });
});

describe('useOriginalOnZoom', () => {
  it('asks for nothing unzoomed or shallowly zoomed', () => {
    const { result } = setup();
    act(() => result.current.onZoom(1));
    act(() => result.current.onZoom(1.5));
    expect(client.getPhotoOriginal).not.toHaveBeenCalled();
    expect(result.current.slides).toBe(slides);
    expect(result.current.loading).toBe(false);
  });

  it("adds the original to the current slide's srcSet once zoomed past the web size, and keeps its src", async () => {
    const { result } = setup();
    act(() => result.current.onZoom(2));
    expect(client.getPhotoOriginal).toHaveBeenCalledWith('a', 'token');
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(srcs(result.current.slides[0])).toContain(ORIGINAL));
    expect(result.current.slides[0].src).toBe(slides[0].src);
    expect(result.current.slides[1]).toBe(slides[1]);
    expect(result.current.maxZoomPixelRatio).toBeCloseTo((3 * 1920) / 7728, 6);

    act(() => result.current.onZoom(4));
    expect(client.getPhotoOriginal).toHaveBeenCalledTimes(1);
  });

  it('is done once the viewer has loaded it, and hides the indicator', async () => {
    const { result } = setup();
    act(() => result.current.onZoom(2));
    await waitFor(() => expect(srcs(result.current.slides[0])).toContain(ORIGINAL));
    const root = document.createElement('div');
    root.className = 'viewer-root';
    const img = document.createElement('img');
    img.setAttribute('src', ORIGINAL);
    root.append(img);
    document.body.append(root);
    act(() => {
      img.dispatchEvent(new Event('load'));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('drops it when the zoom returns to 1 or the slide changes', async () => {
    const { result, rerender } = setup();
    act(() => result.current.onZoom(2));
    await waitFor(() => expect(srcs(result.current.slides[0])).toContain(ORIGINAL));
    act(() => result.current.onZoom(1));
    expect(result.current.slides).toBe(slides);
    expect(result.current.zoomed).toBe(false);

    act(() => result.current.onZoom(2));
    await waitFor(() => expect(srcs(result.current.slides[0])).toContain(ORIGINAL));
    rerender({ list: slides, index: 1 });
    expect(result.current.slides).toBe(slides);
    expect(result.current.loading).toBe(false);
  });

  it('stays on the web size when the original fails to load, and does not try again', async () => {
    const { result } = setup();
    act(() => result.current.onZoom(2));
    await waitFor(() => expect(srcs(result.current.slides[0])).toContain(ORIGINAL));
    const root = document.createElement('div');
    root.className = 'viewer-root';
    const img = document.createElement('img');
    img.setAttribute('src', ORIGINAL);
    root.append(img);
    document.body.append(root);
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(result.current.slides).toBe(slides));
    expect(result.current.isOriginal(ORIGINAL)).toBe(true);

    act(() => result.current.onZoom(1));
    act(() => result.current.onZoom(3));
    expect(client.getPhotoOriginal).toHaveBeenCalledTimes(1);
  });

  it('stays on the web size when the URL cannot be had', async () => {
    vi.mocked(client.getPhotoOriginal).mockRejectedValue(new Error('offline'));
    const { result } = setup();
    act(() => result.current.onZoom(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.slides).toBe(slides);
  });

  it('skips an original browsers cannot show inline', async () => {
    vi.mocked(client.getPhotoOriginal).mockResolvedValue({
      originalUrl: ORIGINAL,
      width: 7728,
      height: 4344,
      contentType: 'image/tiff',
    });
    const { result } = setup();
    act(() => result.current.onZoom(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.slides).toBe(slides);
  });

  it('asks for nothing when the original is no larger, on a low-memory device, or in the Review view', () => {
    const small = [slide('a', { originalWidth: undefined, originalHeight: undefined })];
    const first = setup(small);
    act(() => first.result.current.onZoom(4));

    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 1 });
    const second = setup();
    act(() => second.result.current.onZoom(4));
    Reflect.deleteProperty(navigator, 'deviceMemory');

    const review = setup(slides, 0, false);
    act(() => review.result.current.onZoom(4));
    expect(client.getPhotoOriginal).not.toHaveBeenCalled();
  });
});
