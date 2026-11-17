// 특정일 알림과 상황 알림 (텔레그램, 일정 알림과 같은 봇 @JIN3PLAN_BOT).
//
// 1) 특정일 알림 (reminders 테이블): 날짜 + 시각 + 메모. 그 시각이 되면 보낸다.
// 2) 상황 알림: 하루 한 번 "점검 시각"(기본 20:00)에 살펴보고, 해당하면 보낸다.
//    - 주간 목표 밀림: 주 중반(기본 수요일)에 지나간 날 수에 비해 뒤처진 주간 목표가 있을 때
//    - 기간 목표 부족: 기간(4주·5주)이 끝나기 N일 전(기본 7일)에 아직 못 채운 기간 목표가 있을 때
//    - 운동 공백: N일(기본 3일) 연속 아무 체크가 없을 때 (공백 한 번에 한 번만)
// 3) 목표 달성: 주간 목표 하나를 채우면, 주간 목표를 다 채우면, 기간 목표를 채우면 바로 (30초 안에)
// 4) 주간 요약: 일요일(기본) 저녁(기본 21:00)에 지난 주 결과와 기간 목표 진행
//
// 설정은 app_settings 테이블의 alert_settings(JSON)에 두고, 화면의 알림 설정 창에서 바꾼다.
// 같은 알림을 두 번 보내지 않게 alert_log 테이블에 "무엇을 언제 보냈는지" 키를 남긴다.

