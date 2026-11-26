// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../../types';

vi.mock('../../../api/client', () => ({
  deletePhoto: vi.fn(),
  setCoverImage: vi.fn(),
  reorderPhotos: vi.fn(),
  movePhotos: vi.fn(),
  getAllGalleries: vi.fn(),
  updatePhoto: vi.fn(),
}));

const { default: PhotoManager } = await import('./PhotoManager');
const { usePhotoList } = await import('./usePhotoList');

const photo = (id: string, width: number, height: number) =>
  ({
    id,
    gallery_id: null,
    original_filename: `${id}.jpg`,
    width,
    height,
    review_status: 'shown',
    thumbnailUrl: `https://s3.test/${id}-thumb.webp`,
    webUrl: `https://s3.test/${id}-web.webp`,
  }) as Photo;

const photos = [photo('landscape', 6000, 4000), photo('portrait', 4000, 6000), photo('small', 500, 400)];
const loadPage = async () => ({ photos, total: photos.length });

function Harness() {
  return <PhotoManager photos={usePhotoList(loadPage)} gallery={null} />;
}

const thumb = (n: number) => screen.getByAltText(`Photo ${n} of 3`) as HTMLImageElement;

// jsdom lays nothing out; a browser reports the grid's columns like this.
function columnsOf(width: number) {
  const real = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    if (!(el instanceof HTMLElement) || !el.querySelector('img')) return style;
    return { ...style, gridTemplateColumns: `${width}px ${width}px ${width}px` } as CSSStyleDeclaration;
  });
}

describe('PhotoManager grid thumbnails', () => {
  afterEach(() => vi.restoreAllMocks());

  it('list the web size too, sized to the width a covering image is drawn at', async () => {
    columnsOf(204);
    render(<Harness />);
    await screen.findByText('landscape.jpg');
    const landscape = thumb(1);
    expect(landscape.getAttribute('src')).toBe('https://s3.test/landscape-thumb.webp');
    expect(landscape.getAttribute('srcset')).toBe(
      'https://s3.test/landscape-thumb.webp 600w, https://s3.test/landscape-web.webp 1920w'
    );
    // Covering a 204px square, a 3:2 photo is drawn 306px wide.
    expect(landscape.getAttribute('sizes')).toBe('306px');
    expect(thumb(2).getAttribute('sizes')).toBe('204px');
    // A photo with one size has nothing to choose between.
    expect(thumb(3).hasAttribute('srcset')).toBe(false);
  });

  it('keep the thumbnail alone until the grid has been measured', async () => {
    render(<Harness />);
    await screen.findByText('landscape.jpg');
    expect(thumb(1).hasAttribute('srcset')).toBe(false);
    expect(thumb(1).getAttribute('src')).toBe('https://s3.test/landscape-thumb.webp');
  });
});
