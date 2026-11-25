// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo, ReviewStatus, StatusCounts } from '../../../types';

vi.mock('../../../api/client', () => ({
  deleteRejectedPhotos: vi.fn(),
  setPhotosStatus: vi.fn(),
  deletePhoto: vi.fn(),
  setCoverImage: vi.fn(),
  reorderPhotos: vi.fn(),
  movePhotos: vi.fn(),
  getAllGalleries: vi.fn(),
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
}));
vi.mock('../PhotoUpload/PhotoUpload', () => ({ default: () => null }));

const client = await import('../../../api/client');
const { default: PhotoReviewSection } = await import('./PhotoReviewSection');

const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

const photo = (id: string, review_status: ReviewStatus) =>
  ({
    id,
    gallery_id: null,
    original_filename: `${id}.jpg`,
    width: 600,
    height: 400,
    review_status,
    thumbnailUrl: `https://s3.test/${id}-thumb.webp`,
    webUrl: `https://s3.test/${id}-web.webp`,
  }) as Photo;

const countsOf = (photos: Photo[]): StatusCounts => ({
  review: photos.filter((p) => p.review_status === 'review').length,
  shown: photos.filter((p) => p.review_status === 'shown').length,
  rejected: photos.filter((p) => p.review_status === 'rejected').length,
  all: photos.length,
});

// A server holding these photos: pages as the admin list asks for them, and
// status changes applied when setPhotosStatus resolves.
function server(photos: Photo[]) {
  vi.mocked(client.setPhotosStatus).mockImplementation(async (ids, status) => {
    for (const p of photos) if (ids.includes(p.id)) p.review_status = status;
    return { updated: ids.length };
  });
  return vi.fn(async (offset: number, limit: number, status: ReviewStatus | null) => {
    const list = status ? photos.filter((p) => p.review_status === status) : photos;
    // Copies, as a real response is: the server's photos change on their own.
    const page = list.slice(offset, offset + limit).map((p) => ({ ...p }));
    return { photos: page, total: list.length, counts: countsOf(photos) };
  });
}

// The double-tap guard reads Date.now; later() is a pause between taps.
let now = 0;
const later = () => {
  now += 1000;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.pushState({}, '', '/unassigned');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.useRealTimers();
});

async function openViewer(photos: Photo[], index: number, filter?: RegExp) {
  const user = userEvent.setup();
  render(
    <PhotoReviewSection
      scope="unassigned"
      gallery={null}
      galleryTitle="Unassigned"
      fetchPage={server(photos)}
      uploadsGo="start"
      header={() => null}
      loading={<p>Loading...</p>}
    />
  );
  await waitFor(() => expect(document.querySelectorAll('[data-photo-index]').length).toBeGreaterThan(0));
  if (filter) {
    await user.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: filter }));
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  }
  await user.click(document.querySelector<HTMLElement>(`[data-photo-index="${index}"]`)!);
  return user;
}

const lightbox = () => screen.getByRole('dialog', { name: 'Lightbox' });
const label = () => within(lightbox()).getByText(/^Unassigned · /).textContent;
const actions = () => within(within(lightbox()).getByRole('group', { name: 'Review' })).getAllByRole('button');
const pillText = () => document.querySelector('[aria-label="Status"]')!.textContent;
const statusCalls = () => vi.mocked(client.setPhotosStatus).mock.calls;

