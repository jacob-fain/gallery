import { describe, expect, it } from 'vitest';
import type { Photo } from '../types';
import { derivedImages } from './imageSizes';

const photo = (width: number, height: number): Photo =>
  ({
    width,
    height,
    thumbnailUrl: 'thumb.webp',
    webUrl: 'web.webp',
    url: 'original.jpg',
  }) as Photo;

describe('derivedImages', () => {
  it('lists the thumbnail and web sizes for a large original', () => {
    expect(derivedImages(photo(6000, 4000))).toEqual([
      { src: 'thumb.webp', width: 600, height: 400 },
      { src: 'web.webp', width: 1920, height: 1280 },
    ]);
  });

  it('uses the real width when the original is smaller than the web size', () => {
    // Claiming 1920w for a 1500px file made browsers pick the wrong candidate.
    expect(derivedImages(photo(1500, 1000))).toEqual([
      { src: 'thumb.webp', width: 600, height: 400 },
      { src: 'web.webp', width: 1500, height: 1000 },
    ]);
  });

  it('keeps one candidate when both sizes equal the original width', () => {
    expect(derivedImages(photo(500, 800))).toEqual([
      { src: 'thumb.webp', width: 500, height: 800 },
    ]);
  });

  it('never offers the original', () => {
    const sources = derivedImages(photo(8000, 5000)).map((c) => c.src);
    expect(sources).not.toContain('original.jpg');
  });

  it('skips a size whose URL is missing', () => {
    const p = { ...photo(3000, 2000), thumbnailUrl: undefined };
    expect(derivedImages(p)).toEqual([{ src: 'web.webp', width: 1920, height: 1280 }]);
  });
});

describe('derivedImages with missing dimensions', () => {
  it('returns no candidates rather than dividing by zero', () => {
    expect(derivedImages({ width: 0, height: 0, thumbnailUrl: 't', webUrl: 'w' })).toEqual([]);
  });
});
