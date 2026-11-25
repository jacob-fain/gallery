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

type Save = (id: string, status: ReviewStatus) => Promise<string | null>;

// Holds the photos as the Review view does: the change applies at once, and
// goes back when the save reports an error.
function Harness({ initial, save }: { initial: GridPhoto[]; save: Save }) {
  const [photos, setPhotos] = useState(initial);
  const set = (id: string, status: ReviewStatus) =>
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, review_status: status } : p)));
  const review = {
    onSetStatus: async (id: string, status: ReviewStatus) => {
      const before = photos.find((p) => p.id === id)!.review_status!;
      set(id, status);
      const error = await save(id, status);
      if (error) set(id, before);
      return error;
    },
  };
  return <PhotoGrid photos={photos} galleryTitle="People" review={review} />;
}

const tiles = () => Array.from(document.querySelectorAll<HTMLElement>('[data-photo-index]'));
const lightbox = () => screen.getByRole('dialog', { name: 'Lightbox' });
const buttons = () =>
  within(lightbox())
    .getAllByRole('button')
    .map((b) => b.textContent?.trim())
    .filter((t) => t === 'Show on site' || t === 'Reject' || t === 'Back to review');

async function open(initial: GridPhoto[], index: number, save: Save = async () => null) {
  const user = userEvent.setup();
  render(<Harness initial={initial} save={save} />);
  await user.click(tiles()[index]);
  return user;
}

describe('PhotoGrid in the admin Review view', () => {
  it('badges the tiles that are not shown with their state', () => {
    render(<Harness initial={[photo('a', 'review'), photo('b', 'shown'), photo('c', 'rejected')]} save={async () => null} />);
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.queryByText('Shown')).toBeNull();
  });

  it.each([
    ['review', 'People · 1 / 1 · Needs review', ['Show on site', 'Reject']],
    ['shown', 'People · 1 / 1 · Shown', ['Reject', 'Back to review']],
    ['rejected', 'People · 1 / 1 · Rejected', ['Show on site', 'Back to review']],
  ] as const)('labels a %s photo with its state and offers the other states', async (status, label, actions) => {
    await open([photo('a', status)], 0);
    expect(within(lightbox()).getByText(label)).toBeTruthy();
    expect(buttons()).toEqual(actions);
  });

  it('keeps zoom and close, and offers no download or delete', async () => {
    await open([photo('a', 'review')], 0);
    expect(within(lightbox()).getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(within(lightbox()).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(lightbox()).queryByRole('button', { name: 'Download' })).toBeNull();
    expect(within(lightbox()).queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('acts at once and moves on to the next photo', async () => {
    const save = vi.fn<Save>(async () => null);
    const user = await open([photo('a', 'review'), photo('b', 'review'), photo('c', 'shown')], 0, save);

    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    expect(save).toHaveBeenCalledWith('a', 'shown');
    await waitFor(() => expect(within(lightbox()).getByText('People · 2 / 3 · Needs review')).toBeTruthy());

    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    expect(save).toHaveBeenLastCalledWith('b', 'rejected');
    await waitFor(() => expect(within(lightbox()).getByText('People · 3 / 3 · Shown')).toBeTruthy());
    // The photos acted on keep their new state.
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(within(lightbox()).getByText('People · 2 / 3 · Rejected')).toBeTruthy());
  });

  it('stays on the last photo and says so', async () => {
    const user = await open([photo('a', 'shown'), photo('b', 'review')], 1);
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    expect(await within(lightbox()).findByText('That was the last photo in this list.')).toBeTruthy();
    expect(within(lightbox()).getByText('People · 2 / 2 · Shown')).toBeTruthy();
    // Back to review undoes it.
    await user.click(within(lightbox()).getByRole('button', { name: 'Back to review' }));
    await waitFor(() => expect(within(lightbox()).getByText('People · 2 / 2 · Needs review')).toBeTruthy());
  });

  it('puts the state back and says so when the save fails', async () => {
    const user = await open([photo('a', 'review'), photo('b', 'review')], 0, async () => 'Server error: the photo was not changed.');
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    expect((await within(lightbox()).findByRole('alert')).textContent).toBe('Server error: the photo was not changed.');
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(within(lightbox()).getByText('People · 1 / 2 · Needs review')).toBeTruthy());
  });

  it('has no keyboard shortcut for the actions', async () => {
    const save = vi.fn<Save>(async () => null);
    const user = await open([photo('a', 'review'), photo('b', 'review')], 0, save);
    await user.keyboard('srbSRB');
    expect(save).not.toHaveBeenCalled();
  });

  it('counts no visitor views', async () => {
    await open([photo('a', 'review')], 0);
    expect(client.trackPhotoView).not.toHaveBeenCalled();
  });
});
