import { Request, Response } from 'express';
import crypto from 'crypto';
import * as photoService from '../services/photoService';
import * as galleryService from '../services/galleryService';
import * as imageService from '../services/imageService';
import * as s3Service from '../services/s3Service';
import { recordPhotoDownload, recordPhotoView } from '../services/eventTracking';
import { canViewPhoto } from '../services/photoAccess';
import { toPublicPhoto, toPublicPhotos } from '../services/photoView';
import { cachePublicly } from '../middleware/cacheControl';
import { encodeCursor, nextOffset, parseAdminPage, parsePublicPage } from '../services/photoPaging';
import { storedFilename } from '../config/upload';
import { photoDownloadName } from '../services/downloadNames';
import type { Photo } from '../types';
import { logger } from '../utils/logger';

const NOT_FOUND = { success: false, error: 'Photo not found' } as const;

// A photo the visitor may not see answers exactly like one that does not
// exist, so ids cannot be probed.
const loadViewablePhoto = async (id: string, accessToken: unknown) => {
  const photo = await photoService.getPhotoById(id);
  if (!photo) return null;
  const gallery = photo.gallery_id ? await galleryService.getGalleryById(photo.gallery_id) : null;
  return canViewPhoto(photo, gallery, accessToken) ? photo : null;
};

export const getPhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const photo = await loadViewablePhoto(id, req.query.access);
    if (!photo) {
      return res.status(404).json(NOT_FOUND);
    }

    // Not counted as a view: views are counted only by POST /:id/view, which
    // the lightbox sends when a photo is actually shown.
    res.json({ success: true, data: await toPublicPhoto(photo) });
  } catch (err) {
    logger.error('Error fetching photo', { err });
    res.status(500).json({ success: false, error: 'Failed to fetch photo' });
  }
};

/**
 * List the publicly visible photos (public galleries and unassigned), newest
 * first, one page at a time: ?limit= (at most PUBLIC_PAGE_MAX, the default)
 * and ?cursor=, the nextCursor of the previous page. nextCursor is null on
 * the last page.
 */
export const listAllPhotos = async (req: Request, res: Response) => {
  try {
    const parsed = parsePublicPage(req.query);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const { photos, next } = await photoService.getPublicPhotosPage(parsed.value.limit, parsed.value.after);
    const data = await toPublicPhotos(photos);
    cachePublicly(res);
    res.json({ success: true, data, nextCursor: next ? encodeCursor(next) : null });
  } catch (err) {
    logger.error('Error fetching all photos', { err });
    res.status(500).json({ success: false, error: 'Failed to fetch photos' });
  }
};

/**
 * List photos not assigned to any gallery (admin), newest first. With
 * ?limit= (and ?offset=) it sends one page; total is the whole list's length
 * and nextOffset is null on the last page.
 */
export const listUnassignedPhotos = async (req: Request, res: Response) => {
  try {
    const parsed = parseAdminPage(req.query);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const page = parsed.value;
    const { photos, total } = await photoService.getUnassignedPhotos(page);
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({
      success: true,
      data: photosWithUrls,
      total,
      nextOffset: page ? nextOffset(page.offset, photos.length, total) : null,
    });
  } catch (err) {
    logger.error('Error fetching unassigned photos', { err });
    res.status(500).json({ success: false, error: 'Failed to fetch unassigned photos' });
  }
};

export const getFeatured = async (_req: Request, res: Response) => {
  try {
    const photos = await photoService.getFeaturedPhotos();
    const data = await toPublicPhotos(photos);
    cachePublicly(res);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Error fetching featured photos', { err });
    res.status(500).json({ success: false, error: 'Failed to fetch featured photos' });
  }
};

export const downloadPhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const photo = await loadViewablePhoto(id, req.query.access);
    if (!photo) {
      return res.status(404).json(NOT_FOUND);
    }

    // Not cached: every request counts a download. This is the only public
    // route that signs an original.
    recordPhotoDownload(id);
    res.json({
      success: true,
      data: {
        filename: photoDownloadName(photo),
        downloadUrl: await photoService.getDownloadUrl(photo),
      },
    });
  } catch (err) {
    logger.error('Error downloading photo', { err });
    res.status(500).json({ success: false, error: 'Failed to download photo' });
  }
};

