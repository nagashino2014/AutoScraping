/**
 * RAG 설정 타입 정의 및 스토어
 * 
 * 6개 카테고리:
 * 1. LLM 모델 설정
 * 2. 벡터 검색 설정
 * 3. 이슈 발굴 설정
 * 4. 심층 분석 설정
 * 5. 프롬프트 설정
 * 6. 시스템 설정
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// 타입 정의
// ============================================================

// LLM 제공업체
export type LLMProvider = "openai" | "anthropic" | "google";

// LLM 모델 목록
export type OpenAIModel = "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro";
export type AnthropicModel = "claude-haiku-4.5" | "claude-sonnet-4.5" | "claude-opus-4.5";
export type GoogleModel = "gemini-3-flash" | "gemini-3-pro";
export type LLMModel = OpenAIModel | AnthropicModel | GoogleModel;

// 검색 유형
export type SearchType = "similarity" | "mmr" | "hybrid";

// 클러스터링 알고리즘
export type ClusteringAlgorithm = "kmeans" | "hdbscan" | "bertopic";

// 분석 깊이
export type AnalysisDepth = "quick" | "standard" | "thorough";

// 출력 형식
export type OutputFormat = "structured" | "narrative" | "bullet";

// ============================================================
// 카테고리 1: LLM 모델 설정
// ============================================================
export interface LLMSettings {
  // API 키 (암호화 저장 권장)
  apiKeys: {
    openai: string;
    anthropic: string;
    google: string;
  };
  // 용도별 모델 선택
  models: {
    discovery: LLMModel;      // 이슈 발굴용
    analysis: LLMModel;       // 심층 분석용
    report: LLMModel;         // 보고서 생성용
  };
  // 모델 파라미터
  parameters: {
    temperature: number;       // 0.0 ~ 1.0, 기본 0.2
    maxTokens: number;         // 기본 4096
    topP: number;              // 0.0 ~ 1.0, 기본 0.9
    frequencyPenalty: number;  // -2.0 ~ 2.0, 기본 0.0
    presencePenalty: number;   // -2.0 ~ 2.0, 기본 0.0
  };
  // 비용 관리
  costManagement: {
    monthlyBudget: number;          // 월간 예산 ($)
    budgetAlertThreshold: number;   // 알림 임계값 (0.0~1.0)
    blockOnBudgetExceed: boolean;   // 예산 초과 시 차단
  };
}

// 검색 전략
export type RetrievalStrategy = "basic" | "hybrid" | "advanced";

// ============================================================
// 카테고리 2: 벡터 검색 설정
// ============================================================
export interface VectorSearchSettings {
  // 기본 검색 설정
  basic: {
    topK: number;                   // 검색 결과 개수, 기본 10
    similarityThreshold: number;    // 유사도 임계값, 기본 0.7
    searchType: SearchType;         // 검색 유형
  };
  // MMR 설정 (Maximal Marginal Relevance)
  mmr: {
    diversity: number;              // 결과 다양성 (0~1), 기본 0.3
  };
  // 하이브리드 검색
  hybrid: {
    alpha: number;                  // 벡터/키워드 비중 (0~1), 기본 0.5
    keywordBoost: boolean;          // 키워드 매칭 가중치
  };
  // 필터링
  filtering: {
    byDate: boolean;                // 날짜 필터 활성화
    byOrg: boolean;                 // 기관 필터 활성화
    byDocType: boolean;             // 문서 유형 필터 활성화
  };
  // Reranking
  reranking: {
    enabled: boolean;               // 리랭킹 활성화
    model: string;                  // 리랭킹 모델
    topN: number;                   // 리랭킹 후 최종 결과 수
  };
  // 고급 검색 설정 (Advanced Retrieval Pipeline)
  advanced: {
    strategy: RetrievalStrategy;           // 검색 전략
    // Query Expansion
    enableQueryExpansion: boolean;         // 질의 확장 활성화
    numExpandedQueries: number;            // 확장 쿼리 수 (기본 5)
    // HyDE (Hypothetical Document Embeddings)
    enableHyde: boolean;                   // HyDE 활성화
    numHypotheticalDocs: number;           // 가상 문서 수 (기본 3)
    // Hybrid Search 세부 설정
    enableHybrid: boolean;                 // 하이브리드 검색 활성화
    semanticWeight: number;                // 시맨틱 가중치 (0~1)
    lexicalWeight: number;                 // 어휘(BM25) 가중치 (0~1)
    // Reranking 세부 설정
    enableReranking: boolean;              // Cross-Encoder 리랭킹 활성화
    rerankTopN: number;                    // 리랭킹 후 결과 수
    rerankerModel: string;                 // 리랭커 모델명
  };
}

// ============================================================
// 카테고리 3: 이슈 발굴 설정
// ============================================================

/** 동적 평가 기준 */
export interface ScoringCriteria {
  id: string;
  label: string;                    // 화면 표시명
  description: string;              // LLM에 주입될 설명
  examples?: {                      // 좋은/나쁜 사례 (프롬프트 품질 향상)
    high: string[];
    low: string[];
  };
  weight: number;                   // 0.0 ~ 1.0
  enabled: boolean;
}

