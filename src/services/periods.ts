// 기간 목표 저장소 (gemini_flutter /#/goals 달력 위 "4주 목표" 카드가 사용).
//
// 기간(goal_periods) = 일요일에 시작해서 4주나 5주 동안 이어지는 구간. 기간끼리는 겹치지 않는다.
// 기간 목표(monthly_goals 테이블) = 그 기간 안에 채울 목표. 종류 두 가지:
//   count  "조깅 8회"처럼 횟수를 채우는 목표. 주간 목표 체크 기록(goal_logs)에서 기간 동안의 횟수를 자동으로 센다.
//          goal_id가 비어 있으면 "운동한 날 15일"처럼 무엇이든 체크한 날 수를 센다. 목표보다 더 하면 더 한 만큼 센다.
//   check  "책 1권 읽기"처럼 직접 완료 체크하는 목표.
//
// 처음에는 달(month = 'yyyy-MM') 단위였다가 기간 단위로 바꿨다. 그래서 테이블 이름이 monthly_goals이고 month 칸이 남아 있다.
// 예전 달 목표는 서버가 뜰 때 "그 달 1일이 든 주의 일요일부터 4주" 기간으로 한 번 옮긴다.
// goals.ts와 같은 이유로 Prisma 모델 대신 CREATE TABLE IF NOT EXISTS로 테이블을 만든다.

