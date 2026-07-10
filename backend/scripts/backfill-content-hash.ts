/**
 * Content Hash Backfill Script
 *
 * Populates photos.content_hash for photos uploaded before duplicate
 * detection existed. Streams each photo's original from S3 (originals are
 * stored byte-for-byte as uploaded) and stores its SHA-256.
 *
 * Safe to re-run: only processes rows where content_hash IS NULL.
 *
 * Usage: npx ts-node scripts/backfill-content-hash.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';

// Load environment variables from root .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { getFileStream } from '../src/services/s3Service';

async function hashStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function backfill() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const result = await pool.query(
      `SELECT id, s3_key, original_filename FROM photos WHERE content_hash IS NULL ORDER BY uploaded_at`
    );
    console.log(`${result.rows.length} photos need a content hash`);

    let done = 0;
    let failed = 0;

    for (const row of result.rows) {
      try {
        const stream = await getFileStream(row.s3_key);
        const hash = await hashStream(stream);
        await pool.query(`UPDATE photos SET content_hash = $1 WHERE id = $2`, [
          hash,
          row.id,
        ]);
        done++;
        console.log(`[${done}/${result.rows.length}] ${row.original_filename} -> ${hash.slice(0, 12)}...`);
      } catch (err) {
        failed++;
        console.error(`Failed for ${row.original_filename} (${row.s3_key}):`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`\nDone: ${done} hashed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    await pool.end();
  }
}

backfill();