export interface DiscoverySettings {
  // 클러스터링
  clustering: {
    algorithm: ClusteringAlgorithm;  // 클러스터링 알고리즘
    numClusters: number;             // 클러스터 수 (K-Means용)
    minClusterSize: number;          // 최소 클러스터 크기
    distanceMetric: "cosine" | "euclidean";  // 거리 측정
    sensitivity: number;             // 클러스터링 민감도 (0=느슨, 1=엄격)
  };
  // 이슈 추출
  issueExtraction: {
    minIssues: number;               // 최소 발굴 이슈 수, 기본 5
    maxIssues: number;               // 최대 발굴 이슈 수, 기본 15
    minScoreThreshold: number;       // 최소 중요도 점수, 기본 0.6
  };
  // 중요도 가중치 (기존 호환용)
  scoreWeights: {
    legalMandatory: number;          // 법적 강제성, 기본 0.40
    novelty: number;                 // 신규성, 기본 0.25
    impact: number;                  // 파급력, 기본 0.20
    international: number;           // 국제 동향, 기본 0.15
  };
  // 동적 평가 기준 (신규)
  scoringCriteria: ScoringCriteria[];
  // 키워드 필터
  keywordBoosting: {
    keywords: string[];              // 가중치 부여 키워드 목록
    boostFactor: number;             // 부스트 계수, 기본 1.5
  };
  // 포함/제외 키워드 (신규)
  keywordFilters: {
    mustInclude: string[];           // 반드시 포함 (가중치 2배)
    mustExclude: string[];           // 제외 (검색에서 배제)
  };
}

// ============================================================
// 카테고리 4: 심층 분석 설정
// ============================================================
export interface AnalysisSettings {
  // 분석 단계
  steps: {
    factCheck: boolean;              // Step 1: 사실 확인
    trendAnalysis: boolean;          // Step 2: 배경 분석
    impactAssessment: boolean;       // Step 3: 영향 분석
    responseStrategy: boolean;       // Step 4: 대응 전략
  };
  // 분석 깊이
  depth: {
    level: AnalysisDepth;            // 분석 깊이 수준
    includeHistoricalData: boolean;  // 과거 데이터 참조
    historicalLookbackMonths: number; // 과거 데이터 조회 기간 (월)
  };
  // 출력 형식
  output: {
    format: OutputFormat;            // 출력 형식
    includeTables: boolean;          // 비교표 포함
    includeSources: boolean;         // 출처 인용 포함
    maxSourcesPerStep: number;       // 단계당 최대 인용 출처 수
  };
  // Chain-of-Thought
  chainOfThought: {
    enabled: boolean;                // CoT 프롬프팅 활성화
    showReasoning: boolean;          // 추론 과정 표시
  };
}

// ============================================================
// 카테고리 5: 프롬프트 설정
// ============================================================
export interface PromptSettings {
  // 시스템 프롬프트
  systemPrompts: {
    discovery: string;               // 이슈 발굴용
    analysis: string;                // 심층 분석용
    report: string;                  // 보고서 생성용
  };
  // 분석 단계별 프롬프트 템플릿
  analysisPrompts: {
    factCheck: string;               // 사실 확인
    trendAnalysis: string;           // 배경 분석
    impactAssessment: string;        // 영향 분석
    responseStrategy: string;        // 대응 전략
  };
}

