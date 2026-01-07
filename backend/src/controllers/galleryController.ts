import { Request, Response } from 'express';
import * as galleryService from '../services/galleryService';

export const listGalleries = async (_req: Request, res: Response) => {
  try {
    const galleries = await galleryService.getPublicGalleries();
    res.json({ success: true, data: galleries });
  } catch (err) {
    console.error('Error fetching galleries:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch galleries' });
  }
};

export const getGallery = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const gallery = await galleryService.getGalleryBySlug(slug);

    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // If gallery is private and no session, return limited info
    if (!gallery.is_public) {
      return res.json({
        success: true,
        data: {
          id: gallery.id,
          title: gallery.title,
          slug: gallery.slug,
          is_public: false,
          requires_password: true,
        },
      });
    }

    // Increment view count for public galleries
    await galleryService.incrementGalleryViews(gallery.id);

    res.json({ success: true, data: gallery });
  } catch (err) {
    console.error('Error fetching gallery:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch gallery' });
  }
};

export const getGalleryPhotos = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const gallery = await galleryService.getGalleryBySlug(slug);

    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // Block access to private gallery photos without auth (for now)
    if (!gallery.is_public) {
      return res.status(401).json({
        success: false,
        error: 'Password required to view this gallery',
      });
    }

    const photos = await galleryService.getGalleryPhotos(gallery.id);
    res.json({ success: true, data: photos });
  } catch (err) {
    console.error('Error fetching gallery photos:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch photos' });
  }
};
