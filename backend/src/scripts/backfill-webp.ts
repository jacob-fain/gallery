/**
 * Backfill WebP Script
 *
 * Converts existing JPEG web/thumbnail versions to WebP format.
 * - Downloads original from S3
 * - Generates new WebP web + thumbnail versions
 * - Uploads to new S3 keys (.webp extension)
 * - Updates database with new keys
 *
 * Usage: node dist/scripts/backfill-webp.js
 */

import { loadDotenv } from '../config/env';
import { Pool } from 'pg';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { Readable } from 'stream';

loadDotenv();

// WebP settings (same as imageService.ts)
const IMAGE_SIZES = {
  web: { maxWidth: 1920, quality: 88 },
  thumbnail: { maxWidth: 600, quality: 82 },
};

const WEBP_OPTIONS = { effort: 4 };

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const S3_BUCKET = process.env.AWS_S3_BUCKET || '';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadFromS3(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });
  const response = await s3Client.send(command);
  return streamToBuffer(response.Body as Readable);
}

async function uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await s3Client.send(command);
}

async function deleteFromS3(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });
    await s3Client.send(command);
  } catch {
    // Ignore deletion errors
  }
}

async function processPhoto(
  buffer: Buffer,
  maxWidth: number,
  quality: number
): Promise<Buffer> {
  return sharp(buffer)
    .resize({
      width: maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .webp({
      quality,
      ...WEBP_OPTIONS,
    })
    .toBuffer();
}

export interface BackfillRow {
  id: string;
  s3_key: string;
  s3_web_key: string;
}

const folderOf = (key: string): string | null => {
  const slash = key.lastIndexOf('/');
  return slash > 0 ? key.slice(0, slash) : null;
};

/**
 * The WebP files go in the folder that already holds the photo's files.
 * Neither id can rebuild it: the folder is named by its own UUID, not the
 * photo's id, and the gallery id is null for an unassigned photo and stale
 * for a moved one.
 */
export const webpKeysFor = (photo: BackfillRow): { web: string; thumbnail: string } => {
  const dir = folderOf(photo.s3_web_key) ?? folderOf(photo.s3_key);
  if (!dir) throw new Error(`Photo ${photo.id} has no key folder to write into`);
  return { web: `${dir}/web.webp`, thumbnail: `${dir}/thumb.webp` };
};

async function backfillWebp() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Get all photos
    const result = await pool.query(
      `SELECT id, s3_key, s3_web_key, s3_thumbnail_key FROM photos ORDER BY uploaded_at ASC`
    );

    const photos = result.rows;
    console.log(`Found ${photos.length} photos to process`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const photo of photos) {
      try {
        // Check if already converted (ends with .webp)
        if (photo.s3_web_key.endsWith('.webp')) {
          skipped++;
          continue;
        }

        console.log(`Processing photo ${photo.id}...`);

        // Download original
        const originalBuffer = await downloadFromS3(photo.s3_key);

        // Generate new WebP versions
        const [webBuffer, thumbBuffer] = await Promise.all([
          processPhoto(originalBuffer, IMAGE_SIZES.web.maxWidth, IMAGE_SIZES.web.quality),
          processPhoto(originalBuffer, IMAGE_SIZES.thumbnail.maxWidth, IMAGE_SIZES.thumbnail.quality),
        ]);

        const { web: newWebKey, thumbnail: newThumbKey } = webpKeysFor(photo);

        // Upload new WebP versions
        await Promise.all([
          uploadToS3(webBuffer, newWebKey, 'image/webp'),
          uploadToS3(thumbBuffer, newThumbKey, 'image/webp'),
        ]);

        // Update database with new keys
        await pool.query(
          `UPDATE photos SET s3_web_key = $1, s3_thumbnail_key = $2 WHERE id = $3`,
          [newWebKey, newThumbKey, photo.id]
        );

        // Delete old JPEG files
        await Promise.all([
          deleteFromS3(photo.s3_web_key),
          deleteFromS3(photo.s3_thumbnail_key),
        ]);

        processed++;
        console.log(`  Done (${processed}/${photos.length - skipped})`);
      } catch (err) {
        failed++;
        console.error(`  Failed to process photo ${photo.id}:`, err);
      }
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`Processed: ${processed}`);
    console.log(`Skipped (already WebP): ${skipped}`);
    console.log(`Failed: ${failed}`);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  backfillWebp();
}
