// 타임라인 일정 시각 알림 (텔레그램 봇).
// 서버가 30초마다 "지금 시작하는 일정"을 찾아 텔레그램으로 보낸다. 사이트를 열어 두지 않아도 온다.
//
// 설정 (.env):
//   TELEGRAM_BOT_TOKEN  BotFather가 준 봇 토큰. 없으면 알림 기능은 꺼진 채로 서버만 돈다.
//   TELEGRAM_CHAT_ID    (선택) 받을 대화 id. 없으면 봇에게 처음 /start 를 보낸 대화가 등록된다.
//   NOTIFY_TZ           (선택) 일정 시각의 시간대. 기본 Asia/Seoul
//   TELEGRAM_API_BASE   (선택) 테스트용 가짜 서버 주소. 기본 https://api.telegram.org

import { PrismaClient } from '@prisma/client';
import { ensurePlanTables } from './plans.js';

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined'
  ? process.env.DATABASE_URL.replace(/"/g, '')
  : 'file:./dev.db';

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const API_BASE = (process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/$/, '');
const TZ = process.env.NOTIFY_TZ || 'Asia/Seoul';
const ENV_CHAT_ID = (process.env.TELEGRAM_CHAT_ID ?? '').trim();

const CHAT_KEY = 'telegram_chat_id';
const TICK_MS = 30_000;
const LOOKBACK_MIN = 5; // 서버가 잠깐 꺼졌다 켜져도 5분 안의 일정은 보낸다. 그보다 오래된 건 보내지 않는다.

let ready: Promise<void> | null = null;

function ensureNotifyTables(): Promise<void> {
  ready ??= (async () => {
    await ensurePlanTables();
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
    // 어떤 시각에 대해 알림을 보냈는지 ("2026-11-14 11:00"). 시각을 고치면 값이 달라져서 다시 보낸다.
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info(plan_items)`);
    if (!cols.some((c) => c.name === 'notified_for')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE plan_items ADD COLUMN notified_for TEXT`);
    }
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// ---- 받는 대화 ----

async function getChatId(): Promise<string | null> {
  if (ENV_CHAT_ID) return ENV_CHAT_ID;
  await ensureNotifyTables();
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM app_settings WHERE key = ${CHAT_KEY}`;
  return rows[0]?.value ?? null;
}

async function setChatId(id: string): Promise<void> {
  await ensureNotifyTables();
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value) VALUES (${CHAT_KEY}, ${id})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
}

/** 등록된 대화를 지운다. 다음에 /start 를 보내는 대화가 새로 등록된다. */
export async function disconnectChat(): Promise<void> {
  await ensureNotifyTables();
  await prisma.$executeRaw`DELETE FROM app_settings WHERE key = ${CHAT_KEY}`;
}

// ---- 텔레그램 API ----

class TelegramError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

async function tg<T = any>(method: string, body: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
  if (!TOKEN) throw new TelegramError('TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // 오류 메시지에 토큰이 들어간 주소가 섞이지 않게 원인만 남긴다
    throw new TelegramError(`텔레그램 서버에 연결하지 못했습니다 (${e instanceof Error ? e.name : 'error'}).`);
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!json?.ok) throw new TelegramError(json?.description ?? `텔레그램 응답 ${res.status}`, res.status);
  return json.result as T;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sendMessage = (chatId: string, text: string, extra: Record<string, unknown> = {}) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

let botUsername: string | null = null;

async function getBotUsername(): Promise<string | null> {
  if (botUsername || !TOKEN) return botUsername;
  const me = await tg<{ username?: string }>('getMe');
  botUsername = me.username ?? null;
  return botUsername;
}

// ---- 상태 / 테스트 (화면에서 사용) ----

export interface NotifyStatus {
  configured: boolean; // 서버에 봇 토큰이 있는지
  connected: boolean; // 받을 대화가 등록됐는지
  botUsername: string | null; // t.me/<이름> 링크를 만들 때 쓴다
  error: string | null; // 토큰이 틀렸을 때 등
}

export async function getStatus(): Promise<NotifyStatus> {
  if (!TOKEN) return { configured: false, connected: false, botUsername: null, error: null };
  let error: string | null = null;
  let username: string | null = null;
  try {
    username = await getBotUsername();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { configured: true, connected: (await getChatId()) != null, botUsername: username, error };
}

/** 등록된 대화로 테스트 메시지를 보낸다. 보낼 수 없으면 이유를 던진다. */
export async function sendTest(): Promise<void> {
  const chatId = await getChatId();
  if (!chatId) throw new TelegramError('아직 연결된 대화가 없습니다. 봇에게 /start 를 보내 주세요.');
  await sendMessage(chatId, '🔔 테스트 알림이에요. 일정 시작 시각이 되면 이렇게 메시지가 와요.');
}

// ---- 일정 시각 확인 ----

/** 일정이 저장된 시간대(기본 한국)의 지금 날짜와 시각 */
function nowLocal(at = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

type DueRow = {
  id: unknown; date: string; start_time: string; end_time: string | null;
  title: string; tag: string | null; plan_name: string;
};

function headline(r: Pick<DueRow, 'start_time' | 'title' | 'tag'>): string {
  const label = r.tag || r.title;
  const note = r.tag ? r.title : '';
  return `<b>${esc([r.start_time, label].filter(Boolean).join(' '))}</b>${note ? ` ${esc(note)}` : ''}`;
}

function itemText(r: DueRow, done: boolean): string {
  const range = r.end_time ? `${r.start_time}~${r.end_time}` : r.start_time;
  return `${done ? '✅' : '⏰'} ${headline(r)}\n${esc(r.plan_name)} · ${done ? '완료' : range}`;
}

const doneButton = (id: number) => ({
  inline_keyboard: [[{ text: '✅ 완료 체크', callback_data: `done:${id}` }]],
});

let ticking = false;

/** 지금 시작하는(최근 5분 안에 시작한) 안 끝낸 일정 중 아직 안 보낸 것을 보낸다 */
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const chatId = await getChatId();
    if (!chatId) return;
    await ensureNotifyTables();
    const now = nowLocal();
    const from = nowLocal(new Date(Date.now() - LOOKBACK_MIN * 60_000));
    const fromTime = from.date === now.date ? from.time : '00:00'; // 자정 직후에는 오늘 것만
    const rows = await prisma.$queryRaw<DueRow[]>`
      SELECT i.id, i.date, i.start_time, i.end_time, i.title, i.tag, p.name AS plan_name
      FROM plan_items i JOIN plans p ON p.id = i.plan_id
      WHERE i.date = ${now.date} AND i.start_time <= ${now.time} AND i.start_time >= ${fromTime}
        AND i.done = 0
        AND (i.notified_for IS NULL OR i.notified_for <> i.date || ' ' || i.start_time)
      ORDER BY i.start_time, i.id`;
    for (const r of rows) {
      const id = Number(r.id);
      await sendMessage(chatId, itemText(r, false), { reply_markup: doneButton(id) });
      await prisma.$executeRaw`
        UPDATE plan_items SET notified_for = ${`${r.date} ${r.start_time}`} WHERE id = ${id}`;
    }
  } catch (e) {
    console.error('[notify] 알림 보내기 실패:', e instanceof Error ? e.message : e);
  } finally {
    ticking = false;
  }
}

// ---- 봇이 받는 메시지 (/start, /today, 완료 버튼) ----

async function loadItem(id: number): Promise<DueRow | null> {
  const rows = await prisma.$queryRaw<DueRow[]>`
    SELECT i.id, i.date, i.start_time, i.end_time, i.title, i.tag, p.name AS plan_name
    FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE i.id = ${id}`;
  return rows[0] ?? null;
}

async function todayText(): Promise<string> {
  await ensureNotifyTables();
  const { date } = nowLocal();
  const rows = await prisma.$queryRaw<(DueRow & { done: unknown })[]>`
    SELECT i.id, i.date, i.start_time, i.end_time, i.title, i.tag, i.done, p.name AS plan_name
    FROM plan_items i JOIN plans p ON p.id = i.plan_id
    WHERE i.date = ${date} ORDER BY i.start_time, i.id`;
  if (rows.length === 0) return `오늘(${date})은 등록된 일정이 없어요.`;
  const done = rows.filter((r) => Number(r.done) === 1).length;
  return [
    `<b>오늘 일정</b> ${done}/${rows.length} 완료`,
    ...rows.map((r) => `${Number(r.done) === 1 ? '✅' : '▫️'} ${headline(r)}`),
  ].join('\n');
}

async function handleMessage(msg: any): Promise<void> {
  const chatId = String(msg?.chat?.id ?? '');
  const text = String(msg?.text ?? '').trim();
  if (!chatId || !text.startsWith('/')) return;
  const registered = await getChatId();
  const command = text.split(/[\s@]/)[0];

  if (registered && registered !== chatId) {
    // 이미 다른 대화에 연결돼 있으면 남이 봇을 찾아도 일정을 볼 수 없다
    if (command === '/start') await sendMessage(chatId, '이 봇은 이미 다른 대화에 연결돼 있어요.');
    return;
  }
  if (command === '/start') {
    if (!registered) await setChatId(chatId);
    await sendMessage(
      chatId,
      '연결됐어요. 타임라인 일정의 시작 시각이 되면 여기로 알려 드릴게요.\n/today 를 보내면 오늘 일정을 볼 수 있어요.',
    );
  } else if (command === '/today' && registered) {
    await sendMessage(chatId, await todayText());
  }
}

async function handleCallback(cb: any): Promise<void> {
  const chatId = String(cb?.message?.chat?.id ?? '');
  const data = String(cb?.data ?? '');
  const registered = await getChatId();
  const m = /^done:(\d+)$/.exec(data);
  if (!m || !registered || registered !== chatId) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
    return;
  }
  const id = Number(m[1]);
  await ensureNotifyTables();
  const item = await loadItem(id);
  if (!item) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '지워진 일정이에요.' });
    return;
  }
  await prisma.$executeRaw`UPDATE plan_items SET done = 1 WHERE id = ${id}`;
  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '완료로 체크했어요.' });
  // 메시지를 완료 모양으로 바꾸고 버튼을 없앤다
  await tg('editMessageText', {
    chat_id: chatId, message_id: cb.message.message_id,
    text: itemText(item, true), parse_mode: 'HTML',
  }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 텔레그램에서 오는 메시지를 계속 받아 온다 (롱 폴링: 올 때까지 최대 25초 기다리는 요청을 반복) */
async function pollLoop(): Promise<void> {
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg<any[]>(
        'getUpdates',
        { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
        35_000,
      );
      for (const u of updates) {
        offset = Math.max(offset, Number(u.update_id) + 1);
        try {
          if (u.message) await handleMessage(u.message);
          else if (u.callback_query) await handleCallback(u.callback_query);
        } catch (e) {
          console.error('[notify] 메시지 처리 실패:', e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      const code = e instanceof TelegramError ? e.code : undefined;
      console.error('[notify] getUpdates 실패:', e instanceof Error ? e.message : e);
      // 401: 토큰이 틀림, 409: 같은 봇을 다른 곳에서도 받고 있음. 금방 풀리지 않으니 천천히 다시 시도한다.
      await sleep(code === 401 || code === 409 ? 60_000 : 5_000);
    }
  }
}

let started = false;

/** 서버가 뜰 때 한 번 부른다. 토큰이 없으면 아무것도 하지 않는다. */
export function startNotifier(): void {
  if (started) return;
  started = true;
  if (!TOKEN) {
    console.log('[notify] TELEGRAM_BOT_TOKEN이 없어 일정 알림을 켜지 않습니다.');
    return;
  }
  console.log(`[notify] 텔레그램 일정 알림을 시작합니다 (시간대 ${TZ}).`);
  setInterval(tick, TICK_MS).unref();
  void tick();
  void pollLoop();
}
