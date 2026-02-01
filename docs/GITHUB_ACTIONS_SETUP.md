# GitHub Actions 스크래핑 설정 가이드

이 문서는 GitHub Actions를 사용한 클라우드 스크래핑 시스템 설정 방법을 설명합니다.

## 목차

1. [개요](#개요)
2. [사전 요구사항](#사전-요구사항)
3. [GitHub 저장소 설정](#github-저장소-설정)
4. [Personal Access Token 생성](#personal-access-token-생성)
5. [환경 변수 설정](#환경-변수-설정)
6. [로컬 동기화 설정](#로컬-동기화-설정)
7. [사용 방법](#사용-방법)
8. [문제 해결](#문제-해결)

---

## 개요

### 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions (클라우드)                  │
│  ┌─────────┐    ┌─────────────┐    ┌──────────────────┐    │
│  │  Cron   │ -> │  스크래핑   │ -> │  Artifact 저장    │    │
│  │ 트리거  │    │    실행     │    │   (7일 보관)     │    │
│  └─────────┘    └─────────────┘    └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (하루 1회 동기화)
┌─────────────────────────────────────────────────────────────┐
│                      로컬 PC                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  동기화     │ -> │   파일 저장   │ -> │   Next.js UI  │  │
│  │  스크립트   │    │  (로컬 폴더)  │    │  (조회/관리)  │  │
│  └─────────────┘    └──────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 장점

- **리소스 문제 해결**: 클라우드에서 스크래핑 실행으로 로컬 PC 부담 없음
- **안정성**: GitHub 인프라 사용으로 안정적인 실행
- **무료**: 월 2,000분 무료 (프라이빗 레포), 퍼블릭 레포는 무제한
- **독립성**: 로컬 PC가 꺼져 있어도 스크래핑 실행

---

## 사전 요구사항

- GitHub 계정
- Node.js 20 이상
- Git 설치
- (선택) Windows 작업 스케줄러 (자동 동기화용)

---

## GitHub 저장소 설정

### 1. 저장소 생성 또는 기존 저장소 사용

이미 이 프로젝트가 GitHub에 푸시되어 있다면 다음 단계로 넘어가세요.

새 저장소를 만드는 경우:

```bash
# 프로젝트 디렉토리에서
cd "C:\CodingProject\Web Scraper Final"

# Git 초기화 (이미 되어 있다면 생략)
git init

# 원격 저장소 추가
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# 푸시
git add .
git commit -m "Initial commit"
git push -u origin main
```

### 2. Actions 활성화 확인

1. GitHub 저장소 페이지로 이동
2. **Settings** > **Actions** > **General**
3. "Allow all actions and reusable workflows" 선택 확인

---

## Personal Access Token 생성

GitHub API를 통해 Artifact를 다운로드하려면 Personal Access Token(PAT)이 필요합니다.

### 1. GitHub 설정으로 이동

1. GitHub 우측 상단 프로필 클릭
2. **Settings** 클릭
3. 좌측 메뉴 하단 **Developer settings** 클릭

### 2. Token 생성

1. **Personal access tokens** > **Tokens (classic)** 클릭
2. **Generate new token** > **Generate new token (classic)** 클릭
3. 설정:
   - **Note**: `Web Scraper Sync` (원하는 이름)
   - **Expiration**: 원하는 기간 선택 (권장: 90 days 또는 No expiration)
   - **Select scopes**:
     - [x] `repo` (전체)
     - [x] `workflow`
4. **Generate token** 클릭
5. **토큰 복사** (한 번만 표시됨!)

> ⚠️ 토큰은 다시 볼 수 없으므로 안전한 곳에 저장하세요.

---

## 환경 변수 설정

### `.env.local` 파일 설정

`frontend/.env.local` 파일에 다음 환경 변수를 추가합니다:

```bash
# GitHub 설정 (동기화 스크립트용)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_REPO=your-username/your-repository-name
```

예시:
```bash
GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz
GITHUB_REPO=myname/web-scraper-final
```

### 설정 확인

```bash
cd frontend
npx ts-node scripts/sync-from-github.ts --dry-run
```

정상적으로 설정되었다면 Artifact 목록이 표시됩니다.

---

## 로컬 동기화 설정

### 수동 동기화

```bash
cd frontend

# 최근 24시간 내 결과 동기화
npm run sync

# 최근 48시간 내 결과 동기화
npx ts-node scripts/sync-from-github.ts --hours=48

# 목록만 확인 (다운로드 안 함)
npx ts-node scripts/sync-from-github.ts --dry-run
```

### 자동 동기화 설정 (Windows)

PowerShell을 관리자 권한으로 실행:

```powershell
cd "C:\CodingProject\Web Scraper Final\frontend\scripts"

# 기본 설정 (매일 오전 10시)
powershell -ExecutionPolicy Bypass -File setup-sync-task.ps1

# 시간 변경 (매일 오후 3시)
powershell -ExecutionPolicy Bypass -File setup-sync-task.ps1 -Hour 15 -Minute 00

# 설정 후 즉시 실행
powershell -ExecutionPolicy Bypass -File setup-sync-task.ps1 -RunNow

# 작업 제거
powershell -ExecutionPolicy Bypass -File setup-sync-task.ps1 -Remove
```

### 작업 스케줄러 확인

1. **Win + R** > `taskschd.msc` 입력
2. 작업 스케줄러 라이브러리에서 `WebScraper-GitHub-Sync` 확인

---

## 사용 방법

### GitHub Actions 수동 실행

1. GitHub 저장소 > **Actions** 탭
2. **Scheduled Scraping** 워크플로우 선택
3. **Run workflow** 클릭
4. 옵션 설정:
   - `board_ids`: 스크래핑할 보드 (예: `mcee_board1,kepco_board1`)
   - `max_pages`: 최대 페이지 수
   - `download_attachments`: 첨부파일 다운로드 여부
5. **Run workflow** 버튼 클릭

### 워크플로우 결과 확인

1. **Actions** 탭에서 실행 중인 워크플로우 클릭
2. 로그 및 결과 확인
3. 완료 후 **Artifacts** 섹션에서 결과 다운로드 가능

### 로컬에서 CLI 스크래퍼 직접 실행 (테스트용)

```bash
cd frontend

# 단일 보드 스크래핑
npm run scrape -- --board=mcee_board1

# 여러 보드 스크래핑
npm run scrape -- --boards=mcee_board1,kepco_board1

# 첨부파일 없이
npm run scrape -- --board=mcee_board1 --no-attachments
```

---

## 문제 해결

### GitHub Actions 관련

#### "Resource not accessible by integration" 오류

- **원인**: 토큰 권한 부족
- **해결**: PAT에 `repo` 권한 확인, 또는 저장소 Settings > Actions > General에서 권한 확인

#### 스케줄이 실행되지 않음

- **원인**: 저장소가 60일 이상 비활성 상태
- **해결**: 저장소에 커밋 또는 Actions 탭 방문

#### Playwright 설치 실패

- **원인**: GitHub Actions 캐시 문제
- **해결**: 워크플로우 파일에서 캐시 키 변경 또는 수동으로 Re-run

### 동기화 관련

#### "GITHUB_TOKEN 환경 변수가 설정되지 않았습니다"

- **해결**: `frontend/.env.local` 파일 확인

#### Artifact 목록이 비어있음

- **원인**: 아직 스크래핑이 실행되지 않음 또는 Artifact 만료 (7일)
- **해결**: 수동으로 워크플로우 실행

#### 다운로드 실패

- **원인**: 네트워크 문제 또는 토큰 만료
- **해결**: 네트워크 확인, 토큰 재생성

### 일반

#### ts-node 오류

```bash
# ts-node 설치
cd frontend
npm install

# 또는 직접 설치
npm install -D ts-node
```

#### 권한 오류 (Windows)

- PowerShell을 관리자 권한으로 실행
- 또는 실행 정책 확인: `Get-ExecutionPolicy`

---

## 스케줄 설정

### 현재 설정된 스케줄 (KST 기준)

| 시간 | 보드 | 설명 |
|------|------|------|
| 06:50 | law_board1 | 국가법령정보센터 |
| 07:05 | moleg_board1 | 국민참여입법센터 |
| 07:30 | keiti_board1 | 한국환경산업기술원 |
| 07:45 | nier_board1 | 국립환경과학원 |
| 08:05 | gir_board1 | 온실가스종합정보센터 |
| 08:30 | gir_board2 | 온실가스 통계 |
| 09:00 | motie_board2 | 산업통상자원부 |
| 13:00 | keco_board1 | 한국환경공단 |
| 15:50 | motie_board1 | 산업통상자원부 보도자료 |
| 20:55 | kepco_board1 | 한국전력공사 |
| 22:22 | mcee_board1 | 기후에너지환경부 |

### 월요일 전용

| 시간 | 보드 | 설명 |
|------|------|------|
| 07:00 | mcee_board2,3,4 | 기후에너지환경부 공지/기후정책 |
| 09:00 | mcee_board5 | 기후에너지환경부 한강보도 |

### 스케줄 수정

`.github/workflows/scheduled-scrape.yml` 파일의 `determine-boards` 작업에서 시간대별 보드 매핑을 수정하세요.

---

## 무료 한도 관리

GitHub Actions 무료 한도:
- **프라이빗 저장소**: 월 2,000분
- **퍼블릭 저장소**: 무제한

### 사용량 확인

GitHub > Settings > Billing and plans > Plans and usage

### 한도 초과 방지

1. 일부 스케줄을 격일로 변경
2. 저장소를 퍼블릭으로 전환 (민감 정보 제거 필요)
3. 첨부파일 다운로드 비활성화로 실행 시간 단축

---

## 기존 로컬 스케줄러와의 공존

GitHub Actions로 전환한 후에도 기존 로컬 스케줄러를 유지할 수 있습니다:

1. **테스트 용도**: 즉시 실행 기능으로 설정 확인
2. **백업**: GitHub Actions 장애 시 대체 실행
3. **개발**: 새 보드 추가 시 테스트

로컬 스케줄러를 비활성화하려면:
- `frontend/data/scraper-schedules.json`에서 `enabled: false` 설정
- 또는 `instrumentation.ts`에서 스케줄러 초기화 코드 주석 처리
