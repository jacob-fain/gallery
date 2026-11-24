import { createRouter } from '../middleware/requestLog';
import * as contactController from '../controllers/contactController';
import { contactRateLimit } from '../middleware/rateLimit';

const router = createRouter();

// POST /api/contact - Send contact message
router.post('/', contactRateLimit, contactController.sendContactMessage);

export default router;
