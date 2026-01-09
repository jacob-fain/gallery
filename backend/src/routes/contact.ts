import { Router } from 'express';
import * as contactController from '../controllers/contactController';

const router = Router();

// POST /api/contact - Send contact message
router.post('/', contactController.sendContactMessage);

export default router;
