import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from 'pg';
import { listMigrations, MIGRATIONS_DIR, runMigrations } from './migrate';

const adminUrl = process.env.TEST_DATABASE_URL;
const MIGRATION = '018_review_status.sql';

// Its own database, migrated to the release before review_status, so the
// backfill runs over rows the previous release wrote.
describe.skipIf(!adminUrl)(`${MIGRATION} (database)`, () => {
  const name = `review_${crypto.randomBytes(4).toString('hex')}_test`;
  let dir = '';
  let c: Client;
  let galleryId = '';

  const insertOld = async (label: string, isHidden: boolean | null) => {
    const { rows } = await c.query(
      `INSERT INTO photos (gallery_id, filename, original_filename, s3_key, s3_thumbnail_key,
                           s3_web_key, width, height, file_size, is_hidden)
       VALUES ($1, $2, $2, $3, $4, $5, 10, 10, 1, $6) RETURNING id`,
      [galleryId, label, `o/${label}`, `t/${label}`, `w/${label}`, isHidden]
    );
    return rows[0].id as string;
  };
  const state = async (id: string) =>
    (await c.query(`SELECT review_status, is_hidden FROM photos WHERE id = $1`, [id])).rows[0];

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = `/${name}`;

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    for (const file of listMigrations().filter((f) => f < MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
    }
    const quiet = () => {};
    await runMigrations(url.toString(), dir, quiet);

    c = new Client({ connectionString: url.toString() });
    await c.connect();
    galleryId = (
      await c.query(`INSERT INTO galleries (title, slug) VALUES ('G', 'g') RETURNING id`)
    ).rows[0].id;
    ids.visible = await insertOld('visible', false);
    ids.hidden = await insertOld('hidden', true);
    ids.unset = await insertOld('unset', null);

    expect(await runMigrations(url.toString(), MIGRATIONS_DIR, quiet)).toEqual(
      listMigrations().filter((f) => f >= MIGRATION)
    );
  });

  afterAll(async () => {
    await c?.end();
    fs.rmSync(dir, { recursive: true, force: true });
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  });

  it('makes visible photos shown and hidden ones rejected; a null is_hidden was never public', async () => {
    expect(await state(ids.visible)).toEqual({ review_status: 'shown', is_hidden: false });
    expect(await state(ids.hidden)).toEqual({ review_status: 'rejected', is_hidden: true });
    expect(await state(ids.unset)).toEqual({ review_status: 'rejected', is_hidden: true });
  });

  it('refuses any other status', async () => {
    await expect(c.query(`UPDATE photos SET review_status = 'hidden' WHERE id = $1`, [ids.visible])).rejects.toThrow(
      /photos_review_status_check/
    );
    await expect(c.query(`UPDATE photos SET review_status = NULL WHERE id = $1`, [ids.visible])).rejects.toThrow(
      /null value/
    );
  });

  it('keeps is_hidden in step with every review_status write', async () => {
    const id = await insertOld('new-style', false);
    for (const status of ['review', 'shown', 'rejected', 'shown', 'review']) {
      await c.query(`UPDATE photos SET review_status = $2 WHERE id = $1`, [id, status]);
      expect(await state(id)).toEqual({ review_status: status, is_hidden: status !== 'shown' });
    }
    const both = await insertOld('both', true);
    // review_status wins when one statement writes both.
    await c.query(`UPDATE photos SET review_status = 'shown', is_hidden = true WHERE id = $1`, [both]);
    expect(await state(both)).toEqual({ review_status: 'shown', is_hidden: false });
  });

  describe("the previous release's writes, which know only is_hidden", () => {
    it('an upload (is_hidden true, no status) lands in review', async () => {
      expect(await state(await insertOld('old-upload', true))).toEqual({ review_status: 'review', is_hidden: true });
    });

    it('an insert claiming is_hidden false still lands in review, never public', async () => {
      expect(await state(await insertOld('old-visible', false))).toEqual({ review_status: 'review', is_hidden: true });
    });

    it('Show makes a photo shown, and Hide makes it rejected', async () => {
      const id = await insertOld('toggled', true);
      await c.query(`UPDATE photos SET is_hidden = false WHERE id = $1`, [id]);
      expect(await state(id)).toEqual({ review_status: 'shown', is_hidden: false });
      await c.query(`UPDATE photos SET is_hidden = true WHERE id = $1`, [id]);
      expect(await state(id)).toEqual({ review_status: 'rejected', is_hidden: true });
    });

    it("its public filter, is_hidden = false, matches exactly the shown photos", async () => {
      const { rows } = await c.query(
        `SELECT COUNT(*) FILTER (WHERE is_hidden = false)::int AS old,
                COUNT(*) FILTER (WHERE review_status = 'shown')::int AS new,
                COUNT(*) FILTER (WHERE is_hidden IS DISTINCT FROM (review_status <> 'shown'))::int AS out_of_step
         FROM photos`
      );
      expect(rows[0].old).toBe(rows[0].new);
      expect(rows[0].out_of_step).toBe(0);
    });

    it('a counter update leaves the state alone', async () => {
      await c.query(`UPDATE photos SET view_count = view_count + 1 WHERE id = $1`, [ids.hidden]);
      expect(await state(ids.hidden)).toEqual({ review_status: 'rejected', is_hidden: true });
    });
  });
});
