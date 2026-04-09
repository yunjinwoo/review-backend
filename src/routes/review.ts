import express from 'express';
import { reviewCode } from '../controllers/review.js';

const router = express.Router();

router.post('/review', reviewCode);

export default router;
