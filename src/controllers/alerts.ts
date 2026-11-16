import type { Request, Response } from 'express';
import * as alerts from '../services/alerts.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function serverError(res: Response, e: unknown) {
  console.error('[alerts]', e);
  fail(res, 500, `서버 오류: ${e instanceof Error ? e.message : String(e)}`);
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseReminder(body: any): alerts.ReminderInput | string {
  const date = String(body?.date ?? '');
  const time = String(body?.time ?? '');
  const memo = typeof body?.memo === 'string' ? body.memo.trim() : '';
  if (!DATE_RE.test(date)) return 'date는 yyyy-MM-dd 형식이어야 합니다.';
  if (!TIME_RE.test(time)) return 'time은 HH:mm 형식이어야 합니다.';
  if (!memo || memo.length > 200) return 'memo는 1~200자여야 합니다.';
  return { date, time, memo };
}

export const getReminders = async (req: Request, res: Response) => {
  try {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail(res, 400, 'from, to는 yyyy-MM-dd 형식이어야 합니다.');
    res.json(await alerts.listReminders(from, to));
  } catch (e) {
    serverError(res, e);
  }
};

export const postReminder = async (req: Request, res: Response) => {
  try {
    const r = parseReminder(req.body);
    if (typeof r === 'string') return fail(res, 400, r);
    res.status(201).json(await alerts.createReminder(r));
  } catch (e) {
    serverError(res, e);
  }
};

export const putReminder = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const r = parseReminder(req.body);
    if (typeof r === 'string') return fail(res, 400, r);
    const updated = await alerts.updateReminder(id, r);
    if (!updated) return fail(res, 404, '알림을 찾을 수 없습니다.');
    res.json(updated);
  } catch (e) {
    serverError(res, e);
  }
};

export const removeReminder = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    await alerts.deleteReminder(id);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
};

export const getAlertSettings = async (_req: Request, res: Response) => {
  try {
    res.json(await alerts.getSettings());
  } catch (e) {
    serverError(res, e);
  }
};

/** 보낸 값만 바꾼다 (빠진 값은 지금 설정 유지) */
export const putAlertSettings = async (req: Request, res: Response) => {
  try {
    const s = alerts.parseSettings(req.body, await alerts.getSettings());
    if (typeof s === 'string') return fail(res, 400, s);
    res.json(await alerts.saveSettings(s));
  } catch (e) {
    serverError(res, e);
  }
};

export const postSummaryNow = async (_req: Request, res: Response) => {
  try {
    await alerts.sendSummaryNow();
    res.json({ ok: true });
  } catch (e) {
    fail(res, 400, e instanceof Error ? e.message : String(e));
  }
};
