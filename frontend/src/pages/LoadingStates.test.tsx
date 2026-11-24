// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gallery as GalleryType, PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
  getGallery: vi.fn(),
  getGalleries: vi.fn(),
  getAllPhotos: vi.fn(),
  getGalleryPhotos: vi.fn(),
  getGalleryDownloadUrl: vi.fn(async () => '/download'),
  isKnownPrivateGallery: vi.fn(() => false),
  verifyGalleryPassword: vi.fn(),
  trackGalleryView: vi.fn(),
}));
// The real grid needs layout measurements that jsdom cannot provide.
vi.mock('../components/PhotoGrid/PhotoGrid', () => ({
  default: ({ photos }: { photos: PublicPhoto[] }) => (
    <>
      <p>{photos.length} photos shown</p>
      <img alt="First photo" />
    </>
  ),
}));

const client = await import('../api/client');
const { default: Gallery } = await import('./Gallery');
const { default: Galleries } = await import('./Galleries');
const { default: AllPhotos } = await import('./AllPhotos');
const { SKELETON_DELAY_MS } = await import('../components/Skeleton/Skeleton');

const gallery: GalleryType = { id: 'g1', title: 'Iceland', slug: 'iceland', photoCount: 2 } as GalleryType;
const photos = [{ id: 'p1' }, { id: 'p2' }] as PublicPhoto[];

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/g/:slug" element={<Gallery />} />
        <Route path="/galleries" element={<Galleries />} />
        <Route path="/photos" element={<AllPhotos />} />
      </Routes>
    </MemoryRouter>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const blocks = () => document.querySelectorAll('[data-skeleton]');

describe('loading skeletons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['/galleries', 'Galleries'],
    ['/g/iceland', 'a gallery'],
    ['/photos', 'All Photos'],
  ])('shows placeholder blocks on %s (%s) only once loading takes a while', async (path) => {
    // Never answers: the page stays loading.
    const pending = new Promise<never>(() => {});
    vi.mocked(client.getGalleries).mockReturnValue(pending);
    vi.mocked(client.getGallery).mockReturnValue(pending);
    vi.mocked(client.getGalleryPhotos).mockReturnValue(pending);
    vi.mocked(client.getAllPhotos).mockReturnValue(pending);
    renderAt(path);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('Loading...')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(blocks()).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(blocks().length).toBeGreaterThan(1);
  });

  it('shows nothing in between when the page loads quickly', async () => {
    const galleries = deferred<GalleryType[]>();
    vi.mocked(client.getGalleries).mockReturnValue(galleries.promise);
    renderAt('/galleries');

    await act(async () => {
      galleries.resolve([gallery]);
    });
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(blocks()).toHaveLength(0);
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(screen.getByRole('link', { name: /Iceland/ })).toBeTruthy();
  });
});

describe('gallery floating buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getGallery).mockResolvedValue(gallery);
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos);
  });

  it('appear once the first photo has loaded', async () => {
    renderAt('/g/iceland');

    const firstPhoto = await screen.findByAltText('First photo');
    expect(screen.getByText('2 photos shown')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Shuffle photos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download all photos as ZIP' })).toBeNull();

    fireEvent.load(firstPhoto);
    expect(screen.getByRole('button', { name: 'Shuffle photos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download all photos as ZIP' })).toBeTruthy();
  });

  it('appear when the photos fail to load, so the download stays reachable', async () => {
    renderAt('/g/iceland');

    fireEvent.error(await screen.findByAltText('First photo'));
    expect(screen.getByRole('button', { name: 'Download all photos as ZIP' })).toBeTruthy();
  });
});
