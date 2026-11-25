// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
// The upload panel has its own tests and needs the upload queue's context.
vi.mock('../PhotoUpload/PhotoUpload', () => ({ default: () => null }));

const client = await import('../../../api/client');
const { default: PhotoReviewSection } = await import('./PhotoReviewSection');
const { default: RejectedBar } = await import('./RejectedBar');
const { StatusPills, ViewSwitch } = await import('./ReviewControls');

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

// A server holding these photos, answering pages as the admin list does.
function server(photos: Photo[]) {
  return vi.fn(async (offset: number, limit: number, status: ReviewStatus | null) => {
    const list = status ? photos.filter((p) => p.review_status === status) : photos;
    return { photos: list.slice(offset, offset + limit), total: list.length, counts: countsOf(photos) };
  });
}

function renderSection(fetchPage: ReturnType<typeof server>) {
  const user = userEvent.setup();
  render(
    <PhotoReviewSection
      scope="unassigned"
      gallery={null}
      galleryTitle="Unassigned"
      fetchPage={fetchPage}
      uploadsGo="start"
      header={(counts) => <p>{counts ? `${counts.all} photos` : ''}</p>}
      loading={<p>Loading...</p>}
    />
  );
  return user;
}

const pill = (name: RegExp | string) => within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name });
const pressed = (group: string) =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.pushState({}, '', '/unassigned');
});

describe('StatusPills and ViewSwitch', () => {
  it('show each state with its count, All without one, and mark the current filter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StatusPills value="shown" counts={{ review: 3, shown: 18, rejected: 2, all: 23 }} onChange={onChange} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Needs review · 3',
      'Shown · 18',
      'Rejected · 2',
      'All',
    ]);
    expect(pressed('Status')).toEqual(['Shown · 18']);
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('switches between Grid and Review', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ViewSwitch value="grid" onChange={onChange} />);
    expect(pressed('View')).toEqual(['Grid']);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(onChange).toHaveBeenCalledWith('review');
  });
});

