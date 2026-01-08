import { Router } from 'express';
import * as galleryController from '../controllers/galleryController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// ============ Admin Routes (auth required) ============

// POST /api/galleries - Create gallery
router.post('/', authMiddleware, galleryController.createGallery);

// GET /api/galleries/admin/all - List all galleries (admin)
router.get('/admin/all', authMiddleware, galleryController.listAllGalleries);

// PUT /api/galleries/:id - Update gallery
router.put('/:id', authMiddleware, galleryController.updateGallery);

// DELETE /api/galleries/:id - Delete gallery
router.delete('/:id', authMiddleware, galleryController.deleteGallery);

// PUT /api/galleries/:id/cover - Set cover image
router.put('/:id/cover', authMiddleware, galleryController.setCoverImage);

// GET /api/galleries/:id/photos/admin - Get photos by gallery ID (admin)
router.get('/:id/photos/admin', authMiddleware, galleryController.getGalleryPhotosAdmin);

// PUT /api/galleries/reorder - Reorder galleries
router.put('/reorder', authMiddleware, galleryController.reorderGalleries);

// ============ Public Routes ============

// GET /api/galleries - List all public galleries
router.get('/', galleryController.listGalleries);

// GET /api/galleries/:slug - Get gallery by slug
router.get('/:slug', galleryController.getGallery);

// POST /api/galleries/:slug/verify - Verify password for private gallery
router.post('/:slug/verify', galleryController.verifyGalleryPassword);

// GET /api/galleries/:slug/photos - Get photos in gallery
router.get('/:slug/photos', galleryController.getGalleryPhotos);

// GET /api/galleries/:slug/download - Download gallery as ZIP
router.get('/:slug/download', galleryController.downloadGalleryZip);

export default router;
