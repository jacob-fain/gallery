import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import { getStorageStats, getTopPhotos, getUploadActivity, getViewsOverTime } from './analyticsService';

const db = process.env.TEST_DATABASE_URL;

// A fixed "now" years in the past, so rows other suites insert at NOW() fall
// outside every window these tests read. 15:00 UTC is 10:00 in New York (EST).
const NOW = new Date('2020-11-24T15:00:00Z');

describe.skipIf(!db)('analytics (database)', () => {
  const galleries: string[] = [];
  const photos: string[] = [];
  const events: string[] = [];

  const tag = () => crypto.randomBytes(4).toString('hex');

  const gallery = async () => {
    const t = tag();
    const { rows } = await query(
      `INSERT INTO galleries (title, slug) VALUES ($1, $2) RETURNING id`,
      [`Analytics ${t}`, `analytics-${t}`]
    );
    galleries.push(rows[0].id);
    return rows[0].id as string;
  };

  const photo = async (galleryId: string | null, opts: { size?: number; views?: number; uploadedAt?: string } = {}) => {
    const name = `p-${tag()}`;
    const { rows } = await query(
      `INSERT INTO photos (gallery_id, filename, original_filename, s3_key, s3_thumbnail_key,
                           s3_web_key, width, height, file_size, view_count, uploaded_at)
       VALUES ($1, $2, $2, $3, $4, $5, 100, 100, $6, $7, COALESCE($8::timestamptz, NOW())) RETURNING id`,
      [galleryId, name, `o/${name}`, `t/${name}`, `w/${name}`, opts.size ?? 1, opts.views ?? 0, opts.uploadedAt ?? null]
    );
    photos.push(rows[0].id);
    return rows[0].id as string;
  };

  const view = async (at: string) => {
    const { rows } = await query(
      `INSERT INTO analytics_events (event_type, created_at) VALUES ('gallery_view', $1) RETURNING id`,
      [at]
    );
    events.push(rows[0].id);
  };

  afterAll(async () => {
    if (events.length) await query(`DELETE FROM analytics_events WHERE id = ANY($1)`, [events]);
    if (photos.length) await query(`DELETE FROM photos WHERE id = ANY($1)`, [photos]);
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  describe('views over time', () => {
    it('buckets by the New York day, not the UTC day, and ends on today', async () => {
      // 21:30 EST on Nov 23 is 02:30 UTC on Nov 24.
      await view('2020-11-24T02:30:00Z');
      await view('2020-11-24T14:00:00Z');

      const series = await getViewsOverTime(30, NOW);
      expect(series).toHaveLength(30);
      expect(series.at(-1)).toEqual({ date: '2020-11-24', views: 1 });
      expect(series.at(-2)).toEqual({ date: '2020-11-23', views: 1 });
    });

    it('starts the window at local midnight of the first day, across the DST change', async () => {
      // The first day is Oct 26 (EDT), whose midnight is 04:00 UTC.
      await view('2020-10-26T03:59:00Z');
      await view('2020-10-26T04:00:00Z');

      const series = await getViewsOverTime(30, NOW);
      expect(series[0]).toEqual({ date: '2020-10-26', views: 1 });
      expect(new Set(series.map((d) => d.date)).size).toBe(30);
    });
  });

  it('buckets uploads by the New York day', async () => {
    await photo(null, { uploadedAt: '2020-11-20T03:00:00Z' });

    const series = await getUploadActivity(30, NOW);
    expect(series.find((d) => d.date === '2020-11-19')).toEqual({ date: '2020-11-19', count: 1 });
    expect(series.find((d) => d.date === '2020-11-20')).toEqual({ date: '2020-11-20', count: 0 });
  });

  it('includes unassigned photos in Top Photos', async () => {
    const id = await photo(null, { views: 2_000_000_000 });

    const top = await getTopPhotos(5);
    expect(top[0]).toMatchObject({ id, gallery_id: null, gallery_title: 'Unassigned' });
  });

  it('gives unassigned photos their own storage row, so the rows add up to the total', async () => {
    const g = await gallery();
    await photo(g, { size: 1000 });
    await photo(null, { size: 500 });

    const stats = await getStorageStats();
    const unassigned = stats.galleries.filter((r) => r.id === null);
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].title).toBe('Unassigned');
    expect(stats.galleries.find((r) => r.id === g)?.bytes).toBe(Math.round(1000 * 1.17));

    const sum = stats.galleries.reduce((n, r) => n + r.bytes, 0);
    expect(Math.abs(sum - stats.total_bytes)).toBeLessThanOrEqual(stats.galleries.length);
  });
});
