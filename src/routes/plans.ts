import express from 'express';
import {
  getPlans, getPlanDetail, postPlan, putPlan, removePlan, postItem, putItem, removeItem, getTags,
} from '../controllers/plans.js';

const router = express.Router();

router.get('/plans', getPlans);                 // 계획 목록 (+ 일정 수, 완료 수)
router.post('/plans', postPlan);                // { name, startDate, endDate } 계획 추가
router.get('/plans/:id', getPlanDetail);        // 계획 하나 + items
router.put('/plans/:id', putPlan);              // 계획 수정
router.delete('/plans/:id', removePlan);        // 계획 삭제 (일정도 함께)
router.post('/plan-items', postItem);           // { planId, date, start, end?, title?, tag?, done? } 일정 추가
router.put('/plan-items/:id', putItem);         // 일정 수정 (완료 체크 포함)
router.delete('/plan-items/:id', removeItem);   // 일정 삭제
router.get('/plan-tags', getTags);              // 지금까지 쓴 태그 (많이 쓴 순)

export default router;