import { PrismaClient } from '@prisma/client';
import { ensureGoalTables } from './goals.js';

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined'
  ? process.env.DATABASE_URL.replace(/"/g, '')
  : 'file:./dev.db';

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// ---- 날짜 도우미 (모두 'yyyy-MM-dd' 문자열, 주는 일요일 시작) ----

export const parseDay = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
};
export const addDays = (d: string, n: number) =>
  new Date(parseDay(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const weekdayOf = (d: string) => parseDay(d).getUTCDay(); // 0=일
export const weekStartOf = (d: string) => addDays(d, -weekdayOf(d));
export const daysBetween = (from: string, to: string) =>
  Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);

// ---- 모델 ----

export interface Period {
  id: number;
  startDate: string; // 일요일
  weeks: number;
  endDate: string; // 마지막 날(토요일), 포함
}

export type GoalKind = 'count' | 'check';

export interface PeriodGoal {
  id: number;
  periodId: number;
  name: string;
  kind: GoalKind;
  goalId: number | null; // count일 때 셀 주간 목표. null이면 운동한 날 수
  target: number; // check면 항상 1
  done: boolean; // check 목표의 직접 체크
  sortOrder: number;
}

/** 화면에 줄 때는 지금까지 채운 수를 같이 준다 (목표보다 클 수 있다) */
export interface PeriodGoalProgress extends PeriodGoal {
  count: number;
}

export interface PeriodWithGoals extends Period {
  goals: PeriodGoalProgress[];
}

export type PeriodGoalInput = Omit<PeriodGoal, 'id'>;

let ready: Promise<void> | null = null;

export function ensurePeriodTables(): Promise<void> {
  ready ??= (async () => {
    await ensureGoalTables();
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS goal_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_date TEXT NOT NULL,
        weeks INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS monthly_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'count',
        goal_id INTEGER,
        target INTEGER NOT NULL DEFAULT 1,
        done INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info(monthly_goals)`);
    if (!cols.some((c) => c.name === 'period_id')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE monthly_goals ADD COLUMN period_id INTEGER`);
    }
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS monthly_goals_period ON monthly_goals(period_id)`);
    await migrateMonths();
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** 달 단위로 만들어 둔 목표(period_id가 빈 것)를 기간으로 옮긴다. 달마다 "1일이 든 주의 일요일부터 4주". */
async function migrateMonths(): Promise<void> {
  const months = await prisma.$queryRaw<{ month: string }[]>`
    SELECT DISTINCT month FROM monthly_goals WHERE period_id IS NULL ORDER BY month`;
  for (const { month } of months) {
    const start = weekStartOf(`${month}-01`);
    const found = await prisma.$queryRaw<{ id: unknown }[]>`
      SELECT id FROM goal_periods WHERE start_date = ${start}`;
    let id = found[0] ? Number(found[0].id) : null;
    if (id == null) {
      const rows = await prisma.$queryRaw<{ id: unknown }[]>`
        INSERT INTO goal_periods (start_date, weeks) VALUES (${start}, 4) RETURNING id`;
      id = Number(rows[0]!.id);
    }
    await prisma.$executeRaw`UPDATE monthly_goals SET period_id = ${id} WHERE month = ${month} AND period_id IS NULL`;
  }
}

type PeriodRow = { id: unknown; start_date: string; weeks: unknown };
const toPeriod = (r: PeriodRow): Period => {
  const weeks = Number(r.weeks);
  return { id: Number(r.id), startDate: r.start_date, weeks, endDate: addDays(r.start_date, weeks * 7 - 1) };
};

type GoalRow = {
  id: unknown; period_id: unknown; name: string; kind: string; goal_id: unknown;
  target: unknown; done: unknown; sort_order: unknown;
};
const toGoal = (r: GoalRow): PeriodGoal => ({
  id: Number(r.id),
  periodId: Number(r.period_id),
  name: r.name,
  kind: r.kind === 'check' ? 'check' : 'count',
  goalId: r.goal_id == null ? null : Number(r.goal_id),
  target: Number(r.target),
  done: Number(r.done) === 1,
  sortOrder: Number(r.sort_order),
});

async function allPeriods(): Promise<Period[]> {
  await ensurePeriodTables();
  const rows = await prisma.$queryRaw<PeriodRow[]>`
    SELECT id, start_date, weeks FROM goal_periods ORDER BY start_date`;
  return rows.map(toPeriod);
}

/** 기간의 목표마다 지금까지 채운 수를 붙인다 */
async function withGoals(p: Period): Promise<PeriodWithGoals> {
  const rows = await prisma.$queryRaw<GoalRow[]>`
    SELECT id, period_id, name, kind, goal_id, target, done, sort_order FROM monthly_goals
    WHERE period_id = ${p.id} ORDER BY sort_order, id`;
  const perGoal = await prisma.$queryRaw<{ goal_id: unknown; n: unknown }[]>`
    SELECT goal_id, COUNT(*) AS n FROM goal_logs
    WHERE date >= ${p.startDate} AND date <= ${p.endDate} GROUP BY goal_id`;
  const days = await prisma.$queryRaw<{ n: unknown }[]>`
    SELECT COUNT(DISTINCT date) AS n FROM goal_logs WHERE date >= ${p.startDate} AND date <= ${p.endDate}`;
  const counts = new Map(perGoal.map((r) => [Number(r.goal_id), Number(r.n)]));
  const activeDays = Number(days[0]?.n ?? 0);
  return {
    ...p,
    goals: rows.map(toGoal).map((g) => ({
      ...g,
      count: g.kind === 'check' ? (g.done ? 1 : 0) : g.goalId == null ? activeDays : counts.get(g.goalId) ?? 0,
    })),
  };
}

export interface PeriodLookup {
  period: PeriodWithGoals | null; // 그 날짜가 든 기간
  previous: Period | null; // 그 날짜보다 먼저 끝난 가장 최근 기간 (새 기간을 시작할 때 목표를 이어받는다)
}

/** 그 날짜가 든 기간과 목표 진행. 없으면 period가 null. */
export async function lookupPeriod(date: string): Promise<PeriodLookup> {
  const periods = await allPeriods();
  const current = periods.find((p) => p.startDate <= date && date <= p.endDate) ?? null;
  const previous = periods.filter((p) => p.endDate < date).pop() ?? null;
  return { period: current ? await withGoals(current) : null, previous };
}

export async function getPeriod(id: number): Promise<PeriodWithGoals | null> {
  const p = (await allPeriods()).find((x) => x.id === id);
  return p ? withGoals(p) : null;
}

/** 다른 기간과 겹치면 그 기간을 돌려준다 */
async function overlapping(start: string, weeks: number, exceptId: number | null): Promise<Period | null> {
  const end = addDays(start, weeks * 7 - 1);
  return (await allPeriods()).find((p) => p.id !== exceptId && p.startDate <= end && start <= p.endDate) ?? null;
}

export class PeriodOverlapError extends Error {
  constructor(p: Period) {
    super(`다른 기간(${p.startDate} ~ ${p.endDate})과 겹쳐요.`);
  }
}

/**
 * 새 기간을 만든다. 시작일은 그 주 일요일로 맞춘다.
 * copyFromId가 있으면 그 기간의 목표를 이어받는다 (직접 체크는 비운 채로).
 */
export async function createPeriod(startDate: string, weeks: number, copyFromId: number | null): Promise<PeriodWithGoals> {
  await ensurePeriodTables();
  const start = weekStartOf(startDate);
  const clash = await overlapping(start, weeks, null);
  if (clash) throw new PeriodOverlapError(clash);
  const rows = await prisma.$queryRaw<{ id: unknown }[]>`
    INSERT INTO goal_periods (start_date, weeks) VALUES (${start}, ${weeks}) RETURNING id`;
  const id = Number(rows[0]!.id);
  if (copyFromId != null) {
    await prisma.$executeRaw`
      INSERT INTO monthly_goals (month, period_id, name, kind, goal_id, target, done, sort_order)
      SELECT ${start.slice(0, 7)}, ${id}, name, kind, goal_id, target, 0, sort_order FROM monthly_goals
      WHERE period_id = ${copyFromId} ORDER BY sort_order, id`;
  }
  return (await getPeriod(id))!;
}

/** 시작일·주 수를 바꾼다 (4주 ↔ 5주). 없는 id면 null. */
export async function updatePeriod(id: number, startDate: string, weeks: number): Promise<PeriodWithGoals | null> {
  await ensurePeriodTables();
  const start = weekStartOf(startDate);
  const clash = await overlapping(start, weeks, id);
  if (clash) throw new PeriodOverlapError(clash);
  const n = await prisma.$executeRaw`UPDATE goal_periods SET start_date = ${start}, weeks = ${weeks} WHERE id = ${id}`;
  return n > 0 ? getPeriod(id) : null;
}

/** 기간과 그 안의 목표를 함께 지운다. 운동 체크 기록은 그대로 둔다. */
export async function deletePeriod(id: number): Promise<void> {
  await ensurePeriodTables();
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM monthly_goals WHERE period_id = ${id}`,
    prisma.$executeRaw`DELETE FROM goal_periods WHERE id = ${id}`,
  ]);
}

