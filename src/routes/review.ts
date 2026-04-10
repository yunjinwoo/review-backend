import express from 'express';
import { reviewCode, getReviews, getReviewById } from '../controllers/review.js';

const router = express.Router();

router.post('/review', reviewCode);      // 리뷰 생성 및 저장
router.get('/reviews', getReviews);      // 리뷰 목록 조회
router.get('/reviews/:id', getReviewById); // 특정 리뷰 상세 조회
router.get('/version', (req, res) => {
    res.json({ version: '1.0.0', status: 'ok' });
});

export default router;
