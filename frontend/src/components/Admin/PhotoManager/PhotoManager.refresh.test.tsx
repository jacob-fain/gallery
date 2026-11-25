// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { REFRESH_INTERVAL_MS } = await import('./useRefreshOnImageError');

const photo = (id: string, signing: number, review_status: Photo['review_status'] = 'shown') =>
  ({
    id,
    gallery_id: null,
    original_filename: `${id}.jpg`,
    width: 4344,
    height: 7728,
    review_status,
    thumbnailUrl: `https://s3.test/${id}-thumb.webp?sig=${signing}`,
    webUrl: `https://s3.test/${id}-web.webp?sig=${signing}`,
  }) as Photo;

// Every request signs the URLs anew, as the API does once its cached ones
// near expiry.
let signing = 0;
const loadPage = vi.fn(async (offset: number, limit: number) => {
  signing++;
  const all = [photo('a', signing), photo('b', signing), photo('c', signing)];
  return { photos: all.slice(offset, offset + limit), total: all.length };
});

function Harness() {
  const photos = usePhotoList(loadPage);
  return <PhotoManager photos={photos} gallery={null} />;
}

const thumb = (n: number) => screen.getByAltText(`Photo ${n} of 3`) as HTMLImageElement;

describe('PhotoManager expired thumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signing = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches the loaded photos when a thumbnail fails, and shows the new URLs', async () => {
    render(<Harness />);
    await screen.findByText('a.jpg');
    expect(thumb(2).src).toContain('sig=1');

    fireEvent.error(thumb(2));

    await waitFor(() => expect(thumb(2).src).toContain('sig=2'));
    expect(loadPage).toHaveBeenLastCalledWith(0, 3);
    expect(thumb(1).src).toContain('sig=2');
    expect(thumb(3).src).toContain('sig=2');
  });

  it('refreshes at most once a minute', async () => {
    render(<Harness />);
    await screen.findByText('a.jpg');

    fireEvent.error(thumb(1));
    await waitFor(() => expect(thumb(1).src).toContain('sig=2'));
    fireEvent.error(thumb(1));
    fireEvent.error(thumb(2));
    expect(loadPage).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    fireEvent.error(thumb(1));
    await waitFor(() => expect(thumb(1).src).toContain('sig=3'));
    expect(loadPage).toHaveBeenCalledTimes(3);
  });

  it('keeps what the admin changed in the list and only swaps the URLs', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('a.jpg');
    // A selection survives the refresh, and the list keeps its length.
    await user.click(screen.getAllByRole('checkbox')[2]);
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.error(thumb(1));

    await waitFor(() => expect(thumb(1).src).toContain('sig=2'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getAllByAltText(/^Photo \d of 3$/)).toHaveLength(3);
  });

  it('ignores image errors outside the grid', async () => {
    render(
      <>
        <Harness />
        <img alt="elsewhere" src="https://elsewhere.test/x.png" />
      </>
    );
    await screen.findByText('a.jpg');

    fireEvent.error(screen.getByAltText('elsewhere'));

    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it('keeps the old URLs when the refresh fails', async () => {
    render(<Harness />);
    await screen.findByText('a.jpg');
    loadPage.mockRejectedValueOnce(new Error('offline'));

    fireEvent.error(thumb(1));

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2));
    expect(thumb(1).src).toContain('sig=1');
    expect(screen.getAllByAltText(/^Photo \d of 3$/)).toHaveLength(3);
  });
});
