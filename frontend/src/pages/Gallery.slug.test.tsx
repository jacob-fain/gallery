// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
  getGallery: vi.fn(),
  getGalleryPhotos: vi.fn(),
  getGalleryDownloadUrl: vi.fn(() => '/download'),
  isKnownPrivateGallery: vi.fn(() => false),
  verifyGalleryPassword: vi.fn(),
  trackGalleryView: vi.fn(),
}));
vi.mock('../components/PhotoGrid/PhotoGrid', () => ({
  default: ({ photos }: { photos: PublicPhoto[] }) => <p>{photos.length} photos shown</p>,
}));

const client = await import('../api/client');
const { default: Gallery } = await import('./Gallery');

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/g/:slug" element={<Gallery />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Gallery page slugs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Answers any request with the public gallery list's shape, as the API
    // did for /api/galleries/?x before slugs were checked.
    vi.mocked(client.getGallery).mockResolvedValue({ id: 'g1', title: 'People', slug: 'people' } as never);
    vi.mocked(client.getGalleryPhotos).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as PublicPhoto[]);
  });

  it.each([
    '/g/people%3Faccess%3D1',
    '/g/%3Fx',
    '/g/..%2Fgalleries%2Fpeople',
    '/g/a%2Fb',
    '/g/People',
    '/g/trailing-',
  ])('shows Gallery not found for %s without asking the API', async (path) => {
    renderAt(path);

    expect(await screen.findByText('Gallery not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Shuffle photos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download all photos as ZIP' })).toBeNull();
    expect(client.getGallery).not.toHaveBeenCalled();
    expect(client.getGalleryPhotos).not.toHaveBeenCalled();
    expect(client.trackGalleryView).not.toHaveBeenCalled();
  });

  it('loads a well-formed slug', async () => {
    renderAt('/g/people');

    expect(await screen.findByText('2 photos shown')).toBeTruthy();
    expect(client.getGallery).toHaveBeenCalledWith('people');
  });
});