import { PrismaClient } from '@prisma/client';
import { listGoals } from './goals.js';
import {
  lookupPeriod, ensurePeriodTables, addDays, weekdayOf, weekStartOf, parseDay, daysBetween,
  type PeriodGoalProgress, type PeriodWithGoals,
} from './periods.js';
import { esc, nowLocal, sendToChat, hasChat } from './notify.js';

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined'
  ? process.env.DATABASE_URL.replace(/"/g, '')
  : 'file:./dev.db';

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const LOOKBACK_MIN = 5; // 특정일 알림: 서버가 잠깐 꺼졌어도 5분 안이면 보낸다
const LATE_MIN = 60; // 상황 알림/요약: 정한 시각에서 1시간이 지나면 그날은 건너뛴다 (밤늦게 갑자기 오지 않게)
const SETTINGS_KEY = 'alert_settings';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

let ready: Promise<void> | null = null;

export function ensureAlertTables(): Promise<void> {
  ready ??= (async () => {
    await ensurePeriodTables();
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        memo TEXT NOT NULL,
        sent_for TEXT, -- 보낸 날짜·시각 ("2026-11-20 09:00"). 시각을 고치면 값이 달라져서 다시 보낸다
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS reminders_date ON reminders(date)`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS alert_log (
        key TEXT PRIMARY KEY,
        sent_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    // 달 단위였을 때 보낸 달성 알림 기록("achieved:month:2026-11:<id>")을 기간 단위 키로 옮겨서 같은 목표를 또 알리지 않게 한다
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO alert_log (key, sent_at)
      SELECT 'achieved:period:' || substr(key, 24), sent_at FROM alert_log WHERE key LIKE 'achieved:month:_______:%'`);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// ---- 설정 ----

export interface AlertSettings {
  checkTime: string; // HH:mm 상황 알림을 살펴보는 시각
  weeklyBehind: boolean;
  weeklyBehindWeekday: number; // 0=일 ... 6=토
  monthlyShort: boolean;
  monthlyShortDays: number; // 기간이 끝나기 며칠 전 (이름은 달 단위였을 때 그대로)
  idle: boolean;
  idleDays: number; // 며칠 연속 기록이 없으면
  achieved: boolean;
  summary: boolean;
  summaryWeekday: number; // 0=일 ... 6=토
  summaryTime: string; // HH:mm
}

export const DEFAULT_SETTINGS: AlertSettings = {
  checkTime: '20:00',
  weeklyBehind: true,
  weeklyBehindWeekday: 3,
  monthlyShort: true,
  monthlyShortDays: 7,
  idle: true,
  idleDays: 3,
  achieved: true,
  summary: true,
  summaryWeekday: 0,
  summaryTime: '21:00',
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 들어온 값을 검사해서 설정으로 바꾼다. 빠진 값은 base 값을 쓴다. 문제가 있으면 오류 메시지. */
export function parseSettings(body: any, base: AlertSettings = DEFAULT_SETTINGS): AlertSettings | string {
  const s: AlertSettings = { ...base };
  const bools = ['weeklyBehind', 'monthlyShort', 'idle', 'achieved', 'summary'] as const;
  for (const k of bools) {
    if (body?.[k] === undefined) continue;
    if (typeof body[k] !== 'boolean') return `${k}는 true/false여야 합니다.`;
    s[k] = body[k];
  }
  for (const k of ['checkTime', 'summaryTime'] as const) {
    if (body?.[k] === undefined) continue;
    if (typeof body[k] !== 'string' || !TIME_RE.test(body[k])) return `${k}는 HH:mm 형식이어야 합니다.`;
    s[k] = body[k];
  }
  const ints: [keyof AlertSettings, number, number][] = [
    ['weeklyBehindWeekday', 0, 6], ['summaryWeekday', 0, 6], ['monthlyShortDays', 1, 20], ['idleDays', 2, 14],
  ];
  for (const [k, min, max] of ints) {
    if (body?.[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < min || n > max) return `${k}는 ${min}~${max} 사이 정수여야 합니다.`;
    (s as any)[k] = n;
  }
  return s;
}

export async function getSettings(): Promise<AlertSettings> {
  await ensureAlertTables();
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM app_settings WHERE key = ${SETTINGS_KEY}`;
  if (!rows[0]) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = parseSettings(JSON.parse(rows[0].value));
    return typeof parsed === 'string' ? { ...DEFAULT_SETTINGS } : parsed;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: AlertSettings): Promise<AlertSettings> {
  await ensureAlertTables();
  const value = JSON.stringify(s);
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value) VALUES (${SETTINGS_KEY}, ${value})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
  return s;
}

// ---- 특정일 알림 ----

export interface Reminder {
  id: number;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  memo: string;
  sent: boolean; // 지금 날짜·시각으로 이미 보냈는지
}

export type ReminderInput = Omit<Reminder, 'id' | 'sent'>;

type ReminderRow = { id: unknown; date: string; time: string; memo: string; sent_for: string | null };
const toReminder = (r: ReminderRow): Reminder => ({
  id: Number(r.id), date: r.date, time: r.time, memo: r.memo, sent: r.sent_for === `${r.date} ${r.time}`,
});

export async function listReminders(from: string, to: string): Promise<Reminder[]> {
  await ensureAlertTables();
  const rows = await prisma.$queryRaw<ReminderRow[]>`
    SELECT id, date, time, memo, sent_for FROM reminders
    WHERE date >= ${from} AND date <= ${to} ORDER BY date, time, id`;
  return rows.map(toReminder);
}

export async function createReminder(r: ReminderInput): Promise<Reminder> {
  await ensureAlertTables();
  const rows = await prisma.$queryRaw<ReminderRow[]>`
    INSERT INTO reminders (date, time, memo) VALUES (${r.date}, ${r.time}, ${r.memo})
    RETURNING id, date, time, memo, sent_for`;
  return toReminder(rows[0]!);
}

/** 없는 id면 null */
export async function updateReminder(id: number, r: ReminderInput): Promise<Reminder | null> {
  await ensureAlertTables();
  const rows = await prisma.$queryRaw<ReminderRow[]>`
    UPDATE reminders SET date = ${r.date}, time = ${r.time}, memo = ${r.memo} WHERE id = ${id}
    RETURNING id, date, time, memo, sent_for`;
  return rows[0] ? toReminder(rows[0]) : null;
}

export async function deleteReminder(id: number): Promise<void> {
  await ensureAlertTables();
  await prisma.$executeRaw`DELETE FROM reminders WHERE id = ${id}`;
}

// ---- 날짜 도우미 (날짜 계산은 periods.ts 것을 같이 쓴다) ----

export { addDays, weekdayOf, weekStartOf };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** now가 정한 시각 이후 LATE_MIN분 안인지 */
const inWindow = (now: string, at: string) => toMin(now) >= toMin(at) && toMin(now) - toMin(at) < LATE_MIN;

// ---- 보낸 기록 ----

/** 처음이면 기록하고 true, 이미 보낸 키면 false */
async function claim(key: string): Promise<boolean> {
  const n = await prisma.$executeRaw`INSERT OR IGNORE INTO alert_log (key) VALUES (${key})`;
  return n > 0;
}

async function unclaim(key: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM alert_log WHERE key = ${key}`;
}

/** 키가 처음일 때만 보낸다. 보내기에 실패하면 기록을 지워서 다음 확인 때 다시 시도한다. */
/**
 * 그날 저녁 기준으로 주간 목표가 뒤처졌는지.
 * 지나간 날 수(오늘 포함)에 비례한 횟수를 못 채웠거나, 남은 날에 하루 한 번씩 해도 못 채우면 뒤처진 것으로 본다.
 * 예) 수요일: 주 2회 목표는 0번이면 뒤처짐, 1번이면 정상. 주 1회 목표는 아직 뒤처진 게 아니다.
 */
export function isBehind(count: number, target: number, weekday: number): boolean {
  const elapsed = weekday + 1; // 일요일=1일째
  const daysLeft = 6 - weekday;
  return count < Math.floor((target * elapsed) / 7) || target - count > daysLeft;
}

async function sendOnce(key: string, text: () => Promise<string | null>, silent = false): Promise<void> {
  if (!(await claim(key)) || silent) return; // silent: 보내지 않고 알린 것으로만 적어 둔다
  try {
    const t = await text();
    if (t) await sendToChat(t);
  } catch (e) {
    await unclaim(key);
    throw e;
  }
}

// ---- 계산 ----

type WeekStat = { id: number; name: string; count: number; target: number };

async function weekStats(start: string): Promise<WeekStat[]> {
  const goals = await listGoals();
  const rows = await prisma.$queryRaw<{ goal_id: unknown; n: unknown }[]>`
    SELECT goal_id, COUNT(*) AS n FROM goal_logs
    WHERE date >= ${start} AND date <= ${addDays(start, 6)} GROUP BY goal_id`;
  const counts = new Map(rows.map((r) => [Number(r.goal_id), Number(r.n)]));
  return goals.map((g) => ({ id: g.id, name: g.name, count: counts.get(g.id) ?? 0, target: g.timesPerWeek }));
}

const goalLine = (g: PeriodGoalProgress) =>
  g.kind === 'check'
    ? `${g.done ? '✅' : '▫️'} ${esc(g.name)}`
    : `${g.count >= g.target ? '✅' : '▫️'} ${esc(g.name)} ${g.count}/${g.target}`;

function periodLines(p: PeriodWithGoals, today: string, label: string): string[] {
  const total = p.weeks * 7;
  const ended = today > p.endDate;
  const day = Math.min(total, daysBetween(p.startDate, today) + 1);
  const title = `<b>${label}</b> ${md(p.startDate)}~${md(p.endDate)}`;
  const time = ended
    ? '끝난 기간'
    : `${day}일째/${total}일 (${Math.round((day / total) * 100)}%) · 남은 날 ${total - day}일`;
  if (p.goals.length === 0) return [`${title} · ${time}`, '아직 기간 목표가 없어요. 사이트 달력 위에서 추가할 수 있어요.'];
  const met = p.goals.filter((g) => g.count >= g.target).length;
  return [`${title} · ${time}`, `목표 ${met}/${p.goals.length}개 달성`, ...p.goals.map(goalLine)];
}

/** 봇의 /period 명령과 요약에서 쓰는 기간 목표 진행. 진행 중인 기간이 없으면 마지막으로 끝난 기간의 결과를 보여 준다. */
export async function periodText(today: string): Promise<string> {
  const { period, previous } = await lookupPeriod(today);
  if (period) return periodLines(period, today, `${period.weeks}주 목표`).join('\n');
  const hint = '진행 중인 기간 목표가 없어요. 사이트 달력 위에서 새 기간을 시작할 수 있어요.';
  if (!previous) return hint;
  const last = (await lookupPeriod(previous.endDate)).period;
  return last ? [...periodLines(last, today, `지난 ${last.weeks}주 목표`), '', hint].join('\n') : hint;
}

// ---- 하나씩 확인 ----

async function checkReminders(now: { date: string; time: string }): Promise<void> {
  const from = nowLocal(new Date(Date.now() - LOOKBACK_MIN * 60_000));
  const fromTime = from.date === now.date ? from.time : '00:00';
  const rows = await prisma.$queryRaw<ReminderRow[]>`
    SELECT id, date, time, memo, sent_for FROM reminders
    WHERE date = ${now.date} AND time <= ${now.time} AND time >= ${fromTime}
      AND (sent_for IS NULL OR sent_for <> date || ' ' || time)
    ORDER BY time, id`;
  for (const r of rows) {
    await sendToChat(`🔔 <b>${esc(r.time)}</b> ${esc(r.memo)}`);
    await prisma.$executeRaw`UPDATE reminders SET sent_for = ${`${r.date} ${r.time}`} WHERE id = ${Number(r.id)}`;
  }
}

async function checkWeeklyBehind(now: { date: string; time: string }, s: AlertSettings): Promise<void> {
  if (!s.weeklyBehind || weekdayOf(now.date) !== s.weeklyBehindWeekday || !inWindow(now.time, s.checkTime)) return;
  const start = weekStartOf(now.date);
  await sendOnce(`weeklyBehind:${start}`, async () => {
    const weekday = weekdayOf(now.date);
    const short = (await weekStats(start)).filter((g) => isBehind(g.count, g.target, weekday));
    if (short.length === 0) return null;
    const daysLeft = 6 - weekday; // 오늘 밤 이후 토요일까지
    return [
      `⚠️ <b>이번 주 목표가 밀렸어요</b> (남은 날 ${daysLeft}일)`,
      ...short.map((g) => `▫️ ${esc(g.name)} ${g.count}/${g.target} · ${g.target - g.count}번 더`),
    ].join('\n');
  });
}

async function checkPeriodShort(now: { date: string; time: string }, s: AlertSettings): Promise<void> {
  if (!s.monthlyShort || !inWindow(now.time, s.checkTime)) return;
  const { period } = await lookupPeriod(now.date);
  if (!period || addDays(period.endDate, -s.monthlyShortDays) !== now.date) return;
  await sendOnce(`periodShort:${period.id}:${period.endDate}`, async () => {
    const short = period.goals.filter((g) => g.count < g.target);
    if (short.length === 0) return null;
    return [
      `📅 <b>${period.weeks}주 목표가 ${s.monthlyShortDays}일 남았어요</b> (${md(period.endDate)}까지). 아직 못 채운 목표`,
      ...short.map((g) => g.kind === 'check'
        ? `▫️ ${esc(g.name)}`
        : `▫️ ${esc(g.name)} ${g.count}/${g.target} · ${g.target - g.count} 더`),
    ].join('\n');
  });
}

async function checkIdle(now: { date: string; time: string }, s: AlertSettings): Promise<void> {
  if (!s.idle || !inWindow(now.time, s.checkTime)) return;
  const rows = await prisma.$queryRaw<{ d: string | null }[]>`
    SELECT MAX(date) AS d FROM goal_logs WHERE date <= ${now.date}`;
  const last = rows[0]?.d ?? null;
  if (!last) return; // 기록이 아예 없으면 아직 쓰기 전이라 보지 않는다
  // 오늘까지 비어 있는 날 수 (마지막 기록이 어제면 1일)
  const gap = Math.round((parseDay(now.date).getTime() - parseDay(last).getTime()) / 86_400_000);
  if (gap < s.idleDays) return;
  // 공백 한 번에 한 번만 (마지막 기록 날짜가 바뀌어야 다시 보냄)
  await sendOnce(`idle:${last}`, async () =>
    `💤 <b>${gap}일째 운동 기록이 없어요.</b> 마지막 기록은 ${md(last)}(${WEEKDAYS[weekdayOf(last)]})예요. 오늘 가볍게 움직여 볼까요?`);
}

/**
 * 채운 목표를 한 번씩 알린다. silent면 보내지 않고 "알린 것"으로만 적어 둔다.
 * 달성 알림이 꺼져 있는 동안에도 silent로 적어 두기 때문에, 나중에 켰을 때 그동안 채운 것들이 한꺼번에 오지 않는다.
 */
async function checkAchieved(now: { date: string }, silent: boolean): Promise<void> {
  const start = weekStartOf(now.date);
  const stats = await weekStats(start);
  for (const g of stats) {
    if (g.count >= g.target) {
      await sendOnce(`achieved:week:${start}:${g.id}`, async () =>
        `🎉 <b>${esc(g.name)}</b> 이번 주 목표 달성! (${g.count}/${g.target})`, silent);
    }
  }
  if (stats.length > 0 && stats.every((g) => g.count >= g.target)) {
    await sendOnce(`achieved:weekAll:${start}`, async () => `🏆 <b>이번 주 목표를 모두 채웠어요!</b>`, silent);
  }
  const { period } = await lookupPeriod(now.date);
  for (const g of period?.goals ?? []) {
    if (g.count >= g.target) {
      await sendOnce(`achieved:period:${g.id}`, async () =>
        `🎉 ${period!.weeks}주 목표 달성: <b>${esc(g.name)}</b>${g.kind === 'count' ? ` (${g.count}/${g.target})` : ''}`, silent);
    }
  }
}

/**
 * 지금 채워져 있는 목표를 알림 없이 "알린 것"으로 적어 둔다.
 * 목표를 새로 만들거나 횟수를 고쳐서 처음부터 채워진 상태가 됐을 때 부른다 (운동해서 채운 게 아니므로 "달성!"을 보내지 않는다).
 */
export async function markAchievedSilently(): Promise<void> {
  await ensureAlertTables();
  await checkAchieved(nowLocal(), true);
}

/** 봇의 /week: 이번 주(일~토) 지금까지의 진행과 기간 목표 */
export async function weekText(today: string): Promise<string> {
  const start = weekStartOf(today);
  const stats = await weekStats(start);
  const met = stats.filter((g) => g.count >= g.target).length;
  const daysLeft = 6 - weekdayOf(today);
  const lines = [
    `📈 <b>이번 주</b> ${md(start)}~${md(addDays(start, 6))} · 오늘 빼고 남은 날 ${daysLeft}일`,
    stats.length === 0
      ? '주간 목표가 없어요.'
      : `목표 ${met}/${stats.length}개 달성${met === stats.length ? ' 🏆' : ''}`,
    ...stats.map((g) => `${g.count >= g.target ? '✅' : '▫️'} ${esc(g.name)} ${g.count}/${g.target}`),
    '',
    await periodText(today),
  ];
  return lines.join('\n');
}

/** 주간 요약 글. 토요일에 보내면 이번 주, 다른 요일이면 지난 주(일~토)를 요약한다. */
export async function summaryText(today: string): Promise<string> {
  const start = weekdayOf(today) === 6 ? weekStartOf(today) : addDays(weekStartOf(today), -7);
  const end = addDays(start, 6);
  const stats = await weekStats(start);
  const met = stats.filter((g) => g.count >= g.target).length;
  const days = await prisma.$queryRaw<{ n: unknown }[]>`
    SELECT COUNT(DISTINCT date) AS n FROM goal_logs WHERE date >= ${start} AND date <= ${end}`;
  const lines = [
    `📊 <b>주간 요약</b> ${md(start)}~${md(end)}`,
    stats.length === 0
      ? '주간 목표가 없어요.'
      : `목표 ${met}/${stats.length}개 달성${met === stats.length ? ' 🏆' : ''} · 운동한 날 ${Number(days[0]?.n ?? 0)}일`,
    ...stats.map((g) => `${g.count >= g.target ? '✅' : '▫️'} ${esc(g.name)} ${g.count}/${g.target}`),
    '',
    await periodText(today),
  ];
  return lines.join('\n');
}

async function checkSummary(now: { date: string; time: string }, s: AlertSettings): Promise<void> {
  if (!s.summary || weekdayOf(now.date) !== s.summaryWeekday || !inWindow(now.time, s.summaryTime)) return;
  await sendOnce(`summary:${now.date}`, () => summaryText(now.date));
}

// ---- 30초마다 ----

let ticking = false;

/** notify.ts의 30초 타이머가 부른다. 받는 대화가 연결돼 있을 때만 확인한다. */
export async function alertTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    if (!(await hasChat())) return;
    await ensureAlertTables();
    const now = nowLocal();
    const s = await getSettings();
    // 하나가 실패해도 나머지는 확인한다
    const steps: [string, () => Promise<void>][] = [
      ['특정일', () => checkReminders(now)],
      ['주간 밀림', () => checkWeeklyBehind(now, s)],
      ['기간 부족', () => checkPeriodShort(now, s)],
      ['운동 공백', () => checkIdle(now, s)],
      ['달성', () => checkAchieved(now, !s.achieved)],
      ['주간 요약', () => checkSummary(now, s)],
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (e) {
        console.error(`[alerts] ${name} 알림 실패:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    ticking = false;
  }
}

/** 설정 창의 "미리 보기": 주간 요약을 지금 바로 보낸다 */
export async function sendSummaryNow(): Promise<void> {
  await ensureAlertTables();
  if (!(await hasChat())) throw new Error('아직 연결된 대화가 없습니다. 봇에게 /start 를 보내 주세요.');
  await sendToChat(await summaryText(nowLocal().date));
}
