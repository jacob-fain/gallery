// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../types';
import type { GridPhoto } from './gridItems';

vi.mock('../../api/client', () => ({
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
}));

const client = await import('../../api/client');
const { default: PhotoGrid } = await import('./PhotoGrid');

const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({ page: 'gallery' }, '', '/galleries/g1/photos');
});

const photo = (id: string, review_status: ReviewStatus): GridPhoto => ({
  id,
  gallery_id: 'g1',
  width: 3000,
  height: 2000,
  exif_data: null,
  webUrl: `https://s3.test/${id}-web.jpg`,
  thumbnailUrl: `https://s3.test/${id}-thumb.jpg`,
  review_status,
});

type Save = (id: string, status: ReviewStatus) => void;

// Holds the photos as the Review view does, under a status filter (null for
// All): a photo whose new state is outside the filter leaves at once.
function Harness({ initial, save, filter = null }: { initial: GridPhoto[]; save: Save; filter?: ReviewStatus | null }) {
  const [photos, setPhotos] = useState(initial);
  const keeps = (status: ReviewStatus) => !filter || status === filter;
  const review = {
    keeps,
    toast: null,
    onSetStatus: (id: string, status: ReviewStatus) => {
      if (photos.find((p) => p.id === id)?.review_status === status) return false;
      setPhotos((list) =>
        keeps(status) ? list.map((p) => (p.id === id ? { ...p, review_status: status } : p)) : list.filter((p) => p.id !== id)
      );
      save(id, status);
      return true;
    },
  };
  return <PhotoGrid photos={photos} galleryTitle="People" review={review} />;
}

// The double-tap guard reads Date.now; each step of a test moves it on.
let now = 0;
const later = () => {
  now += 1000;
};
beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

const tiles = () => Array.from(document.querySelectorAll<HTMLElement>('[data-photo-index]'));
const lightbox = () => screen.getByRole('dialog', { name: 'Lightbox' });
const actions = () => within(within(lightbox()).getByRole('group', { name: 'Review' })).getAllByRole('button');
const buttons = () => actions().map((b) => b.textContent?.trim());
const current = () => actions().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent?.trim());

async function open(initial: GridPhoto[], index: number, save: Save = () => {}, filter: ReviewStatus | null = null) {
  const user = userEvent.setup();
  render(<Harness initial={initial} save={save} filter={filter} />);
  await user.click(tiles()[index]);
  return user;
}

