import type { Request, Response } from 'express';
import * as goals from '../services/goals.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function serverError(res: Response, e: unknown) {
  console.error('[goals]', e);
  fail(res, 500, `서버 오류: ${e instanceof Error ? e.message : String(e)}`);
}

/** body를 검사해서 목표 값으로 바꾼다. 문제가 있으면 오류 메시지(string)를 돌려준다. */
function parseGoalBody(body: any): Omit<goals.Goal, 'id'> | string {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const timesPerWeek = Number(body?.timesPerWeek);
  const color = Number(body?.color ?? 0xFF26A69A);
  const sortOrder = Number(body?.sortOrder ?? 0);
  if (!name || name.length > 30) return 'name은 1~30자여야 합니다.';
  if (!Number.isInteger(timesPerWeek) || timesPerWeek < 1 || timesPerWeek > 7) {
    return 'timesPerWeek는 1~7 사이 정수여야 합니다.';
  }
  if (!Number.isInteger(color) || color < 0 || color > 0xFFFFFFFF) return 'color 값이 잘못됐습니다.';
  if (!Number.isInteger(sortOrder)) return 'sortOrder는 정수여야 합니다.';
  return { name, timesPerWeek, color, sortOrder };
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const getGoals = async (_req: Request, res: Response) => {
  try {
    res.json(await goals.listGoals());
  } catch (e) {
    serverError(res, e);
  }
};

export const postGoal = async (req: Request, res: Response) => {
  try {
    const g = parseGoalBody(req.body);
    if (typeof g === 'string') return fail(res, 400, g);
    res.status(201).json(await goals.createGoal(g));
  } catch (e) {
    serverError(res, e);
  }
};

export const putGoal = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const g = parseGoalBody(req.body);
    if (typeof g === 'string') return fail(res, 400, g);
    const updated = await goals.updateGoal(id, g);
    if (!updated) return fail(res, 404, '목표를 찾을 수 없습니다.');
    res.json(updated);
  } catch (e) {
    serverError(res, e);
  }
};

export const removeGoal = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    await goals.deleteGoal(id);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
};

export const getLogs = async (req: Request, res: Response) => {
  try {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return fail(res, 400, 'from, to는 yyyy-MM-dd 형식이어야 합니다.');
    }
    res.json(await goals.listLogs(from, to));
  } catch (e) {
    serverError(res, e);
  }
};

export const toggleLog = async (req: Request, res: Response) => {
  try {
    const goalId = parseId(req.body?.goalId);
    const date = String(req.body?.date ?? '');
    if (!goalId || !DATE_RE.test(date)) return fail(res, 400, 'goalId와 date(yyyy-MM-dd)가 필요합니다.');
    if (!(await goals.goalExists(goalId))) return fail(res, 404, '목표를 찾을 수 없습니다.');
    res.json({ goalId, date, checked: await goals.toggleLog(goalId, date) });
  } catch (e) {
    serverError(res, e);
  }
};

export const markLog = async (req: Request, res: Response) => {
  try {
    const goalId = parseId(req.body?.goalId);
    const date = String(req.body?.date ?? '');
    const workoutId = String(req.body?.workoutId ?? '');
    if (!goalId || !DATE_RE.test(date) || !workoutId) {
      return fail(res, 400, 'goalId, date(yyyy-MM-dd), workoutId가 필요합니다.');
    }
    if (!(await goals.goalExists(goalId))) return fail(res, 404, '목표를 찾을 수 없습니다.');
    await goals.markFromWorkout(goalId, date, workoutId);
    res.json({ goalId, date, checked: true });
  } catch (e) {
    serverError(res, e);
  }
};
