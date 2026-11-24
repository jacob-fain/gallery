// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminStats, AnalyticsData } from '../../types';

vi.mock('../../api/client', () => ({
  getAdminStats: vi.fn(),
  getAnalytics: vi.fn(),
}));

const client = await import('../../api/client');
const { default: Dashboard } = await import('./Dashboard');

const stats: AdminStats = {
  galleries: { total: 12, public: 9, private: 3 },
  photos: { total: 4821, featured: 40 },
  views: { galleries: 15032, photos: 90000 },
  downloads: 377,
};

/** 30 consecutive day keys ending on the given day, as the API sends them. */
function days(last: string, count = 30): string[] {
  const end = Date.parse(`${last}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10)
  );
}

const keys = days('2026-11-23');

const analytics: AnalyticsData = {
  viewsOverTime: keys.map((date, i) => ({ date, views: i === 29 ? 40 : 2 })),
  uploadActivity: keys.map((date, i) => ({ date, count: i === 0 ? 7 : 0 })),
  topGalleries: [
    { id: 'g1', title: 'Smith Wedding', slug: 'smith-wedding', view_count: 1200 },
    { id: 'g2', title: 'Fall Portraits', slug: 'fall-portraits', view_count: 85 },
  ],
  topPhotos: [
    {
      id: 'p1',
      filename: 'DSC_0001.jpg',
      gallery_id: 'g1',
      gallery_title: 'Smith Wedding',
      thumbnailUrl: 'https://cdn.test/p1-thumb.webp',
      view_count: 310,
      download_count: 12,
    },
    {
      id: 'p2',
      filename: 'loose.jpg',
      gallery_id: null,
      gallery_title: 'Unassigned',
      thumbnailUrl: 'https://cdn.test/p2-thumb.webp',
      view_count: 4,
      download_count: 0,
    },
  ],
  storage: {
    total_bytes: 3 * 1024 ** 3,
    galleries: [
      { id: 'g1', title: 'Smith Wedding and Reception', bytes: 2 * 1024 ** 3 },
      { id: 'g2', title: 'Fall Portraits', bytes: 1024 ** 3 },
      { id: 'g3', title: 'Empty', bytes: 0 },
    ],
  },
};

const emptyAnalytics: AnalyticsData = {
  viewsOverTime: keys.map((date) => ({ date, views: 0 })),
  uploadActivity: keys.map((date) => ({ date, count: 0 })),
  topGalleries: [],
  topPhotos: [],
  storage: { total_bytes: 0, galleries: [] },
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

/** The card for one stat: its label, value and sublabel share a parent. */
const card = (label: string) => screen.getByText(label).parentElement!;

/** The chart card whose heading is `title`. */
const chart = (title: string) => screen.getByRole('heading', { name: title }).closest('div')!.parentElement!;

/** The non-blank tick labels on one axis of a chart. */
const tickLabels = (container: HTMLElement, axis: 'xAxis' | 'yAxis') =>
  Array.from(container.querySelectorAll(`.recharts-${axis}-tick-labels .recharts-cartesian-axis-tick-value`))
    .map((t) => t.textContent)
    .filter(Boolean);

describe('admin dashboard', () => {
  const originalTz = process.env.TZ;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  beforeAll(() => {
    // The admin's browser is in New York, west of UTC, where reading a day key
    // as local midnight would label each point with the day before.
    process.env.TZ = 'America/New_York';
    // jsdom has no layout. Recharts sizes a ResponsiveContainer from its
    // bounding box, and draws nothing at zero width.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (!this.classList.contains('recharts-responsive-container')) return originalRect.call(this);
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 250, width: 800, height: 250, toJSON() {} };
    };
  });

  afterAll(() => {
    process.env.TZ = originalTz;
    vi.unstubAllGlobals();
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the stats cards from the admin stats', async () => {
    vi.mocked(client.getAdminStats).mockResolvedValue(stats);
    vi.mocked(client.getAnalytics).mockResolvedValue(analytics);
    renderDashboard();

    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();

    expect(card('Total Galleries').textContent).toContain((12).toLocaleString());
    expect(within(card('Total Galleries')).getByText('9 public, 3 private')).toBeTruthy();
    expect(within(card('Total Photos')).getByText((4821).toLocaleString())).toBeTruthy();
    expect(within(card('Gallery Views')).getByText((15032).toLocaleString())).toBeTruthy();
    expect(within(card('Downloads')).getByText('377')).toBeTruthy();
  });

  it('draws the traffic and upload charts with day labels for the days the keys name', async () => {
    vi.mocked(client.getAdminStats).mockResolvedValue(stats);
    vi.mocked(client.getAnalytics).mockResolvedValue(analytics);
    renderDashboard();
    await screen.findByRole('heading', { name: 'Dashboard' });

    const traffic = chart('Traffic (Last 30 Days)');
    expect(within(traffic).getByText(`${(98).toLocaleString()} total views`)).toBeTruthy();
    // Every fifth day is labelled, starting with the first: Oct 25, 30, Nov 4, ...
    const expected = ['Oct 25', 'Oct 30', 'Nov 4', 'Nov 9', 'Nov 14', 'Nov 19'];
    // Recharts draws its axes a render after the chart mounts.
    await waitFor(() => expect(tickLabels(traffic, 'xAxis')).toEqual(expected));

    const uploads = chart('Upload Activity');
    expect(within(uploads).getByText('7 uploads')).toBeTruthy();
    await waitFor(() => expect(tickLabels(uploads, 'xAxis')).toEqual(expected));
  });

  it('shows storage by gallery and the leaderboards', async () => {
    vi.mocked(client.getAdminStats).mockResolvedValue(stats);
    vi.mocked(client.getAnalytics).mockResolvedValue(analytics);
    renderDashboard();
    await screen.findByRole('heading', { name: 'Dashboard' });

    const storage = chart('Storage by Gallery');
    expect(within(storage).getByText('3 GB total')).toBeTruthy();
    // Galleries with no bytes are left out, and long titles are shortened.
    await waitFor(() => expect(tickLabels(storage, 'yAxis')).toEqual(['Smith Wedding a...', 'Fall Portraits']));

    const galleries = screen.getByRole('heading', { name: 'Top Galleries' }).parentElement!;
    const galleryLinks = within(galleries).getAllByRole('link');
    expect(galleryLinks.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Smith Wedding', '/galleries/g1/photos'],
      ['Fall Portraits', '/galleries/g2/photos'],
    ]);
    expect(within(galleries).getByText((1200).toLocaleString())).toBeTruthy();

    const photos = screen.getByRole('heading', { name: 'Top Photos' }).parentElement!;
    const first = within(photos).getByRole('img', { name: 'Top photo 1 in Smith Wedding' });
    expect(first.getAttribute('src')).toBe('https://cdn.test/p1-thumb.webp');
    expect(first.closest('a')!.getAttribute('href')).toBe('/galleries/g1/photos');
    // A photo in no gallery links to the unassigned page.
    const second = within(photos).getByRole('img', { name: 'Top photo 2 in Unassigned' });
    expect(second.closest('a')!.getAttribute('href')).toBe('/unassigned');
    expect(within(photos).getByText('DSC_0001.jpg')).toBeTruthy();
  });

  it('shows empty charts and leaderboards before there is any activity', async () => {
    vi.mocked(client.getAdminStats).mockResolvedValue({
      galleries: { total: 0, public: 0, private: 0 },
      photos: { total: 0, featured: 0 },
      views: { galleries: 0, photos: 0 },
      downloads: 0,
    });
    vi.mocked(client.getAnalytics).mockResolvedValue(emptyAnalytics);
    renderDashboard();
    await screen.findByRole('heading', { name: 'Dashboard' });

    expect(within(card('Total Galleries')).getByText('0 public, 0 private')).toBeTruthy();
    expect(within(chart('Traffic (Last 30 Days)')).getByText('0 total views')).toBeTruthy();
    expect(within(chart('Upload Activity')).getByText('0 uploads')).toBeTruthy();
    const storage = chart('Storage by Gallery');
    expect(within(storage).getByText('0 B total')).toBeTruthy();
    expect(within(storage).getByText('No data yet')).toBeTruthy();
    for (const title of ['Top Galleries', 'Top Photos']) {
      const board = screen.getByRole('heading', { name: title }).parentElement!;
      expect(within(board).getByText('No data yet')).toBeTruthy();
      expect(within(board).queryByRole('listitem')).toBeNull();
    }
  });

  it('shows the error when either request fails', async () => {
    vi.mocked(client.getAdminStats).mockResolvedValue(stats);
    vi.mocked(client.getAnalytics).mockRejectedValue(new Error('Analytics unavailable'));
    renderDashboard();

    expect(await screen.findByText('Analytics unavailable')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('falls back to a generic message for a failure that is not an Error', async () => {
    vi.mocked(client.getAdminStats).mockRejectedValue('offline');
    vi.mocked(client.getAnalytics).mockResolvedValue(analytics);
    renderDashboard();

    expect(await screen.findByText('Failed to load data')).toBeTruthy();
  });
});
