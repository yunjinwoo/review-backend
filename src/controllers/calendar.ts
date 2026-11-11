import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { buildCalendarIcs, getCalendarToken, resetCalendarToken } from '../services/calendar.js';

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 웹 화면이 구독 주소를 보여줄 때 쓰는 비밀키 (다른 목표 API처럼 인증은 없음) */
export const getCalendarLink = async (_req: Request, res: Response) => {
  try {
    res.json({ token: await getCalendarToken() });
  } catch (e) {
    console.error('[calendar]', e);
    res.status(500).json({ error: '구독 주소를 만들지 못했습니다.' });
  }
};

export const postCalendarLinkReset = async (_req: Request, res: Response) => {
  try {
    res.json({ token: await resetCalendarToken() });
  } catch (e) {
    console.error('[calendar]', e);
    res.status(500).json({ error: '구독 주소를 바꾸지 못했습니다.' });
  }
};

/** GET /api/calendar/:token.ics  다른 달력 앱이 주기적으로 읽어 가는 주소 */
export const getCalendarIcs = async (req: Request, res: Response) => {
  try {
    const raw = String(req.params.file ?? '');
    const token = raw.endsWith('.ics') ? raw.slice(0, -4) : raw;
    if (!sameToken(token, await getCalendarToken())) {
      res.status(404).send('Not found');
      return;
    }
    const ics = await buildCalendarIcs();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="weekly-goals.ics"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(ics);
  } catch (e) {
    console.error('[calendar]', e);
    res.status(500).send('Calendar error');
  }
};
