// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gallery as GalleryType, PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
  getGallery: vi.fn(),
  getGalleries: vi.fn(),
  getAllPhotos: vi.fn(),
  getGalleryPhotos: vi.fn(),
  getGalleryDownloadUrl: vi.fn(() => '/download'),
  isKnownPrivateGallery: vi.fn(() => false),
  verifyGalleryPassword: vi.fn(),
  trackGalleryView: vi.fn(),
}));
// The real grid needs layout measurements that jsdom cannot provide.
vi.mock('../components/PhotoGrid/PhotoGrid', () => ({
  default: ({ photos }: { photos: PublicPhoto[] }) => <p>{photos.length} photos shown</p>,
}));

const client = await import('../api/client');
const { default: Gallery } = await import('./Gallery');
const { default: Galleries } = await import('./Galleries');
const { default: AllPhotos } = await import('./AllPhotos');

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) as PublicPhoto[];

const publicGallery = (overrides: Partial<GalleryType> = {}): GalleryType => ({
  id: 'g1',
  title: 'Iceland',
  slug: 'iceland',
  description: 'Two weeks on the Ring Road.',
  photoCount: 101,
  ...overrides,
});

function renderAt(path: string) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/g/:slug" element={<Gallery />} />
        <Route path="/galleries" element={<Galleries />} />
        <Route path="/photos" element={<AllPhotos />} />
      </Routes>
    </MemoryRouter>
  );
  return user;
}

const onlyHeading = () => {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  return headings[0];
};

describe('page headings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(client.isKnownPrivateGallery).mockReturnValue(false);
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos(3));
  });

  it('the galleries page has one heading above the covers', async () => {
    vi.mocked(client.getGalleries).mockResolvedValue([publicGallery()]);
    renderAt('/galleries');
    expect(await screen.findByRole('link')).toBeTruthy();
    expect(onlyHeading().textContent).toBe('Galleries');
  });

  it('the galleries page keeps its heading when there are no galleries', async () => {
    vi.mocked(client.getGalleries).mockResolvedValue([]);
    renderAt('/galleries');
    expect(await screen.findByText('No galleries yet. Check back soon!')).toBeTruthy();
    expect(onlyHeading().textContent).toBe('Galleries');
  });

  it('the all photos page has one heading above the grid', async () => {
    vi.mocked(client.getAllPhotos).mockResolvedValue(photos(2));
    renderAt('/photos');
    expect(await screen.findByText('2 photos shown')).toBeTruthy();
    expect(onlyHeading().textContent).toBe('All Photos');
  });

  it('a gallery shows its title, photo count and description', async () => {
    vi.mocked(client.getGallery).mockResolvedValue(publicGallery());
    renderAt('/g/iceland');
    expect(await screen.findByText('3 photos shown')).toBeTruthy();
    expect(onlyHeading().textContent).toBe('Iceland');
    // The count is the API's, which counts only visible photos.
    expect(screen.getByText('101 photos')).toBeTruthy();
    expect(screen.getByText('Two weeks on the Ring Road.')).toBeTruthy();
  });

  it('a gallery with one photo says "1 photo"', async () => {
    vi.mocked(client.getGallery).mockResolvedValue(publicGallery({ photoCount: 1 }));
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos(1));
    renderAt('/g/iceland');
    expect(await screen.findByText('1 photo')).toBeTruthy();
  });

  it('a gallery without a description shows no description line', async () => {
    vi.mocked(client.getGallery).mockResolvedValue(publicGallery({ description: null }));
    renderAt('/g/iceland');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Iceland' });
    const header = heading.parentElement!;
    expect(header.querySelectorAll('p')).toHaveLength(1);
    expect(header.textContent).toBe('Iceland101 photos');
  });

  it('a private gallery shows the heading only once it is unlocked', async () => {
    vi.mocked(client.isKnownPrivateGallery).mockReturnValue(true);
    vi.mocked(client.getGallery).mockResolvedValue({
      title: 'Smith Wedding',
      slug: 'smith',
      is_public: false,
      requires_password: true,
    });
    vi.mocked(client.verifyGalleryPassword).mockResolvedValue({
      title: 'Smith Wedding',
      slug: 'smith',
      description: 'June in the vineyard.',
      photoCount: 2,
      is_public: false,
      verified: true,
      accessToken: 'token-1',
    });
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos(2));
    const user = renderAt('/g/smith');

    await user.type(await screen.findByPlaceholderText('Enter password'), 'secret');
    expect(onlyHeading().textContent).toBe('Smith Wedding');
    expect(screen.queryByText('2 photos')).toBeNull();
    expect(screen.queryByText('June in the vineyard.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'View Gallery' }));

    expect(await screen.findByText('2 photos')).toBeTruthy();
    expect(onlyHeading().textContent).toBe('Smith Wedding');
    expect(screen.getByText('June in the vineyard.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Enter password')).toBeNull();
  });

  it('a private gallery revisited with a stored token keeps its description and count', async () => {
    sessionStorage.setItem('gallery_access_smith', 'token-1');
    sessionStorage.setItem(
      'gallery_details_smith',
      JSON.stringify({ description: 'June in the vineyard.', photoCount: 2 })
    );
    vi.mocked(client.getGallery).mockResolvedValue({
      title: 'Smith Wedding',
      slug: 'smith',
      is_public: false,
      requires_password: true,
    });
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos(2));
    renderAt('/g/smith');

    expect(await screen.findByText('2 photos')).toBeTruthy();
    expect(onlyHeading().textContent).toBe('Smith Wedding');
    expect(screen.getByText('June in the vineyard.')).toBeTruthy();
  });
});