/**
 * Track a photo view (lightweight endpoint for analytics)
 */
export const trackView = (req: Request, res: Response) => {
  // Counted only for visible photos (the write checks). The answer is the
  // same either way, so tracking cannot be used to learn which ids exist.
  recordPhotoView(req.params.id);
  // No body, as for gallery views (galleryController.trackGalleryView).
  res.status(204).end();
};

/**
 * Track a photo download (lightweight endpoint for analytics)
 */
export const trackDownload = (req: Request, res: Response) => {
  recordPhotoDownload(req.params.id);
  res.status(204).end();
};

const alreadyUploaded = (existing: Photo | null) => ({
  success: false,
  error: existing ? `Already uploaded as ${existing.original_filename}` : 'Already uploaded',
});

export const uploadPhoto = async (req: Request, res: Response) => {
  try {
    // Validate file exists
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No photo file provided' });
    }

    // galleryId is optional - photos can be uploaded unassigned
    const galleryId: string | null = req.body.galleryId || null;

    // Validate gallery exists when one is specified
    if (galleryId) {
      const gallery = await galleryService.getGalleryById(galleryId);
      if (!gallery) {
        return res.status(404).json({ success: false, error: 'Gallery not found' });
      }
    }

    // One header read decides the format and size and carries the EXIF, so
    // nothing below parses the file again.
    let info: imageService.ImageInfo;
    try {
      info = await imageService.readImageInfo(req.file.buffer);
    } catch (err) {
      if (err instanceof imageService.ImageTooLargeError) {
        return res.status(413).json({ success: false, error: err.message });
      }
      if (err instanceof imageService.HeicNotSupportedError) {
        return res.status(415).json({ success: false, error: err.message });
      }
      if (err instanceof imageService.UnsupportedImageError) {
        return res.status(415).json({
          success: false,
          error: 'Unsupported image format. Allowed: JPEG, PNG, WebP, TIFF',
        });
      }
      throw err;
    }

    // Reject exact duplicates (hash of the raw upload bytes)
    const contentHash = crypto
      .createHash('sha256')
      .update(req.file.buffer)
      .digest('hex');
    const duplicate = await photoService.getPhotoByContentHash(contentHash);
    if (duplicate) {
      return res.status(409).json(alreadyUploaded(duplicate));
    }

    const processed = await imageService.processImage(req.file.buffer, info);
    const exifData = imageService.exifFromMetadata(info.metadata);
    // The stored type and extension come from the bytes, never from the
    // client's MIME type or filename (#87).
    const { format } = processed.original;

    // Generate unique ID and S3 keys
    const photoId = crypto.randomUUID();
    const keys = s3Service.generatePhotoKeys(galleryId, photoId, format.extension);

    const uploads = [
      { buffer: processed.original.buffer, key: keys.original, type: format.contentType },
      { buffer: processed.web.buffer, key: keys.web, type: 'image/webp' },
      { buffer: processed.thumbnail.buffer, key: keys.thumbnail, type: 'image/webp' },
    ];

    let photo: Photo;
    try {
      // allSettled rather than all: cleanup must not start while another
      // upload is still in flight, or that object lands after its delete.
      const results = await Promise.allSettled(
        uploads.map((u) => s3Service.uploadFile(u.buffer, u.key, u.type))
      );
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;

      photo = await photoService.createPhoto({
        gallery_id: galleryId,
        filename: `${photoId}.${format.extension}`,
        original_filename: storedFilename(req.file.originalname),
        s3_key: keys.original,
        s3_thumbnail_key: keys.thumbnail,
        s3_web_key: keys.web,
        width: processed.original.width,
        height: processed.original.height,
        file_size: processed.original.size,
        exif_data: exifData || undefined,
        content_hash: contentHash,
        original_content_type: format.contentType,
      });
    } catch (err) {
      // No row points at these keys, so they would be orphaned (#58).
      // deleteFiles is best effort: it logs what it could not delete and
      // never throws, so the original error is the one reported.
      await s3Service.deleteFiles(uploads.map((u) => u.key));

      if (photoService.isDuplicateContentError(err)) {
        const existing = await photoService.getPhotoByContentHash(contentHash);
        return res.status(409).json(alreadyUploaded(existing));
      }
      throw err;
    }

    // Return photo with signed URLs
    const photoWithUrls = await photoService.enrichPhotoWithUrls(photo);
    res.status(201).json({ success: true, data: photoWithUrls });
  } catch (err) {
    logger.error('Error uploading photo', { err });
    res.status(500).json({ success: false, error: 'Failed to upload photo' });
  }
};

