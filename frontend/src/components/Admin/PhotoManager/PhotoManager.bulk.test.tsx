// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../../types';

vi.mock('../../../api/client', () => ({
  deletePhoto: vi.fn(),
  setCoverImage: vi.fn(),
  reorderPhotos: vi.fn(),
  movePhotos: vi.fn(),
  getAllGalleries: vi.fn(),
  updatePhoto: vi.fn(),
}));

const client = await import('../../../api/client');
const { default: PhotoManager } = await import('./PhotoManager');
const { usePhotoList } = await import('./usePhotoList');

const photo = (id: string, is_hidden: boolean) =>
  ({ id, gallery_id: null, original_filename: `${id}.jpg`, width: 600, height: 400, is_hidden }) as Photo;

const PHOTOS = [photo('visible1', false), photo('visible2', false), photo('hidden1', true)];

function Harness() {
  const photos = usePhotoList(async () => ({ photos: PHOTOS, total: PHOTOS.length }));
  return <PhotoManager photos={photos} gallery={null} />;
}

async function renderManager() {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByText('visible1.jpg');
  // The first checkbox is Select All; the rest follow the grid order.
  const checkbox = (id: string) =>
    screen.getAllByRole('checkbox')[1 + PHOTOS.findIndex((p) => p.id === id)];
  const bulk = (name: 'Show' | 'Hide') =>
    screen.getByRole('button', { name }) as HTMLButtonElement;
  return { user, checkbox, bulk };
}

describe('PhotoManager bulk Show and Hide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers no bulk actions until a photo is selected', async () => {
    await renderManager();
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
  });

  it('enables only Hide for a selection of visible photos', async () => {
    const { user, checkbox, bulk } = await renderManager();
    await user.click(checkbox('visible1'));

    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(bulk('Hide').disabled).toBe(false);
    expect(bulk('Show').disabled).toBe(true);
  });

  it('enables only Show for a selection of hidden photos', async () => {
    const { user, checkbox, bulk } = await renderManager();
    await user.click(checkbox('hidden1'));

    expect(bulk('Show').disabled).toBe(false);
    expect(bulk('Hide').disabled).toBe(true);
  });

  it('enables both for a mixed selection and hides only the visible ones', async () => {
    let finish: () => void = () => {};
    vi.mocked(client.updatePhoto).mockImplementation(
      (id) => new Promise((resolve) => (finish = () => resolve({ id } as Photo)))
    );
    const { user, checkbox, bulk } = await renderManager();
    await user.click(checkbox('visible1'));
    await user.click(checkbox('hidden1'));
    expect(bulk('Show').disabled).toBe(false);
    expect(bulk('Hide').disabled).toBe(false);

    await user.click(bulk('Hide'));

    expect(client.updatePhoto).toHaveBeenCalledTimes(1);
    expect(client.updatePhoto).toHaveBeenCalledWith('visible1', { is_hidden: true });
    // Both stay off while the request runs.
    expect(bulk('Show').disabled).toBe(true);
    expect(bulk('Hide').disabled).toBe(true);

    finish();
    // Everything selected is hidden now, so only Show is left to do.
    await waitFor(() => expect(bulk('Show').disabled).toBe(false));
    expect(bulk('Hide').disabled).toBe(true);
    expect(screen.getAllByText('Hidden')).toHaveLength(2);
  });

  it('puts a photo back and reports it when its change fails', async () => {
    vi.mocked(client.updatePhoto).mockImplementation(async (id) => {
      if (id === 'visible2') throw new Error('Server error');
      return { id } as Photo;
    });
    const { user, checkbox, bulk } = await renderManager();
    await user.click(checkbox('visible1'));
    await user.click(checkbox('visible2'));

    await user.click(bulk('Hide'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getAllByText('Hidden')).toHaveLength(2);
    // visible2 is still visible, so Hide still has something to do.
    expect(bulk('Hide').disabled).toBe(false);
  });

  it('clears the selection with Cancel', async () => {
    const { user, checkbox } = await renderManager();
    await user.click(checkbox('visible1'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('1 selected')).toBeNull();
    expect((checkbox('visible1') as HTMLInputElement).checked).toBe(false);
  });
});
