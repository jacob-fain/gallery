// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo, ReviewStatus } from '../../../types';

vi.mock('../../../api/client', () => ({
  deletePhoto: vi.fn(),
  setCoverImage: vi.fn(),
  reorderPhotos: vi.fn(),
  movePhotos: vi.fn(),
  getAllGalleries: vi.fn(),
  setPhotosStatus: vi.fn(),
}));

const client = await import('../../../api/client');
const { default: PhotoManager } = await import('./PhotoManager');
const { usePhotoList } = await import('./usePhotoList');

const photo = (id: string, review_status: ReviewStatus) =>
  ({ id, gallery_id: null, original_filename: `${id}.jpg`, width: 600, height: 400, review_status }) as Photo;

const PHOTOS = [photo('shown1', 'shown'), photo('shown2', 'shown'), photo('new1', 'review'), photo('out1', 'rejected')];

function Harness() {
  const photos = usePhotoList(async () => ({ photos: PHOTOS, total: PHOTOS.length }));
  return <PhotoManager photos={photos} gallery={null} />;
}

type Action = 'Show on site' | 'Reject' | 'Back to review';

async function renderManager() {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByText('shown1.jpg');
  // The first checkbox is Select All; the rest follow the grid order.
  const checkbox = (id: string) =>
    screen.getAllByRole('checkbox')[1 + PHOTOS.findIndex((p) => p.id === id)];
  const bar = () => screen.getByText(/selected$/).parentElement as HTMLElement;
  const bulk = (name: Action) => within(bar()).getByRole('button', { name }) as HTMLButtonElement;
  const enabled = () =>
    (['Show on site', 'Reject', 'Back to review'] as Action[]).filter((a) => !bulk(a).disabled);
  return { user, checkbox, bulk, enabled };
}

describe('PhotoManager bulk review actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.setPhotosStatus).mockResolvedValue({ updated: 1 });
  });

  it('offers no bulk actions until a photo is selected', async () => {
    await renderManager();
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('badges every photo that is not shown with its state', async () => {
    await renderManager();
    expect(screen.getAllByText('Needs review')).toHaveLength(1);
    expect(screen.getAllByText('Rejected')).toHaveLength(1);
    expect(screen.queryByText('Shown')).toBeNull();
  });

  it.each([
    ['shown1', ['Reject', 'Back to review']],
    ['new1', ['Show on site', 'Reject']],
    ['out1', ['Show on site', 'Back to review']],
  ])('offers for a %s selection only the actions that change it', async (id, actions) => {
    const { user, checkbox, enabled } = await renderManager();
    await user.click(checkbox(id));
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(enabled()).toEqual(actions);
  });

  it('sends one request for the photos that change, and keeps the change', async () => {
    let finish: () => void = () => {};
    vi.mocked(client.setPhotosStatus).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ updated: 2 })))
    );
    const { user, checkbox, bulk, enabled } = await renderManager();
    await user.click(checkbox('shown1'));
    await user.click(checkbox('new1'));
    await user.click(checkbox('out1'));

    await user.click(bulk('Show on site'));

    expect(client.setPhotosStatus).toHaveBeenCalledTimes(1);
    expect(client.setPhotosStatus).toHaveBeenCalledWith(['new1', 'out1'], 'shown');
    // Applied at once, and every action is off while the request runs.
    expect(screen.queryByText('Needs review')).toBeNull();
    expect(enabled()).toEqual([]);

    finish();
    await waitFor(() => expect(enabled()).toEqual(['Reject', 'Back to review']));
    expect(screen.queryByText('Rejected')).toBeNull();
  });

  it('puts the photos back and reports it when the request fails', async () => {
    vi.mocked(client.setPhotosStatus).mockRejectedValue(new Error('Server error'));
    const { user, checkbox, bulk, enabled } = await renderManager();
    await user.click(checkbox('shown1'));
    await user.click(checkbox('shown2'));

    await user.click(bulk('Reject'));

    expect((await screen.findByRole('alert')).textContent).toContain('Server error: 2 photos were not changed');
    expect(screen.getAllByText('Rejected')).toHaveLength(1);
    expect(enabled()).toEqual(['Reject', 'Back to review']);
  });

  it("toggles one photo from its card: a shown one is rejected, any other shown", async () => {
    const { user } = await renderManager();
    await user.click(screen.getAllByRole('button', { name: 'Reject' })[0]);
    expect(client.setPhotosStatus).toHaveBeenLastCalledWith(['shown1'], 'rejected');

    const cardOf = (name: string) => screen.getByText(name).closest('[class*="card"]') as HTMLElement;
    await user.click(within(cardOf('new1.jpg')).getByRole('button', { name: 'Show on site' }));
    expect(client.setPhotosStatus).toHaveBeenLastCalledWith(['new1'], 'shown');
  });

  it('clears the selection with Cancel', async () => {
    const { user, checkbox } = await renderManager();
    await user.click(checkbox('shown1'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('1 selected')).toBeNull();
    expect((checkbox('shown1') as HTMLInputElement).checked).toBe(false);
  });
});