// ============================================================
// 카테고리 6: 시스템 설정
// ============================================================
export interface SystemSettings {
  // 캐싱
  caching: {
    enableQueryCache: boolean;       // 쿼리 결과 캐싱
    cacheTTLHours: number;           // 캐시 유효 기간 (시간)
    enableEmbeddingCache: boolean;   // 임베딩 캐싱
  };
  // Rate Limiting
  rateLimiting: {
    maxRequestsPerMinute: number;    // 분당 최대 요청 수
    requestDelayMs: number;          // 요청 간 딜레이 (ms)
  };
  // 재시도
  retry: {
    maxRetries: number;              // 최대 재시도 횟수
    retryDelayMs: number;            // 재시도 대기 시간 (ms)
    exponentialBackoff: boolean;     // 지수 백오프 사용
  };
  // 타임아웃
  timeout: {
    requestTimeoutSec: number;       // 요청 타임아웃 (초)
    analysisTimeoutSec: number;      // 분석 타임아웃 (초)
  };
  // 로깅
  logging: {
    enableDebugLogging: boolean;     // 디버그 로깅 활성화
    logPrompts: boolean;             // 프롬프트 로깅
    logResponses: boolean;           // 응답 로깅
  };
  // 데이터 관리
  dataManagement: {
    autoCleanupDays: number;         // 분석 결과 자동 정리 (일)
    maxStoredSessions: number;       // 최대 저장 세션 수
  };
}

// ============================================================
// 전체 RAG 설정
// ============================================================
export interface RAGSettings {
  llm: LLMSettings;
  vectorSearch: VectorSearchSettings;
  discovery: DiscoverySettings;
  analysis: AnalysisSettings;
  prompts: PromptSettings;
  system: SystemSettings;
  updatedAt: string;
}

