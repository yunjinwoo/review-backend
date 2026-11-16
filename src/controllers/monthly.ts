import type { Request, Response } from 'express';
import * as monthly from '../services/monthly.js';
import { goalExists } from '../services/goals.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function serverError(res: Response, e: unknown) {
  console.error('[monthly]', e);
  fail(res, 500, `서버 오류: ${e instanceof Error ? e.message : String(e)}`);
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** body를 검사해서 월별 목표 값으로 바꾼다. 문제가 있으면 오류 메시지(string). */
async function parseBody(body: any): Promise<monthly.MonthlyGoalInput | string> {
  const month = String(body?.month ?? '');
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const kind = body?.kind === 'check' ? 'check' : 'count';
  const goalId = body?.goalId == null ? null : parseId(body.goalId);
  const target = kind === 'check' ? 1 : Number(body?.target);
  const done = body?.done === true;
  const sortOrder = Number(body?.sortOrder ?? 0);
  if (!MONTH_RE.test(month)) return 'month는 yyyy-MM 형식이어야 합니다.';
  if (!name || name.length > 40) return 'name은 1~40자여야 합니다.';
  if (body?.goalId != null && goalId == null) return 'goalId가 잘못됐습니다.';
  if (!Number.isInteger(target) || target < 1 || target > 999) return 'target은 1~999 사이 정수여야 합니다.';
  if (!Number.isInteger(sortOrder)) return 'sortOrder는 정수여야 합니다.';
  if (kind === 'count' && goalId != null && !(await goalExists(goalId))) return '연결한 주간 목표를 찾을 수 없습니다.';
  return { month, name, kind, goalId: kind === 'check' ? null : goalId, target, done: kind === 'check' && done, sortOrder };
}

export const getMonthly = async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month ?? '');
    if (!MONTH_RE.test(month)) return fail(res, 400, 'month는 yyyy-MM 형식이어야 합니다.');
    res.json(await monthly.listMonthly(month));
  } catch (e) {
    serverError(res, e);
  }
};

export const postMonthly = async (req: Request, res: Response) => {
  try {
    const g = await parseBody(req.body);
    if (typeof g === 'string') return fail(res, 400, g);
    res.status(201).json(await monthly.createMonthly(g));
  } catch (e) {
    serverError(res, e);
  }
};

export const putMonthly = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const g = await parseBody(req.body);
    if (typeof g === 'string') return fail(res, 400, g);
    const updated = await monthly.updateMonthly(id, g);
    if (!updated) return fail(res, 404, '월별 목표를 찾을 수 없습니다.');
    res.json(updated);
  } catch (e) {
    serverError(res, e);
  }
};

export const removeMonthly = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    await monthly.deleteMonthly(id);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
};

export const copyMonthly = async (req: Request, res: Response) => {
  try {
    const from = String(req.body?.from ?? '');
    const to = String(req.body?.to ?? '');
    if (!MONTH_RE.test(from) || !MONTH_RE.test(to)) return fail(res, 400, 'from, to는 yyyy-MM 형식이어야 합니다.');
    res.json(await monthly.copyMonthly(from, to));
  } catch (e) {
    serverError(res, e);
  }
};
