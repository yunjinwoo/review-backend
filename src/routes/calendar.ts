import express from 'express';
import { getCalendarIcs, getCalendarLink, postCalendarLinkReset } from '../controllers/calendar.js';

const router = express.Router();

router.get('/calendar-link', getCalendarLink);              // { token } 구독 주소용 비밀키
router.post('/calendar-link/reset', postCalendarLinkReset); // 비밀키 새로 만들기 (예전 주소 막힘)
router.get('/calendar/:file', getCalendarIcs);              // /api/calendar/<비밀키>.ics

export default router;
