// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gallery } from '../../../types';
import GalleryForm from './GalleryForm';

const onSubmit = vi.fn();
const onCancel = vi.fn();

function renderForm(gallery?: Gallery) {
  const user = userEvent.setup();
  render(<GalleryForm gallery={gallery} onSubmit={onSubmit} onCancel={onCancel} />);
  return user;
}

// The slug label also holds the Auto/Manual button, so only fields are matched.
function input(label: string | RegExp) {
  return screen.getByLabelText(label, { selector: 'input, textarea' }) as HTMLInputElement;
}

const privateGallery = {
  id: 'g1',
  title: 'Smith Wedding',
  slug: 'smith-wedding',
  description: 'June 2026',
  is_public: false,
  has_password: true,
} as Gallery;

describe('GalleryForm, new gallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onSubmit.mockResolvedValue(undefined);
  });

  it('derives the slug from the title and creates a public gallery', async () => {
    const user = renderForm();

    await user.type(input('Title'), 'Smith & Jones Wedding!');
    expect(input('Slug').value).toBe('smith-jones-wedding');
    await user.type(input('Description'), 'Summer');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Smith & Jones Wedding!',
      slug: 'smith-jones-wedding',
      description: 'Summer',
      is_public: true,
      password: undefined,
    });
  });

  it('keeps a slug typed by hand when the title changes afterwards', async () => {
    const user = renderForm();

    await user.type(input('Title'), 'Smith');
    await user.click(screen.getByRole('button', { name: 'Manual' }));
    // Manual starts from the slug the title produced.
    expect(input('Slug').value).toBe('smith');
    await user.clear(input('Slug'));
    await user.type(input('Slug'), 'custom-slug');
    await user.type(input('Title'), ' Wedding');
    expect(input('Slug').value).toBe('custom-slug');

    await user.click(screen.getByRole('button', { name: 'Auto' }));
    expect(input('Slug').value).toBe('smith-wedding');
  });

  it('refuses a title of only spaces', async () => {
    const user = renderForm();

    // A typed slug, since the one derived from spaces is empty and the
    // browser's required check would stop the submit first.
    await user.type(input('Slug'), 'smith');
    await user.type(input('Title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Title is required')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses to make a gallery private without a password', async () => {
    const user = renderForm();

    await user.type(input('Title'), 'Smith Wedding');
    await user.click(screen.getByRole('button', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Set a password to make this gallery private')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a password that does not match its confirmation', async () => {
    const user = renderForm();

    await user.type(input('Title'), 'Smith Wedding');
    await user.click(screen.getByRole('button', { name: 'Private' }));
    await user.type(input(/^Password/), 'secret');
    await user.type(input('Confirm Password'), 'secrte');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Passwords do not match')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('creates a private gallery with its password', async () => {
    const user = renderForm();

    await user.type(input('Title'), 'Smith Wedding');
    await user.click(screen.getByRole('button', { name: 'Private' }));
    await user.type(input(/^Password/), 'secret');
    await user.type(input('Confirm Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Smith Wedding',
      slug: 'smith-wedding',
      description: undefined,
      is_public: false,
      password: 'secret',
    });
  });

  it('hides the password fields again for a public gallery', async () => {
    const user = renderForm();

    await user.click(screen.getByRole('button', { name: 'Private' }));
    expect(screen.getByLabelText('Confirm Password')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Public' }));
    expect(screen.queryByLabelText('Confirm Password')).toBeNull();
  });

  it('shows the error a failed save rejects with and stays open', async () => {
    onSubmit.mockRejectedValue(new Error('A gallery with this slug already exists'));
    const user = renderForm();

    await user.type(input('Title'), 'Smith Wedding');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('A gallery with this slug already exists')).toBeTruthy();
    expect(input('Title').value).toBe('Smith Wedding');
  });

  it('falls back to a generic message when the failure is not an Error', async () => {
    onSubmit.mockRejectedValue('nope');
    const user = renderForm();

    await user.type(input('Title'), 'Smith Wedding');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Failed to save gallery')).toBeTruthy();
  });

  it('cancels without saving', async () => {
    const user = renderForm();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('turns every control off while saving', () => {
    render(<GalleryForm onSubmit={onSubmit} onCancel={onCancel} isLoading />);

    const save = screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(input('Title').disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('GalleryForm, editing a gallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onSubmit.mockResolvedValue(undefined);
  });

  it('starts from the stored values and offers no slug toggle', () => {
    renderForm(privateGallery);

    expect(input('Title').value).toBe('Smith Wedding');
    expect(input('Slug').value).toBe('smith-wedding');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('June 2026');
    expect(screen.getByLabelText('Password (leave blank to keep current)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Manual' })).toBeNull();
  });

  it('keeps the stored password when the field is left blank', async () => {
    const user = renderForm(privateGallery);

    await user.clear(input('Title'));
    await user.type(input('Title'), 'Smith Wedding 2026');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0][0];
    // A password key, even null, would change or remove the stored one.
    expect(sent).not.toHaveProperty('password');
    expect(sent).toEqual({
      title: 'Smith Wedding 2026',
      slug: 'smith-wedding',
      description: 'June 2026',
      is_public: false,
    });
  });

  it('sends a new password only when one is typed', async () => {
    const user = renderForm(privateGallery);

    await user.type(input(/^Password/), 'new-secret');
    await user.type(input('Confirm Password'), 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ password: 'new-secret' }));
  });

  it('sends a cleared description as null so the API removes it', async () => {
    const user = renderForm(privateGallery);

    await user.clear(screen.getByLabelText('Description'));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
  });

  it('asks for a password when a public gallery without one is made private', async () => {
    const user = renderForm({ ...privateGallery, is_public: true, has_password: false });

    await user.click(screen.getByRole('button', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(screen.getByText('Set a password to make this gallery private')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
