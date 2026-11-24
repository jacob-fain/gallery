// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UploadQueueContext } from '../../../contexts/uploads';
import type { Photo } from '../../../types';
import { UploadQueue } from '../../../utils/uploadQueue';
import UploadIndicator from './UploadIndicator';

const image = (name: string) => new File([name], name, { type: 'image/jpeg' });

/** A queue whose uploads finish only when the test says so. */
function controlledQueue() {
  const pending = new Map<string, { resolve: (p: Photo) => void; reject: (e: unknown) => void }>();
  const queue = new UploadQueue({
    upload: (_galleryId, file) =>
      new Promise<Photo>((resolve, reject) => pending.set(file.name, { resolve, reject })),
    checkDuplicates: async () => ({}),
    hash: (file) => file.text(),
  });
  queue.setSession('user-1');
  const settle = async (name: string, ok = true) => {
    await act(async () => {
      const upload = pending.get(name)!;
      if (ok) upload.resolve({ id: name } as Photo);
      else upload.reject(new Error('Network error'));
    });
  };
  // Hashing and the duplicate check run before any upload starts.
  const started = async (count: number) => {
    await act(async () => {
      while (pending.size < count) await new Promise((r) => setTimeout(r, 0));
    });
  };
  return { queue, settle, started };
}

function renderIndicator(queue: UploadQueue) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <UploadQueueContext.Provider value={queue}>
        <UploadIndicator />
        <Routes>
          <Route path="/" element={<p>Dashboard</p>} />
          <Route path="/galleries/:id/photos" element={<p>Gallery photos page</p>} />
        </Routes>
      </UploadQueueContext.Provider>
    </MemoryRouter>
  );
}

describe('UploadIndicator while uploads run', () => {
  it('counts files as they finish and goes away when the batch is done', async () => {
    const { queue, settle, started } = controlledQueue();
    renderIndicator(queue);
    expect(screen.queryByRole('progressbar')).toBeNull();

    act(() => queue.add([image('a'), image('b')], { galleryId: 'g1', checkOnly: false }));
    expect(screen.getByText('Uploading 0/2')).toBeTruthy();
    await started(2);

    await settle('a');
    expect(screen.getByText('Uploading 1/2')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');

    await settle('b', false);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('links to the gallery the uploads go to', async () => {
    const { queue, started } = controlledQueue();
    renderIndicator(queue);
    act(() => queue.add([image('a')], { galleryId: 'g1', checkOnly: false }));
    await started(1);

    await userEvent.click(screen.getByRole('link', { name: 'Uploading 0/1' }));

    expect(screen.getByText('Gallery photos page')).toBeTruthy();
  });

  it('stops showing progress when the session ends', async () => {
    const { queue, started } = controlledQueue();
    renderIndicator(queue);
    act(() => queue.add([image('a')], { galleryId: null, checkOnly: false }));
    await started(1);

    act(() => queue.setSession(null));

    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
