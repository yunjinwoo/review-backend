// 주간 운동 목표 저장소 (gemini_flutter의 /#/goals 페이지가 사용).
// Review와 같은 SQLite 파일을 쓰지만, 서버 배포 스크립트에 prisma db push 단계가 없어서
// Prisma 모델 대신 시작할 때 CREATE TABLE IF NOT EXISTS로 테이블을 만든다.
// (런타임과 같은 PrismaClient/URL을 쓰므로 테이블이 엉뚱한 DB 파일에 생길 일이 없다.)

import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined'
  ? process.env.DATABASE_URL.replace(/"/g, '')
  : 'file:./dev.db';

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

export interface Goal {
  id: number;
  name: string;
  timesPerWeek: number;
  color: number;
  sortOrder: number;
}

export interface GoalLog {
  goalId: number;
  date: string; // yyyy-MM-dd
  source: string; // manual | samsung
  workoutId: string | null;
}

const DEFAULT_GOALS: Omit<Goal, 'id'>[] = [
  { name: '조깅', timesPerWeek: 2, color: 0xFF26A69A, sortOrder: 0 },
  { name: '등산', timesPerWeek: 1, color: 0xFF8D6E63, sortOrder: 1 },
  { name: '근력운동', timesPerWeek: 2, color: 0xFF5C6BC0, sortOrder: 2 },
];

let ready: Promise<void> | null = null;

/** 테이블이 없으면 만들고, 목표가 하나도 없으면 기본 목표를 넣는다. 한 번만 실행된다. */
export function ensureGoalTables(): Promise<void> {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        times_per_week INTEGER NOT NULL,
        color BIGINT NOT NULL, -- 0xFFRRGGBB가 32비트 INT를 넘어서 BIGINT
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS goal_logs (
        goal_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        workout_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (goal_id, date)
      )`);
    // 날짜별 할 일 (예: "토 북한산 등산"). goal_id가 있으면 완료할 때 그 목표도 체크된다.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        goal_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS todos_date ON todos(date)`);
    const rows = await prisma.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n FROM goals`;
    if (Number(rows[0]?.n ?? 0) === 0) {
      for (const g of DEFAULT_GOALS) {
        await prisma.$executeRaw`
          INSERT INTO goals (name, times_per_week, color, sort_order)
          VALUES (${g.name}, ${g.timesPerWeek}, ${g.color}, ${g.sortOrder})`;
      }
    }
  })().catch((e) => {
    ready = null; // 다음 요청에서 다시 시도
    throw e;
  });
  return ready;
}

type GoalRow = { id: unknown; name: string; times_per_week: unknown; color: unknown; sort_order: unknown };
const toGoal = (r: GoalRow): Goal => ({
  id: Number(r.id),
  name: r.name,
  timesPerWeek: Number(r.times_per_week),
  color: Number(r.color),
  sortOrder: Number(r.sort_order),
});

export async function listGoals(): Promise<Goal[]> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<GoalRow[]>`
    SELECT id, name, times_per_week, color, sort_order FROM goals ORDER BY sort_order, id`;
  return rows.map(toGoal);
}

export async function createGoal(g: Omit<Goal, 'id'>): Promise<Goal> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<GoalRow[]>`
    INSERT INTO goals (name, times_per_week, color, sort_order)
    VALUES (${g.name}, ${g.timesPerWeek}, ${g.color}, ${g.sortOrder})
    RETURNING id, name, times_per_week, color, sort_order`;
  return toGoal(rows[0]!);
}

/** 없는 id면 null */
export async function updateGoal(id: number, g: Omit<Goal, 'id'>): Promise<Goal | null> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<GoalRow[]>`
    UPDATE goals SET name = ${g.name}, times_per_week = ${g.timesPerWeek},
      color = ${g.color}, sort_order = ${g.sortOrder}
    WHERE id = ${id}
    RETURNING id, name, times_per_week, color, sort_order`;
  return rows[0] ? toGoal(rows[0]) : null;
}

/** 목표와 그 목표의 체크 기록을 함께 지운다. 그 목표에 연결된 할 일은 연결만 끊는다. */
export async function deleteGoal(id: number): Promise<void> {
  await ensureGoalTables();
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM goal_logs WHERE goal_id = ${id}`,
    prisma.$executeRaw`UPDATE todos SET goal_id = NULL WHERE goal_id = ${id}`, // 할 일은 남기고 연결만 끊음
    prisma.$executeRaw`DELETE FROM goals WHERE id = ${id}`,
  ]);
}

