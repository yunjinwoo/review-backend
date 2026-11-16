// 월별 목표 저장소 (gemini_flutter /#/goals 달력 위 "이번 달 목표" 줄이 사용).
//
// 목표 종류 두 가지:
//   count  "조깅 8회"처럼 횟수를 채우는 목표. 주간 목표 체크 기록(goal_logs)에서 그 달 횟수를 자동으로 센다.
//          goal_id가 비어 있으면 "운동한 날 15일"처럼 무엇이든 체크한 날 수를 센다.
//   check  "책 1권 읽기"처럼 직접 완료 체크하는 목표.
// 목표는 달마다 따로 둔다 (month = 'yyyy-MM'). 다음 달에는 "지난달 목표 가져오기"로 복사해 쓴다.
// goals.ts와 같은 이유로 Prisma 모델 대신 CREATE TABLE IF NOT EXISTS로 테이블을 만든다.

import { PrismaClient } from '@prisma/client';
import { ensureGoalTables } from './goals.js';

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined'
  ? process.env.DATABASE_URL.replace(/"/g, '')
  : 'file:./dev.db';

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

export type MonthlyKind = 'count' | 'check';

export interface MonthlyGoal {
  id: number;
  month: string; // yyyy-MM
  name: string;
  kind: MonthlyKind;
  goalId: number | null; // count일 때 셀 주간 목표. null이면 운동한 날 수
  target: number; // check면 항상 1
  done: boolean; // check 목표의 직접 체크
  sortOrder: number;
}

/** 화면에 줄 때는 지금까지 채운 수를 같이 준다 */
export interface MonthlyGoalProgress extends MonthlyGoal {
  count: number;
}

export type MonthlyGoalInput = Omit<MonthlyGoal, 'id'>;

let ready: Promise<void> | null = null;

export function ensureMonthlyTables(): Promise<void> {
  ready ??= (async () => {
    await ensureGoalTables();
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
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS monthly_goals_month ON monthly_goals(month)`);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

type Row = {
  id: unknown; month: string; name: string; kind: string; goal_id: unknown;
  target: unknown; done: unknown; sort_order: unknown;
};

const toGoal = (r: Row): MonthlyGoal => ({
  id: Number(r.id),
  month: r.month,
  name: r.name,
  kind: r.kind === 'check' ? 'check' : 'count',
  goalId: r.goal_id == null ? null : Number(r.goal_id),
  target: Number(r.target),
  done: Number(r.done) === 1,
  sortOrder: Number(r.sort_order),
});

/** 'yyyy-MM' → 그 달 첫날과 마지막 날 ('yyyy-MM-dd') */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** 그 달 목표마다 지금까지 채운 수를 붙인다 */
async function withProgress(month: string, goals: MonthlyGoal[]): Promise<MonthlyGoalProgress[]> {
  const { from, to } = monthRange(month);
  const perGoal = await prisma.$queryRaw<{ goal_id: unknown; n: unknown }[]>`
    SELECT goal_id, COUNT(*) AS n FROM goal_logs WHERE date >= ${from} AND date <= ${to} GROUP BY goal_id`;
  const days = await prisma.$queryRaw<{ n: unknown }[]>`
    SELECT COUNT(DISTINCT date) AS n FROM goal_logs WHERE date >= ${from} AND date <= ${to}`;
  const counts = new Map(perGoal.map((r) => [Number(r.goal_id), Number(r.n)]));
  const activeDays = Number(days[0]?.n ?? 0);
  return goals.map((g) => ({
    ...g,
    count: g.kind === 'check' ? (g.done ? 1 : 0) : g.goalId == null ? activeDays : counts.get(g.goalId) ?? 0,
  }));
}

export async function listMonthly(month: string): Promise<MonthlyGoalProgress[]> {
  await ensureMonthlyTables();
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, month, name, kind, goal_id, target, done, sort_order FROM monthly_goals
    WHERE month = ${month} ORDER BY sort_order, id`;
  return withProgress(month, rows.map(toGoal));
}

export async function getMonthly(id: number): Promise<MonthlyGoalProgress | null> {
  await ensureMonthlyTables();
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, month, name, kind, goal_id, target, done, sort_order FROM monthly_goals WHERE id = ${id}`;
  if (!rows[0]) return null;
  const g = toGoal(rows[0]);
  return (await withProgress(g.month, [g]))[0] ?? null;
}

export async function createMonthly(g: MonthlyGoalInput): Promise<MonthlyGoalProgress> {
  await ensureMonthlyTables();
  const rows = await prisma.$queryRaw<{ id: unknown }[]>`
    INSERT INTO monthly_goals (month, name, kind, goal_id, target, done, sort_order)
    VALUES (${g.month}, ${g.name}, ${g.kind}, ${g.goalId}, ${g.target}, ${g.done ? 1 : 0}, ${g.sortOrder})
    RETURNING id`;
  return (await getMonthly(Number(rows[0]!.id)))!;
}

/** 없는 id면 null */
export async function updateMonthly(id: number, g: MonthlyGoalInput): Promise<MonthlyGoalProgress | null> {
  await ensureMonthlyTables();
  const n = await prisma.$executeRaw`
    UPDATE monthly_goals SET month = ${g.month}, name = ${g.name}, kind = ${g.kind}, goal_id = ${g.goalId},
      target = ${g.target}, done = ${g.done ? 1 : 0}, sort_order = ${g.sortOrder}
    WHERE id = ${id}`;
  return n > 0 ? getMonthly(id) : null;
}

export async function deleteMonthly(id: number): Promise<void> {
  await ensureMonthlyTables();
  await prisma.$executeRaw`DELETE FROM monthly_goals WHERE id = ${id}`;
}

/** from 달의 목표를 to 달로 복사한다 (직접 체크는 비운 채로). to 달에 이미 목표가 있으면 아무것도 안 한다. */
export async function copyMonthly(from: string, to: string): Promise<MonthlyGoalProgress[]> {
  await ensureMonthlyTables();
  const existing = await prisma.$queryRaw<{ n: unknown }[]>`
    SELECT COUNT(*) AS n FROM monthly_goals WHERE month = ${to}`;
  if (Number(existing[0]?.n ?? 0) === 0) {
    await prisma.$executeRaw`
      INSERT INTO monthly_goals (month, name, kind, goal_id, target, done, sort_order)
      SELECT ${to}, name, kind, goal_id, target, 0, sort_order FROM monthly_goals WHERE month = ${from}
      ORDER BY sort_order, id`;
  }
  return listMonthly(to);
}

/** 주간 목표를 지우면 그 목표를 세던 월별 목표는 "운동한 날 수"가 되지 않게 함께 지운다 */
export async function deleteMonthlyForGoal(goalId: number): Promise<void> {
  await ensureMonthlyTables();
  await prisma.$executeRaw`DELETE FROM monthly_goals WHERE goal_id = ${goalId}`;
}
