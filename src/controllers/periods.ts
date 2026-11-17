import type { Request, Response } from 'express';
import * as periods from '../services/periods.js';
import { goalExists } from '../services/goals.js';
import { markAchievedSilently } from '../services/alerts.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function serverError(res: Response, e: unknown) {
  if (e instanceof periods.PeriodOverlapError) return fail(res, 409, e.message);
  console.error('[periods]', e);
  fail(res, 500, `서버 오류: ${e instanceof Error ? e.message : String(e)}`);
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 만들거나 고친 순간 이미 채워져 있는 목표는 "달성!" 알림 없이 넘어간다. 실패해도 저장은 그대로 둔다. */
const quiet = () => markAchievedSilently().catch((e) => console.error('[periods]', e));

function parsePeriodBody(body: any): { startDate: string; weeks: number } | string {
  const startDate = String(body?.startDate ?? '');
  const weeks = Number(body?.weeks);
  if (!DATE_RE.test(startDate) || Number.isNaN(periods.parseDay(startDate).getTime())) {
    return 'startDate는 yyyy-MM-dd 형식이어야 합니다.';
  }
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) return 'weeks는 1~12 사이 정수여야 합니다.';
  return { startDate, weeks };
}

export const getPeriodFor = async (req: Request, res: Response) => {
  try {
    const date = String(req.query.date ?? '');
    if (!DATE_RE.test(date)) return fail(res, 400, 'date는 yyyy-MM-dd 형식이어야 합니다.');
    res.json(await periods.lookupPeriod(date));
  } catch (e) {
    serverError(res, e);
  }
};

export const postPeriod = async (req: Request, res: Response) => {
  try {
    const p = parsePeriodBody(req.body);
    if (typeof p === 'string') return fail(res, 400, p);
    const copyFromId = req.body?.copyFromId == null ? null : parseId(req.body.copyFromId);
    if (req.body?.copyFromId != null && copyFromId == null) return fail(res, 400, 'copyFromId가 잘못됐습니다.');
    const created = await periods.createPeriod(p.startDate, p.weeks, copyFromId);
    await quiet();
    res.status(201).json(created);
  } catch (e) {
    serverError(res, e);
  }
};

export const putPeriod = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const p = parsePeriodBody(req.body);
    if (typeof p === 'string') return fail(res, 400, p);
    const updated = await periods.updatePeriod(id, p.startDate, p.weeks);
    if (!updated) return fail(res, 404, '기간을 찾을 수 없습니다.');
    await quiet(); // 기간을 늘려서 채워진 목표도 조용히 넘어간다
    res.json(updated);
  } catch (e) {
    serverError(res, e);
  }
};

export const removePeriod = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    await periods.deletePeriod(id);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
};

/** body를 검사해서 기간 목표 값으로 바꾼다. 문제가 있으면 오류 메시지(string). */
async function parseGoalBody(body: any): Promise<Omit<periods.PeriodGoalInput, 'periodId'> | string> {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const kind = body?.kind === 'check' ? 'check' : 'count';
  const goalId = body?.goalId == null ? null : parseId(body.goalId);
  const target = kind === 'check' ? 1 : Number(body?.target);
  const done = body?.done === true;
  const sortOrder = Number(body?.sortOrder ?? 0);
  if (!name || name.length > 40) return 'name은 1~40자여야 합니다.';
  if (body?.goalId != null && goalId == null) return 'goalId가 잘못됐습니다.';
  if (!Number.isInteger(target) || target < 1 || target > 999) return 'target은 1~999 사이 정수여야 합니다.';
  if (!Number.isInteger(sortOrder)) return 'sortOrder는 정수여야 합니다.';
  if (kind === 'count' && goalId != null && !(await goalExists(goalId))) return '연결한 주간 목표를 찾을 수 없습니다.';
  return { name, kind, goalId: kind === 'check' ? null : goalId, target, done: kind === 'check' && done, sortOrder };
}

export const postPeriodGoal = async (req: Request, res: Response) => {
  try {
    const periodId = parseId(req.body?.periodId);
    if (!periodId) return fail(res, 400, 'periodId가 필요합니다.');
    const g = await parseGoalBody(req.body);
    if (typeof g === 'string') return fail(res, 400, g);
    const created = await periods.createPeriodGoal({ ...g, periodId });
    if (!created) return fail(res, 404, '기간을 찾을 수 없습니다.');
    await quiet();
    res.status(201).json(created);
  } catch (e) {
    serverError(res, e);
  }
};

export const putPeriodGoal = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const g = await parseGoalBody(req.body);
    if (typeof g === 'string') return fail(res, 400, g);
    const updated = await periods.updatePeriodGoal(id, g);
    if (!updated) return fail(res, 404, '기간 목표를 찾을 수 없습니다.');
    // 직접 체크 목표는 체크하는 것이 곧 달성이라 알림을 보낸다. 횟수 목표는 횟수·대상을 고쳐서 채워진 것이면 조용히 넘어간다.
    if (updated.kind === 'count') await quiet();
    res.json(updated);
  } catch (e) {
    serverError(res, e);
  }
};

export const removePeriodGoal = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    await periods.deletePeriodGoal(id);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
};
