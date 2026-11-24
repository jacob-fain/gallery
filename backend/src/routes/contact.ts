import { Router } from 'express';
import * as contactController from '../controllers/contactController';
import { contactRateLimit } from '../middleware/rateLimit';

const router = Router();

// POST /api/contact - Send contact message
router.post('/', contactRateLimit, contactController.sendContactMessage);

export default router;
