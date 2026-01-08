import { Router } from 'express';
import authRouter from './auth';
import galleriesRouter from './galleries';
import photosRouter from './photos';
import settingsRouter from './settings';
import * as photoController from '../controllers/photoController';
import * as galleryController from '../controllers/galleryController';
import * as analyticsController from '../controllers/analyticsController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Featured photos for homepage
router.get('/featured', photoController.getFeatured);

// Admin stats
router.get('/admin/stats', authMiddleware, galleryController.getStats);

// Admin analytics
router.get('/admin/analytics', authMiddleware, analyticsController.getAnalytics);

// Mount route modules
router.use('/auth', authRouter);
router.use('/galleries', galleriesRouter);
router.use('/photos', photosRouter);
router.use('/settings', settingsRouter);

export default router;