describe('PhotoGrid in the admin Review view', () => {
  it('badges the tiles that are not shown with their state', () => {
    render(<Harness initial={[photo('a', 'review'), photo('b', 'shown'), photo('c', 'rejected')]} save={() => {}} />);
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.queryByText('Shown')).toBeNull();
  });

  it('dims only the rejected tiles', () => {
    render(<Harness initial={[photo('a', 'review'), photo('b', 'shown'), photo('c', 'rejected')]} save={() => {}} />);
    const dimmed = tiles().filter((t) => t.closest('.react-photo-album--photo')?.querySelector('[class*="dim"]'));
    expect(dimmed.map((t) => t.getAttribute('data-photo-index'))).toEqual(['2']);
  });

  it.each([
    ['review', 'People · 1 / 1 · Needs review', ['Show on site', 'Reject', 'Needs review']],
    ['shown', 'People · 1 / 1 · Shown', ['Shown', 'Reject', 'Back to review']],
    ['rejected', 'People · 1 / 1 · Rejected', ['Show on site', 'Rejected', 'Back to review']],
  ] as const)('labels a %s photo and keeps the three actions in place, its own pressed', async (status, label, shown) => {
    const save = vi.fn<Save>();
    const user = await open([photo('a', status)], 0, save);
    expect(within(lightbox()).getByText(label)).toBeTruthy();
    expect(buttons()).toEqual(shown);
    const own = actions().find((b) => b.getAttribute('aria-pressed') === 'true')!;
    expect(own.hasAttribute('disabled')).toBe(true);
    expect(actions().filter((b) => b.getAttribute('aria-pressed') === 'false')).toHaveLength(2);
    await user.click(own);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps zoom and close, and offers no download or delete', async () => {
    await open([photo('a', 'review')], 0);
    expect(within(lightbox()).getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(within(lightbox()).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(lightbox()).queryByRole('button', { name: 'Download' })).toBeNull();
    expect(within(lightbox()).queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('under All, acts at once and moves on to the next photo, which keeps its new state', async () => {
    const save = vi.fn<Save>();
    const user = await open([photo('a', 'review'), photo('b', 'review'), photo('c', 'shown')], 0, save);

    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    expect(save).toHaveBeenCalledWith('a', 'shown');
    await waitFor(() => expect(within(lightbox()).getByText('People · 2 / 3 · Needs review')).toBeTruthy());

    later();
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    expect(save).toHaveBeenLastCalledWith('b', 'rejected');
    await waitFor(() => expect(within(lightbox()).getByText('People · 3 / 3 · Shown')).toBeTruthy());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(within(lightbox()).getByText('People · 2 / 3 · Rejected')).toBeTruthy());
  });

  it('under All, stays on the last photo, says so, and keeps every action where it was', async () => {
    const save = vi.fn<Save>();
    const user = await open([photo('a', 'shown'), photo('b', 'review')], 1, save);
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    expect(await within(lightbox()).findByText('That was the last photo in this list.')).toBeTruthy();
    expect(within(lightbox()).getByText('People · 2 / 2 · Shown')).toBeTruthy();
    expect(buttons()).toEqual(['Shown', 'Reject', 'Back to review']);
    expect(current()).toEqual(['Shown']);
  });

  it('in a status filter, drops the photo acted on and shows the next one', async () => {
    const save = vi.fn<Save>();
    const user = await open([photo('a', 'review'), photo('b', 'review'), photo('c', 'review')], 0, save, 'review');
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    expect(save).toHaveBeenCalledWith('a', 'shown');
    await waitFor(() => expect(within(lightbox()).getByText('People · 1 / 2 · Needs review')).toBeTruthy());
    expect(new URLSearchParams(window.location.search).get('photo')).toBe('b');
    expect(tiles()).toHaveLength(2);
    expect(buttons()).toEqual(['Show on site', 'Reject', 'Needs review']);
  });

  it('in a status filter, goes on from the last photo to the first one left', async () => {
    const user = await open([photo('a', 'review'), photo('b', 'review'), photo('c', 'review')], 2, () => {}, 'review');
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(within(lightbox()).getByText('People · 1 / 2 · Needs review')).toBeTruthy());
    expect(new URLSearchParams(window.location.search).get('photo')).toBe('a');
  });

  it('in a status filter, closes once the last photo left', async () => {
    const user = await open([photo('a', 'review')], 0, () => {}, 'review');
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lightbox' })).toBeNull());
    expect(tiles()).toHaveLength(0);
  });

  it('ignores a second tap right after an action', async () => {
    const save = vi.fn<Save>();
    const user = await open([photo('a', 'review'), photo('b', 'review'), photo('c', 'review')], 0, save, 'review');
    await user.click(actions()[0]);
    await waitFor(() => expect(within(lightbox()).getByText('People · 1 / 2 · Needs review')).toBeTruthy());
    await user.click(actions()[0]);
    await user.click(actions()[1]);
    expect(save.mock.calls).toEqual([['a', 'shown']]);
    later();
    await user.click(actions()[1]);
    expect(save.mock.calls).toEqual([
      ['a', 'shown'],
      ['b', 'rejected'],
    ]);
  });

  it('has no keyboard shortcut for the actions', async () => {
    const save = vi.fn<Save>();
    const user = await open([photo('a', 'review'), photo('b', 'review')], 0, save);
    await user.keyboard('srbSRB');
    expect(save).not.toHaveBeenCalled();
  });

  it('counts no visitor views', async () => {
    await open([photo('a', 'review')], 0);
    expect(client.trackPhotoView).not.toHaveBeenCalled();
  });
});
