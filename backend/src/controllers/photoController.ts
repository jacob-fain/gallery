import { Request, Response } from 'express';
import crypto from 'crypto';
import * as photoService from '../services/photoService';
import * as galleryService from '../services/galleryService';
import * as imageService from '../services/imageService';
import * as s3Service from '../services/s3Service';

export const getPhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const photo = await photoService.getPhotoById(id);

    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    // Check if photo's gallery is public (unassigned photos are public)
    const gallery = photo.gallery_id
      ? await galleryService.getGalleryById(photo.gallery_id)
      : null;
    if (gallery && !gallery.is_public) {
      return res.status(403).json({
        success: false,
        error: 'Password required to view this photo',
      });
    }

    await photoService.incrementPhotoViews(id);
    const photoWithUrls = await photoService.enrichPhotoWithUrls(photo);
    res.json({ success: true, data: photoWithUrls });
  } catch (err) {
    console.error('Error fetching photo:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch photo' });
  }
};

/**
 * List every publicly visible photo (public galleries and unassigned)
 * Supports an optional ?limit= query param
 */
export const listAllPhotos = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return res.status(400).json({ success: false, error: 'limit must be a positive integer' });
    }

    const photos = await photoService.getAllPublicPhotos(limit);
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    console.error('Error fetching all photos:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch photos' });
  }
};

/**
 * List photos not assigned to any gallery (admin)
 */
export const listUnassignedPhotos = async (_req: Request, res: Response) => {
  try {
    const photos = await photoService.getUnassignedPhotos();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    console.error('Error fetching unassigned photos:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch unassigned photos' });
  }
};

export const getFeatured = async (_req: Request, res: Response) => {
  try {
    const photos = await photoService.getFeaturedPhotos();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    console.error('Error fetching featured photos:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch featured photos' });
  }
};

export const downloadPhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const photo = await photoService.getPhotoById(id);

    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    await photoService.incrementPhotoDownloads(id);

    const photoWithUrls = await photoService.enrichPhotoWithUrls(photo);
    res.json({
      success: true,
      data: {
        filename: photo.original_filename,
        downloadUrl: photoWithUrls.url,
      },
    });
  } catch (err) {
    console.error('Error downloading photo:', err);
    res.status(500).json({ success: false, error: 'Failed to download photo' });
  }
};

/**
 * Track a photo view (lightweight endpoint for analytics)
 */
export const trackView = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await photoService.incrementPhotoViews(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error tracking view:', err);
    res.status(500).json({ success: false, error: 'Failed to track view' });
  }
};

/**
 * Track a photo download (lightweight endpoint for analytics)
 */
export const trackDownload = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await photoService.incrementPhotoDownloads(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error tracking download:', err);
    res.status(500).json({ success: false, error: 'Failed to track download' });
  }
};

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

    // Validate image format
    const isValid = await imageService.isValidImage(req.file.buffer);
    if (!isValid) {
      return res.status(415).json({
        success: false,
        error: 'Unsupported image format. Allowed: JPEG, PNG, WebP, TIFF, HEIF',
      });
    }

    // Reject exact duplicates (hash of the raw upload bytes)
    const contentHash = crypto
      .createHash('sha256')
      .update(req.file.buffer)
      .digest('hex');
    const duplicate = await photoService.getPhotoByContentHash(contentHash);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: `Already uploaded as ${duplicate.original_filename}`,
      });
    }

    // Process image into 3 sizes and extract EXIF in parallel
    const [processed, exifData] = await Promise.all([
      imageService.processImage(req.file.buffer),
      imageService.extractExifData(req.file.buffer),
    ]);

    // Generate unique ID and S3 keys
    const photoId = crypto.randomUUID();
    const keys = s3Service.generatePhotoKeys(galleryId, photoId);

    // Upload all 3 versions to S3 in parallel
    // Original stays as JPEG, web/thumbnail are WebP for smaller size
    await Promise.all([
      s3Service.uploadFile(processed.original.buffer, keys.original, 'image/jpeg'),
      s3Service.uploadFile(processed.web.buffer, keys.web, 'image/webp'),
      s3Service.uploadFile(processed.thumbnail.buffer, keys.thumbnail, 'image/webp'),
    ]);

    // Create photo record in database
    const photo = await photoService.createPhoto({
      gallery_id: galleryId,
      filename: `${photoId}.jpg`,
      original_filename: req.file.originalname,
      s3_key: keys.original,
      s3_thumbnail_key: keys.thumbnail,
      s3_web_key: keys.web,
      width: processed.original.width,
      height: processed.original.height,
      file_size: processed.original.size,
      exif_data: exifData || undefined,
      content_hash: contentHash,
    });

    // Return photo with signed URLs
    const photoWithUrls = await photoService.enrichPhotoWithUrls(photo);
    res.status(201).json({ success: true, data: photoWithUrls });
  } catch (err) {
    console.error('Error uploading photo:', err);
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
    console.error('Error checking duplicates:', err);
    res.status(500).json({ success: false, error: 'Failed to check duplicates' });
  }
};

/**
 * Update a photo's metadata (featured, hidden, sort_order)
 */
export const updatePhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { is_featured, is_hidden, sort_order } = req.body;

    // Check if photo exists
    const existing = await photoService.getPhotoById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    const photo = await photoService.updatePhoto(id, {
      is_featured,
      is_hidden,
      sort_order,
    });

    const photoWithUrls = await photoService.enrichPhotoWithUrls(photo!);
    res.json({ success: true, data: photoWithUrls });
  } catch (err) {
    console.error('Error updating photo:', err);
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
    console.error('Error deleting photo:', err);
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
    console.error('Error reordering photos:', err);
    res.status(500).json({ success: false, error: 'Failed to reorder photos' });
  }
};

/**
 * Move photos to a different gallery
 */
export const movePhotos = async (req: Request, res: Response) => {
  try {
    const { photo_ids, target_gallery_id } = req.body;

    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'photo_ids array is required',
      });
    }

    if (!target_gallery_id) {
      return res.status(400).json({
        success: false,
        error: 'target_gallery_id is required',
      });
    }

    // Verify target gallery exists
    const targetGallery = await galleryService.getGalleryById(target_gallery_id);
    if (!targetGallery) {
      return res.status(404).json({ success: false, error: 'Target gallery not found' });
    }

    // Move photos
    const movedCount = await photoService.movePhotos(photo_ids, target_gallery_id);

    res.json({ success: true, data: { moved: movedCount } });
  } catch (err) {
    console.error('Error moving photos:', err);
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
    console.error('Error fetching featured photos:', err);
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

    await photoService.setHeroPhoto(photo_id);

    // Return updated featured list
    const photos = await photoService.getFeaturedPhotosAdmin();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    console.error('Error setting hero photo:', err);
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
    console.error('Error adding featured photo:', err);
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
    console.error('Error removing featured photo:', err);
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

    await photoService.reorderFeaturedPhotos(photo_ids);

    // Return updated featured list
    const photos = await photoService.getFeaturedPhotosAdmin();
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    console.error('Error reordering featured photos:', err);
    res.status(500).json({ success: false, error: 'Failed to reorder featured photos' });
  }
};
