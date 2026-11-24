import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';
import { loginRateLimit } from '../middleware/rateLimit';
import { requireAdminOrigin } from '../middleware/session';

const router = Router();

// POST /api/auth/login - Authenticate and set the session cookie. The origin
// check stops another site from signing the browser in to an account it
// chose.
router.post('/login', requireAdminOrigin, loginRateLimit, authController.login);

// GET /api/auth/me - Get current user (protected)
router.get('/me', authMiddleware, authController.me);

// POST /api/auth/logout - Revoke all of the user's admin tokens (protected)
router.post('/logout', authMiddleware, authController.logout);

export default router;
