import { Router } from 'express';
import * as photoController from '../controllers/photoController';

const router = Router();

// GET /api/photos/:id - Get single photo
router.get('/:id', photoController.getPhoto);

// GET /api/photos/:id/download - Download photo (increments counter)
router.get('/:id/download', photoController.downloadPhoto);

export default router;
