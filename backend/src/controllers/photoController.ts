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

    // Check if photo's gallery is public
    const gallery = await galleryService.getGalleryById(photo.gallery_id);
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

    // Validate galleryId
    const { galleryId } = req.body;
    if (!galleryId) {
      return res.status(400).json({ success: false, error: 'Gallery ID is required' });
    }

    // Validate gallery exists
    const gallery = await galleryService.getGalleryById(galleryId);
    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // Validate image format
    const isValid = await imageService.isValidImage(req.file.buffer);
    if (!isValid) {
      return res.status(415).json({
        success: false,
        error: 'Unsupported image format. Allowed: JPEG, PNG, WebP, TIFF, HEIF',
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

    // Check if photo exists and get gallery_id for S3 path
    const photo = await photoService.getPhotoById(id);
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    // Delete from S3 first (best effort)
    await s3Service.deletePhotoFiles(photo.gallery_id, id);

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
