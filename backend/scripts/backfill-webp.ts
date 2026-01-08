/**
 * Backfill WebP Script
 *
 * Converts existing JPEG web/thumbnail versions to WebP format.
 * - Downloads original from S3
 * - Generates new WebP web + thumbnail versions
 * - Uploads to new S3 keys (.webp extension)
 * - Updates database with new keys
 *
 * Usage: npx ts-node scripts/backfill-webp.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { Readable } from 'stream';

// Load environment variables from root .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

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

async function backfillWebp() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Get all photos
    const result = await pool.query(
      `SELECT id, gallery_id, s3_key, s3_web_key, s3_thumbnail_key FROM photos ORDER BY uploaded_at ASC`
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

        // Generate new S3 keys
        const basePath = `galleries/${photo.gallery_id}/${photo.id}`;
        const newWebKey = `${basePath}/web.webp`;
        const newThumbKey = `${basePath}/thumb.webp`;

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

backfillWebp();