// ============ Admin Controllers ============

/**
 * Check which content hashes are already uploaded
 * Body: { hashes: string[] } (SHA-256 hex of original file bytes)
 * Returns a map of hash -> { id, original_filename, gallery_id, gallery_title }
 * for hashes that exist; missing hashes are simply absent.
 */
export const checkDuplicates = async (req: Request, res: Response) => {
  try {
    const { hashes } = req.body;

    if (!Array.isArray(hashes) || hashes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'hashes must be a non-empty array',
      });
    }
    // Cap keeps the request under the 100kb express.json body limit
    if (hashes.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 1000 hashes per request',
      });
    }
    if (!hashes.every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))) {
      return res.status(400).json({
        success: false,
        error: 'hashes must be lowercase SHA-256 hex strings',
      });
    }

    const photos = await photoService.getPhotosByContentHashes(hashes);
    const found: Record<
      string,
      { id: string; original_filename: string; gallery_id: string | null; gallery_title: string | null }
    > = {};
    for (const photo of photos) {
      found[photo.content_hash!] = {
        id: photo.id,
        original_filename: photo.original_filename,
        gallery_id: photo.gallery_id,
        gallery_title: photo.gallery_title,
      };
    }

    res.json({ success: true, data: found });
  } catch (err) {
    logger.error('Error checking duplicates', { err });
    res.status(500).json({ success: false, error: 'Failed to check duplicates' });
  }
};

/**
 * Update a photo's metadata (featured, hidden, sort_order)
 */
export const updatePhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Featured state lives in featured_order and changes only through the
    // homepage endpoints, so is_featured is not accepted here.
    const { is_hidden, sort_order } = req.body;

    // Check if photo exists
    const existing = await photoService.getPhotoById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    const photo = await photoService.updatePhoto(id, {
      is_hidden,
      sort_order,
    });

    const photoWithUrls = await photoService.enrichPhotoWithUrls(photo!);
    res.json({ success: true, data: photoWithUrls });
  } catch (err) {
    logger.error('Error updating photo', { err });
    res.status(500).json({ success: false, error: 'Failed to update photo' });
  }
};

/**
 * Delete a photo and its S3 files
 */
export const deletePhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if photo exists and get its stored S3 keys
    const photo = await photoService.getPhotoById(id);
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    // Delete from S3 first (best effort)
    await s3Service.deletePhotoFiles(
      [photo.s3_key, photo.s3_web_key, photo.s3_thumbnail_key],
      id
    );

    // Delete from database
    await photoService.deletePhoto(id);

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    logger.error('Error deleting photo', { err });
    res.status(500).json({ success: false, error: 'Failed to delete photo' });
  }
};

/**
 * Reorder photos in a gallery
 */
export const reorderPhotos = async (req: Request, res: Response) => {
  try {
    const { gallery_id, photo_ids } = req.body;

    if (!gallery_id || !Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'gallery_id and a non-empty photo_ids array are required',
      });
    }

    // Verify gallery exists
    const gallery = await galleryService.getGalleryById(gallery_id);
    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // Reorder photos
    await photoService.reorderPhotos(gallery_id, photo_ids);

    res.json({ success: true, data: { reordered: true } });
  } catch (err) {
    logger.error('Error reordering photos', { err });
    res.status(500).json({ success: false, error: 'Failed to reorder photos' });
  }
};

/**
 * Move photos to a different gallery
 * Body: { photo_ids: string[], target_gallery_id: string | null }
 * A null target moves the photos to Unassigned. The field must still be
 * sent, so a request that omits it cannot unassign photos by accident.
 */
