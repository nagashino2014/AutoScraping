# chunkingEmbeddingSetting.md - 청킹 및 임베딩 메뉴 UI/기능 설계서

> **문서 개요**: 본 문서는 EcoMonitor AI 플랫폼의 "추출 및 벡터화 > 청킹 및 임베딩" 메뉴에 대한 종합 설계서이다.
> 청킹 전략, 임베딩 모델, 표 데이터 메타데이터 기반 청킹 전략, UI 구현 현황을 정의한다.
>
> **분리 문서**: 텍스트 추출 관련 설계는 `textExtractingSetting.md` 참조

---

## 목차

1. [개요](#1-개요)
2. [UI 구현 현황](#2-ui-구현-현황)
3. [청킹 전략](#3-청킹-전략)
4. [표 데이터 메타데이터 기반 청킹](#4-표-데이터-메타데이터-기반-청킹)
5. [임베딩 모델](#5-임베딩-모델)
6. [API 구현 현황](#6-api-구현-현황)
7. [데이터 저장 구조](#7-데이터-저장-구조)
8. [벡터화 설계](#8-벡터화-설계)
9. [검색 시 표 재조합](#9-검색-시-표-재조합)
10. [LLM 분석 시 표 인식 최적화](#10-llm-분석-시-표-인식-최적화)
11. [검토 사항](#11-검토-사항)

---

## 1. 개요

### 1.1 목적

텍스트 추출 단계에서 생성된 텍스트와 구조화된 표 데이터를 청킹하고, 임베딩을 생성하여
벡터 데이터베이스에 저장하는 파이프라인을 관리하는 화면이다.

### 1.2 메뉴 구조

```
추출 및 벡터화 (/processing)
├── 텍스트 추출 (/processing/extract)      ← textExtractingSetting.md 참조
├── 청킹 및 임베딩 (/processing/chunking)  ← 본 문서 주요 대상 ✅ 구현 완료
└── 벡터화 (/processing/vectorize)         ← 미구현
```

### 1.3 입력 데이터 형식 (v2.0)

텍스트 추출 단계에서 생성된 JSON 파일을 입력으로 받습니다:

```json
{
  "metadata": { ... },
  "content": "추출된 텍스트 본문...",
  "extracted_text": "마크다운 형식 텍스트...",
  "structured_tables": [
    {
      "table_index": 0,
      "page_num": 1,
      "semantic_text": "표 1: 배출허용기준\n...",
      "structured_data": { "headers": [...], "rows": [...] },
      "extraction_method": "line_detection",
      "confidence": 0.92
    }
  ]
}
```

---

## 2. UI 구현 현황

> **구현 파일**: `frontend/app/(app)/processing/chunking/page.tsx`

### 2.1 화면 레이아웃

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        청킹 및 임베딩 (/processing/chunking)                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────┐  ┌───────────────────────────────┐ │
│  │         청킹/임베딩 현황 (70%)            │  │      빠른 작업 (30%)          │ │
│  │  ┌─────────────────┬─────────────────┐  │  │                               │ │
│  │  │ 청킹 현황       │ 임베딩 현황     │  │  │  [청킹 실행]  h=70px          │ │
│  │  │ 🍩 진행률      │ 🍩 진행률      │  │  │  [임베딩 생성] h=70px          │ │
│  │  │ 🍩 성공률      │ 🍩 성공률      │  │  │  [결과 내보내기] h=70px        │ │
│  │  │ KPI 4개        │ KPI 4개        │  │  │                               │ │
│  │  └─────────────────┴─────────────────┘  │  └───────────────────────────────┘ │
│  └─────────────────────────────────────────┘                                    │
│                                                                                 │
│  ┌────────────────────────────────────────┐  ┌────────────────────────────────┐ │
│  │         청킹 설정 (50%)                 │  │      임베딩 설정 (50%)         │ │
│  │  청킹 전략: [RecursiveCharacter ▼] (?) │  │  임베딩 모델: [모델 선택 ▼] (?)│ │
│  │  청크 크기: [━━━●━━━] 800 (?)          │  │  배치 크기: [━━━●━━━] 100 (?) │ │
│  │  오버랩: [━━━●━━━] 150 (?)             │  │                                │ │
│  │  ☑ 표 데이터 자동 감지                 │  │                                │ │
│  │    최대 행 수: [━━━●━━━] 10 (max 60)  │  │                                │ │
│  └────────────────────────────────────────┘  └────────────────────────────────┘ │
│                                                                                 │
│  ┌───────────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │      대상 문서 선택 (50%)          │  │      선택된 문서 (50%)             │  │
│  │  🔽 기관명                         │  │  ┌───┬─────────┬──────┬────────┐ │  │
│  │    🔽 보드명                       │  │  │ # │ 파일명  │ 크기 │ 청크수 │ │  │
│  │      ☑ 2026-01 (5개, 1.2MB)       │  │  ├───┼─────────┼──────┼────────┤ │  │
│  │      ☐ 2026-02 (3개, 0.8MB)       │  │  │ 1 │ doc1.json │ 45KB │ 12개  │ │  │
│  │                                   │  │  │ 2 │ doc2.json │ 32KB │ 8개   │ │  │
│  │  선택: 5개 / 1.2MB / ~2분         │  │  └───┴─────────┴──────┴────────┘ │  │
│  └───────────────────────────────────┘  └───────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 카드별 구현 상세

#### 2.2.1 청킹/임베딩 현황 카드

| 항목               | 구현 상태 | 설명                                       |
| ------------------ | :-------: | ------------------------------------------ |
| 청킹 진행률 도넛   |    ✅     | 청킹 완료 문서 / 전체 문서                 |
| 청킹 성공률 도넛   |    ✅     | 성공 문서 / 시도 문서                      |
| 임베딩 진행률 도넛 |    ✅     | 임베딩 완료 청크 / 전체 청크               |
| 임베딩 성공률 도넛 |    ✅     | 성공 청크 / 시도 청크                      |
| 청킹 KPI           |    ✅     | 텍스트 청크, 표 청크, 총 토큰, 실패 문서   |
| 임베딩 KPI         |    ✅     | 현재 배치, 완료 청크, 실패 청크, 예상 비용 |

**디자인 특징:**

- 서브카드에 3D 테두리 효과: `shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8),0_1px_3px_0_rgba(0,0,0,0.05)]`
- 도넛 차트 크기: `w-28 h-28` (직경 112px)

#### 2.2.2 빠른 작업 카드

| 버튼          | 구현 상태 | 기능                             |
| ------------- | :-------: | -------------------------------- |
| 청킹 실행     |    ✅     | 선택 문서 청킹 시작              |
| 임베딩 생성   |    ✅     | API 키 입력 모달 → OpenAI 임베딩 |
| 결과 내보내기 |    ⏳     | JSON/CSV 내보내기 (미구현)       |

**버튼 스타일:**

- 고정 높이: `h-[70px]`
- 글래스모피즘 효과 적용

#### 2.2.3 청킹 설정 카드

| 설정                | 구현 상태 | 범위/옵션                                              |
| ------------------- | :-------: | ------------------------------------------------------ |
| 청킹 전략           |    ✅     | RecursiveCharacter, Sentence, Semantic, MarkdownHeader |
| 청크 크기           |    ✅     | 200~2000 토큰 (기본 800)                               |
| 오버랩              |    ✅     | 0~500 토큰 (기본 150)                                  |
| 표 데이터 자동 감지 |    ✅     | 토글 on/off                                            |
| 최대 행 수          |    ✅     | 5~60행 (기본 10)                                       |

**도움말 버튼 (?):**

- 청킹 전략별 특징 설명
- 청크 크기 大/小 설정 차이
- 오버랩 설정 가이드

#### 2.2.4 임베딩 설정 카드

| 설정        | 구현 상태 | 옵션                                                    |
| ----------- | :-------: | ------------------------------------------------------- |
| 임베딩 모델 |    ✅     | OpenAI (small/large), HuggingFace (ko-sroberta, bge-m3) |
| 배치 크기   |    ✅     | 10~500 (기본 100)                                       |

**모델별 정보:**

| 모델                        | 차원 |   비용   | 특징        |
| --------------------------- | :--: | :------: | ----------- |
| text-embedding-3-small      | 1536 | $0.02/1M | 빠르고 저렴 |
| text-embedding-3-large      | 3072 | $0.13/1M | 고품질      |
| jhgan/ko-sroberta-multitask | 768  |   무료   | 한국어 특화 |
| BAAI/bge-m3                 | 1024 |   무료   | 다국어 지원 |

#### 2.2.5 대상 문서 선택 카드

| 기능          | 구현 상태 | 설명                               |
| ------------- | :-------: | ---------------------------------- |
| 계층적 트리뷰 |    ✅     | 기관 > 보드 > 연도-월              |
| 체크박스      |    ✅     | 모든 노드에 체크박스 (글라스 효과) |
| 계층 선택     |    ✅     | 상위 노드 체크 시 하위 자동 선택   |
| 통계 표시     |    ✅     | 파일 수, 용량, 예상 처리 시간      |
| 아이콘        |    ✅     | 보드 타입별 아이콘 (Megaphone 등)  |

**트리뷰 데이터 소스:**

- `scraper-targets.json`에서 기관/보드 목록 로드
- `ExtractedData/{기관}/{보드}/{연도-월}/` 폴더 스캔하여 파일 통계

#### 2.2.6 선택된 문서 테이블

| 컬럼    | 구현 상태 | 설명                               |
| ------- | :-------: | ---------------------------------- |
| #       |    ✅     | 순번                               |
| 파일명  |    ✅     | 원본 파일명                        |
| 크기    |    ✅     | 파일 용량                          |
| 청크 수 |    ✅     | 생성된 청크 수 (청킹 후)           |
| 상태    |    ✅     | pending/chunking/chunked/completed |

### 2.3 API 키 입력 모달

```
┌─────────────────────────────────────────────┐
│           OpenAI API 키 입력                │
├─────────────────────────────────────────────┤
│                                             │
│  선택된 청크: 156개                         │
│  예상 비용: $0.0032 (text-embedding-3-small)│
│                                             │
│  API 키: [sk-xxxxx...              ]       │
│                                             │
│      [취소]              [임베딩 시작]      │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 3. 청킹 전략

### 3.1 청킹 전략 유형

| 전략                   | 설명                | 권장 사용처  | 구현 상태 |
| :--------------------- | :------------------ | :----------- | :-------: |
| **RecursiveCharacter** | 의미 단위 유지 분할 | 일반 문서    |    ✅     |
| **Sentence**           | 문장 단위 분할      | 짧은 문서    |    ✅     |
| **Semantic**           | 의미 유사도 기반    | 긴 문서      |    ⏳     |
| **MarkdownHeader**     | 헤더 기반 분할      | 구조화 문서  |    ✅     |
| **TableAware**         | 표 구조 인식 분할   | 표 포함 문서 |    ✅     |

### 3.2 청킹 설정 타입 (구현됨)

```typescript
// frontend/lib/chunking/chunking-store.ts

export type ChunkingStrategy =
  | "recursive"
  | "sentence"
  | "semantic"
  | "markdown";

export interface ChunkingSettings {
  strategy: ChunkingStrategy;
  chunkSize: number; // 기본 800 토큰
  chunkOverlap: number; // 기본 150 토큰
  separators: string[]; // ["\n\n", "\n", ". ", " "]
  minChunkSize: number; // 최소 100
  maxChunkSize: number; // 최대 2000
  tableChunking: {
    enabled: boolean; // 표 인식 활성화
    maxRowsPerChunk: number; // 청크당 최대 행 수 (기본 10, 최대 60)
  };
}
```

---

## 4. 표 데이터 메타데이터 기반 청킹

> **목적**: 마크다운/JSON 표 추출 결과를 벡터화할 때 표 구조를 보존하고, LLM 분석 시 표 데이터로서 정확하게 인식되도록 메타데이터 기반 라벨링 및 청킹 로직을 적용합니다.

### 4.1 표 청킹 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    표 데이터 메타데이터 기반 청킹 파이프라인                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                           1. 입력 단계                                    │  │
│   │   ExtractedData/{기관}/{보드}/{연도-월}/*.json                            │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                         │                                       │
│                                         ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        2. 표 감지 및 분리                                  │  │
│   │   structured_tables 배열에서 표 데이터 추출                               │  │
│   │   content에서 일반 텍스트 영역 분리                                       │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                         │                                       │
│                    ┌────────────────────┴────────────────────┐                 │
│                    ▼                                         ▼                 │
│   ┌────────────────────────────────┐    ┌────────────────────────────────┐    │
│   │       3A. 일반 텍스트 청킹       │    │       3B. 표 데이터 청킹        │    │
│   │   기존 RecursiveCharacter 전략  │    │   표 전용 메타데이터 라벨링      │    │
│   │   - chunk_size: 800            │    │   - 표 크기에 따른 분할          │    │
│   │   - chunk_overlap: 150         │    │   - 구조 정보 메타데이터 부여     │    │
│   └────────────────────────────────┘    └────────────────────────────────┘    │
│                    │                                         │                 │
│                    └────────────────────┬────────────────────┘                 │
│                                         ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                      4. 청크 파일 저장 (분리 구조)                          │  │
│   │   chunk/{기관명}/{보드명}/{연도월}/{기관명}_{보드명}_{연도월}_chunks.json   │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                         │                                       │
│                                         ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                      5. 임베딩 생성 (OpenAI API)                          │  │
│   │   content + embedding + metadata → 벡터 DB 저장                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 청크 메타데이터 스키마 (구현됨)

```typescript
// frontend/lib/chunking/chunking-store.ts

export type ChunkType = "text" | "table_full" | "table_segment";

export interface ChunkMetadata {
  chunk_type: ChunkType;
  chunk_index: number;
  total_chunks: number;

  // 표 관련 메타데이터
  table_id?: string;
  table_title?: string;
  total_rows?: number;
  total_cols?: number;
  headers?: string[];
  row_start?: number;
  row_end?: number;
  is_first_chunk?: boolean;
  is_last_chunk?: boolean;

  // 문서 메타데이터
  doc_id: string;
  org_id: string;
  org_name: string;
  board_id: string;
  board_name: string;
  date_folder: string;
  source_file: string;
  published_date?: string;
}

export interface Chunk {
  chunk_id: string;
  content: string;
  raw_content: string;
  token_count: number;
  metadata: ChunkMetadata;
  embedding?: number[];
  embedding_model?: string;
  created_at: string;
}
```

### 4.3 표 크기에 따른 청킹 전략

| 표 크기  |  행 수  | 청킹 전략 | 설명                         |
| :------- | :-----: | :-------- | :--------------------------- |
| **소형** | ≤ 10행  | 단일 청크 | 표 전체를 하나의 청크로 저장 |
| **중형** | 11-30행 | 2-3 청크  | 5-10행 단위로 분할           |
| **대형** |  31행+  | N 청크    | 10행 단위로 분할 (최대 60행) |

---

## 5. 임베딩 모델

### 5.1 임베딩 모델 비교 (구현됨)

| 모델                          | 제공자      | 차원 | 한국어 성능 | 비용/1M토큰 | 구현 상태 |
| :---------------------------- | :---------- | :--: | :---------: | :---------: | :-------: |
| `text-embedding-3-small`      | OpenAI      | 1536 |    양호     |    $0.02    |    ✅     |
| `text-embedding-3-large`      | OpenAI      | 3072 |    우수     |    $0.13    |    ✅     |
| `jhgan/ko-sroberta-multitask` | HuggingFace | 768  |    우수     |    무료     |    ⏳     |
| `BAAI/bge-m3`                 | HuggingFace | 1024 |    우수     |    무료     |    ⏳     |

### 5.2 임베딩 설정 타입 (구현됨)

```typescript
// frontend/lib/chunking/embedding.ts

export type EmbeddingModel =
  | "text-embedding-3-small"
  | "text-embedding-3-large"
  | "jhgan/ko-sroberta-multitask"
  | "BAAI/bge-m3";

export interface EmbeddingSettings {
  model: EmbeddingModel;
  batchSize: number; // 기본 100
  concurrent: number; // 동시 요청 수 (기본 3)
  retryAttempts: number; // 재시도 횟수 (기본 3)
  retryDelay: number; // 재시도 대기 (ms)
}

// 모델별 설정
export const MODEL_CONFIG = {
  "text-embedding-3-small": {
    dimension: 1536,
    maxTokens: 8191,
    costPer1MTokens: 0.02,
  },
  "text-embedding-3-large": {
    dimension: 3072,
    maxTokens: 8191,
    costPer1MTokens: 0.13,
  },
  // ...
};
```

---

## 6. API 구현 현황

### 6.1 청킹 API

| 엔드포인트                           | 메서드 | 기능           | 구현 상태 |
| ------------------------------------ | :----: | -------------- | :-------: |
| `/api/processing/chunking/settings`  |  GET   | 청킹 설정 조회 |    ✅     |
| `/api/processing/chunking/settings`  |  PUT   | 청킹 설정 저장 |    ✅     |
| `/api/processing/chunking/documents` |  GET   | 문서 트리 조회 |    ✅     |
| `/api/processing/chunking/execute`   |  POST  | 청킹 실행      |    ✅     |
| `/api/processing/chunking/chunks`    |  GET   | 청크 조회      |    ✅     |

### 6.2 임베딩 API

| 엔드포인트                           | 메서드 | 기능                 | 구현 상태 |
| ------------------------------------ | :----: | -------------------- | :-------: |
| `/api/processing/embedding/settings` |  GET   | 임베딩 설정 조회     |    ✅     |
| `/api/processing/embedding/settings` |  PUT   | 임베딩 설정 저장     |    ✅     |
| `/api/processing/embedding/execute`  |  POST  | 임베딩 생성 (OpenAI) |    ✅     |
| `/api/processing/embedding/execute`  |  GET   | 임베딩 상태 조회     |    ✅     |

### 6.3 청킹 실행 API 요청/응답

```typescript
// POST /api/processing/chunking/execute

// Request
interface ExecuteRequest {
  doc_ids?: string[]; // 특정 문서 ID 목록
  org_id?: string; // 기관 ID (해당 기관 전체)
  board_id?: string; // 보드 ID (해당 보드 전체)
  rechunk?: boolean; // 기존 청크 삭제 후 재청킹
}

// Response
interface ExecuteResult {
  success: boolean;
  processed: number;
  failed: number;
  results: {
    doc_id: string;
    success: boolean;
    chunks?: number;
    tokens?: number;
    error?: string;
  }[];
}
```

### 6.4 임베딩 실행 API 요청/응답

```typescript
// POST /api/processing/embedding/execute

// Request
interface EmbeddingExecuteRequest {
  apiKey: string; // OpenAI API 키
  chunkIds?: string[]; // 특정 청크 ID (선택)
  docIds?: string[]; // 특정 문서 ID (선택)
  settings?: Partial<EmbeddingSettings>; // 설정 오버라이드
}

// Response
interface EmbeddingExecuteResponse {
  success: boolean;
  total_chunks: number;
  embedded_chunks: number;
  skipped_chunks: number; // 이미 임베딩된 청크
  failed_chunks: number;
  total_tokens: number;
  estimated_cost: number;
  error?: string;
}
```

---

## 7. 데이터 저장 구조

### 7.1 폴더 구조 (구현됨)

```
C:\CodingProject\Web Scraper Final\frontend\
│
├── data/
│   ├── chunking-index.json       ← 문서 인덱스 (메타데이터만)
│   ├── embedding-settings.json   ← 임베딩 설정
│   └── embedding-data.json       ← 임베딩 결과/통계
│
├── chunk/                         ← 청크 데이터 (분리 저장)
│   ├── 기후에너지환경부/
│   │   └── 보도·설명/
│   │       ├── 2026-01/
│   │       │   └── 기후에너지환경부_보도·설명_2026-01_chunks.json
│   │       └── 2026-02/
│   │           └── 기후에너지환경부_보도·설명_2026-02_chunks.json
│   │
│   └── 산업통상자원부/
│       └── 공지·공고/
│           └── 2026-01/
│               └── 산업통상자원부_공지·공고_2026-01_chunks.json
│
└── save/
    └── ExtractedData/             ← 입력 데이터 (텍스트 추출 결과)
        ├── 기후에너지환경부/
        │   └── 보도·설명/
        │       └── 2026-01/
        │           └── doc1.json
        └── ...
```

### 7.2 파일 형식

#### chunking-index.json

```json
{
  "settings": {
    "strategy": "recursive",
    "chunkSize": 800,
    "chunkOverlap": 150,
    "separators": ["\n\n", "\n", ". ", " "],
    "minChunkSize": 100,
    "maxChunkSize": 2000,
    "tableChunking": {
      "enabled": true,
      "maxRowsPerChunk": 10
    }
  },
  "documents": [
    {
      "doc_id": "기관_보드_2026-01_doc1",
      "org_name": "기후에너지환경부",
      "board_name": "보도·설명",
      "date_folder": "2026-01",
      "source_file": "doc1.json",
      "file_path": "...",
      "chunk_file_path": "...",
      "status": "chunked",
      "total_chunks": 12,
      "text_chunks": 10,
      "table_chunks": 2,
      "total_tokens": 4500,
      "embedded_chunks": 0,
      "created_at": "2026-01-27T10:00:00Z",
      "updated_at": "2026-01-27T10:05:00Z"
    }
  ],
  "lastUpdated": "2026-01-27T10:05:00Z"
}
```

#### {기관}_{보드}_{연도월}\_chunks.json

```json
{
  "org_name": "기후에너지환경부",
  "board_name": "보도·설명",
  "date_folder": "2026-01",
  "chunks": [
    {
      "chunk_id": "doc1_text_000",
      "content": "청크 내용...",
      "raw_content": "원본 마크다운...",
      "token_count": 450,
      "metadata": {
        "chunk_type": "text",
        "chunk_index": 0,
        "total_chunks": 12,
        "doc_id": "기관_보드_2026-01_doc1",
        "org_name": "기후에너지환경부",
        "board_name": "보도·설명",
        "date_folder": "2026-01",
        "source_file": "doc1.json"
      },
      "embedding": [0.012, -0.034, ...],
      "embedding_model": "text-embedding-3-small",
      "created_at": "2026-01-27T10:05:00Z"
    }
  ],
  "created_at": "2026-01-27T10:05:00Z",
  "updated_at": "2026-01-27T10:10:00Z"
}
```

### 7.3 분리 저장의 장점

| 항목            | 설명                                      |
| --------------- | ----------------------------------------- |
| **메모리 효율** | 전체 로드 없이 필요한 폴더만 로드         |
| **일관성**      | ScrapingData, ExtractedData와 동일한 구조 |
| **확장성**      | 대용량 데이터에서도 성능 유지             |
| **유지보수**    | 특정 폴더의 청크만 삭제/재생성 용이       |
| **직관성**      | 파일명으로 소속 폴더 즉시 파악            |

---

## 8. 벡터화 설계

> `/processing/vectorize` 메뉴 설계 (미구현)

### 8.1 벡터 DB 옵션

| DB           | 유형       | 특징                    | 권장 사용처        |
| :----------- | :--------- | :---------------------- | :----------------- |
| **ChromaDB** | 로컬       | 설치 간편, 개발용       | 프로토타입, 소규모 |
| **Pinecone** | 클라우드   | 확장성, 운영용          | 프로덕션, 대규모   |
| **Weaviate** | 하이브리드 | 다목적, 하이브리드 검색 | 복합 검색 필요     |
| **Milvus**   | 오픈소스   | 대규모, 고성능          | 자체 인프라 운영   |

### 8.2 필수 메타데이터

```typescript
export type VectorMetadata = {
  // === 문서 식별 ===
  doc_id: string;
  chunk_id: string;

  // === 출처 정보 ===
  org_id: string;
  org_name: string;
  board_id: string;
  board_name: string;
  date_folder: string;
  source: string;
  doc_type: string;
  file_path: string;

  // === 시간 정보 ===
  published_date: string;
  extracted_at: string;

  // === 청크 정보 ===
  chunk_index: number;
  total_chunks: number;
  chunk_type: "text" | "table_segment" | "table_full";

  // === 표 전용 메타데이터 ===
  table_id?: string;
  table_title?: string;
  headers?: string[];
  total_rows?: number;
  total_cols?: number;
  row_start?: number;
  row_end?: number;
  is_first_chunk?: boolean;
  is_last_chunk?: boolean;
};
```

---

## 9. 검색 시 표 재조합

### 9.1 표 재조합 로직

```python
class TableReconstructor:
    """
    검색 결과에서 분할된 표 청크를 원본 표로 재조합

    사용 시점: RAG 파이프라인의 검색(Retrieval) 후,
    LLM에 컨텍스트 전달 전 단계
    """

    def reconstruct_tables(self, retrieved_chunks: List[Dict]) -> Dict[str, str]:
        """
        검색된 청크에서 표 데이터 감지 시 전체 표 재조합

        1단계: table_id로 표 청크 그룹화
        2단계: 누락된 청크 벡터DB에서 보완 조회
        3단계: chunk_index로 정렬 후 마크다운 병합

        Returns:
            Dict[str, str]: {table_id: 재조합된_마크다운_테이블}
        """
        # ... 구현 ...
```

---

## 10. LLM 분석 시 표 인식 최적화

### 10.1 프롬프트 엔지니어링

```python
def build_table_aware_prompt(query: str, context: str) -> str:
    return f"""당신은 환경/에너지 분야 문서 분석 전문가입니다.

## 참고 자료

아래 문서에는 마크다운 테이블이 포함되어 있습니다.
테이블은 | 문자로 구분된 열과 --- 구분선으로 구성됩니다.

{context}

## 질문
{query}

## 답변 지침
1. 표 데이터를 참조할 때는 정확한 값을 인용하세요.
2. 해당 값이 어느 행/열에 있는지 명시하세요.
3. 여러 표가 있는 경우 표 번호를 명시하세요.
4. 표에 없는 정보는 "해당 정보가 표에 없습니다"라고 답하세요.
5. 숫자 값은 단위와 함께 정확히 기재하세요.

답변:"""
```

### 10.2 LLM의 마크다운 표 인식 능력

| 모델                     | 표 구조 인식 | 셀 값 참조 | 행/열 계산 | 권장 용도      |
| :----------------------- | :----------: | :--------: | :--------: | :------------- |
| **GPT-4/4o**             |     우수     |    우수    |    가능    | 복잡한 표 분석 |
| **GPT-4o-mini**          |     양호     |    양호    |   제한적   | 단순 표 조회   |
| **Claude 3 Opus/Sonnet** |     우수     |    우수    |    가능    | 표 기반 추론   |
| **Gemini Pro**           |     양호     |    양호    |    가능    | 일반 표 분석   |

---

## 11. 검토 사항

### 11.1 구현 완료 항목 ✅

1. **청킹 UI/기능**
   - 청킹 설정 패널 (전략, 크기, 오버랩, 표 설정)
   - 대상 문서 트리뷰 (계층적 선택)
   - 청킹 실행 및 결과 저장
   - 분리 저장 구조 (기관-보드-연도월)

2. **임베딩 UI/기능**
   - 임베딩 설정 패널 (모델, 배치 크기)
   - OpenAI API 연동
   - API 키 입력 모달
   - 진행률/상태 표시

3. **통계/현황**
   - 청킹 진행률/성공률 도넛 차트
   - 임베딩 진행률/성공률 도넛 차트
   - KPI 메트릭스

### 11.2 미구현 항목 ⏳

1. **HuggingFace 로컬 임베딩**
   - jhgan/ko-sroberta-multitask
   - BAAI/bge-m3

2. **벡터화 메뉴**
   - 벡터 DB 연동 (ChromaDB, Pinecone 등)
   - 벡터 검색 테스트

3. **결과 내보내기**
   - JSON/CSV 내보내기 기능

### 11.3 필요 패키지

```bash
# 프론트엔드 (이미 설치됨)
npm install lucide-react

# 백엔드 (필요 시)
pip install openai
pip install sentence-transformers  # HuggingFace 로컬 임베딩 시
pip install chromadb               # 벡터 DB
```

---

## 전체 파이프라인 흐름 요약

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        표 데이터 RAG 파이프라인 전체 흐름                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [인덱싱 단계] ✅ 구현 완료                                                       │
│                                                                                 │
│   ExtractedData/*.json (텍스트 추출 결과)                                        │
│       │                                                                         │
│       ▼                                                                         │
│   표 감지 & 분리  ────▶  메타데이터 라벨링  ────▶  청크 분할                      │
│       │                                                                         │
│       ▼                                                                         │
│   chunk/{기관}/{보드}/{연도월}/*_chunks.json 저장                                │
│       │                                                                         │
│       ▼                                                                         │
│   OpenAI 임베딩 생성  ────▶  청크 파일에 embedding 필드 추가                      │
│                                                                                 │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  [벡터화 단계] ⏳ 미구현                                                          │
│                                                                                 │
│   임베딩된 청크  ────▶  벡터 DB 저장 (ChromaDB/Pinecone)                          │
│                                                                                 │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  [검색 단계] ⏳ 미구현                                                            │
│                                                                                 │
│   사용자 질문                                                                    │
│       │                                                                         │
│       ▼                                                                         │
│   쿼리 임베딩  ────▶  벡터 유사도 검색  ────▶  표 재조합  ────▶  LLM 응답        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 변경 이력

| 날짜       | 버전 | 변경 내용                                                                   |
| :--------- | :--- | :-------------------------------------------------------------------------- |
| 2026-01-20 | 1.0  | 초안 작성 (extractEmbeddingSetting.md에서 분리)                             |
| 2026-01-21 | 1.1  | 표 데이터 메타데이터 기반 청킹 블루프린트 추가                              |
| 2026-01-27 | 2.0  | **파일 분할**: `extractEmbeddingSetting.md` → `chunkingEmbeddingSetting.md` |
| 2026-01-27 | 2.0  | **JSON 입력 형식 대응**: structured_tables 배열 처리 로직 추가              |
| 2026-01-27 | 2.0  | **TableAwareChunker 업데이트**: semantic_text, structured_data 직접 활용    |
| 2026-01-28 | 3.0  | **UI 구현 완료**: 청킹/임베딩 현황, 설정, 트리뷰, 테이블 등                 |
| 2026-01-28 | 3.0  | **API 구현 완료**: 청킹/임베딩 설정, 실행, 조회 API                         |
| 2026-01-28 | 3.0  | **분리 저장 구조**: `chunk/{기관}/{보드}/{연도월}/*_chunks.json`            |
| 2026-01-28 | 3.0  | **OpenAI 임베딩 연동**: API 키 입력 모달, 배치 처리, 에러 핸들링            |

---

> **참조 문서**
>
> - `WebScraperRAG.md` - 프로젝트 전체 설계
> - `textExtractingSetting.md` - 텍스트 추출 설계
> - `DESIGN.md` - UI/UX 디자인 가이드
