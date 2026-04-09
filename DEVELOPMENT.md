# AI Code Reviewer - 개발 및 트러블슈팅 일지 (DEVELOPMENT.md)

## 1. 프로젝트 초기 구성 개요
- **목표**: 사용자가 입력한 코드에 대해 Gemini API 기반의 스마트한 코드 리뷰를 제공하고, 해당 리뷰 히스토리를 데이터베이스에 영구 저장하는 풀스택 웹 애플리케이션 구축.
- **백엔드 스택**: Node.js, Express, TypeScript, Prisma ORM, SQLite
- **프론트엔드 스택**: React, Vite, TypeScript

## 2. 주요 구현 내역 (시니어 아키텍트 관점 적용)
백엔드 연동 과정에서 단순히 기능만 구현하는 것을 넘어, 운영 효율성 및 비용 최적화(Cost-Optimization)를 위한 세 가지 핵심 로직을 탑재했습니다.

1. **DB 기반 캐싱 로직 (Cache Hit 방어)**
   - 동일한 소스코드를 반복적으로 서버에 요청할 경우, Gemini API를 호출하지 않고 기존 데이터베이스(`dev.db`)에 저장된 이전 리뷰를 즉시 불러옵니다. 불필요한 API 토큰 소진을 100% 방지합니다.
2. **개발용 모의(Mock) 모드**
   - `.env` 파일에 `USE_MOCK_AI=true`를 설정하면 외부 네트워크(AI API)를 타지 않고 더미 텍스트를 즉각 반환합니다. 이를 통해 프론트엔드 UI/UX 작업 시 비용 발생을 차단했습니다.
3. **지수 백오프(Exponential Backoff) 기반 장애 조치**
   - 초과 트래픽(`429 Too Many Requests`)이나 서버 지연(`503 Service Unavailable`) 등 Gemini API에 일시적 장애가 발생할 경우를 대비하여 3회 재시도 및 하위 AI 모델 Fallback 로직을 설계했습니다.

---

## 3. 핵심 트러블슈팅: Prisma 7.x 초기화 및 SQLite 연결 에러

개발 진행 중 Prisma ORM과 DB(SQLite)를 최초로 연결하는 과정에서 치명적인 런타임 오류들을 겪었으며 여러 단계를 거쳐 해결했습니다.

### 🔴 문제 상황 (Errors)
1. **`PrismaClientConstructorValidationError: Unknown property...`**
   - 백엔드 실행 시 `PrismaClient` 생성자가 `datasourceUrl` 또는 `datasources` 프로퍼티를 완전히 거부하며 발생한 에러입니다.
2. **`URL_INVALID: The URL 'undefined' is not in a valid format`**
   - 어댑터를 강제로 주입해도 `findMany()` 나 `findFirst()` 같은 실제 데이터베이스 호출 시점에 쿼리 엔진 내부에서 **연결 주소가 undefined로 평가되면서 런타임이 폭발하는 문제**였습니다.

### 🔍 원인 분석 (Root Causes)
- 최신 버전인 **Prisma 7.7.0** 릴리즈에 도입된 파격적인 엔진 구조 개편 때문이었습니다. 
- Vercel이나 Edge 런타임을 지원하기 위해 `engineType="library"`(기존 네이티브 엔진) 대신 무조건 "Driver Adapter 패러다임" (`engineType="client"`)을 강제하려는 프레임워크의 과도기적 버그 및 스펙이 문제였습니다.
- 이로 인해 로컬의 `dev.db`를 가리키는 `DATABASE_URL`을 `.env`에서 불러와 JS 드라이버에 넘겨줘도, 내부 WASM/Rust 바이너리는 설정값을 상실하고 `undefined`를 참조해 쿼리를 실행하려다 죽어버리게 된 것입니다.

### ✅ 해결 방법 (Solution)
실험적인 버전 위에서 편법 코드를 양산하기보다는, 시스템 아키텍처의 견고함을 위해 의도적인 다운그레이드 전략을 선택했습니다.

1. **Prisma 생태계 안정화 버전(v6.x)으로 롤백**
   - `prisma` 및 `@prisma/client` 버전을 7점대에서 가장 검증된 `^6.0.0` 안정화 버전으로 재설치했습니다.
2. **불필요한 Driver Adapter 제거**
   - `@prisma/adapter-libsql` 패키지 의존을 걷어내고, 복잡한 초기화 로직 대신 `const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });` 하나로 직관적인 연결을 복구했습니다.
3. **스키마 복구 및 테이블 동기화 (DB Push)**
   - `schema.prisma`에 `url = env("DATABASE_URL")`을 정상적으로 추가했습니다.
   - `npx prisma db push` 커맨드를 실행하여 물리적으로 존재하지 않던 `Review` 테이블 스키마를 SQLite 파일 안에 정확하게 생성했습니다.

그 결과 현재 HTTP 요청(`curl http://localhost:5050/api/reviews`)에 대해 에러 없이 완벽하게 데이터를 반환하는 상태가 되었습니다.
