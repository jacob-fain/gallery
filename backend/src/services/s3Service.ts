import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, S3_BUCKET, isS3Configured } from '../config/s3';

// Default signed URL expiration: 1 hour
const DEFAULT_EXPIRES_IN = 3600;

// Cache signed URLs for 50 minutes (URLs valid for 60 min, leave 10 min buffer)
const URL_CACHE_TTL_MS = 50 * 60 * 1000;
const urlCache = new Map<string, { url: string; expires: number }>();

// Periodic cleanup of expired cache entries (run every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of urlCache) {
    if (now >= value.expires) {
      urlCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

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
 * @returns Temporary signed URL
 */
export const getSignedUrl = async (
  key: string,
  expiresIn: number = DEFAULT_EXPIRES_IN
): Promise<string> => {
  if (!isS3Configured()) {
    // Fail fast in production - S3 must be configured
    if (process.env.NODE_ENV === 'production') {
      throw new Error('S3 is not configured. Check AWS environment variables.');
    }
    // Return placeholder URL in dev when S3 isn't configured
    return `https://placehold.co/800x600/1a1a1a/ffffff?text=S3+Not+Configured`;
  }

  // Check cache first
  const cached = urlCache.get(key);
  if (cached && Date.now() < cached.expires) {
    return cached.url;
  }

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  const url = await awsGetSignedUrl(s3Client, command, { expiresIn });

  // Cache the URL
  urlCache.set(key, {
    url,
    expires: Date.now() + URL_CACHE_TTL_MS,
  });

  return url;
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

/**
 * Copy a file within S3
 * @param sourceKey - Source S3 object key
 * @param destKey - Destination S3 object key
 */
export const copyFile = async (sourceKey: string, destKey: string): Promise<void> => {
  if (!isS3Configured()) {
    throw new Error('S3 is not configured. Check AWS environment variables.');
  }

  const command = new CopyObjectCommand({
    Bucket: S3_BUCKET,
    CopySource: `${S3_BUCKET}/${sourceKey}`,
    Key: destKey,
  });

  await s3Client.send(command);
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
 * - Original: .jpg (preserved as uploaded)
 * - Web/Thumbnail: .webp (optimized format)
 *
 * @param galleryId - Gallery UUID
 * @param photoId - Photo UUID
 * @returns Object with keys for original, web, and thumbnail versions
 */
export const generatePhotoKeys = (
  galleryId: string,
  photoId: string
): { original: string; web: string; thumbnail: string } => {
  const basePath = `galleries/${galleryId}/${photoId}`;
  return {
    original: `${basePath}/original.jpg`,
    web: `${basePath}/web.webp`,
    thumbnail: `${basePath}/thumb.webp`,
  };
};

/**
 * Delete all versions of a photo from S3
 * Uses Promise.allSettled to attempt all deletions even if some fail
 * (prevents orphaned files in S3)
 *
 * @param galleryId - Gallery UUID
 * @param photoId - Photo UUID
 */
export const deletePhotoFiles = async (
  galleryId: string,
  photoId: string
): Promise<void> => {
  if (!isS3Configured()) {
    return; // Nothing to delete if S3 not configured
  }

  const keys = generatePhotoKeys(galleryId, photoId);

  const results = await Promise.allSettled([
    deleteFile(keys.original),
    deleteFile(keys.web),
    deleteFile(keys.thumbnail),
  ]);

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Failed to delete ${failures.length}/3 files for photo ${photoId}`);
  }
};