describe('Review viewer actions', () => {
  it('Show on site and then an immediate tap in the same place does not reject the photo', async () => {
    const user = await openViewer([photo('a', 'review'), photo('b', 'review'), photo('c', 'review')], 2);
    expect(label()).toBe('Unassigned · 3 / 3 · Needs review');
    const showAt = actions()[0];
    expect(showAt.textContent).toBe('Show on site');

    await user.click(showAt);
    await user.click(actions()[0]);
    await user.dblClick(actions()[0]);

    expect(statusCalls()).toEqual([[['c'], 'shown']]);
    // The shown photo left Needs review and the viewer went on to the first one left.
    expect(label()).toBe('Unassigned · 1 / 2 · Needs review');
    expect(actions().map((b) => b.textContent)).toEqual(['Show on site', 'Reject', 'Needs review']);
  });

  it('under All, the misclick lands on the pressed state, not on Reject', async () => {
    const user = await openViewer([photo('s', 'shown'), photo('a', 'review')], 1, /^All/);
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    later();
    // The photo stays (the last in the list); the same place now reads
    // Shown, pressed and disabled.
    const same = actions()[0];
    expect(same.textContent).toBe('Shown');
    expect(same.getAttribute('aria-pressed')).toBe('true');
    await user.click(same);
    expect(statusCalls()).toEqual([[['a'], 'shown']]);
    expect(label()).toBe('Unassigned · 2 / 2 · Shown');
    expect(within(lightbox()).getByText('That was the last photo in this list.')).toBeTruthy();
  });

  it('under All, keeps the photo in the list and still moves on', async () => {
    const user = await openViewer([photo('s', 'shown'), photo('a', 'review'), photo('b', 'review')], 1, /^All/);
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    expect(label()).toBe('Unassigned · 3 / 3 · Needs review');
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(label()).toBe('Unassigned · 2 / 3 · Rejected'));
  });

  it.each([
    ['review', /^Needs review/, 'Reject', 'Rejected · Undo'],
    ['shown', /^Shown/, 'Back to review', 'Moved to review · Undo'],
    ['rejected', /^Rejected/, 'Show on site', 'Shown on site · Undo'],
  ] as const)('in the %s filter, a photo that leaves it leaves the list at once', async (state, pill, action, toast) => {
    const others = (['review', 'shown', 'rejected'] as const).filter((s) => s !== state).map((s, i) => photo(`o${i}`, s));
    const user = await openViewer([photo('a', state), photo('b', state), ...others], 0, pill);
    expect(label()).toMatch(/^Unassigned · 1 \/ 2 · /);
    await user.click(within(lightbox()).getByRole('button', { name: action }));
    expect(label()).toMatch(/^Unassigned · 1 \/ 1 · /);
    expect(new URLSearchParams(window.location.search).get('photo')).toBe('b');
    expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(1);
    expect(within(lightbox()).getByRole('status').textContent).toBe(toast);
  });

  it('Undo puts the photo back where it was with one request, and the counts with it', async () => {
    const user = await openViewer([photo('a', 'review'), photo('b', 'review'), photo('c', 'review')], 0);
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    expect(label()).toBe('Unassigned · 1 / 2 · Needs review');
    await waitFor(() => expect(pillText()).toContain('Needs review · 2'));
    expect(pillText()).toContain('Shown · 1');
    expect(within(lightbox()).getByRole('status').textContent).toBe('Shown on site · Undo');

    await user.click(within(lightbox()).getByRole('button', { name: 'Undo' }));
    expect(label()).toBe('Unassigned · 1 / 3 · Needs review');
    expect(new URLSearchParams(window.location.search).get('photo')).toBe('a');
    expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(3);
    await waitFor(() => expect(statusCalls()).toHaveLength(2));
    expect(statusCalls()[1]).toEqual([['a'], 'review']);
    expect(pillText()).toContain('Needs review · 3');
    expect(pillText()).toContain('Shown · 0');
    expect(within(lightbox()).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('Undo waits for the change it undoes, so the two arrive in order', async () => {
    let finish!: () => void;
    const user = await openViewer([photo('a', 'review'), photo('b', 'review')], 0);
    vi.mocked(client.setPhotosStatus).mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({ updated: 1 })))
    );
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    await user.click(within(lightbox()).getByRole('button', { name: 'Undo' }));
    expect(statusCalls()).toEqual([[['a'], 'rejected']]);
    await act(async () => finish());
    await waitFor(() => expect(statusCalls()).toEqual([[['a'], 'rejected'], [['a'], 'review']]));
  });

  it('hides the toast after about five seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    const user = await openViewer([photo('a', 'review'), photo('b', 'review')], 0);
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    expect(within(lightbox()).getByRole('button', { name: 'Undo' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(4000));
    expect(within(lightbox()).getByRole('button', { name: 'Undo' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1100));
    expect(within(lightbox()).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('ignores a second action on a photo while its change is being saved', async () => {
    let finish!: () => void;
    const user = await openViewer([photo('s', 'shown'), photo('a', 'review')], 1, /^All/);
    vi.mocked(client.setPhotosStatus).mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({ updated: 1 })))
    );
    await user.click(within(lightbox()).getByRole('button', { name: 'Show on site' }));
    later();
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    expect(statusCalls()).toEqual([[['a'], 'shown']]);
    expect(label()).toBe('Unassigned · 2 / 2 · Shown');

    await act(async () => finish());
    later();
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    expect(statusCalls()).toEqual([[['a'], 'shown'], [['a'], 'rejected']]);
  });

  it('puts the photo back in place and says so when the save fails', async () => {
    const user = await openViewer([photo('a', 'review'), photo('b', 'review')], 0);
    vi.mocked(client.setPhotosStatus).mockRejectedValueOnce(new Error('Server error'));
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    expect((await within(lightbox()).findByRole('alert')).textContent).toBe('Server error: the photo was not changed.');
    expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(2);
    expect(pillText()).toContain('Needs review · 2');
    expect(pillText()).toContain('Rejected · 0');
  });

  it('takes the photo out again and says so when the undo fails', async () => {
    const user = await openViewer([photo('a', 'review'), photo('b', 'review')], 0);
    await user.click(within(lightbox()).getByRole('button', { name: 'Reject' }));
    vi.mocked(client.setPhotosStatus).mockRejectedValueOnce(new Error('Server error'));
    await user.click(within(lightbox()).getByRole('button', { name: 'Undo' }));
    expect((await within(lightbox()).findByRole('alert')).textContent).toBe('Server error: the undo was not saved.');
    expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(1);
    expect(pillText()).toContain('Rejected · 1');
  });
});