// ---- 기간 목표 ----

async function goalProgress(id: number): Promise<PeriodGoalProgress | null> {
  const rows = await prisma.$queryRaw<{ period_id: unknown }[]>`
    SELECT period_id FROM monthly_goals WHERE id = ${id}`;
  if (!rows[0]) return null;
  const p = await getPeriod(Number(rows[0].period_id));
  return p?.goals.find((g) => g.id === id) ?? null;
}

/** 기간이 없으면 null */
export async function createPeriodGoal(g: PeriodGoalInput): Promise<PeriodGoalProgress | null> {
  const p = await getPeriod(g.periodId);
  if (!p) return null;
  const rows = await prisma.$queryRaw<{ id: unknown }[]>`
    INSERT INTO monthly_goals (month, period_id, name, kind, goal_id, target, done, sort_order)
    VALUES (${p.startDate.slice(0, 7)}, ${p.id}, ${g.name}, ${g.kind}, ${g.goalId}, ${g.target}, ${g.done ? 1 : 0}, ${g.sortOrder})
    RETURNING id`;
  return goalProgress(Number(rows[0]!.id));
}

/** 없는 id면 null. 기간은 옮기지 않는다. */
export async function updatePeriodGoal(id: number, g: Omit<PeriodGoalInput, 'periodId'>): Promise<PeriodGoalProgress | null> {
  await ensurePeriodTables();
  const n = await prisma.$executeRaw`
    UPDATE monthly_goals SET name = ${g.name}, kind = ${g.kind}, goal_id = ${g.goalId},
      target = ${g.target}, done = ${g.done ? 1 : 0}, sort_order = ${g.sortOrder}
    WHERE id = ${id}`;
  return n > 0 ? goalProgress(id) : null;
}

export async function deletePeriodGoal(id: number): Promise<void> {
  await ensurePeriodTables();
  await prisma.$executeRaw`DELETE FROM monthly_goals WHERE id = ${id}`;
}

/** 주간 목표를 지우면 그 목표를 세던 기간 목표는 "운동한 날 수"가 되지 않게 함께 지운다 */
export async function deletePeriodGoalsForGoal(goalId: number): Promise<void> {
  await ensurePeriodTables();
  await prisma.$executeRaw`DELETE FROM monthly_goals WHERE goal_id = ${goalId}`;
}
