import { Request, Response } from 'express';
import * as galleryService from '../services/galleryService';
import * as photoService from '../services/photoService';
import * as s3Service from '../services/s3Service';
import { recordGalleryDownload, recordGalleryView } from '../services/eventTracking';
import {
  generateGalleryAccessToken,
  verifyGalleryAccessToken,
} from '../services/authService';
import { publicGallery, publicGalleryCard, adminGallery } from '../services/galleryView';
import { toPublicPhotos } from '../services/photoView';
import { cachePublicly } from '../middleware/cacheControl';
import { attachmentDisposition, zipEntryNames } from '../services/downloadNames';
import { writeZip } from '../services/zipStream';

const PRIVATE_NEEDS_PASSWORD = 'A private gallery needs a password';
const SLUG_TAKEN = 'A gallery with this slug already exists';

export const listGalleries = async (_req: Request, res: Response) => {
  try {
    const galleries = await galleryService.getPublicGalleriesWithCovers();
    cachePublicly(res);
    res.json({ success: true, data: galleries.map(publicGalleryCard) });
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
    // NOTE: Do NOT expose gallery.id here - it was previously used as an access token
    // which allowed authentication bypass. Now we use signed JWT tokens instead.
    if (!gallery.is_public) {
      return res.json({
        success: true,
        data: {
          title: gallery.title,
          slug: gallery.slug,
          is_public: false,
          requires_password: true,
        },
      });
    }

    // Not counted here: a cached response never reaches the server. The page
    // counts its view with POST /galleries/:slug/view once it is shown.
    cachePublicly(res);
    res.json({ success: true, data: publicGallery(gallery) });
  } catch (err) {
    console.error('Error fetching gallery:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch gallery' });
  }
};

/**
 * Count a view of a gallery page. Counted only for a public gallery or one
 * the access token unlocks (the write checks). The answer is the same either
 * way, so tracking cannot be used to learn which slugs exist.
 */
export const trackGalleryView = (req: Request, res: Response) => {
  const { access } = req.query;
  const token = typeof access === 'string' ? verifyGalleryAccessToken(access) : null;
  recordGalleryView(req.params.slug, token?.galleryId ?? null);
  res.json({ success: true });
};

export const getGalleryPhotos = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { access } = req.query; // Signed JWT access token from password verification

    const gallery = await galleryService.getGalleryBySlug(slug);

    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // For private galleries, require a valid signed access token
    if (!gallery.is_public) {
      if (!access || typeof access !== 'string') {
        return res.status(403).json({
          success: false,
          error: 'Password required to view this gallery',
        });
      }

      // Verify the signed access token
      const tokenPayload = verifyGalleryAccessToken(access);
      if (!tokenPayload || tokenPayload.galleryId !== gallery.id) {
        return res.status(403).json({
          success: false,
          error: 'Invalid or expired access token. Please verify the password again.',
        });
      }
    }

    const photos = await galleryService.getGalleryPhotos(gallery.id);
    const data = await toPublicPhotos(photos);
    // A private gallery's photos stay no-store: they are for one visitor's
    // unlock token, not for any cache.
    if (gallery.is_public) cachePublicly(res);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching gallery photos:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch photos' });
  }
};

// ============ Admin Controllers ============

/**
 * Get admin dashboard statistics
 */
