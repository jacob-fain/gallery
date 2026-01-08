import { Router } from 'express';
import * as photoController from '../controllers/photoController';
import { authMiddleware } from '../middleware/auth';
import { trackingRateLimit } from '../middleware/rateLimit';
import { upload } from '../config/upload';

const router = Router();

// ============ Admin Routes (auth required) ============

// POST /api/photos/upload - Upload photo (admin only)
router.post('/upload', authMiddleware, upload.single('photo'), photoController.uploadPhoto);

// PUT /api/photos/reorder - Reorder photos in a gallery
router.put('/reorder', authMiddleware, photoController.reorderPhotos);

// PUT /api/photos/:id - Update photo (featured, sort_order)
router.put('/:id', authMiddleware, photoController.updatePhoto);

// DELETE /api/photos/:id - Delete photo
router.delete('/:id', authMiddleware, photoController.deletePhoto);

// ============ Public Routes ============

// GET /api/photos/:id - Get single photo
router.get('/:id', photoController.getPhoto);

// GET /api/photos/:id/download - Download photo (increments counter)
router.get('/:id/download', photoController.downloadPhoto);

// POST /api/photos/:id/view - Track a photo view (analytics)
router.post('/:id/view', trackingRateLimit, photoController.trackView);

// POST /api/photos/:id/download-track - Track a photo download (analytics)
router.post('/:id/download-track', trackingRateLimit, photoController.trackDownload);

export default router;
