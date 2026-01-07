import { Request, Response } from 'express';
import * as photoService from '../services/photoService';
import * as galleryService from '../services/galleryService';

export const getPhoto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const photo = await photoService.getPhotoById(id);

    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    // Check if photo's gallery is public
    const gallery = await galleryService.getGalleryBySlug(photo.gallery_id);
    if (gallery && !gallery.is_public) {
      return res.status(401).json({
        success: false,
        error: 'Password required to view this photo',
      });
    }

    await photoService.incrementPhotoViews(id);
    res.json({ success: true, data: photo });
  } catch (err) {
    console.error('Error fetching photo:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch photo' });
  }
};

export const getFeatured = async (_req: Request, res: Response) => {
  try {
    const photos = await photoService.getFeaturedPhotos();
    res.json({ success: true, data: photos });
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

    // For now, return the S3 key - actual S3 signed URL generation comes later
    res.json({
      success: true,
      data: {
        filename: photo.original_filename,
        s3_key: photo.s3_key,
      },
    });
  } catch (err) {
    console.error('Error downloading photo:', err);
    res.status(500).json({ success: false, error: 'Failed to download photo' });
  }
};
