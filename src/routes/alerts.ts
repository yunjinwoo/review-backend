import express from 'express';
import {
  getReminders, postReminder, putReminder, removeReminder,
  getAlertSettings, putAlertSettings, postSummaryNow,
} from '../controllers/alerts.js';

const router = express.Router();

router.get('/reminders', getReminders);             // ?from=yyyy-MM-dd&to=yyyy-MM-dd  특정일 알림
router.post('/reminders', postReminder);            // { date, time: HH:mm, memo }
router.put('/reminders/:id', putReminder);          // 수정 (시각을 바꾸면 다시 보낸다)
router.delete('/reminders/:id', removeReminder);    // 삭제
router.get('/alert-settings', getAlertSettings);    // 상황 알림·주간 요약 설정
router.put('/alert-settings', putAlertSettings);    // 보낸 값만 바꾼다
router.post('/alert-settings/summary-now', postSummaryNow); // 주간 요약을 지금 보내 보기

export default router;
