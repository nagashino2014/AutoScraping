# 스케줄러 아키텍처 개선 가이드

## 목차
1. [현재 구조의 문제점](#현재-구조의-문제점)
2. [단기적 개선 (적용됨)](#단기적-개선-적용됨)
3. [중장기 개선: 마이크로서비스 아키텍처](#중장기-개선-마이크로서비스-아키텍처)
4. [Docker 환경 구성](#docker-환경-구성)
5. [모니터링 및 장애 대응](#모니터링-및-장애-대응)

---

## 현재 구조의 문제점

### 단일 프로세스 구조

```
┌─────────────────────────────────────────────────────────┐
│              Next.js 서버 (단일 Node.js 프로세스)          │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐    │
│  │node-cron │──▶│   API    │──▶│  스크래핑 실행    │    │
│  │ 스케줄러  │   │  핸들러  │   │  (Playwright 등) │    │
│  └──────────┘   └──────────┘   └──────────────────┘    │
│       │              │               │                 │
│       └──────────────┴───────────────┘                 │
│              모두 같은 이벤트 루프 공유                    │
│                                                         │
│  ⚠️ 문제:                                               │
│  - 스크래핑 중 스케줄러 차단                              │
│  - CPU 집약적 작업이 이벤트 루프 블로킹                    │
│  - 프로세스 크래시 시 전체 시스템 다운                     │
└─────────────────────────────────────────────────────────┘
```

### 주요 문제점

1. **이벤트 루프 차단**: node-cron은 setInterval 기반으로 동작하며, 무거운 작업이 이벤트 루프를 차단하면 스케줄러가 제 시간에 실행되지 못함
2. **리소스 경쟁**: 스크래핑과 스케줄러가 같은 CPU/메모리를 공유
3. **단일 장애점**: 프로세스가 죽으면 모든 기능이 중단
4. **스케일링 불가**: 트래픽/작업량 증가 시 수평 확장 불가

---

## 단기적 개선 (적용됨)

### 적용된 개선 사항

```typescript
// 1. 타임아웃 설정
const SCHEDULE_TIMEOUT_MS = 30 * 60 * 1000; // 30분

// 2. 최소 실행 간격
const MIN_SCHEDULE_INTERVAL_MS = 10 * 1000; // 10초

// 3. 재시도 로직
const MAX_RETRY_COUNT = 2;
const RETRY_DELAY_MS = 30 * 1000; // 30초

// 4. setImmediate로 이벤트 루프 양보
setImmediate(() => processQueue());
```

### 효과

- 무한 대기 방지 (타임아웃)
- 일시적 오류 복구 (재시도)
- 연속 트리거 방지 (최소 간격)
- 이벤트 루프 차단 감소 (setImmediate)

### 한계

- 근본적인 구조 문제는 해결되지 않음
- 70개 이상 보드 동시 스크래핑 시 여전히 문제 발생 가능

---

## 중장기 개선: 마이크로서비스 아키텍처

### 권장 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Docker Compose / Kubernetes                   │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │   Web App    │   │  Scheduler   │   │      Workers         │    │
│  │  (Next.js)   │   │   Service    │   │   (N개 인스턴스)      │    │
│  │              │   │              │   │                      │    │
│  │ • UI 렌더링   │   │ • Cron 관리  │   │ • 스크래핑 실행      │    │
│  │ • API 서버   │   │ • 작업 발행  │   │ • 텍스트 추출        │    │
│  │ • 사용자 인증 │   │ • 상태 모니터│   │ • 첨부파일 다운로드   │    │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬───────────┘    │
│         │                  │                      │                 │
│         │                  ▼                      │                 │
│         │          ┌──────────────┐               │                 │
│         │          │    Redis     │               │                 │
│         └─────────▶│ Message Queue│◀──────────────┘                 │
│                    │    + Cache   │                                  │
│                    └──────────────┘                                  │
│                           │                                          │
│                    ┌──────┴──────┐                                   │
│                    │  PostgreSQL │                                   │
│                    │  (선택사항)  │                                   │
│                    └─────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 구성 요소

| 서비스 | 역할 | 기술 스택 |
|:------|:-----|:---------|
| **Web App** | UI, API, 사용자 상호작용 | Next.js |
| **Scheduler** | Cron 관리, 작업 큐 발행 | Node.js + BullMQ |
| **Workers** | 스크래핑, 텍스트 추출 실행 | Node.js 또는 Python |
| **Redis** | 메시지 큐, 캐시, 상태 저장 | Redis 7.x |
| **PostgreSQL** | 영구 데이터 저장 (선택) | PostgreSQL 15.x |

### 장점

1. **격리**: 각 서비스가 독립적으로 실행, 한 서비스 장애가 전체에 영향 없음
2. **스케일링**: 워커 인스턴스 수를 동적으로 조절 가능
3. **안정성**: 스케줄러가 별도 프로세스로 항상 동작
4. **모니터링**: 각 서비스별 상태 추적 용이

---

## Docker 환경 구성

### docker-compose.yml

```yaml
version: '3.8'

services:
  # ===========================================
  # Web Application (Next.js)
  # ===========================================
  web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - SCHEDULER_ENABLED=false  # 웹 서버에서는 스케줄러 비활성화
    depends_on:
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '1'

  # ===========================================
  # Scheduler Service (별도 프로세스)
  # ===========================================
  scheduler:
    build:
      context: ./scheduler
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - WEB_API_URL=http://web:3000
    depends_on:
      - redis
      - web
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 60s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'

  # ===========================================
  # Worker Service (스크래핑 실행)
  # ===========================================
  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - CONCURRENCY=2  # 동시 처리 작업 수
    depends_on:
      - redis
    restart: unless-stopped
    volumes:
      - scraping_data:/app/data
    deploy:
      replicas: 2  # 워커 인스턴스 수 (부하에 따라 조절)
      resources:
        limits:
          memory: 2G
          cpus: '2'

  # ===========================================
  # Redis (메시지 큐 + 캐시)
  # ===========================================
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ===========================================
  # Backend API (Python - 텍스트 추출)
  # ===========================================
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - REDIS_URL=redis://redis:6379
    volumes:
      - extracted_data:/app/data
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'

volumes:
  redis_data:
  scraping_data:
  extracted_data:

networks:
  default:
    driver: bridge
```

### Scheduler Service 구현 예시

```typescript
// scheduler/src/index.ts
import { Queue } from 'bullmq';
import cron from 'node-cron';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);
const scrapingQueue = new Queue('scraping', { connection: redis });

// 스케줄 정의 로드
async function loadSchedules() {
  const response = await fetch(`${process.env.WEB_API_URL}/api/scraper/schedules`);
  return response.json();
}

// 스케줄 등록
async function registerSchedules() {
  const schedules = await loadSchedules();
  
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    
    cron.schedule(schedule.cron, async () => {
      console.log(`[Scheduler] 트리거: ${schedule.name}`);
      
      // 작업을 큐에 추가 (워커가 처리)
      await scrapingQueue.add('scrape', {
        scheduleId: schedule.schedule_id,
        targets: schedule.targets,
        triggeredAt: new Date().toISOString(),
      }, {
        attempts: 3,  // 재시도 횟수
        backoff: {
          type: 'exponential',
          delay: 30000,  // 30초부터 시작
        },
        timeout: 30 * 60 * 1000,  // 30분 타임아웃
      });
    }, {
      timezone: schedule.timezone || 'Asia/Seoul',
    });
    
    console.log(`[Scheduler] 등록: ${schedule.name} (${schedule.cron})`);
  }
}

// 헬스체크
setInterval(async () => {
  const queueStats = await scrapingQueue.getJobCounts();
  console.log(`[Scheduler] 큐 상태:`, queueStats);
}, 60000);

// 시작
registerSchedules();
console.log('[Scheduler] 서비스 시작됨');
```

### Worker Service 구현 예시

```typescript
// worker/src/index.ts
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);
const concurrency = parseInt(process.env.CONCURRENCY || '2');

const worker = new Worker('scraping', async (job: Job) => {
  const { scheduleId, targets } = job.data;
  
  console.log(`[Worker] 작업 시작: ${scheduleId}`);
  
  for (const boardId of targets) {
    // 진행률 업데이트
    await job.updateProgress(targets.indexOf(boardId) / targets.length * 100);
    
    // 스크래핑 실행
    const response = await fetch(
      `${process.env.WEB_API_URL}/api/scraper/execute/instant/stream?board_id=${boardId}&mode=auto`
    );
    
    // 결과 처리
    // ...
  }
  
  return { success: true, processedBoards: targets.length };
  
}, { 
  connection: redis,
  concurrency,
  limiter: {
    max: 5,  // 분당 최대 5개 작업
    duration: 60000,
  },
});

// 이벤트 핸들러
worker.on('completed', (job) => {
  console.log(`[Worker] ✓ 완료: ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] ✗ 실패: ${job?.id}`, err.message);
});

worker.on('error', (err) => {
  console.error('[Worker] 오류:', err);
});

console.log(`[Worker] 서비스 시작됨 (동시성: ${concurrency})`);
```

---

## 모니터링 및 장애 대응

### 모니터링 대시보드 (Bull Board)

```typescript
// web/pages/api/admin/queues.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';

const scrapingQueue = new Queue('scraping');

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullMQAdapter(scrapingQueue)],
  serverAdapter,
});
```

### 장애 대응 체크리스트

| 증상 | 원인 | 대응 |
|:----|:----|:----|
| 스케줄 실행 안됨 | Scheduler 서비스 다운 | `docker-compose restart scheduler` |
| 작업 큐에 쌓임 | Worker 부족/다운 | Worker replicas 증가 |
| 메모리 부족 | 대용량 파일 처리 | Worker 메모리 limit 증가 |
| Redis 연결 실패 | Redis 서비스 다운 | Redis 헬스체크 확인, 재시작 |
| 타임아웃 발생 | 네트워크 지연/사이트 응답 느림 | 타임아웃 값 조정 |

### 알림 설정

```yaml
# docker-compose.override.yml (모니터링 추가)
services:
  alertmanager:
    image: prom/alertmanager
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml
    ports:
      - "9093:9093"
```

---

## 마이그레이션 순서

### Phase 1: Redis 도입 (1주)
1. Redis 컨테이너 추가
2. 스케줄 상태를 Redis에 저장
3. 기존 JSON 파일 방식과 병행 운영

### Phase 2: 스케줄러 분리 (1주)
1. Scheduler 서비스 구현
2. BullMQ 큐 도입
3. 기존 node-cron 로직 마이그레이션

### Phase 3: 워커 분리 (1주)
1. Worker 서비스 구현
2. 스크래핑 로직 워커로 이전
3. Web App에서 스크래핑 직접 실행 제거

### Phase 4: 안정화 (1주)
1. 모니터링 대시보드 구축
2. 알림 설정
3. 부하 테스트 및 튜닝

---

## 참고 자료

- [BullMQ 공식 문서](https://docs.bullmq.io/)
- [Docker Compose 모범 사례](https://docs.docker.com/compose/best-practices/)
- [Node.js 이벤트 루프 이해](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/)
