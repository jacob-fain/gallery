import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getPhotoOriginal } from '../../api/client';
import type { SlideWithExif } from './gridItems';

/**
 * Deep zoom on the original. The viewer opens on the web size; once zooming
 * in spreads each of its pixels over more than one device pixel, the
 * original is added to the current slide's srcSet. The Zoom plugin then
 * picks it as the smallest candidate wide enough, loads it hidden and swaps
 * it in at the same zoom and position, and stays on the web size if it
 * fails. The slide's src never changes, since the plugin resets the zoom
 * when it does.
 */

// The lightbox's default padding around the slide (carousel.padding).
const SLIDE_PADDING = 16;
// The viewer's own zoom limit for the web size (PhotoGrid.tsx): this many
// device pixels per web pixel at the deepest zoom.
export const WEB_MAX_ZOOM_PIXEL_RATIO = 3;
// Formats browsers show inline. A TIFF or HEIC original would download in
// full and then fail to draw.
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
// Chromium reports device memory in GB (navigator.deviceMemory). Below this,
// decoding a 30+ megapixel original (around 130 MB) risks the tab, so such
// devices stay on the web size. Safari reports nothing and is not limited.
const MIN_DEVICE_MEMORY_GB = 2;

/** The slide's width on screen at zoom 1, as the lightbox fits it. */
export function fittedWidth(slide: Pick<SlideWithExif, 'width' | 'height'>, viewport: { width: number; height: number }) {
  if (!slide.width || !slide.height) return 0;
  const width = viewport.width - 2 * SLIDE_PADDING;
  const height = viewport.height - 2 * SLIDE_PADDING;
  return Math.max(0, Math.min(width, (height * slide.width) / slide.height, slide.width));
}

/** Whether the web size is coarser than the screen at this zoom. */
export function wantsOriginal(zoom: number, shownWidth: number, pixelRatio: number, webWidth: number): boolean {
  return zoom > 1 && shownWidth > 0 && webWidth > 0 && shownWidth * zoom * pixelRatio > webWidth;
}

/**
 * The plugin's zoom limit is the widest candidate times this ratio. With the
 * original in, the limit stays where the web size put it, or grows only so
 * far that one original pixel covers one device pixel at the deepest zoom.
 */
export function maxZoomPixelRatio(webWidth: number, originalWidth: number | undefined, pixelRatio: number): number {
  if (!originalWidth || originalWidth <= webWidth) return WEB_MAX_ZOOM_PIXEL_RATIO;
  return Math.max((WEB_MAX_ZOOM_PIXEL_RATIO * webWidth) / originalWidth, 1 / pixelRatio);
}

function lowMemoryDevice(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === 'number' && memory < MIN_DEVICE_MEMORY_GB;
}

interface Active {
  photoId: string;
  url?: string;
  width?: number;
  height?: number;
  loaded: boolean;
}

export interface OriginalZoom {
  // The slides, with the original added to the current one's srcSet.
  slides: SlideWithExif[];
  // The lightbox's on.zoom callback.
  onZoom: (zoom: number) => void;
  // The current slide is zoomed in.
  zoomed: boolean;
  // The original is on its way: the viewer shows a small indicator.
  loading: boolean;
  maxZoomPixelRatio: number;
  // Every original URL handed to the viewer, so a failed one is not taken
  // for an expired grid URL.
  isOriginal: (src: string) => boolean;
}

interface ZoomLevel {
  photoId: string;
  zoomed: boolean;
}

