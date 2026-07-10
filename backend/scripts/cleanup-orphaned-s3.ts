/**
 * Orphaned S3 File Cleanup Script
 *
 * Photos deleted before the deletePhotoFiles fix left their S3 files behind
 * (keys were regenerated from the DB id instead of using the stored keys).
 * This script lists every object under galleries/ in the bucket, compares
 * against the s3 keys referenced by the photos table, and reports orphans.
 *
 * Dry-run by default. Pass --delete to actually remove the orphaned objects.
 *
 * IMPORTANT: DATABASE_URL and AWS_S3_BUCKET must belong to the same
 * environment - comparing the prod bucket against the dev database would
 * flag every prod photo as an orphan.
 *
 * IMPORTANT: The gallery-app IAM user only has object-level permissions.
 * This script needs s3:ListBucket on the bucket - grant it temporarily or
 * run with admin credentials.
 *
 * Usage:
 *   npx ts-node scripts/cleanup-orphaned-s3.ts            # dry run
 *   npx ts-node scripts/cleanup-orphaned-s3.ts --delete   # delete orphans
 */

import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// Load environment variables from root .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const BUCKET = process.env.AWS_S3_BUCKET;
const PREFIX = 'galleries/';

async function listAllKeys(s3: S3Client): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: PREFIX,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of response.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

async function cleanupOrphans() {
  const shouldDelete = process.argv.includes('--delete');

  if (!BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    console.error('Error: AWS_S3_BUCKET and AWS credentials must be set in .env');
    process.exit(1);
  }

  const s3 = new S3Client({ region: process.env.AWS_REGION });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log(`Bucket:   ${BUCKET}`);
    console.log(`Database: ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':***@')}`);
    console.log(`Mode:     ${shouldDelete ? 'DELETE' : 'dry run'}\n`);

    // All keys referenced by the database
    const result = await pool.query(
      `SELECT s3_key, s3_web_key, s3_thumbnail_key FROM photos`
    );
    const referenced = new Set<string>();
    for (const row of result.rows) {
      referenced.add(row.s3_key);
      referenced.add(row.s3_web_key);
      referenced.add(row.s3_thumbnail_key);
    }
    console.log(`Database references ${referenced.size} keys across ${result.rows.length} photos`);

    // All keys actually in the bucket
    const bucketKeys = await listAllKeys(s3);
    console.log(`Bucket contains ${bucketKeys.length} objects under ${PREFIX}`);

    const orphans = bucketKeys.filter((key) => !referenced.has(key));
    console.log(`\nFound ${orphans.length} orphaned objects`);

    if (orphans.length === 0) {
      return;
    }

    for (const key of orphans) {
      console.log(`  ${key}`);
    }

    if (!shouldDelete) {
      console.log('\nDry run - nothing deleted. Re-run with --delete to remove these objects.');
      return;
    }

    console.log('\nDeleting orphans...');
    let deleted = 0;
    for (const key of orphans) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        deleted++;
      } catch (err) {
        console.error(`Failed to delete ${key}:`, err);
      }
    }
    console.log(`Deleted ${deleted}/${orphans.length} orphaned objects`);
  } catch (err) {
    console.error('Cleanup failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanupOrphans();
