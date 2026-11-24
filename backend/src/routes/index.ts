import { createRouter } from '../middleware/requestLog';
import authRouter from './auth';
import contactRouter from './contact';
import galleriesRouter from './galleries';
import photosRouter from './photos';
import settingsRouter from './settings';
import healthRouter from './health';
import sitemapRouter from './sitemap';
import shareRouter from './share';
import * as photoController from '../controllers/photoController';
import * as galleryController from '../controllers/galleryController';
import * as analyticsController from '../controllers/analyticsController';
import * as metricsController from '../controllers/metricsController';
import { authMiddleware } from '../middleware/auth';
import { validateBodyIds } from '../middleware/validateIds';

const router = createRouter();

router.use(healthRouter);
router.use(sitemapRouter);

// Featured photos for homepage
router.get('/featured', photoController.getFeatured);

// Admin stats
router.get('/admin/stats', authMiddleware, galleryController.getStats);

// Admin analytics
router.get('/admin/analytics', authMiddleware, analyticsController.getAnalytics);

// Admin process metrics (in-memory, this process only)
router.get('/admin/metrics', authMiddleware, metricsController.getMetrics);

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
router.use('/share', shareRouter);

export default router;