function viewportSize() {
  return { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
}

export function useOriginalOnZoom(
  slides: SlideWithExif[],
  index: number,
  accessToken: string | undefined,
  rootClass: string,
  enabled = true
): OriginalZoom {
  const [stored, setActive] = useState<Active | null>(null);
  // State changes only when the level does, not on every frame of a pinch.
  const [level, setLevel] = useState<ZoomLevel | null>(null);
  const failed = useRef(new Set<string>());
  const handedOut = useRef(new Set<string>());
  // The photo whose original was last asked for while zoomed. Cleared when
  // the zoom is back to 1, so a later zoom asks (from the cache) again.
  const requested = useRef<string | null>(null);
  const slide = index >= 0 ? slides[index] : undefined;
  const photoId = slide?.photoId;
  // A level reported for another slide is stale: the lightbox resets the zoom
  // when the slide changes, and says so a moment later.
  const zoomed = !!level && level.photoId === photoId && level.zoomed;
  // Gone as soon as the zoom is back to 1 or the slide changes, so nothing
  // loads an original unzoomed. One the plugin already swapped in stays on
  // screen: it is loaded, and is not fetched again.
  const active = stored && zoomed && stored.photoId === photoId ? stored : null;

  const onZoom = useCallback(
    (zoom: number) => {
      if (!slide) return;
      const id = slide.photoId;
      const next: ZoomLevel = { photoId: id, zoomed: zoom > 1 };
      setLevel((prev) => (prev && prev.photoId === id && prev.zoomed === next.zoomed ? prev : next));
      if (zoom <= 1 || requested.current !== id) requested.current = null;
      if (!enabled || requested.current === id) return;
      if (!slide.originalWidth || slide.originalWidth <= slide.width) return;
      if (failed.current.has(id) || lowMemoryDevice()) return;
      if (!wantsOriginal(zoom, fittedWidth(slide, viewportSize()), window.devicePixelRatio || 1, slide.width)) return;

      requested.current = id;
      setActive({ photoId: id, loaded: false });
      getPhotoOriginal(id, accessToken)
        .then((original) => {
          if (original.contentType && !INLINE_TYPES.has(original.contentType)) throw new Error('Not shown inline');
          handedOut.current.add(original.originalUrl);
          setActive((prev) =>
            prev?.photoId === id
              ? { photoId: id, url: original.originalUrl, width: original.width, height: original.height, loaded: false }
              : prev
          );
        })
        .catch(() => {
          failed.current.add(id);
          setActive((prev) => (prev?.photoId === id ? null : prev));
        });
    },
    [slide, enabled, accessToken]
  );

  // Done when the plugin's copy of the original has loaded and decoded. One
  // already on screen from an earlier zoom is done at once.
  const url = active?.url;
  useLayoutEffect(() => {
    if (!url) return;
    const id = active?.photoId;
    const isOurs = (target: EventTarget | null): target is HTMLImageElement =>
      target instanceof HTMLImageElement && target.getAttribute('src') === url && !!target.closest(`.${rootClass}`);
    const done = () => setActive((prev) => (prev?.url === url ? { ...prev, loaded: true } : prev));
    const onLoad = (event: Event) => {
      if (!isOurs(event.target)) return;
      const img = event.target;
      (typeof img.decode === 'function' ? img.decode() : Promise.resolve()).catch(() => {}).then(done);
    };
    const onError = (event: Event) => {
      if (!isOurs(event.target)) return;
      if (id) failed.current.add(id);
      setActive((prev) => (prev?.url === url ? null : prev));
    };
    document.addEventListener('load', onLoad, true);
    document.addEventListener('error', onError, true);
    const existing = [...document.querySelectorAll(`.${rootClass} img`)].find(
      (img) => isOurs(img) && (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0
    );
    if (existing) done();
    return () => {
      document.removeEventListener('load', onLoad, true);
      document.removeEventListener('error', onError, true);
    };
  }, [url, active?.photoId, rootClass]);

  const withOriginal = useMemo(() => {
    if (!active?.url || !active.width || !active.height || index < 0) return slides;
    const shown = slides[index];
    if (!shown || shown.photoId !== active.photoId) return slides;
    const next = slides.slice();
    next[index] = {
      ...shown,
      srcSet: [...shown.srcSet, { src: active.url, width: active.width, height: active.height }],
    };
    return next;
  }, [slides, index, active]);

  const isOriginal = useCallback((src: string) => handedOut.current.has(src), []);
  const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const inSrcSet = !!active?.url && slide?.photoId === active.photoId;
  return {
    slides: withOriginal,
    onZoom,
    zoomed,
    loading: !!active && !active.loaded,
    maxZoomPixelRatio: inSrcSet && slide ? maxZoomPixelRatio(slide.width, active?.width, pixelRatio) : WEB_MAX_ZOOM_PIXEL_RATIO,
    isOriginal,
  };
}