// ============================================================
// 기본값
// ============================================================
export const DEFAULT_RAG_SETTINGS: RAGSettings = {
  llm: {
    apiKeys: {
      openai: "",
      anthropic: "",
      google: "",
    },
    models: {
      discovery: "gpt-5-mini",
      analysis: "claude-sonnet-4.5",
      report: "gpt-5.2",
    },
    parameters: {
      temperature: 0.2,
      maxTokens: 4096,
      topP: 0.9,
      frequencyPenalty: 0.0,
      presencePenalty: 0.0,
    },
    costManagement: {
      monthlyBudget: 50.0,
      budgetAlertThreshold: 0.8,
      blockOnBudgetExceed: true,
    },
  },
  vectorSearch: {
    basic: {
      topK: 10,
      similarityThreshold: 0.7,
      searchType: "similarity",
    },
    mmr: {
      diversity: 0.3,
    },
    hybrid: {
      alpha: 0.5,
      keywordBoost: false,
    },
    filtering: {
      byDate: true,
      byOrg: true,
      byDocType: true,
    },
    reranking: {
      enabled: false,
      model: "cohere-rerank-v3",
      topN: 5,
    },
    advanced: {
      strategy: "hybrid",
      enableQueryExpansion: false,
      numExpandedQueries: 5,
      enableHyde: false,
      numHypotheticalDocs: 3,
      enableHybrid: true,
      semanticWeight: 0.5,
      lexicalWeight: 0.5,
      enableReranking: true,
      rerankTopN: 15,
      rerankerModel: "BAAI/bge-reranker-v2-m3",
    },
  },
  discovery: {
    clustering: {
      algorithm: "kmeans",
      numClusters: 15,
      minClusterSize: 5,
      distanceMetric: "cosine",
      sensitivity: 0.5,
    },
    issueExtraction: {
      minIssues: 5,
      maxIssues: 15,
      minScoreThreshold: 0.6,
    },
    scoreWeights: {
      legalMandatory: 0.40,
      novelty: 0.25,
      impact: 0.20,
      international: 0.15,
    },
    scoringCriteria: [
      {
        id: "legal_mandatory",
        label: "법적 강제성",
        description: "이 이슈가 기업에게 의무를 부과하거나, 위반 시 제재(과태료, 영업정지 등)가 따르는지 평가하십시오.",
        examples: {
          high: ["의무 규정", "과태료 부과", "허가 취소"],
          low: ["권고 사항", "자율 준수", "가이드라인"],
        },
        weight: 0.40,
        enabled: true,
      },
      {
        id: "novelty",
        label: "신규성",
        description: "이 이슈가 새로운 규제나 정책인지, 기존 규제의 개정인지 평가하십시오.",
        examples: {
          high: ["신규 제정", "첫 시행", "새로운 기준"],
          low: ["기존 유지", "단순 재공고", "경미한 수정"],
        },
        weight: 0.25,
        enabled: true,
      },
      {
        id: "impact",
        label: "파급력",
        description: "이 이슈가 영향을 미치는 산업/기업의 범위와 강도를 평가하십시오.",
        examples: {
          high: ["전 산업", "대규모 투자 필요", "생산 중단"],
          low: ["특정 업종", "소규모 조정", "행정 절차"],
        },
        weight: 0.20,
        enabled: true,
      },
      {
        id: "international",
        label: "국제 동향",
        description: "이 이슈가 국제 기준이나 협약과 관련되어 있는지 평가하십시오.",
        examples: {
          high: ["EU 규정 연동", "파리협정", "CBAM"],
          low: ["국내 고유", "지역 특화", "단일 부처"],
        },
        weight: 0.15,
        enabled: true,
      },
    ],
    keywordBoosting: {
      keywords: [],
      boostFactor: 1.5,
    },
    keywordFilters: {
      mustInclude: [],
      mustExclude: [],
    },
  },
  analysis: {
    steps: {
      factCheck: true,
      trendAnalysis: true,
      impactAssessment: true,
      responseStrategy: true,
    },
    depth: {
      level: "standard",
      includeHistoricalData: true,
      historicalLookbackMonths: 12,
    },
    output: {
      format: "structured",
      includeTables: true,
      includeSources: true,
      maxSourcesPerStep: 5,
    },
    chainOfThought: {
      enabled: true,
      showReasoning: false,
    },
  },
  prompts: {
    systemPrompts: {
      discovery: `당신은 환경/에너지 정책 분석 전문가입니다.
주어진 문서들을 분석하여 중요한 이슈를 발굴하고 요약합니다.
법적 강제성, 신규성, 파급력, 국제 동향을 기준으로 중요도를 평가합니다.`,
      analysis: `당신은 환경/에너지 규제 분석 전문가입니다.
선택된 이슈에 대해 단계별로 심층 분석을 수행합니다.
정확한 법령명, 시행일, 변경 사항을 파악하고 대응 전략을 제시합니다.`,
      report: `당신은 전문 보고서 작성자입니다.
분석 결과를 전문적이고 읽기 쉬운 보고서 형식으로 구성합니다.
명확한 구조와 논리적 흐름을 유지합니다.`,
    },
    analysisPrompts: {
      factCheck: `## Step 1: 사실 확인 (Fact Check)

다음 이슈에 대해 정확한 사실 관계를 확인하세요:

**이슈**: {issue_title}

**참고 자료**:
{context}

**확인 사항**:
1. 정확한 법령명/고시명
2. 시행일/예고 기간
3. 주요 변경 조항 (변경 전 → 변경 후 비교표)
4. 적용 대상 및 범위

출처를 명시하여 작성해 주세요.`,
      trendAnalysis: `## Step 2: 배경 분석 (Trend Analysis)

다음 이슈의 발생 배경을 분석하세요:

**이슈**: {issue_title}

**참고 자료**:
{context}

**분석 항목**:
1. 이 변화가 발생한 배경 (국내 정책 기조)
2. 관련 국제 동향 (EU, UN, 주요국 정책)
3. 산업계 요구 및 사회적 압력
4. 기존 규제와의 연관성

출처를 명시하여 작성해 주세요.`,
      impactAssessment: `## Step 3: 영향 분석 (Impact Assessment)

다음 이슈가 산업계에 미치는 영향을 분석하세요:

**이슈**: {issue_title}

**참고 자료**:
{context}

**분석 항목**:
1. 영향받는 산업/업종/기업 유형
2. 예상되는 비용/투자 규모
3. 시행까지 남은 준비 기간
4. 비준수 시 제재/불이익

정량적 데이터가 있으면 포함해 주세요.`,
      responseStrategy: `## Step 4: 대응 전략 (Response Strategy)

다음 이슈에 대한 대응 전략을 제시하세요:

**이슈**: {issue_title}

**참고 자료**:
{context}

**대응 전략**:
1. 단기 대응 (3개월 이내)
   - 즉시 조치가 필요한 사항
   - 현황 파악 및 점검 사항

2. 중기 대응 (1년 이내)
   - 시스템/프로세스 개선
   - 인력/조직 대응

3. 장기 대응 (1년 이상)
   - 전략적 투자 방향
   - 기회 요인 활용

실행 가능한 구체적 조치를 제시해 주세요.`,
    },
  },
  system: {
    caching: {
      enableQueryCache: true,
      cacheTTLHours: 24,
      enableEmbeddingCache: true,
    },
    rateLimiting: {
      maxRequestsPerMinute: 60,
      requestDelayMs: 100,
    },
    retry: {
      maxRetries: 3,
      retryDelayMs: 1000,
      exponentialBackoff: true,
    },
    timeout: {
      requestTimeoutSec: 60,
      analysisTimeoutSec: 300,
    },
    logging: {
      enableDebugLogging: false,
      logPrompts: false,
      logResponses: false,
    },
    dataManagement: {
      autoCleanupDays: 30,
      maxStoredSessions: 50,
    },
  },
  updatedAt: "",
};

