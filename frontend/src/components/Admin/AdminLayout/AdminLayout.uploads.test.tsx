// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy, Suspense } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../../contexts/auth';
import { ThemeContext } from '../../../contexts/theme';
import type { Photo } from '../../../types';

vi.mock('../../../api/client', () => ({
  uploadPhoto: vi.fn(),
  checkDuplicates: vi.fn(async () => ({})),
}));

const client = await import('../../../api/client');
const { default: AdminLayout } = await import('./AdminLayout');
const { default: PhotoUpload } = await import('../PhotoUpload/PhotoUpload');

const auth: AuthContextType = {
  user: { id: 'admin-1', email: 'admin@example.com' } as AuthContextType['user'],
  isAuthenticated: true,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

const image = (name: string) => new File([name], name, { type: 'image/jpeg' });
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

// jsdom's Blob has no arrayBuffer(); hashing failing is fine here (the file
// is sent), but the queue awaits it, so it must settle.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = () => Promise.reject(new Error('no arrayBuffer in jsdom'));
}

let uploads: Array<{ name: string; resolve: (p: Photo) => void; reject: (e: unknown) => void }>;

// A page that loads like the real ones (lazily, under the app's Suspense),
// so leaving the upload page also mounts a page that suspends first.
let showSettings!: () => void;
const settingsLoaded = new Promise<{ default: () => React.JSX.Element }>((resolve) => {
  showSettings = () => resolve({ default: () => <p>Settings page</p> });
});
const Settings = lazy(() => settingsLoaded);

function renderAdmin() {
  render(
    <AuthContext.Provider value={auth}>
      <ThemeContext.Provider value={{ theme: 'light', toggleTheme: vi.fn() }}>
        <MemoryRouter initialEntries={['/unassigned']}>
          <Suspense fallback={<p>Loading page</p>}>
            <AdminLayout>
              <Routes>
                <Route path="" element={<p>Dashboard page</p>} />
                <Route path="unassigned" element={<PhotoUpload galleryId={null} onUploadComplete={vi.fn()} />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<p>Other page</p>} />
              </Routes>
            </AdminLayout>
          </Suspense>
        </MemoryRouter>
      </ThemeContext.Provider>
    </AuthContext.Provider>
  );
}

async function started(count: number) {
  await act(async () => {
    while (uploads.length < count) await vi.advanceTimersByTimeAsync(10);
  });
}

describe('uploads while the admin moves between pages', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    uploads = [];
    vi.mocked(client.uploadPhoto).mockImplementation(
      (_galleryId, file) =>
        new Promise<Photo>((resolve, reject) => uploads.push({ name: file.name, resolve, reject }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps uploading and retrying on other pages, and the upload page shows the result on return', async () => {
    const user = userEvent.setup({ applyAccept: false, advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderAdmin();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [image('a.jpg'), image('b.jpg')]);
    await started(2);

    // Leave for a page that has to load first, then another one.
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await act(async () => showSettings());
    expect(await screen.findByText('Settings page')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByText('Dashboard page')).toBeTruthy();

    // The connection drops on one upload while the admin is elsewhere.
    await act(async () => uploads[0].reject(failure('Upload failed', 0)));
    expect(screen.getByText('1 retrying')).toBeTruthy();
    await act(async () => uploads[1].resolve({ id: 'p-b' } as Photo));

    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await started(3);
    expect(uploads[2].name).toBe('a.jpg');
    expect(screen.getByText('Uploading 1/2')).toBeTruthy();
    await act(async () => uploads[2].resolve({ id: 'p-a' } as Photo));
    expect(screen.queryByRole('progressbar')).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Unassigned' }));
    expect(document.querySelector('[class*="summaryText"]')?.textContent).toBe('Done · 2 uploaded');
    expect(client.uploadPhoto).toHaveBeenCalledTimes(3);
  });

  it('keeps a failed upload on every page, with Retry all failed', async () => {
    const user = userEvent.setup({ applyAccept: false, advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderAdmin();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [image('a.jpg')]);
    await started(1);
    await act(async () => uploads[0].reject(failure('Failed to upload photo', 500)));

    await user.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByText('1 upload failed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry all failed' }));
    await started(2);
    expect(screen.getByText('Uploading 0/1')).toBeTruthy();
    expect(screen.queryByText('1 upload failed')).toBeNull();
  });
});
