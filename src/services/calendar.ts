// 다른 달력(구글, 아이폰, 삼성)이 구독할 수 있는 iCal(.ics) 피드.
// 주소에 들어가는 비밀키는 처음 요청할 때 만들어서 DB(app_settings)에 저장한다.
// 서버 .env를 고칠 필요가 없고, 키를 바꾸면 예전 구독 주소는 더 이상 열리지 않는다.

import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ensureGoalTables, listGoals, listLogs, listTodos } from './goals.js';

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined'
  ? process.env.DATABASE_URL.replace(/"/g, '')
  : 'file:./dev.db';

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const TOKEN_KEY = 'calendar_token';

async function ensureSettingsTable(): Promise<void> {
  await ensureGoalTables();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
}

const newToken = () => randomBytes(18).toString('base64url'); // 24자

/** 지금 비밀키. 없으면 만든다. */
export async function getCalendarToken(): Promise<string> {
  await ensureSettingsTable();
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM app_settings WHERE key = ${TOKEN_KEY}`;
  if (rows[0]) return rows[0].value;
  const token = newToken();
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES (${TOKEN_KEY}, ${token})`;
  // 동시에 두 요청이 왔을 때 먼저 들어간 값을 쓴다
  const again = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM app_settings WHERE key = ${TOKEN_KEY}`;
  return again[0]!.value;
}

/** 비밀키를 새로 만든다. 예전 구독 주소는 바로 막힌다. */
export async function resetCalendarToken(): Promise<string> {
  await ensureSettingsTable();
  const token = newToken();
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value) VALUES (${TOKEN_KEY}, ${token})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
  return token;
}

// ---- iCal 만들기 (RFC 5545) ----

/** TEXT 값 이스케이프: \ ; , 줄바꿈 */
const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** 한 줄이 75바이트를 넘으면 접는다 (한글이 깨지지 않게 글자 단위로) */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // 이어지는 줄은 앞에 공백 1바이트
    if (bytes + b > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const ymd = (date: string) => date.replace(/-/g, ''); // 2026-11-10 → 20261110

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return t.toISOString().slice(0, 10).replace(/-/g, '');
}

function shiftDays(base: Date, days: number): string {
  const t = new Date(base.getTime() + days * 86400000);
  return t.toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261110T061500Z
}

function allDayEvent(uid: string, date: string, summary: string, dtstamp: string, description?: string): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${ymd(date)}`,
    `DTEND;VALUE=DATE:${nextDay(date)}`,
    `SUMMARY:${esc(summary)}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    'TRANSP:TRANSPARENT', // 종일 일정이 "바쁨"으로 잡히지 않게
    'END:VEVENT',
  ];
}

/** 지난 90일 ~ 앞으로 1년의 할 일과 체크한 운동을 .ics 문자열로 */
export async function buildCalendarIcs(now = new Date()): Promise<string> {
  const from = shiftDays(now, -90);
  const to = shiftDays(now, 365);
  const [goals, logs, todos] = await Promise.all([
    listGoals(),
    listLogs(from, to),
    listTodos(from, to),
  ]);
  const goalName = new Map(goals.map((g) => [g.id, g.name]));
  const dtstamp = stamp(now);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//jin3//weekly-goals//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:주간 운동 목표',
    'X-WR-TIMEZONE:Asia/Seoul',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', // 지원하는 앱은 1시간마다 새로 읽음
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const l of logs) {
    const name = goalName.get(l.goalId);
    if (!name) continue;
    lines.push(
      ...allDayEvent(
        `log-${l.goalId}-${l.date}@weekly-goals`,
        l.date,
        `✅ ${name}`,
        dtstamp,
        l.source === 'samsung' ? 'Samsung Health 기록으로 자동 체크' : undefined,
      ),
    );
  }

  for (const t of todos) {
    const linked = t.goalId != null ? goalName.get(t.goalId) : undefined;
    lines.push(
      ...allDayEvent(
        `todo-${t.id}@weekly-goals`,
        t.date,
        `${t.done ? '☑' : '☐'} ${t.title}`,
        dtstamp,
        linked ? `목표: ${linked}` : undefined,
      ),
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
