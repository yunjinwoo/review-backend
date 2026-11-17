import express from 'express';
import {
  getPeriodFor, postPeriod, putPeriod, removePeriod,
  postPeriodGoal, putPeriodGoal, removePeriodGoal,
} from '../controllers/periods.js';

const router = express.Router();

router.get('/goal-periods', getPeriodFor);            // ?date=yyyy-MM-dd  → { period(그 날짜가 든 기간 + 목표 진행) | null, previous | null }
router.post('/goal-periods', postPeriod);             // { startDate, weeks, copyFromId? }  새 기간 (시작일은 그 주 일요일로 맞춤)
router.put('/goal-periods/:id', putPeriod);           // { startDate, weeks }  4주 ↔ 5주, 시작일 바꾸기
router.delete('/goal-periods/:id', removePeriod);     // 기간과 그 안의 목표 삭제
router.post('/period-goals', postPeriodGoal);         // { periodId, name, kind: count|check, goalId?, target, done?, sortOrder? }
router.put('/period-goals/:id', putPeriodGoal);       // 수정 (check 목표의 완료 체크 포함)
router.delete('/period-goals/:id', removePeriodGoal); // 삭제

export default router;
