import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/auth/login - Authenticate and get token
router.post('/login', authController.login);

// GET /api/auth/me - Get current user (protected)
router.get('/me', authMiddleware, authController.me);

export default router;
