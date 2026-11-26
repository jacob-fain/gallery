// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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
      // A refusal that would repeat, so the row fails at once with no retry.
      else upload.reject(Object.assign(new Error('Unsupported'), { status: 415 }));
    });
  };
  const fail = async (name: string, status: number) => {
    await act(async () => pending.get(name)!.reject(Object.assign(new Error('Failed'), { status })));
  };
  // Hashing and the duplicate check run before any upload starts.
  const started = async (count: number) => {
    await act(async () => {
      while (pending.size < count) await new Promise((r) => setTimeout(r, 0));
    });
  };
  return { queue, settle, started, fail, pending };
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

  it('counts uploads that are retrying by themselves', async () => {
    const { queue, started, fail } = controlledQueue();
    renderIndicator(queue);
    act(() => queue.add([image('a'), image('b')], { galleryId: 'g1', checkOnly: false }));
    await started(2);

    await fail('a', 0);
    expect(screen.getByText('Uploading 0/2')).toBeTruthy();
    expect(screen.getByText('1 retrying')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry all failed' })).toBeNull();
  });

  it('stays after the batch while uploads failed, and retries them all', async () => {
    const { queue, started, fail, pending } = controlledQueue();
    renderIndicator(queue);
    act(() => queue.add([image('a'), image('b')], { galleryId: 'g1', checkOnly: false }));
    await started(2);
    await fail('a', 500);
    await fail('b', 500);

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('2 uploads failed')).toBeTruthy();

    pending.clear();
    await userEvent.click(screen.getByRole('button', { name: 'Retry all failed' }));
    await started(2);
    expect(screen.getByText('Uploading 0/2')).toBeTruthy();
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it('says it is confirming, not uploading, while it asks whether a lost answer was stored', async () => {
    const { queue, started, fail } = controlledQueue();
    renderIndicator(queue);
    act(() => queue.add([image('a')], { galleryId: 'g1', checkOnly: false }));
    await started(1);

    await fail('a', 524);
    expect(screen.getByText('Confirming upload...')).toBeTruthy();
    expect(screen.queryByText(/^Uploading/)).toBeNull();
    expect(screen.queryByText(/confirming$/)).toBeNull();
  });

  it('counts down to the next retry while nothing is being sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { queue, started, fail } = controlledQueue();
      renderIndicator(queue);
      act(() => queue.add([image('a')], { galleryId: 'g1', checkOnly: false }));
      await started(1);

      await fail('a', 503);
      expect(screen.getByText(/^Retrying in [12]s$/)).toBeTruthy();
      expect(screen.queryByText(/^Uploading/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
