import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, S3_BUCKET, isS3Configured } from '../config/s3';
import { attachmentDisposition } from './downloadNames';
import { logger } from '../utils/logger';

// Default signed URL expiration: 1 hour
const DEFAULT_EXPIRES_IN = 3600;

// Every URL handed out, fresh or cached, stays valid at least this long. The
// API response holding it can sit in the browser's HTTP cache and the SPA's
// in-memory cache for 5 minutes each before an image loads from it, and a
// page can stay open long after that, so a URL near the end of its life
// breaks images (#59).
export const MIN_REMAINING_LIFETIME_MS = 50 * 60 * 1000;

/**
 * The time until which a URL signed at `signedAt` for `expiresIn` seconds may
 * be served from the cache. A URL whose whole lifetime is under
 * MIN_REMAINING_LIFETIME_MS is never reused.
 */
export const cacheReuseDeadline = (signedAt: number, expiresIn: number): number =>
  Math.max(signedAt, signedAt + expiresIn * 1000 - MIN_REMAINING_LIFETIME_MS);

const urlCache = new Map<string, { url: string; expires: number }>();
// Signings in progress, so concurrent cold requests for the same object share
// one signature. Keyed by lifetime too: a caller asking for a long-lived URL
// must never receive a short-lived one.
const signing = new Map<string, Promise<string>>();

// Periodic cleanup of expired cache entries (run every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of urlCache) {
    if (now >= value.expires) {
      urlCache.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

/**
 * Upload a file to S3
 * @param buffer - File content as Buffer
 * @param key - S3 object key (path in bucket)
 * @param contentType - MIME type (e.g., 'image/jpeg')
 */
export const uploadFile = async (
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<void> => {
  if (!isS3Configured()) {
    throw new Error('S3 is not configured. Check AWS environment variables.');
  }

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
};

/**
 * Generate a signed URL for accessing a private S3 object
 * Signed URLs allow temporary access without making the bucket public
 *
 * @param key - S3 object key
 * @param expiresIn - URL validity in seconds (default: 1 hour)
 * @param downloadName - When set, S3 serves the object as an attachment with
 *   this filename, so a browser saves it under that name instead of the key's.
 * @returns Temporary signed URL
 */
export const getSignedUrl = async (
  key: string,
  expiresIn: number = DEFAULT_EXPIRES_IN,
  downloadName?: string
): Promise<string> => {
  if (!isS3Configured()) {
    // Fail fast in production - S3 must be configured
    if (process.env.NODE_ENV === 'production') {
      throw new Error('S3 is not configured. Check AWS environment variables.');
    }
    // Return placeholder URL in dev when S3 isn't configured
    return `https://placehold.co/800x600/1a1a1a/ffffff?text=S3+Not+Configured`;
  }

  const cacheKey = downloadName ? `${key}\n${downloadName}` : key;
  const cached = urlCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.url;
  }

  const signingKey = `${cacheKey}\n${expiresIn}`;
  const inFlight = signing.get(signingKey);
  if (inFlight) return inFlight;

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ResponseContentDisposition: downloadName ? attachmentDisposition(downloadName) : undefined,
  });

  const pending = awsGetSignedUrl(s3Client, command, { expiresIn })
    .then((url) => {
      urlCache.set(cacheKey, {
        url,
        expires: cacheReuseDeadline(Date.now(), expiresIn),
      });
      return url;
    })
    .finally(() => signing.delete(signingKey));
  signing.set(signingKey, pending);
  return pending;
};

/**
 * Delete a file from S3
 * @param key - S3 object key to delete
 */
export const deleteFile = async (key: string): Promise<void> => {
  if (!isS3Configured()) {
    throw new Error('S3 is not configured. Check AWS environment variables.');
  }

  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  await s3Client.send(command);
};

// DeleteObjects accepts at most 1000 keys per request.
const DELETE_BATCH_SIZE = 1000;

/**
 * Delete many S3 objects with batched DeleteObjects requests. Best effort:
 * every batch is attempted, failures are logged, and the call never throws.
 * @returns Number of keys that could not be deleted
 */
export const deleteFiles = async (keys: string[]): Promise<number> => {
  if (!isS3Configured() || keys.length === 0) {
    return 0;
  }

  let failed = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    try {
      const response = await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        })
      );
      // DeleteObjects answers 200 even when some keys fail; they come back here.
      failed += response.Errors?.length ?? 0;
    } catch (err) {
      logger.error(`Failed to delete a batch of ${batch.length} S3 objects`, { err });
      failed += batch.length;
    }
  }

  if (failed > 0) {
    logger.error(`Failed to delete ${failed}/${keys.length} S3 objects`);
  }
  return failed;
};

/**
 * Get a readable stream for an S3 file
 * Used for streaming files (e.g., for ZIP creation)
 * @param key - S3 object key
 * @returns Readable stream
 */
export const getFileStream = async (key: string): Promise<Readable> => {
  if (!isS3Configured()) {
    throw new Error('S3 is not configured. Check AWS environment variables.');
  }

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);
  return response.Body as Readable;
};

/**
 * Generate S3 keys for a photo's three versions
 * Structure: galleries/{galleryId}/{photoId}/{version}.{ext}
 * - Original: the uploaded bytes, under the extension of their real format
 * - Web/Thumbnail: .webp (optimized format)
 *
 * Photos uploaded before the format was recorded all have "original.jpg";
 * their keys are stored on the row, so they keep working.
 *
 * @param galleryId - Gallery UUID, or null for unassigned photos
 * @param photoId - Photo UUID
 * @param originalExtension - Extension of the original's format, no dot
 * @returns Object with keys for original, web, and thumbnail versions
 */
export const generatePhotoKeys = (
  galleryId: string | null,
  photoId: string,
  originalExtension: string
): { original: string; web: string; thumbnail: string } => {
  const basePath = `galleries/${galleryId ?? 'unassigned'}/${photoId}`;
  return {
    original: `${basePath}/original.${originalExtension}`,
    web: `${basePath}/web.webp`,
    thumbnail: `${basePath}/thumb.webp`,
  };
};

/**
 * Delete all versions of a photo from S3
 * Uses Promise.allSettled to attempt all deletions even if some fail
 * (prevents orphaned files in S3)
 *
 * Takes the keys stored on the photo record - the S3 folder name is a
 * separate UUID from the photo's DB id, so keys must never be regenerated
 * from the id.
 *
 * @param keys - The photo's stored S3 keys (s3_key, s3_web_key, s3_thumbnail_key)
 * @param photoId - Photo UUID (for error logging only)
 */
export const deletePhotoFiles = async (
  keys: string[],
  photoId: string
): Promise<void> => {
  if (!isS3Configured()) {
    return; // Nothing to delete if S3 not configured
  }

  const results = await Promise.allSettled(keys.map((key) => deleteFile(key)));

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    logger.error(`Failed to delete ${failures.length}/${keys.length} files for photo ${photoId}`);
  }
};
