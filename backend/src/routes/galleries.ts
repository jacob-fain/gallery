import { Router } from 'express';
import * as galleryController from '../controllers/galleryController';

const router = Router();

// GET /api/galleries - List all public galleries
router.get('/', galleryController.listGalleries);

// GET /api/galleries/:slug - Get gallery by slug
router.get('/:slug', galleryController.getGallery);

// GET /api/galleries/:slug/photos - Get photos in gallery
router.get('/:slug/photos', galleryController.getGalleryPhotos);

export default router;
