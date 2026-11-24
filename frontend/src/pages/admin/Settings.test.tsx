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

const stored = { site_title: 'Jacob Fain Photography', meta_description: 'Portraits and weddings' };
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
