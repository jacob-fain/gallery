import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getClient, query } from '../config/db';
import { MIGRATIONS_DIR } from '../migrate';
import { createPhoto, isDuplicateContentError } from './photoService';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('duplicate uploads (database)', () => {
  const photos: string[] = [];

  const insert = async (contentHash: string | undefined) => {
    const tag = crypto.randomBytes(4).toString('hex');
    const photo = await createPhoto({
      gallery_id: null,
      filename: `${tag}.jpg`,
      original_filename: `${tag}.jpg`,
      s3_key: `o/${tag}`,
      s3_thumbnail_key: `t/${tag}`,
      s3_web_key: `w/${tag}`,
      width: 100,
      height: 100,
      file_size: 1,
      content_hash: contentHash,
    });
    photos.push(photo.id);
    return photo;
  };

  afterAll(async () => {
    if (photos.length) await query(`DELETE FROM photos WHERE id = ANY($1)`, [photos]);
  });

  it('stores one of several concurrent inserts of the same content', async () => {
    const hash = crypto.randomBytes(32).toString('hex');
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => insert(hash)));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(isDuplicateContentError(r.reason)).toBe(true);

    const { rows } = await query(`SELECT count(*)::int AS n FROM photos WHERE content_hash = $1`, [hash]);
    expect(rows[0].n).toBe(1);
  });

  it('allows any number of photos without a hash', async () => {
    await Promise.all([insert(undefined), insert(undefined), insert(undefined)]);
  });

  it('does not treat other insert errors as duplicates', async () => {
    const err = await insert('x'.repeat(65)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isDuplicateContentError(err)).toBe(false);
  });
});

describe.skipIf(!db)('migration 012 on existing duplicates (database)', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '012_unique_content_hash.sql'), 'utf8');

  // Runs the migration against a scratch photos table in a schema that is
  // rolled back, shaped like the table as 010 left it.
  const migrate = async (hashes: (string | null)[]) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA migration_012_check');
      await client.query('SET LOCAL search_path = migration_012_check');
      await client.query(`
        CREATE TABLE photos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          content_hash VARCHAR(64),
          uploaded_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX idx_photos_content_hash ON photos(content_hash);`);
      for (const hash of hashes) {
        await client.query('INSERT INTO photos (content_hash) VALUES ($1)', [hash]);
      }
      await client.query(sql);
      const { rows } = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'migration_012_check' AND tablename = 'photos'`
      );
      return rows.map((r) => r.indexname).sort();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  it('fails, naming the shared hash, instead of deleting photos', async () => {
    await expect(migrate(['a'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)])).rejects.toThrow(
      /1 hash\(es\) belong to more than one photo.*a{64} \(photos [0-9a-f-]{36}, [0-9a-f-]{36}\)/
    );
  });

  it('applies when hashes are distinct, whatever the number of missing ones', async () => {
    expect(await migrate(['a'.repeat(64), 'b'.repeat(64), null, null])).toEqual([
      'photos_content_hash_key',
      'photos_pkey',
    ]);
  });
});
