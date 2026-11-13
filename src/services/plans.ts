// 기간 계획 타임라인 저장소 (gemini_flutter의 /#/plans 페이지가 사용).
// 계획(plan) = "이번 주말"처럼 이름과 기간, 일정(item) = 그 기간의 어느 날 몇 시에 무엇을 할지와 완료 여부.
// goals.ts와 같은 이유로 Prisma 모델 대신 CREATE TABLE IF NOT EXISTS로 테이블을 만든다.

import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined'
  ? process.env.DATABASE_URL.replace(/"/g, '')
  : 'file:./dev.db';

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

export interface Plan {
  id: number;
  name: string;
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd (포함)
}

/** 목록에서 달성률을 보여주려고 일정 수를 같이 준다 */
export interface PlanSummary extends Plan {
  itemCount: number;
  doneCount: number;
}

export interface PlanItem {
  id: number;
  planId: number;
  date: string; // yyyy-MM-dd
  start: string; // HH:mm
  end: string | null; // HH:mm. null이면 "9시 기상"처럼 시각 하나짜리
  title: string; // 비어 있을 수 있다 (시각만 찍어 두는 일정)
  tag: string | null; // "등산"처럼 자주 쓰는 분류. 화면에서 칩으로 골라 빠르게 등록한다
  done: boolean;
}

export type PlanInput = Omit<Plan, 'id'>;
export type PlanItemInput = Omit<PlanItem, 'id'>;

let ready: Promise<void> | null = null;

export function ensurePlanTables(): Promise<void> {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS plan_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS plan_items_plan ON plan_items(plan_id, date)`);
    // 태그 칸은 나중에 추가됐다. 이미 만들어진 테이블에는 없으므로 없을 때만 붙인다.
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info(plan_items)`);
    if (!cols.some((c) => c.name === 'tag')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE plan_items ADD COLUMN tag TEXT`);
    }
  })().catch((e) => {
    ready = null; // 다음 요청에서 다시 시도
    throw e;
  });
  return ready;
}

type PlanRow = {
  id: unknown; name: string; start_date: string; end_date: string;
  item_count?: unknown; done_count?: unknown;
};
const toPlan = (r: PlanRow): Plan => ({
  id: Number(r.id),
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
});

type ItemRow = {
  id: unknown; plan_id: unknown; date: string; start_time: string;
  end_time: string | null; title: string; tag: string | null; done: unknown;
};
const toItem = (r: ItemRow): PlanItem => ({
  id: Number(r.id),
  planId: Number(r.plan_id),
  date: r.date,
  start: r.start_time,
  end: r.end_time,
  title: r.title,
  tag: r.tag ?? null,
  done: Number(r.done) === 1,
});

/** 최근 기간이 위로 오게 */
export async function listPlans(): Promise<PlanSummary[]> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<PlanRow[]>`
    SELECT p.id, p.name, p.start_date, p.end_date,
      COUNT(i.id) AS item_count, COALESCE(SUM(i.done), 0) AS done_count
    FROM plans p LEFT JOIN plan_items i ON i.plan_id = p.id
    GROUP BY p.id
    ORDER BY p.start_date DESC, p.id DESC`;
  return rows.map((r) => ({
    ...toPlan(r),
    itemCount: Number(r.item_count ?? 0),
    doneCount: Number(r.done_count ?? 0),
  }));
}

export async function getPlan(id: number): Promise<Plan | null> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<PlanRow[]>`
    SELECT id, name, start_date, end_date FROM plans WHERE id = ${id}`;
  return rows[0] ? toPlan(rows[0]) : null;
}

export async function listItems(planId: number): Promise<PlanItem[]> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<ItemRow[]>`
    SELECT id, plan_id, date, start_time, end_time, title, tag, done FROM plan_items
    WHERE plan_id = ${planId}
    ORDER BY date, start_time, id`;
  return rows.map(toItem);
}

export async function createPlan(p: PlanInput): Promise<Plan> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<PlanRow[]>`
    INSERT INTO plans (name, start_date, end_date)
    VALUES (${p.name}, ${p.startDate}, ${p.endDate})
    RETURNING id, name, start_date, end_date`;
  return toPlan(rows[0]!);
}

/** 바꾼 기간 밖에 남게 되는 일정 수. 0이 아니면 기간을 줄이지 못하게 한다. */
export async function countItemsOutside(planId: number, startDate: string, endDate: string): Promise<number> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<{ n: unknown }[]>`
    SELECT COUNT(*) AS n FROM plan_items
    WHERE plan_id = ${planId} AND (date < ${startDate} OR date > ${endDate})`;
  return Number(rows[0]?.n ?? 0);
}

/** 없는 id면 null */
export async function updatePlan(id: number, p: PlanInput): Promise<Plan | null> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<PlanRow[]>`
    UPDATE plans SET name = ${p.name}, start_date = ${p.startDate}, end_date = ${p.endDate}
    WHERE id = ${id}
    RETURNING id, name, start_date, end_date`;
  return rows[0] ? toPlan(rows[0]) : null;
}

/** 계획과 그 안의 일정을 함께 지운다 */
export async function deletePlan(id: number): Promise<void> {
  await ensurePlanTables();
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM plan_items WHERE plan_id = ${id}`,
    prisma.$executeRaw`DELETE FROM plans WHERE id = ${id}`,
  ]);
}

export async function createItem(i: PlanItemInput): Promise<PlanItem> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<ItemRow[]>`
    INSERT INTO plan_items (plan_id, date, start_time, end_time, title, tag, done)
    VALUES (${i.planId}, ${i.date}, ${i.start}, ${i.end}, ${i.title}, ${i.tag}, ${i.done ? 1 : 0})
    RETURNING id, plan_id, date, start_time, end_time, title, tag, done`;
  return toItem(rows[0]!);
}

export async function getItem(id: number): Promise<PlanItem | null> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<ItemRow[]>`
    SELECT id, plan_id, date, start_time, end_time, title, tag, done FROM plan_items WHERE id = ${id}`;
  return rows[0] ? toItem(rows[0]) : null;
}

/** 일정은 다른 계획으로 옮기지 않는다 (planId는 그대로). 없는 id면 null */
export async function updateItem(id: number, i: Omit<PlanItemInput, 'planId'>): Promise<PlanItem | null> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<ItemRow[]>`
    UPDATE plan_items SET date = ${i.date}, start_time = ${i.start}, end_time = ${i.end},
      title = ${i.title}, tag = ${i.tag}, done = ${i.done ? 1 : 0}
    WHERE id = ${id}
    RETURNING id, plan_id, date, start_time, end_time, title, tag, done`;
  return rows[0] ? toItem(rows[0]) : null;
}

export async function deleteItem(id: number): Promise<void> {
  await ensurePlanTables();
  await prisma.$executeRaw`DELETE FROM plan_items WHERE id = ${id}`;
}

/** 지금까지 쓴 태그를 많이 쓴 순서로. 일정 추가 창의 칩에 쓴다. */
export async function listTags(): Promise<string[]> {
  await ensurePlanTables();
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT tag FROM plan_items
    WHERE tag IS NOT NULL AND tag <> ''
    GROUP BY tag
    ORDER BY COUNT(*) DESC, MAX(id) DESC
    LIMIT 30`;
  return rows.map((r) => r.tag);
}