export const getStats = async (_req: Request, res: Response) => {
  try {
    const stats = await galleryService.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

/**
 * Get all galleries (admin only - includes private)
 */
export const listAllGalleries = async (_req: Request, res: Response) => {
  try {
    const galleries = await galleryService.getAllGalleries();
    res.json({ success: true, data: galleries.map(adminGallery) });
  } catch (err) {
    console.error('Error fetching all galleries:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch galleries' });
  }
};

/**
 * Create a new gallery
 */
export const createGallery = async (req: Request, res: Response) => {
  try {
    const { title, slug, description, is_public, password } = req.body;

    if (!title || !slug) {
      return res.status(400).json({
        success: false,
        error: 'Title and slug are required',
      });
    }

    // Validate slug format (lowercase alphanumeric, hyphens between words, no leading/trailing hyphens)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({
        success: false,
        error: 'Slug must be lowercase alphanumeric with hyphens only (no leading/trailing hyphens)',
      });
    }

    if (
      !galleryService.privateGalleryHasPassword({
        isPublic: is_public ?? true,
        hasStoredPassword: false,
        password,
      })
    ) {
      return res.status(400).json({ success: false, error: PRIVATE_NEEDS_PASSWORD });
    }

    // Check if slug is already taken
    if (await galleryService.isSlugTaken(slug)) {
      return res.status(409).json({
        success: false,
        error: SLUG_TAKEN,
      });
    }

    const gallery = await galleryService.createGallery({
      title,
      slug,
      description,
      is_public,
      password,
    });

    res.status(201).json({ success: true, data: adminGallery(gallery) });
  } catch (err) {
    if (galleryService.isSlugConflictError(err)) {
      return res.status(409).json({ success: false, error: SLUG_TAKEN });
    }
    console.error('Error creating gallery:', err);
    res.status(500).json({ success: false, error: 'Failed to create gallery' });
  }
};

/**
 * Update an existing gallery
 */
export const updateGallery = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, slug, description, is_public, password } = req.body;

    // Check if gallery exists
    const existing = await galleryService.getGalleryById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // If changing slug, validate and check uniqueness
    if (slug !== undefined && slug !== existing.slug) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        return res.status(400).json({
          success: false,
          error: 'Slug must be lowercase alphanumeric with hyphens only (no leading/trailing hyphens)',
        });
      }
      if (await galleryService.isSlugTaken(slug, id)) {
        return res.status(409).json({
          success: false,
          error: SLUG_TAKEN,
        });
      }
    }

    const gallery = await galleryService.updateGallery(id, {
      title,
      slug,
      description,
      is_public,
      password,
    });
    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    res.json({ success: true, data: adminGallery(gallery) });
  } catch (err) {
    if (err instanceof galleryService.PrivateGalleryNeedsPasswordError) {
      return res.status(400).json({ success: false, error: PRIVATE_NEEDS_PASSWORD });
    }
    if (galleryService.isSlugConflictError(err)) {
      return res.status(409).json({ success: false, error: SLUG_TAKEN });
    }
    console.error('Error updating gallery:', err);
    res.status(500).json({ success: false, error: 'Failed to update gallery' });
  }
};

/**
 * Delete a gallery and all its photos (including S3 files)
 */
export const deleteGallery = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await galleryService.deleteGallery(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // After the commit, so a failed delete never leaves rows pointing at
    // removed objects. Best effort: deleteFiles logs failures and never
    // throws, so S3 trouble leaves orphans for the cleanup script.
    await s3Service.deleteFiles(deleted.s3Keys);

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    console.error('Error deleting gallery:', err);
    res.status(500).json({ success: false, error: 'Failed to delete gallery' });
  }
};

/**
 * Set the cover image for a gallery
 */
export const setCoverImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { photoId } = req.body;

    // Check if gallery exists
    const gallery = await galleryService.getGalleryById(id);
    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // If photoId provided, verify it belongs to this gallery
    if (photoId) {
      const photo = await photoService.getPhotoById(photoId);
      if (!photo || photo.gallery_id !== id) {
        return res.status(400).json({
          success: false,
          error: 'Photo not found or does not belong to this gallery',
        });
      }
    }

    const updated = await galleryService.setCoverImage(id, photoId || null);
    res.json({ success: true, data: updated ? adminGallery(updated) : null });
  } catch (err) {
    console.error('Error setting cover image:', err);
    res.status(500).json({ success: false, error: 'Failed to set cover image' });
  }
};

