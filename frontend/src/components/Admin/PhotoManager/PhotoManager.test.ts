import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const { AuthContext } = await import('../../../contexts/auth');
const { default: PhotoManager } = await import('./PhotoManager');

import type { Photo } from '../../../types';
import type { PhotoListHandle } from './usePhotoList';

const photo = (id: string, width = 6000, height = 4000) =>
  ({
    id,
    gallery_id: 'g1',
    original_filename: `${id}.jpg`,
    width,
    height,
    is_hidden: false,
    thumbnailUrl: `${id}-thumb.webp`,
  }) as Photo;

const handle = (items: Photo[], total: number): PhotoListHandle => ({
  list: { items, total },
  status: 'ready',
  error: '',
  loadingMore: false,
  moreFailed: false,
  loadMore: async () => true,
  loadAll: async () => items,
  update: () => {},
  latest: () => ({ items, total }),
  reload: () => {},
});

const render = (photos: PhotoListHandle) =>
  renderToStaticMarkup(
    createElement(
      AuthContext.Provider,
      { value: { token: 't', user: null, isAuthenticated: true, isLoading: false, login: async () => {}, logout: () => {} } },
      createElement(PhotoManager, { photos, gallery: null })
    )
  );

describe('PhotoManager', () => {
  it('loads thumbnails lazily with their size reserved', () => {
    const html = render(handle([photo('a'), photo('b', 400, 300)], 2));
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
    expect(html).toContain('width="600" height="400"');
    // A small original has a thumbnail no wider than itself.
    expect(html).toContain('width="400" height="300"');
  });

  it('says how many photos Select All covers, loaded or not', () => {
    const html = render(handle([photo('a')], 240));
    expect(html).toContain('Select All (240)');
    expect(html).toContain('Showing 1 of 240');
    expect(html).toContain('Photo 1 of 240');
  });

  it('shows no load-more row once every photo is loaded', () => {
    expect(render(handle([photo('a')], 1))).not.toContain('Showing');
  });
});
