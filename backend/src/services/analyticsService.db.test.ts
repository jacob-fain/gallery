import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query, withTransaction } from '../config/db';
import { getStorageStats, getTopPhotos, getUploadActivity, getViewsOverTime } from './analyticsService';
import { RETENTION_DAYS, ROLLUP_LOCK_KEY, runAnalyticsRollup } from './analyticsRollup';

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

  const event = async (type: string, at: string, galleryId: string, photoId: string | null = null) => {
    const { rows } = await query(
      `INSERT INTO analytics_events (event_type, gallery_id, photo_id, created_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [type, galleryId, photoId, at]
    );
    events.push(rows[0].id);
    return rows[0].id as string;
  };

  const rawLeft = async (ids: string[]) =>
    (await query(`SELECT COUNT(*)::int AS n FROM analytics_events WHERE id = ANY($1)`, [ids])).rows[0].n as number;

  const rolledUp = async (galleryId: string) =>
    (
      await query(
        `SELECT event_type, to_char(day, 'YYYY-MM-DD') AS day, photo_id, count
         FROM analytics_daily WHERE gallery_id = $1 ORDER BY 1, 2, 3`,
        [galleryId]
      )
    ).rows;

  afterAll(async () => {
    await query(`UPDATE analytics_rollup_state SET rolled_through = NULL`);
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

  // The rollup tests live in 2019, before every window the tests above read,
  // and only ever move the watermark up to late 2019, so the 2020 tests keep
  // reading raw events whichever order they run in.
  describe('rollup and retention', () => {
    const NOW_2019 = new Date('2019-06-15T15:00:00Z');

    it('reports the same views before the rollup, after it, and after retention deletes the raw events', async () => {
      const g = await gallery();
      const p = await photo(g);
      const ids = [
        // 23:30 EDT on Jun 13 and 00:30 EDT on Jun 14: either side of New York midnight.
        await event('gallery_view', '2019-06-14T03:30:00Z', g),
        await event('gallery_view', '2019-06-14T04:30:00Z', g),
        await event('gallery_view', '2019-06-10T12:00:00Z', g),
        await event('gallery_view', '2019-06-10T13:00:00Z', g),
        await event('gallery_view', '2019-06-10T14:00:00Z', g),
        // The window's first day, and a day before the window.
        await event('gallery_view', '2019-05-17T05:00:00Z', g),
        await event('gallery_view', '2019-05-01T12:00:00Z', g),
        // Other event types are rolled up too, but are not views.
        await event('photo_view', '2019-06-10T12:00:00Z', g, p),
        await event('photo_download', '2019-06-10T12:00:00Z', g, p),
        await event('gallery_download', '2019-06-10T12:00:00Z', g),
      ];
      // Today is not complete, so it stays raw until a later run.
      const today = await event('gallery_view', '2019-06-15T14:00:00Z', g);

      const before = await getViewsOverTime(30, NOW_2019);
      expect(before[0]).toEqual({ date: '2019-05-17', views: 1 });
      expect(before.find((d) => d.date === '2019-06-10')).toEqual({ date: '2019-06-10', views: 3 });
      expect(before.find((d) => d.date === '2019-06-13')).toEqual({ date: '2019-06-13', views: 1 });
      expect(before.find((d) => d.date === '2019-06-14')).toEqual({ date: '2019-06-14', views: 1 });
      expect(before.at(-1)).toEqual({ date: '2019-06-15', views: 1 });

      const first = await runAnalyticsRollup(NOW_2019);
      expect(first).toEqual({ ran: true, rolledThrough: '2019-06-15', deleted: 0 });
      expect(await getViewsOverTime(30, NOW_2019)).toEqual(before);
      expect(await rolledUp(g)).toEqual([
        { event_type: 'gallery_download', day: '2019-06-10', photo_id: null, count: 1 },
        { event_type: 'gallery_view', day: '2019-05-01', photo_id: null, count: 1 },
        { event_type: 'gallery_view', day: '2019-05-17', photo_id: null, count: 1 },
        { event_type: 'gallery_view', day: '2019-06-10', photo_id: null, count: 3 },
        { event_type: 'gallery_view', day: '2019-06-13', photo_id: null, count: 1 },
        { event_type: 'gallery_view', day: '2019-06-14', photo_id: null, count: 1 },
        { event_type: 'photo_download', day: '2019-06-10', photo_id: p, count: 1 },
        { event_type: 'photo_view', day: '2019-06-10', photo_id: p, count: 1 },
      ]);

      // A second run in the same day changes nothing.
      expect(await runAnalyticsRollup(NOW_2019)).toEqual(first);
      expect(await getViewsOverTime(30, NOW_2019)).toEqual(before);

      // Four months later, in several chunks: Jun 15 is rolled up and every
      // raw event above is past retention.
      const later = new Date('2019-10-13T15:00:00Z');
      const second = await runAnalyticsRollup(later);
      expect(second.rolledThrough).toBe('2019-10-13');
      expect(second.deleted).toBeGreaterThanOrEqual(ids.length + 1);
      expect(await rawLeft([...ids, today])).toBe(0);
      expect(await getViewsOverTime(30, NOW_2019)).toEqual(before);
    });

    it('keeps raw events inside the retention period', async () => {
      const g = await gallery();
      const recent = await event('gallery_view', '2019-10-20T12:00:00Z', g);
      const now = new Date(Date.parse('2019-10-20T12:00:00Z') + (RETENTION_DAYS - 1) * 86_400_000);

      await runAnalyticsRollup(now);
      expect(await rawLeft([recent])).toBe(1);
      expect(await rolledUp(g)).toEqual([
        { event_type: 'gallery_view', day: '2019-10-20', photo_id: null, count: 1 },
      ]);
    });

    it('does nothing while another instance holds the lock, and never double-counts concurrent runs', async () => {
      const g = await gallery();
      const fresh = [
        await event('gallery_view', '2020-01-25T12:00:00Z', g),
        await event('gallery_view', '2020-01-25T13:00:00Z', g),
      ];
      const now = new Date('2020-02-01T15:00:00Z');

      await withTransaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [ROLLUP_LOCK_KEY]);
        expect(await runAnalyticsRollup(now)).toEqual({ ran: false, rolledThrough: null, deleted: 0 });
      });
      expect(await rolledUp(g)).toEqual([]);

      await Promise.all([runAnalyticsRollup(now), runAnalyticsRollup(now), runAnalyticsRollup(now)]);
      expect(await rolledUp(g)).toEqual([
        { event_type: 'gallery_view', day: '2020-01-25', photo_id: null, count: 2 },
      ]);
      expect(await rawLeft(fresh)).toBe(2);
    });

    it('drops a deleted gallery from the rollup, as from the raw events', async () => {
      const g = await gallery();
      await event('gallery_view', '2020-02-10T12:00:00Z', g);
      await runAnalyticsRollup(new Date('2020-02-12T15:00:00Z'));
      expect(await rolledUp(g)).toHaveLength(1);

      await query(`DELETE FROM galleries WHERE id = $1`, [g]);
      expect(await rolledUp(g)).toEqual([]);
    });
  });
});
