// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthContext, type AuthContextType } from '../../../contexts/auth';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const { reportClientError } = vi.hoisted(() => ({ reportClientError: vi.fn() }));
vi.mock('../../../utils/clientErrors', () => ({ reportClientError }));

// The real queue starts nothing until it is given files; this one reports a
// batch running and notes whether it was stopped.
const queue = vi.hoisted(() => ({
  summary: { active: true, total: 3, processed: 1, checkOnly: false, targetCount: 1, galleryId: 'g' },
  aborted: false,
}));
vi.mock('../../../utils/uploadQueue', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../utils/uploadQueue')>();
  return {
    ...real,
    UploadQueue: class {
      subscribe = () => () => {};
      getSummary = () => queue.summary;
      setSession() {}
      abortAll() {
        queue.aborted = true;
      }
    },
  };
});

const { default: AdminLayout } = await import('./AdminLayout');
const { loadWithReload } = await import('../../../utils/lazyWithReload');

const auth = { user: { id: 'u', email: 'admin@example.test' }, logout: vi.fn() } as unknown as AuthContextType;

function renderLayout(page: ReactNode) {
  return render(
    <ThemeProvider>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <AdminLayout>{page}</AdminLayout>
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}

function Broken(): never {
  throw new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/Photos-abc.js');
}

describe('AdminLayout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the uploads running when a page fails, and shows the error with Reload inside the layout', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLayout(<Broken />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(queue.aborted).toBe(false);
  });

  it('holds the automatic reload while uploads run', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    renderLayout(<p>page</p>);
    await expect(
      loadWithReload(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))
    ).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });
});
