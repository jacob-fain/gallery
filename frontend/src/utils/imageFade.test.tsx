// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GalleryCard from '../components/GalleryCard/GalleryCard';
import { HeroImage } from '../pages/HomeImages';
import type { Gallery, PublicPhoto } from '../types';
import { CACHED_LOAD_MS, IMAGE_FADE_PROPS } from './imageFade';

const photo: PublicPhoto = {
  id: 'p1',
  gallery_id: 'g1',
  width: 6000,
  height: 4000,
  exif_data: null,
  webUrl: 'https://s3.test/web.webp',
  thumbnailUrl: 'https://s3.test/thumb.webp',
};

const gallery: Gallery = {
  id: 'g1',
  title: 'Iceland',
  slug: 'iceland',
  coverUrl: 'https://s3.test/cover-thumb.webp',
  coverWebUrl: 'https://s3.test/cover-web.webp',
  coverWidth: 6000,
  coverHeight: 4000,
} as Gallery;

// jsdom loads no images: each one reports incomplete until stubbed.
function stubComplete() {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(600);
}

function clock(start: number) {
  let now = start;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return (ms: number) => {
    now += ms;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image fade', () => {
  it('leaves a loading image unmarked, then marks it to fade in', () => {
    const tick = clock(1000);
    render(<img alt="photo" src="https://s3.test/a.jpg" {...IMAGE_FADE_PROPS} />);
    const img = screen.getByAltText('photo');
    expect(img.dataset.loaded).toBeUndefined();

    tick(CACHED_LOAD_MS + 400);
    fireEvent.load(img);
    expect(img.dataset.loaded).toBe('fade');
  });

  it('shows an image already in the memory cache at once', () => {
    stubComplete();
    render(<img alt="photo" src="https://s3.test/a.jpg" {...IMAGE_FADE_PROPS} />);
    const img = screen.getByAltText('photo');
    expect(img.dataset.loaded).toBe('cached');

    fireEvent.load(img);
    expect(img.dataset.loaded).toBe('cached');
  });

  it('shows an image that loads straight away, from the disk cache, without the fade', () => {
    const tick = clock(1000);
    render(<img alt="photo" src="https://s3.test/a.jpg" {...IMAGE_FADE_PROPS} />);
    tick(CACHED_LOAD_MS / 4);
    fireEvent.load(screen.getByAltText('photo'));
    expect(screen.getByAltText('photo').dataset.loaded).toBe('cached');
  });

  it('keeps an image shown when its src is refreshed', () => {
    const tick = clock(1000);
    const { rerender } = render(<img alt="photo" src="https://s3.test/a.jpg" {...IMAGE_FADE_PROPS} />);
    tick(500);
    fireEvent.load(screen.getByAltText('photo'));

    rerender(<img alt="photo" src="https://s3.test/a-fresh.jpg" {...IMAGE_FADE_PROPS} />);
    expect(screen.getByAltText('photo').dataset.loaded).toBe('fade');
  });

  it.each([
    ['a gallery cover', () => render(<MemoryRouter><GalleryCard gallery={gallery} /></MemoryRouter>), 'Iceland'],
    ['the homepage hero', () => render(<HeroImage photo={photo} />), ''],
  ])('marks %s once it loads', (_name, renderImage, alt) => {
    const tick = clock(1000);
    const { container } = renderImage();
    const img = alt ? screen.getByAltText(alt) : container.querySelector('img');
    if (!img) throw new Error('no image');
    expect(img.dataset.loaded).toBeUndefined();

    tick(500);
    fireEvent.load(img);
    expect(img.dataset.loaded).toBe('fade');
  });
});
