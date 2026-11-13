import type { Request, Response } from 'express';
import * as notify from '../services/notify.js';

function fail(res: Response, status: number, e: unknown) {
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
}

/** 화면의 알림 설정 창이 쓰는 상태. 토큰 자체는 절대 내보내지 않는다. */
export const getNotifyStatus = async (_req: Request, res: Response) => {
  try {
    res.json(await notify.getStatus());
  } catch (e) {
    console.error('[notify]', e);
    fail(res, 500, e);
  }
};

export const postNotifyTest = async (_req: Request, res: Response) => {
  try {
    await notify.sendTest();
    res.json({ ok: true });
  } catch (e) {
    fail(res, 400, e);
  }
};

/** 받는 대화 연결을 끊는다. 다음에 봇에게 /start 를 보내는 대화가 새로 연결된다. */
export const postNotifyDisconnect = async (_req: Request, res: Response) => {
  try {
    await notify.disconnectChat();
    res.json(await notify.getStatus());
  } catch (e) {
    console.error('[notify]', e);
    fail(res, 500, e);
  }
};
