import express from 'express';
import { getNotifyStatus, postNotifyDisconnect, postNotifyTest } from '../controllers/notify.js';

const router = express.Router();

router.get('/notify/status', getNotifyStatus);            // { configured, connected, botUsername, error }
router.post('/notify/test', postNotifyTest);              // 연결된 텔레그램 대화로 테스트 메시지
router.post('/notify/disconnect', postNotifyDisconnect);  // 받는 대화 연결 끊기

export default router;
