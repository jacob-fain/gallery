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

    // Process image into 3 sizes
    const processed = await imageService.processImage(req.file.buffer);

    // Generate unique ID and S3 keys
    const photoId = crypto.randomUUID();
    const keys = s3Service.generatePhotoKeys(galleryId, photoId);

    // Upload all 3 versions to S3 in parallel
    await Promise.all([
      s3Service.uploadFile(processed.original.buffer, keys.original, 'image/jpeg'),
      s3Service.uploadFile(processed.web.buffer, keys.web, 'image/jpeg'),
      s3Service.uploadFile(processed.thumbnail.buffer, keys.thumbnail, 'image/jpeg'),
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
    });

    // Return photo with signed URLs
    const photoWithUrls = await photoService.enrichPhotoWithUrls(photo);
    res.status(201).json({ success: true, data: photoWithUrls });
  } catch (err) {
    console.error('Error uploading photo:', err);
    res.status(500).json({ success: false, error: 'Failed to upload photo' });
  }
};
