import { Router } from 'express';
import * as contactController from '../controllers/contactController';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Rate limit: 5 requests per hour per IP
const contactRateLimit = rateLimit(5, 60 * 60 * 1000);

// POST /api/contact - Send contact message
router.post('/', contactRateLimit, contactController.sendContactMessage);

export default router;