type LogRow = { goal_id: unknown; date: string; source: string; workout_id: string | null };

export async function listLogs(from: string, to: string): Promise<GoalLog[]> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<LogRow[]>`
    SELECT goal_id, date, source, workout_id FROM goal_logs
    WHERE date >= ${from} AND date <= ${to}
    ORDER BY date, goal_id`;
  return rows.map((r) => ({
    goalId: Number(r.goal_id),
    date: r.date,
    source: r.source,
    workoutId: r.workout_id,
  }));
}

/** 체크돼 있으면 지우고 없으면 넣는다. 결과로 체크 상태를 돌려준다. */
export async function toggleLog(goalId: number, date: string): Promise<boolean> {
  await ensureGoalTables();
  const removed = await prisma.$executeRaw`
    DELETE FROM goal_logs WHERE goal_id = ${goalId} AND date = ${date}`;
  if (removed > 0) return false;
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO goal_logs (goal_id, date, source) VALUES (${goalId}, ${date}, 'manual')`;
  return true;
}

/** 나중에 Samsung Health 동기화가 부를 자리. 이미 체크돼 있으면 그대로 둔다. */
export async function markFromWorkout(goalId: number, date: string, workoutId: string): Promise<void> {
  await ensureGoalTables();
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO goal_logs (goal_id, date, source, workout_id)
    VALUES (${goalId}, ${date}, 'samsung', ${workoutId})`;
}

export async function goalExists(id: number): Promise<boolean> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<{ id: unknown }[]>`SELECT id FROM goals WHERE id = ${id}`;
  return rows.length > 0;
}

// ---- 날짜별 할 일 ----

export interface Todo {
  id: number;
  date: string; // yyyy-MM-dd
  title: string;
  done: boolean;
  goalId: number | null;
}

export type TodoInput = Omit<Todo, 'id'>;

type TodoRow = { id: unknown; date: string; title: string; done: unknown; goal_id: unknown };
const toTodo = (r: TodoRow): Todo => ({
  id: Number(r.id),
  date: r.date,
  title: r.title,
  done: Number(r.done) === 1,
  goalId: r.goal_id == null ? null : Number(r.goal_id),
});

export async function listTodos(from: string, to: string): Promise<Todo[]> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<TodoRow[]>`
    SELECT id, date, title, done, goal_id FROM todos
    WHERE date >= ${from} AND date <= ${to}
    ORDER BY date, id`;
  return rows.map(toTodo);
}

/** 완료된 할 일에 목표가 연결돼 있으면 그날 그 목표도 체크한다 (이미 체크돼 있으면 그대로) */
async function checkLinkedGoal(t: Todo): Promise<void> {
  if (!t.done || t.goalId == null) return;
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO goal_logs (goal_id, date, source) VALUES (${t.goalId}, ${t.date}, 'manual')`;
}

export async function createTodo(t: TodoInput): Promise<Todo> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<TodoRow[]>`
    INSERT INTO todos (date, title, done, goal_id)
    VALUES (${t.date}, ${t.title}, ${t.done ? 1 : 0}, ${t.goalId})
    RETURNING id, date, title, done, goal_id`;
  const todo = toTodo(rows[0]!);
  await checkLinkedGoal(todo);
  return todo;
}

/** 없는 id면 null */
export async function updateTodo(id: number, t: TodoInput): Promise<Todo | null> {
  await ensureGoalTables();
  const rows = await prisma.$queryRaw<TodoRow[]>`
    UPDATE todos SET date = ${t.date}, title = ${t.title}, done = ${t.done ? 1 : 0}, goal_id = ${t.goalId}
    WHERE id = ${id}
    RETURNING id, date, title, done, goal_id`;
  if (!rows[0]) return null;
  const todo = toTodo(rows[0]);
  await checkLinkedGoal(todo);
  return todo;
}

export async function deleteTodo(id: number): Promise<void> {
  await ensureGoalTables();
  await prisma.$executeRaw`DELETE FROM todos WHERE id = ${id}`;
}
