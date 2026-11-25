// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gallery, Photo } from '../../types';

vi.mock('../../api/client', () => ({
  getHomepagePhotos: vi.fn(),
  setHeroPhoto: vi.fn(),
  addToHomepage: vi.fn(),
  removeFromHomepage: vi.fn(),
  reorderHomepagePhotos: vi.fn(),
  getAllGalleries: vi.fn(),
  getGalleryPhotosPage: vi.fn(),
}));

const client = await import('../../api/client');
const { default: Homepage } = await import('./Homepage');

const photo = (id: string, signing: number) =>
  ({
    id,
    gallery_id: 'g1',
    gallery_title: 'People',
    original_filename: `${id}.jpg`,
    width: 600,
    height: 400,
    is_hidden: false,
    thumbnailUrl: `https://s3.test/${id}-thumb.webp?sig=${signing}`,
  }) as Photo;

let signing = 0;
const signed = (ids: string[]) => {
  signing++;
  return ids.map((id) => photo(id, signing));
};

const images = (container: HTMLElement) => Array.from(container.querySelectorAll('img'));

describe('admin Homepage expired thumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signing = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.mocked(client.getHomepagePhotos).mockImplementation(async () => signed(['hero', 'f1']));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches the homepage photos when one of their images fails', async () => {
    const { container } = render(<Homepage />);
    await screen.findByText('Featured Photos');
    expect(images(container).map((img) => img.src)).toEqual([
      'https://s3.test/hero-thumb.webp?sig=1',
      'https://s3.test/f1-thumb.webp?sig=1',
    ]);

    fireEvent.error(images(container)[1]);

    await waitFor(() => expect(images(container)[1].src).toContain('sig=2'));
    expect(images(container)[0].src).toContain('sig=2');
    expect(client.getHomepagePhotos).toHaveBeenCalledTimes(2);

    // Once a minute at most.
    fireEvent.error(images(container)[0]);
    expect(client.getHomepagePhotos).toHaveBeenCalledTimes(2);
  });

  it('refetches the picker photos when a picker image fails, leaving the featured list alone', async () => {
    vi.mocked(client.getAllGalleries).mockResolvedValue([{ id: 'g1', title: 'People' } as Gallery]);
    vi.mocked(client.getGalleryPhotosPage).mockImplementation(async (_id, offset, limit) => {
      const all = signed(['p1', 'p2']);
      return { photos: all.slice(offset, offset + limit), total: all.length };
    });
    const user = userEvent.setup();
    const { container } = render(<Homepage />);
    await user.click(await screen.findByRole('button', { name: 'Add Photos' }));
    await user.selectOptions(await screen.findByRole('combobox'), 'g1');
    await waitFor(() => expect(container.querySelector('img[src*="p2-thumb"]')).toBeTruthy());
    const homepageCalls = vi.mocked(client.getHomepagePhotos).mock.calls.length;

    fireEvent.error(container.querySelector('img[src*="p2-thumb"]')!);

    await waitFor(() => expect(client.getGalleryPhotosPage).toHaveBeenCalledTimes(2));
    expect(client.getGalleryPhotosPage).toHaveBeenLastCalledWith('g1', 0, 2);
    const picker = container.querySelector('img[src*="p2-thumb"]') as HTMLImageElement;
    expect(picker.src).toContain(`sig=${signing}`);
    expect(client.getHomepagePhotos).toHaveBeenCalledTimes(homepageCalls);
  });
});
