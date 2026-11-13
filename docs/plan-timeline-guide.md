# 기간 계획 타임라인 + 텔레그램 알림: 서버 코드 공부 가이드

이 문서는 `gemini_flutter`의 `/#/plans` 화면이 쓰는 서버 코드를 처음 보는 사람이 **구조부터 코드 한 줄까지** 따라 읽을 수 있게 정리한 것입니다.
화면 쪽 설명은 gemini_flutter 레포의 `docs/plans/plan_timeline_analysis.md`와 `docs/plans/plan_timeline_for_react_dev.md`에 있습니다.

읽는 순서는 위에서 아래로입니다. 각 장 끝에 "직접 해 보기"가 있으니 코드를 열어 놓고 같이 보세요.

## 목차

1. [무엇을 만드는 서버인가](#1-무엇을-만드는-서버인가)
2. [폴더 구조와 요청이 흘러가는 길](#2-폴더-구조와-요청이-흘러가는-길)
3. [데이터베이스: 테이블 세 개](#3-데이터베이스-테이블-세-개)
4. [서비스 계층: SQL을 다루는 곳](#4-서비스-계층-sql을-다루는-곳)
5. [컨트롤러 계층: 검사하고 응답하는 곳](#5-컨트롤러-계층-검사하고-응답하는-곳)
6. [API 목록](#6-api-목록)
7. [텔레그램 알림이 동작하는 방식](#7-텔레그램-알림이-동작하는-방식)
8. [실제로 겪은 문제: fetch failed](#8-실제로-겪은-문제-fetch-failed)
9. [설정하고 실행하기](#9-설정하고-실행하기)
10. [연습 문제](#10-연습-문제)

---

## 1. 무엇을 만드는 서버인가

사용자가 하고 싶은 일은 이렇습니다.

> 주말 이틀을 잡고, 토요일 9시 기상, 11~13시 등산, 일요일 12시 런닝처럼 일정을 넣는다.
> 주말에 하나씩 체크한다. 시작 시각이 되면 텔레그램으로 알림이 온다.

여기서 서버가 맡는 일은 세 가지입니다.

| 할 일 | 담당 파일 |
| --- | --- |
| 계획과 일정을 저장하고 돌려준다 | `src/services/plans.ts`, `src/controllers/plans.ts`, `src/routes/plans.ts` |
| 시작 시각이 된 일정을 찾아 텔레그램으로 보낸다 | `src/services/notify.ts` |
| 알림이 연결됐는지 화면에 알려 준다 | `src/controllers/notify.ts`, `src/routes/notify.ts` |

용어는 두 개만 기억하면 됩니다.

- **계획(plan)**: "이번 주말"처럼 이름과 기간(시작일, 종료일)을 가진 묶음.
- **일정(item)**: 그 기간 안의 어느 날, 몇 시에, 무엇을 할지. 완료 여부를 가진다.

---

## 2. 폴더 구조와 요청이 흘러가는 길

```
src/
├── server.ts              ← 시작점. 라우터를 붙이고 서버를 켠다
├── routes/
│   ├── plans.ts           ← "어떤 주소가 어떤 함수로 가는가"
│   └── notify.ts
├── controllers/
│   ├── plans.ts           ← 입력을 검사하고, 서비스를 부르고, 응답을 만든다
│   └── notify.ts
└── services/
    ├── plans.ts           ← 데이터베이스(SQL)를 다룬다
    └── notify.ts          ← 텔레그램과 이야기하고, 30초마다 일정을 확인한다
```

요청 하나가 지나가는 길은 항상 같습니다.

```
브라우저                서버
   │  POST /api/plan-items  { planId: 1, date: "2026-11-14", start: "09:00", tag: "기상" }
   ▼
server.ts        app.use('/api', planRoutes)
   ▼
routes/plans.ts  router.post('/plan-items', postItem)
   ▼
controllers/plans.ts  postItem()   ← 값이 올바른지 검사. 틀리면 여기서 400으로 끝
   ▼
services/plans.ts     createItem() ← INSERT 실행
   ▼
SQLite (dev.db)
```

왜 세 층으로 나눌까요? 각 층이 **한 가지 질문**에만 답하게 하려는 것입니다.

| 층 | 답하는 질문 | 모르는 것 |
| --- | --- | --- |
| route | 이 주소는 누가 처리하지? | 검사 규칙, SQL |
| controller | 이 요청은 받아도 되는 요청인가? 뭐라고 응답하지? | SQL |
| service | 데이터를 어떻게 읽고 쓰지? | HTTP (req, res) |

서비스는 `req`, `res`를 전혀 모릅니다. 그래서 `notify.ts`처럼 HTTP 요청이 아닌 곳(30초 타이머)에서도 같은 테이블을 편하게 쓸 수 있습니다.

React에 비유하면 route는 라우터 설정, controller는 폼 검증과 이벤트 핸들러, service는 데이터 접근 함수(`api.ts`)에 가깝습니다.

### server.ts에서 볼 곳

```ts
app.use(cors());           // 다른 주소(포트 80의 화면)에서 오는 요청을 허용
app.use(express.json());   // 요청 본문 JSON을 req.body로 바꿔 준다

app.use('/api', planRoutes);   // 기간 계획 타임라인
app.use('/api', notifyRoutes); // 일정 시각 텔레그램 알림

app.listen(port, () => {
  startNotifier(); // 텔레그램 봇 토큰이 .env에 있을 때만 켜진다
});
```

`app.use('/api', planRoutes)` 때문에 라우터 안의 `/plans`는 실제로 `/api/plans`가 됩니다.

**직접 해 보기**: `routes/plans.ts`를 열어 주소 아홉 개를 세어 보고, 각각이 `controllers/plans.ts`의 어떤 함수인지 짝지어 보세요.

---

## 3. 데이터베이스: 테이블 세 개

데이터베이스는 SQLite입니다. 파일 하나(`dev.db`)가 곧 데이터베이스입니다.

### plans (계획)

| 칸 | 형식 | 설명 |
| --- | --- | --- |
| id | INTEGER, 자동 증가 | 번호 |
| name | TEXT | "이번 주말" |
| start_date | TEXT | `2026-11-14` |
| end_date | TEXT | `2026-11-15` (이 날 포함) |
| created_at | TEXT | 만든 시각 |

### plan_items (일정)

| 칸 | 형식 | 설명 |
| --- | --- | --- |
| id | INTEGER, 자동 증가 | 번호 |
| plan_id | INTEGER | 어느 계획에 속하는지 |
| date | TEXT | `2026-11-14` |
| start_time | TEXT | `09:00` |
| end_time | TEXT 또는 NULL | `13:00`. NULL이면 "9시 기상"처럼 시각 하나짜리 |
| title | TEXT | 메모. 빈 글자여도 된다 |
| tag | TEXT 또는 NULL | "등산" 같은 분류 (나중에 추가된 칸) |
| done | INTEGER | 0 또는 1 |
| notified_for | TEXT 또는 NULL | 알림을 보낸 시각 `2026-11-14 09:00` (알림 기능이 추가한 칸) |

### app_settings (설정 한 줄짜리 저장소)

| 칸 | 설명 |
| --- | --- |
| key | `telegram_chat_id` |
| value | 알림을 받을 텔레그램 대화 번호 |

### 날짜와 시각을 왜 글자로 저장할까

`2026-11-14`, `09:00`처럼 자릿수를 맞춘 글자는 **글자 순서가 곧 시간 순서**입니다.
그래서 `ORDER BY date, start_time`이 그대로 시간순 정렬이 되고, `start_time <= '09:30'` 같은 비교도 됩니다.
컨트롤러가 형식을 엄격하게 검사하는 이유가 여기에 있습니다. `9:00`이 한 건이라도 들어가면 `10:00`보다 뒤로 정렬됩니다.

### 테이블은 누가 만드나: `ensurePlanTables`

이 프로젝트는 Prisma를 쓰지만 이 기능은 Prisma 모델(`schema.prisma`)을 쓰지 않고 SQL을 직접 씁니다.
배포할 때 마이그레이션 명령을 따로 돌리지 않아도 되게 하려는 선택입니다. 서버가 처음 요청을 받을 때 스스로 테이블을 만듭니다.

```ts
let ready: Promise<void> | null = null;

export function ensurePlanTables(): Promise<void> {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS plans ( ... )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS plan_items ( ... )`);
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
```

여기에 배울 것이 세 가지 있습니다.

1. **`CREATE TABLE IF NOT EXISTS`**: 있으면 아무 일도 안 하고, 없으면 만든다. 몇 번을 실행해도 결과가 같다.
2. **`ready ??= ...`**: `ready`가 비어 있을 때만 오른쪽을 실행해 넣는다. Promise를 변수에 담아 두므로 요청 100개가 동시에 와도 테이블 만들기는 한 번만 실행되고, 모두 같은 Promise를 기다린다.
3. **칸 추가**: `CREATE TABLE IF NOT EXISTS`는 이미 있는 테이블을 고치지 못한다. 그래서 `PRAGMA table_info`로 칸 목록을 읽고, `tag`가 없을 때만 `ALTER TABLE ... ADD COLUMN`을 실행한다. 운영 서버에는 태그 기능 이전에 만든 테이블이 있었기 때문에 꼭 필요했다.

실패하면 `ready = null`로 되돌려서 다음 요청이 다시 시도합니다. 되돌리지 않으면 한 번 실패한 Promise가 영원히 남아 서버를 재시작할 때까지 모든 요청이 실패합니다.

**직접 해 보기**: `services/notify.ts`의 `ensureNotifyTables`를 열어 같은 방식으로 `notified_for` 칸을 붙이는 부분을 찾아보세요.

---

## 4. 서비스 계층: SQL을 다루는 곳

### DB 줄을 코드용 객체로 바꾸기

DB의 칸 이름은 `start_date`(뱀 표기), 코드와 JSON은 `startDate`(낙타 표기)입니다. 바꿔 주는 함수가 하나씩 있습니다.

```ts
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
```

- `Number(r.id)`: SQLite의 정수는 `BigInt`로 올 수 있는데, `BigInt`는 JSON으로 바꿀 수 없어서 숫자로 바꾼다.
- `Number(r.done) === 1`: SQLite에는 참/거짓 형식이 없어 0과 1로 저장한다. 밖으로 나갈 때 `true`/`false`로 바꾼다.

### 값이 들어가는 SQL은 반드시 태그드 템플릿으로

```ts
const rows = await prisma.$queryRaw<ItemRow[]>`
  INSERT INTO plan_items (plan_id, date, start_time, end_time, title, tag, done)
  VALUES (${i.planId}, ${i.date}, ${i.start}, ${i.end}, ${i.title}, ${i.tag}, ${i.done ? 1 : 0})
  RETURNING id, plan_id, date, start_time, end_time, title, tag, done`;
```

`` prisma.$queryRaw`...` `` 안의 `${값}`은 글자를 이어 붙이는 것이 아닙니다. Prisma가 자리 표시(`?`)로 바꾸고 값은 따로 전달합니다.
그래서 누가 제목에 `'); DROP TABLE plans; --`를 넣어도 그냥 글자로 저장됩니다. 이것이 **SQL 인젝션 방지**입니다.

반대로 `$executeRawUnsafe("...")`는 글자를 그대로 실행합니다. 이 코드에서는 사용자 입력이 전혀 없는 `CREATE TABLE` 같은 고정 문장에만 씁니다.

`RETURNING`은 방금 넣은 줄을 바로 돌려받는 문법입니다. INSERT 뒤에 SELECT를 한 번 더 하지 않아도 자동으로 붙은 `id`를 알 수 있습니다.

### 목록에 달성률 붙이기: `listPlans`

```sql
SELECT p.id, p.name, p.start_date, p.end_date,
  COUNT(i.id) AS item_count, COALESCE(SUM(i.done), 0) AS done_count
FROM plans p LEFT JOIN plan_items i ON i.plan_id = p.id
GROUP BY p.id
ORDER BY p.start_date DESC, p.id DESC
```

- `LEFT JOIN`: 일정이 하나도 없는 계획도 목록에 나와야 하므로 왼쪽(plans)을 기준으로 붙인다. 그냥 `JOIN`이면 빈 계획이 사라진다.
- `COUNT(i.id)`: 일정 수. 일정이 없으면 `i.id`가 NULL이라 0이 된다. `COUNT(*)`로 쓰면 빈 계획도 1이 되어 버린다.
- `SUM(i.done)`: done이 0 또는 1이므로 합이 곧 완료 수. 일정이 없으면 NULL이 나오므로 `COALESCE(..., 0)`으로 0으로 바꾼다.

계획마다 일정을 따로 조회하지 않고 SQL 한 번으로 끝낸다는 점이 중요합니다.

### 두 번의 삭제를 하나로: `deletePlan`

```ts
await prisma.$transaction([
  prisma.$executeRaw`DELETE FROM plan_items WHERE plan_id = ${id}`,
  prisma.$executeRaw`DELETE FROM plans WHERE id = ${id}`,
]);
```

트랜잭션은 "둘 다 되거나, 둘 다 안 되거나"를 보장합니다. 일정만 지워지고 계획이 남거나 그 반대가 되는 일이 없습니다.

### 많이 쓴 태그 순서: `listTags`

```sql
SELECT tag FROM plan_items
WHERE tag IS NOT NULL AND tag <> ''
GROUP BY tag
ORDER BY COUNT(*) DESC, MAX(id) DESC
LIMIT 30
```

태그를 위한 테이블은 따로 없습니다. 일정에 적힌 태그를 모아서 많이 쓴 순서로, 같으면 최근에 쓴 순서로 돌려줍니다. 화면은 이것을 칩으로 보여 줘서 탭 한 번으로 등록하게 합니다.

**직접 해 보기**: `countItemsOutside`가 어떤 SQL을 쓰는지 읽고, 어떤 상황을 막기 위한 함수인지 5장을 읽기 전에 추측해 보세요.

---

## 5. 컨트롤러 계층: 검사하고 응답하는 곳

### 믿을 수 있는 입력은 없다

화면에서 이미 검사했더라도 서버는 다시 검사합니다. 주소만 알면 누구나 화면 없이 요청을 보낼 수 있기 때문입니다.

```ts
function parseItemBody(body: any): Omit<plans.PlanItemInput, 'planId'> | string {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  ...
  // 제목은 비워도 된다 (시작 시각만으로 등록)
  if (title.length > 60) return 'title은 60자 이하여야 합니다.';
  if (tag != null && tag.length > 20) return 'tag는 20자 이하여야 합니다.';
  if (!validDate(date)) return 'date는 yyyy-MM-dd 형식이어야 합니다.';
  if (!TIME_RE.test(start)) return 'start는 HH:mm 형식이어야 합니다.';
  if (end != null && !TIME_RE.test(end)) return 'end는 HH:mm 형식이어야 합니다.';
  if (end != null && end <= start) return '끝 시각은 시작 시각보다 늦어야 합니다.';
  return { title, tag, date, start, end, done };
}
```

이 함수의 반환 형식 `정상 값 | string`을 눈여겨보세요. **성공하면 깨끗한 값, 실패하면 오류 문장**을 돌려줍니다. 부르는 쪽은 이렇게 씁니다.

```ts
const i = parseItemBody(req.body);
if (typeof i === 'string') return fail(res, 400, i);
// 여기부터 i는 검사를 통과한 값. TypeScript도 그렇게 알고 있다.
```

`throw`를 쓰지 않고도 흐름이 한눈에 보이고, `typeof` 검사 뒤에는 TypeScript가 형식을 자동으로 좁혀 줍니다.

### 검사 규칙 정리

| 대상 | 규칙 | 이유 |
| --- | --- | --- |
| 계획 이름 | 1~40자 | 빈 이름 방지 |
| 날짜 | `yyyy-MM-dd`이고 실제로 있는 날 | `2026-02-31` 같은 값 거르기 |
| 기간 | 끝 ≥ 시작, 최대 31일 | 날짜 탭이 끝없이 길어지는 것 방지 |
| 일정 시각 | `HH:mm` (00:00~23:59) | 글자 정렬이 시간 정렬이 되려면 형식이 같아야 함 |
| 끝 시각 | 없어도 됨. 있으면 시작보다 늦어야 함 | 시각 하나짜리 일정 허용 |
| 제목 | 없어도 됨. 60자 이하 | "시작 시각만으로 등록" 요구사항 |
| 태그 | 없어도 됨. 20자 이하 | 빈 글자는 NULL로 통일 |
| 일정 날짜 | 계획 기간 안 | 화면에 보이지 않는 일정 방지 |

`validDate`는 정규식만으로 끝내지 않습니다.

```ts
function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
```

`2026-02-31`은 정규식을 통과하지만 `Date`로 만들면 3월 3일로 넘어갑니다. 다시 글자로 바꿔 원래 값과 같은지 비교해서 걸러 냅니다.

### 상태 코드

| 코드 | 언제 |
| --- | --- |
| 200 | 조회, 수정 성공 |
| 201 | 새로 만들기 성공 |
| 204 | 삭제 성공 (돌려줄 내용 없음) |
| 400 | 보낸 값이 규칙에 맞지 않음 |
| 404 | 그 번호의 계획이나 일정이 없음 |
| 500 | 서버 안에서 예상 못 한 오류 |

오류 응답은 항상 `{ "error": "사람이 읽을 문장" }` 모양입니다. 화면은 이 문장을 그대로 스낵바에 보여 줍니다.

### 기간을 줄일 때의 안전장치: `putPlan`

```ts
const outside = await plans.countItemsOutside(id, p.startDate, p.endDate);
if (outside > 0) {
  return fail(res, 400, `바꾼 기간 밖에 일정이 ${outside}개 있습니다. 먼저 그 일정을 옮기거나 지워 주세요.`);
}
```

토~일 계획을 토요일 하루로 줄이면 일요일 일정은 DB에는 남아 있지만 화면에는 날짜 탭이 없어 볼 수도 지울 수도 없게 됩니다.
조용히 지워 버리는 대신 거절하고 이유를 알려 주는 쪽을 골랐습니다. 데이터를 지우는 결정은 사용자가 하게 합니다.

**직접 해 보기**: `putItem`은 왜 `planId`를 요청 본문에서 받지 않고 `plans.getItem(id)`로 현재 일정을 먼저 읽을까요? (힌트: 서비스의 `updateItem` 주석)

---

## 6. API 목록

기본 주소는 `http://<서버>:5050/api`입니다. 로그인은 없습니다.

| 메서드 | 주소 | 본문 | 응답 |
| --- | --- | --- | --- |
| GET | `/plans` | | 계획 배열. 각 계획에 `itemCount`, `doneCount` 포함 |
| POST | `/plans` | `{ name, startDate, endDate }` | 만든 계획 (201) |
| GET | `/plans/:id` | | 계획 + `items` 배열 |
| PUT | `/plans/:id` | `{ name, startDate, endDate }` | 고친 계획 |
| DELETE | `/plans/:id` | | 204. 일정도 함께 삭제 |
| POST | `/plan-items` | `{ planId, date, start, end?, title?, tag?, done? }` | 만든 일정 (201) |
| PUT | `/plan-items/:id` | `{ date, start, end?, title?, tag?, done? }` | 고친 일정 |
| DELETE | `/plan-items/:id` | | 204 |
| GET | `/plan-tags` | | 태그 글자 배열 (많이 쓴 순, 최대 30개) |
| GET | `/notify/status` | | 알림 상태 (7장 참고) |
| POST | `/notify/test` | | `{ ok: true }` 또는 400 + 이유 |
| POST | `/notify/disconnect` | | 끊은 뒤의 알림 상태 |

완료 체크는 전용 주소가 없습니다. `PUT /plan-items/:id`에 `done: true`를 넣어 일정 전체를 다시 보냅니다. PUT은 "이 내용으로 통째로 바꿔라"라는 뜻이라 빠진 칸은 빈 값으로 저장된다는 점에 주의하세요.

터미널에서 바로 해 볼 수 있습니다.

```bash
# 계획 만들기
curl -X POST http://localhost:5050/api/plans \
  -H 'Content-Type: application/json' \
  -d '{"name":"이번 주말","startDate":"2026-11-14","endDate":"2026-11-15"}'

# 일정 넣기 (제목 없이 태그와 시작 시각만)
curl -X POST http://localhost:5050/api/plan-items \
  -H 'Content-Type: application/json' \
  -d '{"planId":1,"date":"2026-11-14","start":"09:00","tag":"기상"}'

# 계획과 일정 보기
curl http://localhost:5050/api/plans/1
```

---

## 7. 텔레그램 알림이 동작하는 방식

코드는 전부 `src/services/notify.ts` 한 파일에 있습니다.

### 왜 텔레그램인가

웹 사이트가 브라우저 알림(웹 푸시)을 보내려면 주소가 `https`여야 합니다. 이 사이트는 `http`라서 쓸 수 없습니다.
텔레그램 봇은 서버가 텔레그램에 요청만 보내면 되므로 사이트를 열어 두지 않아도 휴대폰으로 알림이 옵니다.

### 전체 그림

서버가 켜지면 `startNotifier()`가 두 가지 일을 동시에 시작합니다.

```
startNotifier()
   ├── tick()      30초마다: "지금 시작하는 일정 있나?" → 있으면 sendMessage
   └── pollLoop()  끝없이:   "나한테 온 메시지 있나?"   → /start, /today, 완료 버튼 처리
```

```
          ┌──────────── 서버 (notify.ts) ────────────┐
          │                                          │
 30초마다 │ tick ──── SELECT 시작할 일정 ───▶ SQLite │
          │   │                                      │
          │   └── sendMessage ──────────────────────────▶ 텔레그램 ──▶ 내 휴대폰
          │                                          │
          │ pollLoop ── getUpdates(25초 대기) ◀──────────  텔레그램 ◀── /start, 버튼
          │   └── UPDATE done = 1 ─────────▶ SQLite  │
          └──────────────────────────────────────────┘
```

토큰이 없으면 둘 다 시작하지 않고 로그 한 줄만 남깁니다. 알림 설정을 안 한 환경에서도 나머지 기능은 그대로 돕니다.

### 설정값 (.env)

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | 예 | BotFather가 준 봇 토큰. 없으면 알림 기능이 꺼진다 |
| `TELEGRAM_CHAT_ID` | 아니오 | 받을 대화 번호를 고정하고 싶을 때. 없으면 `/start`를 처음 보낸 대화가 등록된다 |
| `NOTIFY_TZ` | 아니오 | 일정 시각의 시간대. 기본 `Asia/Seoul` |
| `TELEGRAM_API_BASE` | 아니오 | 테스트용 가짜 서버 주소. 기본 `https://api.telegram.org` |

**토큰은 비밀번호와 같습니다.** 토큰을 아는 사람은 누구나 그 봇으로 메시지를 보내고 읽을 수 있습니다. 그래서 다음을 지킵니다.

- 코드나 git에 넣지 않고 서버의 `.env`에만 둔다.
- 상태 API가 토큰을 절대 응답에 넣지 않는다.
- 오류 로그에 주소(`/bot<토큰>/...`)가 찍히지 않게 원인 코드만 남긴다.

### tick: 보낼 일정 찾기

```ts
const now = nowLocal();                                              // { date: '2026-11-14', time: '09:00' }
const from = nowLocal(new Date(Date.now() - LOOKBACK_MIN * 60_000)); // 5분 전
const fromTime = from.date === now.date ? from.time : '00:00';       // 자정 직후에는 오늘 것만
```

```sql
SELECT i.id, i.date, i.start_time, i.end_time, i.title, i.tag, p.name AS plan_name
FROM plan_items i JOIN plans p ON p.id = i.plan_id
WHERE i.date = ${now.date} AND i.start_time <= ${now.time} AND i.start_time >= ${fromTime}
  AND i.done = 0
  AND (i.notified_for IS NULL OR i.notified_for <> i.date || ' ' || i.start_time)
ORDER BY i.start_time, i.id
```

조건을 하나씩 읽어 봅시다.

| 조건 | 뜻 |
| --- | --- |
| `date = 오늘` | 오늘 일정만 |
| `start_time <= 지금` | 시작 시각이 됐거나 지났고 |
| `start_time >= 5분 전` | 너무 오래된 것은 제외 |
| `done = 0` | 이미 체크한 일정은 알릴 필요가 없다 |
| `notified_for`가 비었거나 지금 시각과 다름 | 아직 이 시각으로 알림을 보낸 적이 없다 |

**왜 "정확히 지금"이 아니라 5분 범위일까요?** 타이머는 정확히 30초마다 돌지 않고, 배포 때 서버가 잠깐 꺼졌다 켜지기도 합니다. `start_time = 지금`으로 비교하면 그 사이에 걸린 일정은 영영 알림이 오지 않습니다. 범위를 넉넉히 잡고, 대신 중복은 `notified_for`로 막습니다.

**왜 `notified` 참/거짓이 아니라 시각을 저장할까요?** 9시 일정을 알림 받은 뒤 10시로 고쳤다고 해 봅시다. 참/거짓이면 "이미 보냄"이라 10시에 알림이 오지 않습니다. `2026-11-14 09:00`이라는 값을 저장해 두면 고친 뒤의 `2026-11-14 10:00`과 다르므로 다시 보냅니다. 수정할 때 값을 초기화하는 코드를 따로 넣지 않아도 됩니다.

보낸 뒤에는 바로 기록합니다.

```ts
for (const r of rows) {
  const id = Number(r.id);
  await sendMessage(chatId, itemText(r, false), { reply_markup: doneButton(id) });
  await prisma.$executeRaw`
    UPDATE plan_items SET notified_for = ${`${r.date} ${r.start_time}`} WHERE id = ${id}`;
}
```

`ticking` 변수는 앞의 tick이 아직 끝나지 않았을 때(텔레그램이 느릴 때) 다음 tick이 겹쳐 돌면서 같은 일정을 두 번 보내는 것을 막습니다.

### 시간대: 서버 시계를 그대로 믿지 않는다

일정은 `09:00`처럼 시간대 없는 글자로 저장돼 있습니다. 서버가 UTC로 돌고 있으면 `new Date().getHours()`는 한국 시각보다 9시간 느린 값을 줍니다.
그래서 `Intl.DateTimeFormat`에 시간대를 지정해서 "한국의 지금"을 구합니다.

```ts
function nowLocal(at = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  ...
}
```

`hourCycle: 'h23'`은 자정을 `24`가 아닌 `00`으로 받기 위한 설정입니다.

### pollLoop: 봇이 메시지를 받는 방법 (롱 폴링)

봇이 메시지를 받는 방법은 두 가지입니다.

| 방법 | 설명 | 필요한 것 |
| --- | --- | --- |
| 웹훅 | 텔레그램이 우리 서버로 요청을 보낸다 | 공개된 `https` 주소 |
| 롱 폴링 | 우리 서버가 텔레그램에 "온 것 있나요?" 하고 묻는다 | 없음 |

이 서버는 `https` 주소가 없으므로 롱 폴링을 씁니다.

```ts
for (;;) {
  const updates = await tg<any[]>(
    'getUpdates',
    { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
    40_000,
  );
  for (const u of updates) {
    offset = Math.max(offset, Number(u.update_id) + 1);
    ...
  }
}
```

- `timeout: 25`: 온 메시지가 없으면 텔레그램이 최대 25초 동안 응답을 붙잡고 있다가, 메시지가 오는 순간 바로 돌려준다. 1초마다 묻는 것보다 요청 수는 훨씬 적고 반응은 즉시다. 이것이 "롱" 폴링이다.
- `40_000`: 우리 쪽 대기 한도. 텔레그램이 25초를 붙잡고 있으므로 그보다 길어야 한다.
- `offset`: "이 번호부터 주세요"라는 뜻. 받은 번호 + 1을 보내면 텔레그램은 그 앞의 것을 처리된 것으로 보고 다시 주지 않는다.

실패하면 5초 쉬고 다시 시도합니다. 401(토큰 틀림)이나 409(같은 봇을 다른 곳에서도 받고 있음)는 금방 풀리지 않으므로 60초를 쉽니다.

### /start: 받을 대화 등록하기

봇은 먼저 말을 걸 수 없습니다. 사용자가 봇에게 한 번 메시지를 보내야 그 대화 번호(`chat.id`)를 알 수 있습니다.

```ts
if (registered && registered !== chatId) {
  // 이미 다른 대화에 연결돼 있으면 남이 봇을 찾아도 일정을 볼 수 없다
  if (command === '/start') await sendMessage(chatId, '이 봇은 이미 다른 대화에 연결돼 있어요.');
  return;
}
if (command === '/start') {
  if (!registered) await setChatId(chatId);
  ...
}
```

처음 `/start`를 보낸 대화가 주인이 됩니다. 텔레그램 봇은 이름만 알면 누구나 말을 걸 수 있으므로, 이미 주인이 있으면 다른 사람은 거절합니다.
`setChatId`는 `INSERT ... ON CONFLICT(key) DO UPDATE`를 씁니다. 줄이 없으면 넣고 있으면 고치는 문법으로, 보통 "upsert"라고 부릅니다.

### 완료 버튼

알림 메시지에는 버튼이 하나 붙습니다.

```ts
const doneButton = (id: number) => ({
  inline_keyboard: [[{ text: '✅ 완료 체크', callback_data: `done:${id}` }]],
});
```

버튼을 누르면 텔레그램이 `callback_query`라는 업데이트에 `data: "done:12"`를 담아 보냅니다. `handleCallback`이 이것을 받아서 다음 순서로 처리합니다.

1. `done:(\d+)` 모양인지, 등록된 대화에서 온 것인지 확인한다.
2. `UPDATE plan_items SET done = 1`을 실행한다.
3. `answerCallbackQuery`로 "완료로 체크했어요." 토스트를 띄운다. 이것을 부르지 않으면 버튼이 계속 로딩 표시로 남는다.
4. `editMessageText`로 메시지를 ✅ 모양으로 바꾼다. 버튼을 다시 넣지 않으므로 버튼이 사라진다.

화면(웹)은 다음에 목록을 불러올 때 체크된 상태를 보게 됩니다.

### 메시지를 만들 때: HTML 이스케이프

메시지는 `parse_mode: 'HTML'`로 보냅니다. 굵은 글씨(`<b>`)를 쓰기 위해서입니다. 그런데 사용자가 제목에 `<3`이라고 쓰면 텔레그램이 잘못된 태그로 보고 전송을 거절합니다.

```ts
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
```

사용자가 쓴 글자가 들어가는 자리는 모두 `esc()`를 거칩니다. 웹에서 XSS를 막는 것과 같은 원리입니다.

### 상태 API: 로그 없이 진단하기

```json
{
  "configured": true,
  "connected": true,
  "botUsername": "<봇 이름>",
  "error": null,
  "lastPollOkAt": "2026-11-13T03:03:44.056Z",
  "lastError": null
}
```

| 칸 | 뜻 | 문제가 있다면 |
| --- | --- | --- |
| `configured` | 서버에 토큰이 있다 | false면 `.env`에 토큰을 넣고 재시작 |
| `connected` | 받을 대화가 등록됐다 | false면 봇에게 `/start` |
| `botUsername` | 봇 이름. 화면이 `t.me/<이름>` 링크를 만든다 | |
| `error` | 봇 정보를 못 읽은 이유 | 토큰이 틀렸을 가능성 |
| `lastPollOkAt` | 메시지 수신을 마지막으로 성공한 시각 | 비었거나 오래됐으면 `/start`를 받을 수 없는 상태 |
| `lastError` | 마지막 텔레그램 호출 실패 | 원인 코드를 보고 판단 |

**직접 해 보기**: `handleMessage`에서 `text.split(/[\s@]/)[0]`은 왜 `@`로도 자를까요? (힌트: 그룹 대화에서는 명령이 `/start@봇이름`으로 옵니다.)

---

## 8. 실제로 겪은 문제: fetch failed

이 기능을 배포한 직후 실제로 있었던 일입니다. 문제를 좁혀 가는 과정이 공부가 되므로 남겨 둡니다.

### 증상

봇에게 `/start`를 보냈는데 아무 답이 없었습니다.

### 좁혀 가기

1. 상태 API를 열었다. `configured: true`, `botUsername`이 정상으로 나왔다. 토큰은 맞고 `getMe` 호출은 성공한다는 뜻이다.
2. `connected: false`였다. `/start`가 서버에 도착하지 않았다는 뜻이다.
3. 서버 로그(`pm2 logs backend-app`)에 이 줄이 반복됐다.
   ```
   [notify] getUpdates 실패: 텔레그램 서버에 연결하지 못했습니다 (TypeError)
   ```
4. 같은 서버, 같은 토큰인데 `getMe`는 되고 `getUpdates`는 가끔 안 된다. 그렇다면 코드 논리가 아니라 **연결 단계**의 문제다.

### 원인

처음에는 Node의 `fetch`를 썼습니다. Node의 `fetch`는 IPv6 주소와 IPv4 주소를 번갈아 시도하는데, 한 번에 250ms만 기다립니다.
서버에서 텔레그램까지 연결에 그보다 오래 걸리면 양쪽 다 포기하고 `TypeError: fetch failed`를 던집니다. 오류 이름이 `TypeError`라서 원인을 알아보기 더 어려웠습니다.

### 고친 방법

`fetch` 대신 Node의 `https` 모듈을 직접 써서 세 가지를 바꿨습니다.

```ts
const agentOptions = { keepAlive: true, family: 4 as const };
const httpsAgent = new https.Agent(agentOptions);
```

| 설정 | 효과 |
| --- | --- |
| `family: 4` | IPv4만 쓴다. 번갈아 시도하다 포기하는 일이 없다 |
| `keepAlive: true` | 한 번 맺은 연결을 계속 쓴다. 매번 새로 연결하지 않으므로 실패할 기회 자체가 줄어든다 |
| `req.setTimeout(...)` | 넉넉히 기다린다 (보통 15초, getUpdates는 40초) |

그리고 다음에는 로그를 보지 않고도 알 수 있게 **진단 정보**를 더했습니다.

- 오류에 `ETIMEDOUT`, `ECONNRESET` 같은 원인 코드를 넣었다.
- 상태 API에 `lastError`와 `lastPollOkAt`을 넣었다.

배포 후 상태가 `connected: true`, `lastError: null`로 바뀌었습니다.

### 여기서 배울 것

- 내 컴퓨터에서 되는 코드가 서버에서는 안 될 수 있다. 네트워크 환경이 다르기 때문이다.
- 오류 메시지를 삼키지 말고 원인 코드를 남겨라. 단, 비밀값(토큰이 든 주소)은 빼고.
- 서버에 접속하지 않고도 상태를 볼 수 있는 주소를 하나 만들어 두면 문제를 훨씬 빨리 찾는다.

---

## 9. 설정하고 실행하기

### 내 컴퓨터에서 실행

```bash
npm install
npx prisma generate
npm run dev          # tsx watch: 파일을 고치면 자동으로 다시 시작
```

`http://localhost:5050/api/plans`를 열어 `[]`가 나오면 성공입니다. 테이블은 이때 자동으로 만들어집니다.

토큰 없이 실행하면 알림만 꺼지고 나머지는 모두 동작합니다.

### 텔레그램 봇 연결

1. 텔레그램에서 `@BotFather`에게 `/newbot`을 보내 봇을 만들고 토큰을 받는다.
2. 서버의 `.env`에 한 줄을 넣는다.
   ```
   TELEGRAM_BOT_TOKEN=<BotFather가 준 토큰>
   ```
3. 서버를 다시 시작한다. 운영 서버라면 `pm2 restart backend-app --update-env`. `--update-env`가 없으면 pm2가 예전 환경 변수를 그대로 쓴다.
4. `t.me/<봇 이름>` 링크로 봇 대화를 열고 `/start`를 보낸다. 새로 만든 봇은 검색에 바로 안 나올 수 있어서 링크로 들어가는 편이 확실하다.
5. 화면의 종 아이콘에서 "테스트 보내기"를 누르거나 `POST /api/notify/test`를 호출한다.

### 배포

`main`에 머지되면 GitHub Actions(`.github/workflows/deploy.yml`)가 빌드해서 서버로 복사하고 pm2로 다시 시작합니다. 마지막에 `curl http://localhost:5050/api/plans`로 응답을 확인하므로, 테이블 만들기가 실패하면 배포가 실패로 표시됩니다.

### 텔레그램 없이 알림 코드 시험하기

`TELEGRAM_API_BASE`에 내가 만든 가짜 서버 주소를 넣으면 진짜 텔레그램 없이 시험할 수 있습니다.
가짜 서버는 `/bot<토큰>/getMe`, `getUpdates`, `sendMessage` 주소에 `{ ok: true, result: ... }`를 돌려주기만 하면 됩니다.
외부 서비스 주소를 환경 변수로 바꿀 수 있게 해 두는 것은 테스트하기 좋은 코드를 만드는 흔한 방법입니다.

---

## 10. 연습 문제

쉬운 것부터 순서대로입니다. 고친 뒤에는 `curl`로 확인해 보세요.

1. **읽기**: 일정 제목 길이 제한을 60자에서 100자로 바꾸려면 어느 파일의 어느 줄을 고쳐야 할까요? 화면 쪽도 고쳐야 할까요?
2. **읽기**: `GET /api/plans/999`처럼 없는 번호를 요청하면 어떤 상태 코드와 본문이 올까요? 코드를 따라가서 답한 뒤 실제로 호출해 확인하세요.
3. **고치기**: `GET /api/plans/:id/summary`를 추가해서 `{ itemCount, doneCount }`만 돌려주게 해 보세요. route, controller, service 세 곳을 모두 고쳐야 합니다.
4. **고치기**: 텔레그램에 `/tomorrow` 명령을 추가해 내일 일정을 보여 주세요. `todayText`를 날짜를 받는 함수로 바꾸면 됩니다.
5. **생각하기**: 지금은 시작 시각에 알림이 옵니다. "10분 전에 미리 알림"을 만들려면 `tick`의 SQL과 `notified_for`를 어떻게 바꿔야 할까요? 시작 시각 알림과 미리 알림을 둘 다 보내려면 칸이 하나로 충분할까요?
6. **생각하기**: 이 API에는 로그인이 없어서 주소를 아는 사람은 누구나 일정을 읽고 고칠 수 있습니다. 혼자 쓰는 서비스에서 가장 간단하게 막는 방법은 무엇일까요?

---

## 관련 PR

| PR | 내용 |
| --- | --- |
| #5 | 계획·일정 테이블과 API |
| #6 | 제목 필수 해제, 태그 칸과 `/plan-tags` |
| #7 | 텔레그램 알림 (`notify.ts`), 상태·테스트·연결 끊기 API |
| #8 | 텔레그램 연결을 IPv4 고정 `https`로 교체, 진단 정보 추가 |
