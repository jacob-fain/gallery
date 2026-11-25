import { createRouter } from '../middleware/requestLog';
import * as photoController from '../controllers/photoController';
import { authMiddleware } from '../middleware/auth';
import { trackingRateLimit } from '../middleware/rateLimit';
import { upload } from '../config/upload';
import { uuidParam, validateBodyIds } from '../middleware/validateIds';

const router = createRouter();

router.param('id', uuidParam('Photo not found'));

// ============ Admin Routes (auth required) ============

// POST /api/photos/upload - Upload photo (admin only)
router.post(
  '/upload',
  authMiddleware,
  upload.single('photo'),
  validateBodyIds({ galleryId: 'uuid?' }),
  photoController.uploadPhoto
);

// GET /api/photos/admin/unassigned - List photos without a gallery
router.get('/admin/unassigned', authMiddleware, photoController.listUnassignedPhotos);

// GET /api/photos/admin/all - Every photo, filtered by ?gallery= and ?status=
router.get('/admin/all', authMiddleware, photoController.listAdminPhotos);

// DELETE /api/photos/admin/rejected?gallery= - Delete the rejected photos of a scope
router.delete('/admin/rejected', authMiddleware, photoController.deleteRejectedPhotos);

// PUT /api/photos/status - Put several photos in one review state
router.put(
  '/status',
  authMiddleware,
  validateBodyIds({ photo_ids: 'uuid[]' }),
  photoController.setPhotosStatus
);

// POST /api/photos/admin/check-duplicates - Check which content hashes exist
router.post('/admin/check-duplicates', authMiddleware, photoController.checkDuplicates);

// PUT /api/photos/reorder - Reorder photos in a gallery
router.put(
  '/reorder',
  authMiddleware,
  validateBodyIds({ gallery_id: 'uuid', photo_ids: 'uuid[]' }),
  photoController.reorderPhotos
);

// PUT /api/photos/move - Move photos to another gallery or to Unassigned (null)
router.put(
  '/move',
  authMiddleware,
  validateBodyIds({ photo_ids: 'uuid[]', target_gallery_id: 'uuid?' }),
  photoController.movePhotos
);

// PUT /api/photos/:id - Update photo (review_status, sort_order)
router.put('/:id', authMiddleware, photoController.updatePhoto);

// DELETE /api/photos/:id - Delete photo
router.delete('/:id', authMiddleware, photoController.deletePhoto);

// ============ Public Routes ============

// GET /api/photos - List all publicly visible photos
router.get('/', photoController.listAllPhotos);

// GET /api/photos/:id - Get single photo
router.get('/:id', photoController.getPhoto);

// GET /api/photos/:id/download - Download photo (increments counter)
router.get('/:id/download', photoController.downloadPhoto);

// POST /api/photos/:id/view - Track a photo view (analytics)
router.post('/:id/view', trackingRateLimit, photoController.trackView);

// POST /api/photos/:id/download-track - Track a photo download (analytics)
router.post('/:id/download-track', trackingRateLimit, photoController.trackDownload);

export default router;