// ============================================================
// 모델 정보 (UI 표시용)
// ============================================================
export const MODEL_INFO: Record<LLMModel, {
  provider: LLMProvider;
  displayName: string;
  inputCost: number;   // $/1M tokens
  outputCost: number;  // $/1M tokens
  description: string;
}> = {
  // OpenAI
  "gpt-5-mini": {
    provider: "openai",
    displayName: "GPT-5 mini",
    inputCost: 0.25,
    outputCost: 2.00,
    description: "가장 저렴, 대량 처리에 적합",
  },
  "gpt-5.2": {
    provider: "openai",
    displayName: "GPT-5.2",
    inputCost: 1.75,
    outputCost: 14.00,
    description: "플래그십 기본 모델",
  },
  "gpt-5.2-pro": {
    provider: "openai",
    displayName: "GPT-5.2 pro",
    inputCost: 21.00,
    outputCost: 168.00,
    description: "최고 성능, 복잡한 추론",
  },
  // Anthropic
  "claude-haiku-4.5": {
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    inputCost: 1.00,
    outputCost: 5.00,
    description: "빠른 응답, 경량 작업",
  },
  "claude-sonnet-4.5": {
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    inputCost: 3.00,
    outputCost: 15.00,
    description: "균형 잡힌 성능",
  },
  "claude-opus-4.5": {
    provider: "anthropic",
    displayName: "Claude Opus 4.5",
    inputCost: 5.00,
    outputCost: 25.00,
    description: "최고 품질 분석",
  },
  // Google
  "gemini-3-flash": {
    provider: "google",
    displayName: "Gemini 3 Flash",
    inputCost: 0.50,
    outputCost: 2.00,
    description: "빠른 속도, 합리적 가격",
  },
  "gemini-3-pro": {
    provider: "google",
    displayName: "Gemini 3 Pro",
    inputCost: 2.00,
    outputCost: 12.00,
    description: "고성능 멀티모달",
  },
};

// ============================================================
// 파일 경로
// ============================================================
const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "rag-settings.json");
const USAGE_FILE = path.join(DATA_DIR, "rag-usage.json");

// ============================================================
// API 사용량 타입
// ============================================================
export interface APIUsage {
  month: string;  // YYYY-MM
  totalCost: number;
  byProvider: {
    openai: number;
    anthropic: number;
    google: number;
  };
  byPurpose: {
    discovery: number;
    analysis: number;
    report: number;
  };
  requests: number;
  inputTokens: number;
  outputTokens: number;
  updatedAt: string;
}

// ============================================================
// 설정 저장/로드 함수
// ============================================================

/**
 * RAG 설정 로드
 */
export function loadRAGSettings(): RAGSettings {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const loaded = JSON.parse(data) as RAGSettings;
      // 기본값과 병합 (새 필드 추가 시 대응)
      return deepMerge(DEFAULT_RAG_SETTINGS, loaded);
    }
    
    return { ...DEFAULT_RAG_SETTINGS };
  } catch (error) {
    console.error("Failed to load RAG settings:", error);
    return { ...DEFAULT_RAG_SETTINGS };
  }
}