export const movePhotos = async (req: Request, res: Response) => {
  try {
    const { photo_ids } = req.body;

    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'photo_ids array is required',
      });
    }

    // Unassigning must be explicit: only null means Unassigned, so a missing
    // or empty field can never move photos out of their gallery.
    const target = req.body.target_gallery_id;
    if (target === undefined || target === '') {
      return res.status(400).json({
        success: false,
        error: 'target_gallery_id is required (null for Unassigned)',
      });
    }
    const targetGalleryId: string | null = target;

    if (targetGalleryId) {
      const targetGallery = await galleryService.getGalleryById(targetGalleryId);
      if (!targetGallery) {
        return res.status(404).json({ success: false, error: 'Target gallery not found' });
      }
    }

    const movedCount = await photoService.movePhotos(photo_ids, targetGalleryId);

    res.json({ success: true, data: { moved: movedCount } });
  } catch (err) {
    logger.error('Error moving photos', { err });
    res.status(500).json({ success: false, error: 'Failed to move photos' });
  }
};

// ============ Homepage Featured Photos Management ============

/**
 * Get all featured photos for admin management
 */
export const getFeaturedAdmin = async (_req: Request, res: Response) => {
  try {
    const photos = await photoService.getFeaturedPhotosAdmin();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    logger.error('Error fetching featured photos', { err });
    res.status(500).json({ success: false, error: 'Failed to fetch featured photos' });
  }
};

/**
 * Set a photo as the hero (main homepage image)
 */
export const setHero = async (req: Request, res: Response) => {
  try {
    const { photo_id } = req.body;

    if (!photo_id) {
      return res.status(400).json({ success: false, error: 'photo_id is required' });
    }

    // Verify photo exists
    const photo = await photoService.getPhotoById(photo_id);
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }
    // Visitors never see a hidden photo, so as hero it would be silently
    // replaced by the next featured photo.
    if (photo.is_hidden) {
      return res
        .status(400)
        .json({ success: false, error: 'Show this photo before making it the hero' });
    }

    await photoService.setHeroPhoto(photo_id);

    // Return updated featured list
    const photos = await photoService.getFeaturedPhotosAdmin();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    logger.error('Error setting hero photo', { err });
    res.status(500).json({ success: false, error: 'Failed to set hero photo' });
  }
};

/**
 * Add a photo to featured section
 */
export const addFeatured = async (req: Request, res: Response) => {
  try {
    const { photo_id } = req.body;

    if (!photo_id) {
      return res.status(400).json({ success: false, error: 'photo_id is required' });
    }

    // Verify photo exists
    const photo = await photoService.getPhotoById(photo_id);
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    await photoService.addToFeatured(photo_id);

    // Return updated featured list
    const photos = await photoService.getFeaturedPhotosAdmin();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    logger.error('Error adding featured photo', { err });
    res.status(500).json({ success: false, error: 'Failed to add featured photo' });
  }
};

/**
 * Remove a photo from featured section
 */
export const removeFeatured = async (req: Request, res: Response) => {
  try {
    const { photo_id } = req.body;

    if (!photo_id) {
      return res.status(400).json({ success: false, error: 'photo_id is required' });
    }

    await photoService.removeFromFeatured(photo_id);

    // Return updated featured list
    const photos = await photoService.getFeaturedPhotosAdmin();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    logger.error('Error removing featured photo', { err });
    res.status(500).json({ success: false, error: 'Failed to remove featured photo' });
  }
};

/**
 * Reorder featured photos
 */
export const reorderFeatured = async (req: Request, res: Response) => {
  try {
    const { photo_ids } = req.body;

    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'photo_ids array is required',
      });
    }

    // The first position is the hero. A hidden photo may stay there (it was
    // hidden after becoming hero), but none may be moved there.
    const first = await photoService.getPhotoById(photo_ids[0]);
    if (first?.is_hidden && first.featured_order !== 0) {
      return res
        .status(400)
        .json({ success: false, error: 'Show this photo before making it the hero' });
    }

    await photoService.reorderFeaturedPhotos(photo_ids);

    // Return updated featured list
    const photos = await photoService.getFeaturedPhotosAdmin();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    logger.error('Error reordering featured photos', { err });
    res.status(500).json({ success: false, error: 'Failed to reorder featured photos' });
  }
};