/**
 * Get photos for a gallery by ID (admin only - includes hidden photos)
 */
export const getGalleryPhotosAdmin = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const gallery = await galleryService.getGalleryById(id);
    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // Use photoService.getPhotosByGalleryId to include hidden photos
    const photos = await photoService.getPhotosByGalleryId(id);
    const photosWithUrls = await photoService.enrichPhotosWithUrls(photos);
    res.json({ success: true, data: photosWithUrls });
  } catch (err) {
    console.error('Error fetching gallery photos:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch photos' });
  }
};

/**
 * Reorder galleries
 */
export const reorderGalleries = async (req: Request, res: Response) => {
  try {
    const { gallery_ids } = req.body;

    if (!Array.isArray(gallery_ids) || gallery_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'gallery_ids array is required',
      });
    }

    await galleryService.reorderGalleries(gallery_ids);
    res.json({ success: true, data: { reordered: true } });
  } catch (err) {
    console.error('Error reordering galleries:', err);
    res.status(500).json({ success: false, error: 'Failed to reorder galleries' });
  }
};

// ============ Public Controllers ============

/**
 * Verify password for a private gallery
 * Returns gallery data and access token if password is correct
 */
export const verifyGalleryPassword = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }

    const gallery = await galleryService.getGalleryBySlug(slug);
    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // Public galleries don't need password
    if (gallery.is_public) {
      return res.status(400).json({
        success: false,
        error: 'This gallery is public and does not require a password',
      });
    }

    // Verify password
    const isValid = await galleryService.verifyGalleryPassword(gallery, password);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }

    // Generate a signed access token for this gallery
    // This token is cryptographically signed and time-limited (24 hours)
    const accessToken = generateGalleryAccessToken(gallery.id, gallery.slug);

    // Return gallery data with signed access token
    // The frontend should include this token in ?access= query param when fetching photos
    res.json({
      success: true,
      data: {
        title: gallery.title,
        slug: gallery.slug,
        description: gallery.description,
        is_public: gallery.is_public,
        verified: true,
        accessToken, // Signed JWT token for accessing photos
      },
    });
  } catch (err) {
    console.error('Error verifying gallery password:', err);
    res.status(500).json({ success: false, error: 'Failed to verify password' });
  }
};

/**
 * Download all photos in a gallery as a ZIP file
 * Streams original (full-res) photos from S3 to the client, one at a time
 */
export const downloadGalleryZip = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { access } = req.query;

    const gallery = await galleryService.getGalleryBySlug(slug);
    if (!gallery) {
      return res.status(404).json({ success: false, error: 'Gallery not found' });
    }

    // For private galleries, require valid access token
    if (!gallery.is_public) {
      if (!access || typeof access !== 'string') {
        return res.status(403).json({
          success: false,
          error: 'Password required to download this gallery',
        });
      }

      const tokenPayload = verifyGalleryAccessToken(access);
      if (!tokenPayload || tokenPayload.galleryId !== gallery.id) {
        return res.status(403).json({
          success: false,
          error: 'Invalid or expired access token. Please verify the password again.',
        });
      }
    }

    // Get all photos in the gallery
    const photos = await galleryService.getGalleryPhotos(gallery.id);
    if (photos.length === 0) {
      return res.status(400).json({ success: false, error: 'Gallery has no photos' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', attachmentDisposition(`${gallery.slug}.zip`));

    const names = zipEntryNames(photos);
    const sources = photos.map((photo, i) => ({ key: photo.s3_key, name: names[i] }));
    const result = await writeZip(sources, res, s3Service.getFileStream);

    if (result.status === 'complete') {
      recordGalleryDownload(gallery.id);
    } else if (result.status === 'failed') {
      console.error(`Gallery ZIP for ${gallery.slug} failed mid-stream:`, result.error);
    }
  } catch (err) {
    console.error('Error downloading gallery:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to download gallery' });
    }
  }
};
