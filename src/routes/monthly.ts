import express from 'express';
import { getMonthly, postMonthly, putMonthly, removeMonthly, copyMonthly } from '../controllers/monthly.js';

const router = express.Router();

router.get('/monthly-goals', getMonthly);            // ?month=yyyy-MM  그 달 목표 + 지금까지 채운 수(count)
router.post('/monthly-goals', postMonthly);          // { month, name, kind: count|check, goalId?, target, done?, sortOrder? }
router.put('/monthly-goals/:id', putMonthly);        // 수정 (check 목표의 완료 체크 포함)
router.delete('/monthly-goals/:id', removeMonthly);  // 삭제
router.post('/monthly-goals/copy', copyMonthly);     // { from, to }  지난달 목표를 이번 달로 복사 (이번 달이 비어 있을 때만)

export default router;
