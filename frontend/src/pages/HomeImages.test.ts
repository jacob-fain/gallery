import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicPhoto } from '../types';
import { CoverImage, FEATURED_SIZES, FeaturedImage, HERO_SIZES, HeroImage } from './HomeImages';
import { coverSizes } from './homeLayout';

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
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1280"');
    expect(html).toContain(`sizes="${FEATURED_SIZES}"`);
  });

  it('paints as it downloads instead of waiting to fade in', () => {
    expect(html).not.toContain('data-loaded');
    expect(html).not.toContain('decoding="async"');
  });
});

describe('CoverImage', () => {
  const cover = {
    id: 'g1',
    title: 'Chicago',
    slug: 'chicago',
    coverUrl: 'thumb.webp',
    coverWebUrl: 'web.webp',
    coverWidth: 4000,
    coverHeight: 6000,
  };

  it('reserves the cover at its own proportions with a layout-matched sizes', () => {
    const html = renderToStaticMarkup(createElement(CoverImage, { gallery: cover, sizes: coverSizes(0.5) }));
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="2880"');
    expect(html).toContain('srcSet="thumb.webp 600w, web.webp 1920w"');
    expect(html).toContain(`sizes="${coverSizes(0.5)}"`);
    expect(html).toContain('loading="lazy"');
  });

  it('falls back to a single file when the API sent no dimensions', () => {
    const html = renderToStaticMarkup(
      createElement(CoverImage, { gallery: { ...cover, coverWidth: null, coverHeight: null }, sizes: coverSizes(0.5) })
    );
    expect(html).toContain('src="web.webp"');
    expect(html).not.toContain('sizes=');
  });
});