describe('PhotoReviewSection', () => {
  const mixed = () => [photo('new1', 'review'), photo('pub1', 'shown'), photo('out1', 'rejected')];
  // The Grid names each photo by filename, which makes lists easy to read.
  const inGrid = () => window.localStorage.setItem('admin.photoView', 'grid');

  it('starts on Needs review when a photo needs it', async () => {
    inGrid();
    renderSection(server(mixed()));
    await screen.findByText('new1.jpg');
    expect(pressed('Status')).toEqual(['Needs review · 1']);
    expect(screen.queryByText('pub1.jpg')).toBeNull();
    expect(screen.getByText('3 photos')).toBeTruthy();
  });

  it('starts on All when nothing needs review', async () => {
    inGrid();
    renderSection(server([photo('pub1', 'shown'), photo('out1', 'rejected')]));
    await screen.findByText('pub1.jpg');
    expect(pressed('Status')).toEqual(['All']);
  });

  it('lists the chosen filter', async () => {
    inGrid();
    const fetchPage = server(mixed());
    const user = renderSection(fetchPage);
    await screen.findByText('new1.jpg');
    await user.click(pill(/^Shown/));
    expect(await screen.findByText('pub1.jpg')).toBeTruthy();
    expect(screen.queryByText('new1.jpg')).toBeNull();
    expect(fetchPage).toHaveBeenLastCalledWith(0, 100, 'shown');
  });

  it('opens in Review, the public layout, until Grid is chosen', async () => {
    renderSection(server(mixed()));
    await waitFor(() => expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(1));
    expect(pressed('View')).toEqual(['Review']);
    expect(screen.queryByText('new1.jpg')).toBeNull();
    expect(screen.getByText('Needs review', { selector: 'span' })).toBeTruthy();
  });

  it('remembers Grid in this browser', async () => {
    const user = renderSection(server(mixed()));
    await waitFor(() => expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Grid' }));
    expect(window.localStorage.getItem('admin.photoView')).toBe('grid');
    expect(await screen.findByText('new1.jpg')).toBeTruthy();
    cleanup();

    renderSection(server(mixed()));
    expect(await screen.findByText('new1.jpg')).toBeTruthy();
    expect(pressed('View')).toEqual(['Grid']);
  });

  it('drops a photo from the filter at once, updates the counts, and closes with All done on the last one', async () => {
    vi.mocked(client.setPhotosStatus).mockResolvedValue({ updated: 1 });
    const user = renderSection(server(mixed()));
    await waitFor(() => expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(1));

    await user.click(document.querySelector<HTMLElement>('[data-photo-index="0"]')!);
    const lightbox = screen.getByRole('dialog', { name: 'Lightbox' });
    await user.click(within(lightbox).getByRole('button', { name: 'Show on site' }));
    expect(client.setPhotosStatus).toHaveBeenCalledWith(['new1'], 'shown');
    expect(await screen.findByText('No photos need review.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Lightbox' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('All done. Shown on site · Undo');
    expect(pill(/^Needs review/).textContent).toBe('Needs review · 0');
    expect(pill(/^Shown/).textContent).toBe('Shown · 2');

    // Undo from the page puts it back in the list.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(document.querySelectorAll('[data-photo-index]')).toHaveLength(1));
    expect(client.setPhotosStatus).toHaveBeenLastCalledWith(['new1'], 'review');
    expect(pill(/^Needs review/).textContent).toBe('Needs review · 1');
  });

  it('shows the Rejected section only under Rejected, and deletes them all after a confirm', async () => {
    inGrid();
    const photos = mixed();
    const fetchPage = server(photos);
    vi.mocked(client.deleteRejectedPhotos).mockImplementation(async () => {
      photos.splice(2, 1);
      return { deleted: 1, counts: countsOf(photos) };
    });
    const user = renderSection(fetchPage);
    await screen.findByText('new1.jpg');
    expect(screen.queryByRole('button', { name: /Delete all rejected/ })).toBeNull();

    await user.click(pill(/^Rejected/));
    await screen.findByText('out1.jpg');
    expect(screen.getByText(/Rejected photos are private and kept until you delete them/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete all rejected (1)' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete 1' }));

    expect(client.deleteRejectedPhotos).toHaveBeenCalledWith('unassigned');
    expect(await screen.findByText('No rejected photos.')).toBeTruthy();
    expect(pill(/^Rejected/).textContent).toBe('Rejected · 0');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('RejectedBar', () => {
  it('asks before deleting, and Cancel deletes nothing', async () => {
    const onDeleteAll = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<RejectedBar count={12} onDeleteAll={onDeleteAll} />);

    await user.click(screen.getByRole('button', { name: 'Delete all rejected (12)' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete rejected photos' });
    expect(confirm.textContent).toContain("Delete 12 rejected photos from the site and storage? This can't be undone.");
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(onDeleteAll).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the confirm open and reports a failure', async () => {
    const user = userEvent.setup();
    render(<RejectedBar count={1} onDeleteAll={async () => Promise.reject(new Error('Server error'))} />);
    await user.click(screen.getByRole('button', { name: 'Delete all rejected (1)' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Delete 1 rejected photo from');
    await user.click(screen.getByRole('button', { name: 'Delete 1' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Server error');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('offers no delete when there is nothing rejected', () => {
    render(<RejectedBar count={0} onDeleteAll={async () => {}} />);
    expect(screen.queryByRole('button', { name: /Delete all rejected/ })).toBeNull();
  });
});

describe('StatusPills on a narrow screen', () => {
  it('scrolls the row, not the page, so the selected pill is visible', () => {
    const { rerender } = render(<StatusPills value="review" counts={null} onChange={() => {}} />);
    const group = document.querySelector<HTMLElement>('[aria-label="Status"]')!;
    const pills = Array.from(group.querySelectorAll<HTMLElement>('button'));
    Object.defineProperty(group, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(group, 'offsetLeft', { configurable: true, value: 0 });
    pills.forEach((pill, i) => {
      Object.defineProperty(pill, 'offsetLeft', { configurable: true, value: i * 120 });
      Object.defineProperty(pill, 'offsetWidth', { configurable: true, value: 110 });
    });
    const pageScroll = window.scrollY;
    rerender(<StatusPills value={null} counts={null} onChange={() => {}} />);
    expect(group.scrollLeft).toBe(3 * 120 + 110 - 200 + 32);
    expect(window.scrollY).toBe(pageScroll);
  });

  it('treats the edge fade as hidden', () => {
    const { rerender } = render(<StatusPills value="review" counts={null} onChange={() => {}} />);
    const group = document.querySelectorAll<HTMLElement>('[aria-label="Status"]')[0];
    const pills = Array.from(group.querySelectorAll<HTMLElement>('button'));
    Object.defineProperty(group, 'clientWidth', { configurable: true, value: 343 });
    Object.defineProperty(group, 'offsetLeft', { configurable: true, value: 0 });
    // The Rejected pill ends 20px before the edge: inside the 32px fade.
    pills.forEach((pill, i) => {
      Object.defineProperty(pill, 'offsetLeft', { configurable: true, value: i * 110 });
      Object.defineProperty(pill, 'offsetWidth', { configurable: true, value: 103 });
    });
    rerender(<StatusPills value="rejected" counts={null} onChange={() => {}} />);
    expect(group.scrollLeft).toBe(2 * 110 + 103 - 343 + 32);
  });
});
