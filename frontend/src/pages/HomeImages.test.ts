import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicPhoto } from '../types';
import { FEATURED_SIZES, FeaturedImage, HERO_SIZES, HeroImage } from './HomeImages';

const photo: PublicPhoto = {
  id: 'p1',
  gallery_id: 'g1',
  width: 6000,
  height: 4000,
  exif_data: null,
  webUrl: 'web.webp',
  thumbnailUrl: 'thumb.webp',
};

describe('HeroImage', () => {
  const html = renderToStaticMarkup(createElement(HeroImage, { photo }));

  it('is fetched at high priority and never lazily', () => {
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain('loading=');
  });

  it('reserves its box with the intrinsic size', () => {
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1280"');
  });

  it('lets the browser choose between the thumbnail and web sizes', () => {
    expect(html).toContain('srcSet="thumb.webp 600w, web.webp 1920w"');
    expect(html).toContain(`sizes="${HERO_SIZES}"`);
  });
});

describe('FeaturedImage', () => {
  const html = renderToStaticMarkup(createElement(FeaturedImage, { photo, alt: 'Photo 1 of 3' }));

  it('loads lazily with its size reserved and a layout-matched sizes', () => {
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1280"');
    expect(html).toContain(`sizes="${FEATURED_SIZES}"`);
  });
});
