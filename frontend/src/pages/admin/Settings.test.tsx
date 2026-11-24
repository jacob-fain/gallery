// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteTitleContext } from '../../contexts/siteTitle';

vi.mock('../../api/client', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const client = await import('../../api/client');
const { default: Settings } = await import('./Settings');

const stored = {
  site_title: 'Jacob Fain Photography',
  meta_description: 'Portraits and weddings',
  instagram_url: 'https://www.instagram.com/jacobfain',
  contact_email: '',
};
const setSiteTitle = vi.fn();

function renderSettings() {
  const user = userEvent.setup();
  render(
    <SiteTitleContext.Provider value={{ siteTitle: stored.site_title, setSiteTitle }}>
      <Settings />
    </SiteTitleContext.Provider>
  );
  return user;
}

describe('admin settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getSettings).mockResolvedValue(stored);
  });

  it('loads the stored settings into the form', async () => {
    renderSettings();

    expect(((await screen.findByLabelText('Site Title')) as HTMLInputElement).value).toBe(
      'Jacob Fain Photography'
    );
    expect((screen.getByLabelText('Meta Description') as HTMLTextAreaElement).value).toBe(
      'Portraits and weddings'
    );
    expect((screen.getByLabelText('Instagram URL') as HTMLInputElement).value).toBe(
      'https://www.instagram.com/jacobfain'
    );
    expect((screen.getByLabelText('Contact Email') as HTMLInputElement).value).toBe('');
  });

  it('saves the footer links trimmed', async () => {
    vi.mocked(client.updateSettings).mockResolvedValue(stored);
    const user = renderSettings();

    const instagram = await screen.findByLabelText('Instagram URL');
    await user.clear(instagram);
    await user.type(instagram, ' https://instagram.com/jf ');
    await user.type(screen.getByLabelText('Contact Email'), 'hello@jacobfain.com ');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Settings saved successfully')).toBeTruthy();
    expect(client.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ instagram_url: 'https://instagram.com/jf', contact_email: 'hello@jacobfain.com' })
    );
  });

  it('clears a footer link by saving the field empty', async () => {
    vi.mocked(client.updateSettings).mockResolvedValue(stored);
    const user = renderSettings();

    await user.clear(await screen.findByLabelText('Instagram URL'));
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Settings saved successfully')).toBeTruthy();
    expect(client.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ instagram_url: '' }));
  });

  it('names an invalid Instagram link or email without saving', async () => {
    const user = renderSettings();

    const instagram = await screen.findByLabelText('Instagram URL');
    await user.clear(instagram);
    await user.type(instagram, 'https://example.com/jf');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    expect(await screen.findByText('Instagram link must be an https://instagram.com address')).toBeTruthy();

    await user.clear(instagram);
    await user.type(screen.getByLabelText('Contact Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    expect(await screen.findByText('Contact email must be a valid email address')).toBeTruthy();

    expect(client.updateSettings).not.toHaveBeenCalled();
  });

  it('saves both fields, confirms, and applies the new title to the open page', async () => {
    vi.mocked(client.updateSettings).mockResolvedValue({ ...stored, site_title: 'JF Photo' });
    const user = renderSettings();

    const title = await screen.findByLabelText('Site Title');
    await user.clear(title);
    await user.type(title, 'JF Photo');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Settings saved successfully')).toBeTruthy();
    expect(client.updateSettings).toHaveBeenCalledWith({
      site_title: 'JF Photo',
      meta_description: 'Portraits and weddings',
      instagram_url: 'https://www.instagram.com/jacobfain',
      contact_email: '',
    });
    expect(setSiteTitle).toHaveBeenCalledWith('JF Photo');
  });

  it('turns the button off while the save is in flight', async () => {
    let finish: () => void = () => {};
    vi.mocked(client.updateSettings).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve(stored)))
    );
    const user = renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Save Settings' }));
    expect((screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true);

    finish();
    expect(await screen.findByRole('button', { name: 'Save Settings' })).toBeTruthy();
  });

  it('shows a failed save and leaves the page title alone', async () => {
    vi.mocked(client.updateSettings).mockRejectedValue(new Error('Site title is too long'));
    const user = renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Site title is too long')).toBeTruthy();
    expect(screen.queryByText('Settings saved successfully')).toBeNull();
    expect(setSiteTitle).not.toHaveBeenCalled();
  });

  it('replaces an earlier success message with the error of a later failed save', async () => {
    vi.mocked(client.updateSettings)
      .mockResolvedValueOnce(stored)
      .mockRejectedValueOnce(new Error('Failed to save settings'));
    const user = renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Save Settings' }));
    await screen.findByText('Settings saved successfully');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Failed to save settings')).toBeTruthy();
    expect(screen.queryByText('Settings saved successfully')).toBeNull();
  });

  it('offers no form to save when the settings could not be loaded', async () => {
    vi.mocked(client.getSettings).mockRejectedValue(new Error('API request failed: 500'));
    renderSettings();

    expect(await screen.findByText('API request failed: 500')).toBeTruthy();
    // A blank form saved here would overwrite the stored settings.
    expect(screen.queryByRole('button', { name: 'Save Settings' })).toBeNull();
    expect(screen.queryByLabelText('Site Title')).toBeNull();
  });
});
