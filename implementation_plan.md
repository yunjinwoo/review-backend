# 코드 리뷰어(Code Reviewer) 앱 초기 뼈대 및 구조 제안

본 프로젝트는 AI(Gemini API)를 활용하여 코드를 분석해 주고 리뷰 결과를 반환하는 '코드 리뷰어' 앱입니다. 20년 차 시니어 아키텍트 관점에서 확장성, 유지보수성, 보안성을 고려한 초기 뼈대를 다음과 같이 제안합니다.

## User Review Required

> [!IMPORTANT]
> 기본적으로 백엔드와 프론트엔드를 분리(Decoupled) 구조로 구성할 예정입니다. Next.js를 사용하여 프론트와 API를 통합(BFF 패턴)할지, 아니면 프론트(React/Vite)와 백엔드(Node.js/Express) 리포지토리 폴더를 분리할지 결정이 필요합니다. 아래는 분리 구조를 기준으로 작성된 계획입니다.

## 제안하는 기술 스택 및 디렉토리 구조

*   **프론트엔드(`frontend/`)**: React 18, TypeScript, Vite, Tailwind CSS (또는 기본 CSS 모듈)
*   **백엔드(`backend/`)**: Node.js, Express, TypeScript, `@google/genai` (Gemini SDK)

```text
my-app1/
├── frontend/             # 클라이언트 앱 (React + Vite)
│   ├── src/
│   │   ├── components/   # 재사용 가능한 UI 컴포넌트
│   │   ├── services/     # 백엔드 API 통신 로직 (추상화)
│   │   ├── App.tsx       # 메인 진입점
│   │   └── index.css     # 글로벌 스타일
│   └── package.json
└── backend/              # 서버 API (Node.js + Express)
    ├── src/
    │   ├── controllers/  # 비즈니스 로직 및 API 엔드포인트
    │   ├── services/     # Gemini API 통신 처리 및 프롬프트 관리
    │   ├── routes/       # 라우터 설정
    │   └── server.ts     # 진입점
    └── package.json
```

## 단계별 구축 계획

### 1단계: 백엔드 기본 설정
1. Node.js 프로젝트 초기화 및 TypeScript, Express 설정
2. CORS 및 환경 변수(dotenv) 설정
3. `@google/genai` 라이브러리 설치 및 초기 프롬프트(시스템 인스트럭션) 연동 API 작성

### 2단계: 프론트엔드 기본 설정
1. Vite를 이용한 React + TypeScript 프로젝트 생성
2. Tailwind CSS (또는 최신 디자인 시스템 가이드에 따른 스타일링) 설정
3. 코드를 입력받는 텍스트 에어리어(TextArea) 화면 및 결과 출력 UI 기본 뼈대 구성

### 3단계: 통합 및 뼈대 코드 작성
1. 백엔드 `POST /api/review` 엔드포인트 작성
2. 프론트엔드 백엔드 호출 로직 (Fetch/Axios) 작성

## Open Questions

> [!WARNING]
> * Gemini API 키(API_KEY) 발급이 필요합니다. 이후 `.env`에 설정하여 환경변수로 안전하게 처리할 예정입니다.
> * 프론트엔드에서 코드를 입력할 때 단순 텍스트 입력창을 원하시나요, 아니면 Monaco Editor와 같은 코드 에디터 컴포넌트 연동을 원하시나요? 초기 뼈대에는 단순 텍스트 창을 제공하고 추후 고도화하는 것을 추천합니다.

설계 내용이 마음에 드신다면 **"이대로 진행해줘"** 또는 원하시는 아키텍처(예: Next.js로 통합) 방향을 말씀해주시면, 즉시 관련 라이브러리 설치 및 뼈대 코드 생성 명령어들을 실행하겠습니다.
