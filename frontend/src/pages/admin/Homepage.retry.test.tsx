// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  getHomepagePhotos: vi.fn(),
  setHeroPhoto: vi.fn(),
  addToHomepage: vi.fn(),
  removeFromHomepage: vi.fn(),
  reorderHomepagePhotos: vi.fn(),
  getAllGalleries: vi.fn(),
  getGalleryPhotosPage: vi.fn(),
}));

const client = await import('../../api/client');
const { default: Homepage } = await import('./Homepage');

describe('admin Homepage load failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The page logs the failure; the test expects it.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the error with Try Again, and Try Again loads the page', async () => {
    vi.mocked(client.getHomepagePhotos)
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<Homepage />);

    expect(await screen.findByText('Error: Service unavailable')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(await screen.findByText('No photos on homepage yet.')).toBeTruthy();
    expect(screen.queryByText(/^Error:/)).toBeNull();
    expect(client.getHomepagePhotos).toHaveBeenCalledTimes(2);
  });

  it('shows the error again when the retry fails too', async () => {
    vi.mocked(client.getHomepagePhotos)
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockRejectedValueOnce(new Error('Still down'));
    const user = userEvent.setup();
    render(<Homepage />);

    await user.click(await screen.findByRole('button', { name: 'Try Again' }));

    expect(await screen.findByText('Error: Still down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });
});
