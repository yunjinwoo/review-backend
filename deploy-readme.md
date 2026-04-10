# Backend CI/CD 배포 파이프라인 (deploy.yml) 수정 내역 및 아키텍처 가이드

이 문서에서는 기존 배포 파이프라인(`deploy.yml`)에서 발생했던 치명적인 오류들의 원인을 분석하고, 이를 어떻게 고성능·저비용 구조로 최적화했는지에 대한 상세 내역을 기록합니다.

## 🚨 1. 발생했던 주요 이슈 및 원인 분석

### 이슈 A: `cd: review-backend: No such file or directory` 에러
* **원인**: GitHub Actions의 `checkout` 동작 방식을 오해하여 발생했습니다. GitHub 저장소(`yunjinwoo/review-backend`) 구조상, 프로젝트 코드가 최상단(Root)에 존재합니다. 따라서 GitHub 런닝 서버 입장에서는 하위 `review-backend` 폴더가 존재하지 않는데 해당 폴더로 진입(`cd`)하려 했기 때문에 발생한 경로 에러였습니다.

### 이슈 B: `1719721 Killed` (OOM, Out Of Memory) 현상
* **원인**: iwinv 클라우드 VPS와 같이 저사양(RAM 1~2GB) 환경에서 무거운 Node 생태계 명령어(`npm install`, `npx prisma generate`)를 직접 실행했기 때문에 발생했습니다. 리눅스 서버의 실물 RAM 한계를 초과하여, 서버를 보호하기 위해 리눅스 커널의 OOM(Out Of Memory) 킬러가 해당 npm 프로세스를 강제 종료(Killed)시킨 현상입니다.

---

## 🛠️ 2. 하이브리드 파이프라인 구조 (Build Offloading + Fast Install)

무거운 `node_modules`(특히 Prisma와 Google SDK, 100MB 이상)를 SCP로 직접 해상 전송할 때 발생하는 극심한 병목 현상을 방지하기 위해 **"하이브리드(Hybrid) 배포 전략"**으로 전면 개편했습니다.

### [Step 1~2] 코드 체크아웃 및 Node.js 세팅
* GitHub Actions 서버(Ubuntu)에 코드를 다운로드하고 Node 24 버전을 설치합니다.

### [Step 3] 깃허브 서버에서 코드 빌드만 전담
* GitHub의 고사양 서버(RAM 7GB 이상)에서 `npm install`과 `npm run build`를 통해 Typescript 코드를 Javascript(`dist/`)로 초고속 컴파일합니다.

### [Step 4] 파일 최소화 및 초고속 SCP 전송 (병목 제거)
* 무거운 `node_modules` 전체를 서버로 전송하지 않습니다. (`appleboy/scp-action`이 수천 개의 모듈 파일을 다시 tar로 감싸면서 발생하는 수십 분의 지연 현상을 원천 차단)
* **오직 실행에 필수적인 기초 파일(`dist`, `package.json`, `package-lock.json`, `prisma`)만 전송**하므로 전송 속도가 1~2초 이내로 극단적으로 단축됩니다.

### [Step 5] 서버에서 `npm ci` 초경량 설치 및 PM2 가동
* 내 서버에 SSH로 접속한 뒤, `npm install` 대신 마법의 명령어 **`npm ci --omit=dev`**를 실행합니다.
* **`npm ci`의 강력함**: 족보를 재계산(Tree Resolution)하지 않고 `package-lock.json`에 적힌 그대로 NPM 글로벌 초고속 CDN에서 펀칭하듯 꽂아 넣기 때문에 **서버 RAM을 획기적으로 적게 쓰며 OOM(Killed) 현상 없이 초고속으로 설치**됩니다.
* 서버 환경에 딱 맞는 Prisma 바이너리 엔진을 가볍게 생성(`npx prisma generate`)한 직후 애플리케이션을 PM2 백그라운드로 즉각 실행(`pm2 start`)합니다.

---

## 💡 3. 시니어 아키텍트의 관점 및 조언 (안정성 강화)

단순히 배포를 성공시키는 것을 넘어, 실서비스 관점에서의 장기적인 고가용성(High Availability) 및 안정성을 위한 제안입니다.

1. **리눅스 Swap Memory(가상 메모리) 설정 강력 권장**
   * 현재 `npm ci` 방식으로 RAM 소모를 우회하였으나, 실 서비스 중 사용자 트래픽이 몰리면 Node 앱 자체가 OOM으로 뻗을 수 있습니다.
   * iwinv 서버 설정에서 최소 2GB 규모의 Swap 파티션(디스크 일부를 램처럼 쓰는 기술)을 할당하여 애플리케이션의 런타임 셧다운 위험을 방어해야 합니다.

2. **`package-lock.json` 불변성 원칙 유지**
   * 새로 적용된 초경량 배포 파이프라인의 핵심은 `npm ci` 명령어이며, 이는 전적으로 `package-lock.json` 파일에 의존합니다.
   * 로컬에서 작업 시 해당 파일이 삭제되거나 훼손된 채로 GitHub에 업로드되면 서버 배포가 즉각 실패합니다. 따라서 개발 중 패키지 버전 관리 시 `.lock` 파일을 반드시 안전하게 커밋해야 합니다.

3. **PM2 클러스터 기반 무중단 릴리즈 (Zero-Downtime Deployment)**
   * 현재의 스크립트(`pm2 delete` 후 `pm2 start`)는 배포되는 순간마다 잠깐의 서버 다운(Downtime)이 생깁니다.
   * 추후 기능이 고도화되면 `pm2 reload` 명령어를 통해 사용자의 연결을 끊지 않으면서(무중단) 새 버전을 교체하는 우아한 배포(Graceful Reload) 방식으로 마이그레이션이 필요합니다.

4. **OS 인프라 환경 종속성 경고 및 도커(Docker) 전환 고려**
   * 서비스가 성장할 경우, 어느 OS 환경(AWS, GCP 등)에서나 격리된 형태로 완벽히 동일하게 동작하며 GitHub Actions의 모듈 캐싱 시스템을 100% 활용할 수 있는 **Docker 컨테이너라이제이션(Containerization)** 방식 배포로 전환하는 것을 목표로 설계하시기 바랍니다.
