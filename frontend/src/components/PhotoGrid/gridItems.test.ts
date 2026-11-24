import { describe, expect, it } from 'vitest';
import type { PublicPhoto } from '../../types';
import { gridColumns, toAlbumPhotos, toLightboxSlides } from './gridItems';

const photo = (id: string, width = 6000, height = 4000): PublicPhoto => ({
  id,
  gallery_id: 'g1',
  width,
  height,
  exif_data: null,
  webUrl: `${id}-web.webp`,
  thumbnailUrl: `${id}-thumb.webp`,
});

describe('toAlbumPhotos', () => {
  it('offers the thumbnail first and both sizes in the srcset', () => {
    const [tile] = toAlbumPhotos([photo('a')]);
    expect(tile.src).toBe('a-thumb.webp');
    expect(tile.srcSet.map((c) => c.width)).toEqual([600, 1920]);
    expect([tile.width, tile.height]).toEqual([1920, 1280]);
  });

  it('keys tiles by photo id so fresh URLs update tiles in place', () => {
    const tiles = toAlbumPhotos([photo('a'), photo('b')]);
    expect(tiles.map((t) => t.key)).toEqual(['a', 'b']);
  });

  it('names the gallery in the alt text', () => {
    const tiles = toAlbumPhotos([photo('a'), photo('b')], 'Iceland');
    expect(tiles[1].alt).toBe('Photo 2 of 2 in Iceland');
  });

  it('falls back to the web URL when dimensions are missing', () => {
    const [tile] = toAlbumPhotos([photo('a', 0, 0)]);
    expect(tile.src).toBe('a-web.webp');
    expect(tile.srcSet).toEqual([]);
  });
});

describe('toLightboxSlides', () => {
  it('shows the web size, never an original, and carries the photo id for downloads', () => {
    const [slide] = toLightboxSlides([photo('a')]);
    expect(slide.src).toBe('a-web.webp');
    expect(slide.photoId).toBe('a');
    expect(slide.srcSet.map((c) => c.src)).toEqual(['a-thumb.webp', 'a-web.webp']);
  });
});

describe('gridColumns', () => {
  it('uses one column on phones, two on tablets, three on desktops', () => {
    expect([gridColumns(375), gridColumns(768), gridColumns(1400)]).toEqual([1, 2, 3]);
  });
});
