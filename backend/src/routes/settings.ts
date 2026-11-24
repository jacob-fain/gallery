import { createRouter } from '../middleware/requestLog';
import * as settingsController from '../controllers/settingsController';
import { authMiddleware } from '../middleware/auth';

const router = createRouter();

// GET /api/settings - Public, get all settings
router.get('/', settingsController.getSettings);

// PUT /api/admin/settings - Auth required, update settings
router.put('/admin', authMiddleware, settingsController.updateSettings);

export default router;
