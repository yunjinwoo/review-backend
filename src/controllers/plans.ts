import type { Request, Response } from 'express';
import * as plans from '../services/plans.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS = 31; // 한 계획의 최대 기간

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function serverError(res: Response, e: unknown) {
  console.error('[plans]', e);
  fail(res, 500, `서버 오류: ${e instanceof Error ? e.message : String(e)}`);
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 실제로 있는 날짜인지 (2026-02-31 같은 값 거르기) */
function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function parsePlanBody(body: any): plans.PlanInput | string {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const startDate = String(body?.startDate ?? '');
  const endDate = String(body?.endDate ?? '');
  if (!name || name.length > 40) return 'name은 1~40자여야 합니다.';
  if (!validDate(startDate) || !validDate(endDate)) return 'startDate, endDate는 yyyy-MM-dd 형식이어야 합니다.';
  if (endDate < startDate) return '끝나는 날이 시작하는 날보다 빠릅니다.';
  if (daysBetween(startDate, endDate) >= MAX_DAYS) return `기간은 최대 ${MAX_DAYS}일입니다.`;
  return { name, startDate, endDate };
}

function parseItemBody(body: any): Omit<plans.PlanItemInput, 'planId'> | string {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const date = String(body?.date ?? '');
  const start = String(body?.start ?? '');
  const end = body?.end == null || body.end === '' ? null : String(body.end);
  const tagRaw = typeof body?.tag === 'string' ? body.tag.trim() : '';
  const tag = tagRaw === '' ? null : tagRaw;
  const done = body?.done === true;
  // 제목은 비워도 된다 (시작 시각만으로 등록)
  if (title.length > 60) return 'title은 60자 이하여야 합니다.';
  if (tag != null && tag.length > 20) return 'tag는 20자 이하여야 합니다.';
  if (!validDate(date)) return 'date는 yyyy-MM-dd 형식이어야 합니다.';
  if (!TIME_RE.test(start)) return 'start는 HH:mm 형식이어야 합니다.';
  if (end != null && !TIME_RE.test(end)) return 'end는 HH:mm 형식이어야 합니다.';
  if (end != null && end <= start) return '끝 시각은 시작 시각보다 늦어야 합니다.';
  return { title, tag, date, start, end, done };
}

export const getPlans = async (_req: Request, res: Response) => {
  try {
    res.json(await plans.listPlans());
  } catch (e) {
    serverError(res, e);
  }
};

/** 계획 하나와 그 안의 일정 전부 */
export const getPlanDetail = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const plan = await plans.getPlan(id);
    if (!plan) return fail(res, 404, '계획을 찾을 수 없습니다.');
    res.json({ ...plan, items: await plans.listItems(id) });
  } catch (e) {
    serverError(res, e);
  }
};

export const postPlan = async (req: Request, res: Response) => {
  try {
    const p = parsePlanBody(req.body);
    if (typeof p === 'string') return fail(res, 400, p);
    res.status(201).json(await plans.createPlan(p));
  } catch (e) {
    serverError(res, e);
  }
};

export const putPlan = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const p = parsePlanBody(req.body);
    if (typeof p === 'string') return fail(res, 400, p);
    const outside = await plans.countItemsOutside(id, p.startDate, p.endDate);
    if (outside > 0) {
      return fail(res, 400, `바꾼 기간 밖에 일정이 ${outside}개 있습니다. 먼저 그 일정을 옮기거나 지워 주세요.`);
    }
    const updated = await plans.updatePlan(id, p);
    if (!updated) return fail(res, 404, '계획을 찾을 수 없습니다.');
    res.json(updated);
  } catch (e) {
    serverError(res, e);
  }
};

export const removePlan = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    await plans.deletePlan(id);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
};

export const postItem = async (req: Request, res: Response) => {
  try {
    const planId = parseId(req.body?.planId);
    if (!planId) return fail(res, 400, 'planId가 필요합니다.');
    const i = parseItemBody(req.body);
    if (typeof i === 'string') return fail(res, 400, i);
    const plan = await plans.getPlan(planId);
    if (!plan) return fail(res, 404, '계획을 찾을 수 없습니다.');
    if (i.date < plan.startDate || i.date > plan.endDate) return fail(res, 400, '날짜가 계획 기간 밖입니다.');
    res.status(201).json(await plans.createItem({ ...i, planId }));
  } catch (e) {
    serverError(res, e);
  }
};

export const putItem = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    const i = parseItemBody(req.body);
    if (typeof i === 'string') return fail(res, 400, i);
    const current = await plans.getItem(id);
    if (!current) return fail(res, 404, '일정을 찾을 수 없습니다.');
    const plan = await plans.getPlan(current.planId);
    if (plan && (i.date < plan.startDate || i.date > plan.endDate)) {
      return fail(res, 400, '날짜가 계획 기간 밖입니다.');
    }
    const updated = await plans.updateItem(id, i);
    if (!updated) return fail(res, 404, '일정을 찾을 수 없습니다.');
    res.json(updated);
  } catch (e) {
    serverError(res, e);
  }
};

export const removeItem = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'id가 잘못됐습니다.');
    await plans.deleteItem(id);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
};

export const getTags = async (_req: Request, res: Response) => {
  try {
    res.json(await plans.listTags());
  } catch (e) {
    serverError(res, e);
  }
};
