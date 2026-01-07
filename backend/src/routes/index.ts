import { Router } from 'express';
import galleriesRouter from './galleries';
import photosRouter from './photos';
import * as photoController from '../controllers/photoController';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Featured photos for homepage
router.get('/featured', photoController.getFeatured);

// Mount route modules
router.use('/galleries', galleriesRouter);
router.use('/photos', photosRouter);

export default router;
