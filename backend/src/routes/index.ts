import { Router } from 'express';
import authRouter from './auth';
import contactRouter from './contact';
import galleriesRouter from './galleries';
import photosRouter from './photos';
import settingsRouter from './settings';
import healthRouter from './health';
import sitemapRouter from './sitemap';
import * as photoController from '../controllers/photoController';
import * as galleryController from '../controllers/galleryController';
import * as analyticsController from '../controllers/analyticsController';
import { authMiddleware } from '../middleware/auth';
import { validateBodyIds } from '../middleware/validateIds';

const router = Router();

router.use(healthRouter);
router.use(sitemapRouter);

// Featured photos for homepage
router.get('/featured', photoController.getFeatured);

// Admin stats
router.get('/admin/stats', authMiddleware, galleryController.getStats);

// Admin analytics
router.get('/admin/analytics', authMiddleware, analyticsController.getAnalytics);

// Admin homepage management
router.get('/admin/homepage', authMiddleware, photoController.getFeaturedAdmin);
router.post('/admin/homepage/hero', authMiddleware, validateBodyIds({ photo_id: 'uuid' }), photoController.setHero);
router.post('/admin/homepage/featured', authMiddleware, validateBodyIds({ photo_id: 'uuid' }), photoController.addFeatured);
router.delete('/admin/homepage/featured', authMiddleware, validateBodyIds({ photo_id: 'uuid' }), photoController.removeFeatured);
router.put('/admin/homepage/reorder', authMiddleware, validateBodyIds({ photo_ids: 'uuid[]' }), photoController.reorderFeatured);

// Mount route modules
router.use('/auth', authRouter);
router.use('/contact', contactRouter);
router.use('/galleries', galleriesRouter);
router.use('/photos', photosRouter);
router.use('/settings', settingsRouter);

export default router;
