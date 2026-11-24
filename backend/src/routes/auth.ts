import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';
import { loginRateLimit } from '../middleware/rateLimit';

const router = Router();

// POST /api/auth/login - Authenticate and get token
router.post('/login', loginRateLimit, authController.login);

// GET /api/auth/me - Get current user (protected)
router.get('/me', authMiddleware, authController.me);

// POST /api/auth/logout - Revoke all of the user's admin tokens (protected)
router.post('/logout', authMiddleware, authController.logout);

export default router;