/**
 * RAG 설정 저장
 */
export function saveRAGSettings(settings: RAGSettings): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    const toSave: RAGSettings = {
      ...settings,
      updatedAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), "utf-8");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to save RAG settings:", error);
    return { ok: false, error: error.message };
  }
}

/**
 * RAG 설정 초기화
 */
export function resetRAGSettings(): RAGSettings {
  const defaults = {
    ...DEFAULT_RAG_SETTINGS,
    updatedAt: new Date().toISOString(),
  };
  
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to reset RAG settings:", error);
  }
  
  return defaults;
}

/**
 * API 사용량 로드
 */
export function loadAPIUsage(): APIUsage {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const defaultUsage: APIUsage = {
    month: currentMonth,
    totalCost: 0,
    byProvider: { openai: 0, anthropic: 0, google: 0 },
    byPurpose: { discovery: 0, analysis: 0, report: 0 },
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    updatedAt: new Date().toISOString(),
  };
  
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const data = fs.readFileSync(USAGE_FILE, "utf-8");
      const loaded = JSON.parse(data) as APIUsage;
      
      // 월이 바뀌었으면 초기화
      if (loaded.month !== currentMonth) {
        return defaultUsage;
      }
      
      return loaded;
    }
    
    return defaultUsage;
  } catch (error) {
    console.error("Failed to load API usage:", error);
    return defaultUsage;
  }
}

/**
 * API 사용량 저장
 */
export function saveAPIUsage(usage: APIUsage): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    const toSave: APIUsage = {
      ...usage,
      updatedAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(USAGE_FILE, JSON.stringify(toSave, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save API usage:", error);
  }
}

/**
 * API 사용량 업데이트
 */
export function updateAPIUsage(
  provider: LLMProvider,
  purpose: "discovery" | "analysis" | "report",
  inputTokens: number,
  outputTokens: number,
  model: LLMModel
): void {
  const usage = loadAPIUsage();
  const modelInfo = MODEL_INFO[model];
  
  const cost = (inputTokens / 1_000_000) * modelInfo.inputCost +
               (outputTokens / 1_000_000) * modelInfo.outputCost;
  
  usage.totalCost += cost;
  usage.byProvider[provider] += cost;
  usage.byPurpose[purpose] += cost;
  usage.requests += 1;
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  
  saveAPIUsage(usage);
}

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 깊은 병합
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = target[key];
      
      if (
        sourceValue !== null &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        (result as any)[key] = deepMerge(targetValue as object, sourceValue as object);
      } else if (sourceValue !== undefined) {
        (result as any)[key] = sourceValue;
      }
    }
  }
  
  return result;
}

/**
 * API 키 마스킹
 */
export function maskAPIKey(key: string): string {
  if (!key || key.length < 8) return "********";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

/**
 * API 키 검증
 */
export async function validateAPIKey(
  provider: LLMProvider,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey || apiKey.trim() === "") {
    return { valid: false, error: "API 키가 비어있습니다." };
  }
  
  try {
    switch (provider) {
      case "openai":
        // OpenAI API 검증
        const openaiRes = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!openaiRes.ok) {
          return { valid: false, error: `OpenAI API 오류: ${openaiRes.status}` };
        }
        return { valid: true };
        
      case "anthropic":
        // Anthropic API 검증 (메시지 API 사용)
        const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1,
            messages: [{ role: "user", content: "Hi" }],
          }),
        });
        // 401이 아니면 키는 유효한 것으로 간주
        if (anthropicRes.status === 401) {
          return { valid: false, error: "Anthropic API 키가 유효하지 않습니다." };
        }
        return { valid: true };
        
      case "google":
        // Google API 검증
        const googleRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );
        if (!googleRes.ok) {
          return { valid: false, error: `Google API 오류: ${googleRes.status}` };
        }
        return { valid: true };
        
      default:
        return { valid: false, error: "알 수 없는 제공업체입니다." };
    }
  } catch (error: any) {
    return { valid: false, error: error.message || "검증 중 오류가 발생했습니다." };
  }
}
