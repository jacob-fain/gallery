import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import {
  drainTracking,
  recordGalleryDownload,
  recordGalleryView,
  recordPhotoDownload,
  recordPhotoView,
} from './eventTracking';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('event tracking (database)', () => {
  const galleries: string[] = [];
  const tag = () => crypto.randomBytes(4).toString('hex');

  const gallery = async () => {
    const t = tag();
    const { rows } = await query(
      `INSERT INTO galleries (title, slug) VALUES ($1, $2) RETURNING id`,
      [`Tracking ${t}`, `tracking-${t}`]
    );
    galleries.push(rows[0].id);
    return rows[0].id as string;
  };

  const photo = async (galleryId: string, hidden = false) => {
    const name = `p-${tag()}`;
    const { rows } = await query(
      `INSERT INTO photos (gallery_id, filename, original_filename, s3_key, s3_thumbnail_key,
                           s3_web_key, width, height, file_size, is_hidden)
       VALUES ($1, $2, $2, $3, $4, $5, 100, 100, 1, $6) RETURNING id`,
      [galleryId, name, `o/${name}`, `t/${name}`, `w/${name}`, hidden]
    );
    return rows[0].id as string;
  };

  const eventsFor = async (galleryId: string) =>
    (
      await query(
        `SELECT event_type, photo_id FROM analytics_events WHERE gallery_id = $1 ORDER BY event_type`,
        [galleryId]
      )
    ).rows;

  afterAll(async () => {
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  it('counts a photo view and download with its gallery in one statement each', async () => {
    const g = await gallery();
    const p = await photo(g);

    recordPhotoView(p);
    recordPhotoView(p);
    recordPhotoDownload(p);
    await drainTracking();

    const { rows } = await query(`SELECT view_count, download_count FROM photos WHERE id = $1`, [p]);
    expect(rows[0]).toEqual({ view_count: 2, download_count: 1 });
    expect(await eventsFor(g)).toEqual([
      { event_type: 'photo_download', photo_id: p },
      { event_type: 'photo_view', photo_id: p },
      { event_type: 'photo_view', photo_id: p },
    ]);
  });

  it('does not count hidden or missing photos', async () => {
    const g = await gallery();
    const hidden = await photo(g, true);

    recordPhotoView(hidden);
    recordPhotoDownload(hidden);
    recordPhotoView(crypto.randomUUID());
    await drainTracking();

    const { rows } = await query(`SELECT view_count, download_count FROM photos WHERE id = $1`, [hidden]);
    expect(rows[0]).toEqual({ view_count: 0, download_count: 0 });
    expect(await eventsFor(g)).toEqual([]);
  });

  it('counts gallery views and downloads', async () => {
    const g = await gallery();

    recordGalleryView(g);
    recordGalleryDownload(g);
    await drainTracking();

    const { rows } = await query(`SELECT view_count FROM galleries WHERE id = $1`, [g]);
    expect(rows[0].view_count).toBe(1);
    expect(await eventsFor(g)).toEqual([
      { event_type: 'gallery_download', photo_id: null },
      { event_type: 'gallery_view', photo_id: null },
    ]);
  });
});
