// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gallery } from '../../types';

vi.mock('../../api/client', () => ({
  getAllGalleries: vi.fn(),
  createGallery: vi.fn(),
  updateGallery: vi.fn(),
  deleteGallery: vi.fn(),
  reorderGalleries: vi.fn(),
}));

const client = await import('../../api/client');
const { default: Galleries } = await import('./Galleries');

const SLUG_TAKEN = 'A gallery with this slug already exists';

const existing = {
  id: 'g1',
  title: 'Smith Wedding',
  slug: 'smith-wedding',
  description: null,
  is_public: false,
  has_password: true,
  view_count: 4,
} as Gallery;

function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Galleries />
    </MemoryRouter>
  );
  return user;
}

function field(label: string | RegExp) {
  return screen.getByLabelText(label, { selector: 'input, textarea' }) as HTMLInputElement;
}

function dialog() {
  const heading = screen.getByRole('heading', { level: 2 });
  return within(heading.parentElement as HTMLElement);
}

describe('admin galleries form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getAllGalleries).mockResolvedValue([existing]);
  });

  it('shows the slug conflict message and keeps the form open with what was typed', async () => {
    vi.mocked(client.createGallery).mockRejectedValue(new Error(SLUG_TAKEN));
    const user = renderPage();

    await user.click(await screen.findByRole('button', { name: 'New Gallery' }));
    await user.type(field('Title'), 'Smith Wedding');
    await user.click(dialog().getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(SLUG_TAKEN)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'New Gallery', level: 2 })).toBeTruthy();
    expect(field('Slug').value).toBe('smith-wedding');
    // The form is usable again for a new slug.
    expect((dialog().getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
    expect(client.getAllGalleries).toHaveBeenCalledTimes(1);

    vi.mocked(client.createGallery).mockResolvedValue({ ...existing, id: 'g2', slug: 'smith-wedding-2' });
    await user.click(dialog().getByRole('button', { name: 'Manual' }));
    await user.clear(field('Slug'));
    await user.type(field('Slug'), 'smith-wedding-2');
    await user.click(dialog().getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('heading', { level: 2 })).toBeNull());
    expect(client.createGallery).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'smith-wedding-2' })
    );
    expect(client.getAllGalleries).toHaveBeenCalledTimes(2);
  });

  it('saves an edit without touching the stored password and closes the form', async () => {
    vi.mocked(client.updateGallery).mockResolvedValue(existing);
    const user = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Gallery' })).toBeTruthy();
    await user.type(field('Description'), 'June');
    await user.click(dialog().getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Gallery' })).toBeNull());
    expect(client.updateGallery).toHaveBeenCalledWith('g1', {
      title: 'Smith Wedding',
      slug: 'smith-wedding',
      description: 'June',
      is_public: false,
    });
    expect(client.getAllGalleries).toHaveBeenCalledTimes(2);
  });

  it('shows a slug conflict on an edit too', async () => {
    vi.mocked(client.updateGallery).mockRejectedValue(new Error(SLUG_TAKEN));
    const user = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.clear(field('Slug'));
    await user.type(field('Slug'), 'jones');
    await user.click(dialog().getByRole('button', { name: 'Update' }));

    expect(await screen.findByText(SLUG_TAKEN)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Edit Gallery' })).toBeTruthy();
  });

  it('closes the form on Cancel without saving', async () => {
    const user = renderPage();

    await user.click(await screen.findByRole('button', { name: 'New Gallery' }));
    await user.click(dialog().getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(client.createGallery).not.toHaveBeenCalled();
  });
});
