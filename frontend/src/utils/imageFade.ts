import type { SyntheticEvent } from 'react';

// Marks an <img> once it has loaded, for stylesheets that hide it on its
// placeholder until then: data-loaded="fade" when it arrived from the
// network, to fade in, and "cached" when it was already there, to show at
// once. Unmarked images are still loading.
//
// A memory-cached image is complete before the first paint. One from the disk
// cache reports its load a few milliseconds later, so a load this soon after
// mounting counts as cached too: fading it would flash the placeholder.
export const CACHED_LOAD_MS = 100;

const mountedAt = new WeakMap<HTMLImageElement, number>();

function markIfCached(img: HTMLImageElement | null) {
  if (!img) return;
  if (img.complete && img.naturalWidth > 0) {
    img.dataset.loaded = 'cached';
  } else {
    mountedAt.set(img, performance.now());
  }
}

function markLoaded(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  // A refreshed src after expiry loads again; the image is already shown.
  if (img.dataset.loaded) return;
  const started = mountedAt.get(img);
  const quick = started !== undefined && performance.now() - started < CACHED_LOAD_MS;
  img.dataset.loaded = quick ? 'cached' : 'fade';
}

// Stable references, so React attaches the ref once per image.
export const IMAGE_FADE_PROPS = { ref: markIfCached, onLoad: markLoaded };
