import { Router } from 'express';
import * as photoController from '../controllers/photoController';
import { authMiddleware } from '../middleware/auth';
import { upload } from '../config/upload';

const router = Router();

// POST /api/photos/upload - Upload photo (admin only)
router.post('/upload', authMiddleware, upload.single('photo'), photoController.uploadPhoto);

// GET /api/photos/:id - Get single photo
router.get('/:id', photoController.getPhoto);

// GET /api/photos/:id/download - Download photo (increments counter)
router.get('/:id/download', photoController.downloadPhoto);

export default router;
