/**
 * 임베딩 생성 유틸리티
 * 
 * OpenAI API를 사용하여 텍스트 임베딩 벡터를 생성합니다.
 */

import fs from "node:fs";
import path from "node:path";

// ============================================================================
// 타입 정의
// ============================================================================

export type EmbeddingModel = "openai-small" | "openai-large" | "ko-sroberta" | "bge-m3";

export interface EmbeddingSettings {
  model: EmbeddingModel;
  batchSize: number;
  concurrent: number;
  autoRetry: boolean;
  apiKey?: string;
}

export interface EmbeddingResult {
  chunk_id: string;
  embedding: number[];
  model: string;
  tokens_used: number;
  created_at: string;
}

export interface EmbeddingBatchResult {
  success: boolean;
  processed: number;
  failed: number;
  results: EmbeddingResult[];
  errors: { chunk_id: string; error: string }[];
  total_tokens: number;
  estimated_cost: number;
}

export interface EmbeddingStats {
  totalEmbeddings: number;
  pendingChunks: number;
  embeddedChunks: number;
  failedChunks: number;
  totalTokensUsed: number;
  estimatedCost: number;
  lastUpdated: string;
}

// ============================================================================
// 상수
// ============================================================================

const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";

const MODEL_CONFIG: Record<EmbeddingModel, {
  apiModel: string;
  dimensions: number;
  maxTokens: number;
  costPer1M: number;
}> = {
  "openai-small": {
    apiModel: "text-embedding-3-small",
    dimensions: 1536,
    maxTokens: 8191,
    costPer1M: 0.02,
  },
  "openai-large": {
    apiModel: "text-embedding-3-large",
    dimensions: 3072,
    maxTokens: 8191,
    costPer1M: 0.13,
  },
  "ko-sroberta": {
    apiModel: "jhgan/ko-sroberta-multitask",
    dimensions: 768,
    maxTokens: 512,
    costPer1M: 0,
  },
  "bge-m3": {
    apiModel: "BAAI/bge-m3",
    dimensions: 1024,
    maxTokens: 8192,
    costPer1M: 0,
  },
};

// ============================================================================
// 경로 설정
// ============================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const EMBEDDING_DATA_FILE = path.join(DATA_DIR, "embedding-data.json");
const EMBEDDING_SETTINGS_FILE = path.join(DATA_DIR, "embedding-settings.json");

// ============================================================================
// 기본 설정
// ============================================================================

const DEFAULT_SETTINGS: EmbeddingSettings = {
  model: "openai-small",
  batchSize: 100,
  concurrent: 5,
  autoRetry: true,
};

// ============================================================================
// 설정 관리
// ============================================================================

export function loadEmbeddingSettings(): EmbeddingSettings {
  try {
    if (fs.existsSync(EMBEDDING_SETTINGS_FILE)) {
      const content = fs.readFileSync(EMBEDDING_SETTINGS_FILE, "utf-8");
      return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
    }
  } catch (error) {
    console.error("Error loading embedding settings:", error);
  }
  return DEFAULT_SETTINGS;
}

export function saveEmbeddingSettings(settings: EmbeddingSettings): EmbeddingSettings {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // API 키는 설정 파일에 저장하지 않음
    const { apiKey, ...settingsToSave } = settings;
    fs.writeFileSync(EMBEDDING_SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2), "utf-8");
    return settings;
  } catch (error) {
    console.error("Error saving embedding settings:", error);
    throw error;
  }
}

// ============================================================================
// 임베딩 데이터 관리
// ============================================================================

interface EmbeddingDataStore {
  embeddings: Record<string, EmbeddingResult>;
  stats: EmbeddingStats;
}

function loadEmbeddingData(): EmbeddingDataStore {
  try {
    if (fs.existsSync(EMBEDDING_DATA_FILE)) {
      const content = fs.readFileSync(EMBEDDING_DATA_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Error loading embedding data:", error);
  }
  return {
    embeddings: {},
    stats: {
      totalEmbeddings: 0,
      pendingChunks: 0,
      embeddedChunks: 0,
      failedChunks: 0,
      totalTokensUsed: 0,
      estimatedCost: 0,
      lastUpdated: new Date().toISOString(),
    },
  };
}

function saveEmbeddingData(data: EmbeddingDataStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(EMBEDDING_DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving embedding data:", error);
    throw error;
  }
}

export function getEmbeddingStats(): EmbeddingStats {
  const data = loadEmbeddingData();
  return data.stats;
}

export function getEmbedding(chunkId: string): EmbeddingResult | null {
  const data = loadEmbeddingData();
  return data.embeddings[chunkId] || null;
}

export function getEmbeddings(chunkIds: string[]): Record<string, EmbeddingResult | null> {
  const data = loadEmbeddingData();
  const result: Record<string, EmbeddingResult | null> = {};
  for (const id of chunkIds) {
    result[id] = data.embeddings[id] || null;
  }
  return result;
}

export function saveEmbeddingResult(result: EmbeddingResult): void {
  const data = loadEmbeddingData();
  data.embeddings[result.chunk_id] = result;
  data.stats.embeddedChunks = Object.keys(data.embeddings).length;
  data.stats.totalEmbeddings = data.stats.embeddedChunks;
  data.stats.totalTokensUsed += result.tokens_used;
  data.stats.lastUpdated = new Date().toISOString();
  saveEmbeddingData(data);
}

export function saveEmbeddingResults(results: EmbeddingResult[], tokensUsed: number, cost: number): void {
  const data = loadEmbeddingData();
  for (const result of results) {
    data.embeddings[result.chunk_id] = result;
  }
  data.stats.embeddedChunks = Object.keys(data.embeddings).length;
  data.stats.totalEmbeddings = data.stats.embeddedChunks;
  data.stats.totalTokensUsed += tokensUsed;
  data.stats.estimatedCost += cost;
  data.stats.lastUpdated = new Date().toISOString();
  saveEmbeddingData(data);
}

export function updateEmbeddingStats(updates: Partial<EmbeddingStats>): void {
  const data = loadEmbeddingData();
  data.stats = { ...data.stats, ...updates, lastUpdated: new Date().toISOString() };
  saveEmbeddingData(data);
}

// ============================================================================
// OpenAI 임베딩 API 호출
// ============================================================================

interface OpenAIEmbeddingResponse {
  object: string;
  data: {
    object: string;
    embedding: number[];
    index: number;
  }[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export async function createOpenAIEmbeddings(
  texts: string[],
  model: EmbeddingModel,
  apiKey: string
): Promise<{
  embeddings: number[][];
  tokens_used: number;
  model: string;
}> {
  const config = MODEL_CONFIG[model];
  
  if (!config || !config.apiModel.startsWith("text-embedding")) {
    throw new Error(`Model ${model} is not an OpenAI model`);
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: config.apiModel,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`
    );
  }

  const data: OpenAIEmbeddingResponse = await response.json();

  // 인덱스 순서대로 정렬
  const sortedData = [...data.data].sort((a, b) => a.index - b.index);

  return {
    embeddings: sortedData.map((d) => d.embedding),
    tokens_used: data.usage.total_tokens,
    model: data.model,
  };
}

// ============================================================================
// 배치 임베딩 생성
// ============================================================================

export interface ChunkForEmbedding {
  chunk_id: string;
  content: string;
}

export async function generateEmbeddingsBatch(
  chunks: ChunkForEmbedding[],
  settings: EmbeddingSettings,
  apiKey: string,
  onProgress?: (processed: number, total: number) => void
): Promise<EmbeddingBatchResult> {
  const results: EmbeddingResult[] = [];
  const errors: { chunk_id: string; error: string }[] = [];
  let totalTokens = 0;

  const config = MODEL_CONFIG[settings.model];
  const costPer1M = config.costPer1M;

  // 배치 단위로 처리
  const batches: ChunkForEmbedding[][] = [];
  for (let i = 0; i < chunks.length; i += settings.batchSize) {
    batches.push(chunks.slice(i, i + settings.batchSize));
  }

  let processedCount = 0;

  for (const batch of batches) {
    try {
      const texts = batch.map((c) => c.content);
      
      const embeddingResult = await createOpenAIEmbeddings(
        texts,
        settings.model,
        apiKey
      );

      totalTokens += embeddingResult.tokens_used;

      for (let i = 0; i < batch.length; i++) {
        results.push({
          chunk_id: batch[i].chunk_id,
          embedding: embeddingResult.embeddings[i],
          model: embeddingResult.model,
          tokens_used: Math.ceil(embeddingResult.tokens_used / batch.length),
          created_at: new Date().toISOString(),
        });
      }

      processedCount += batch.length;
      onProgress?.(processedCount, chunks.length);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // 재시도 로직
      if (settings.autoRetry) {
        try {
          // 500ms 대기 후 재시도
          await new Promise((resolve) => setTimeout(resolve, 500));
          
          const texts = batch.map((c) => c.content);
          const embeddingResult = await createOpenAIEmbeddings(
            texts,
            settings.model,
            apiKey
          );

          totalTokens += embeddingResult.tokens_used;

          for (let i = 0; i < batch.length; i++) {
            results.push({
              chunk_id: batch[i].chunk_id,
              embedding: embeddingResult.embeddings[i],
              model: embeddingResult.model,
              tokens_used: Math.ceil(embeddingResult.tokens_used / batch.length),
              created_at: new Date().toISOString(),
            });
          }

          processedCount += batch.length;
          onProgress?.(processedCount, chunks.length);
          continue;
        } catch {
          // 재시도 실패
        }
      }

      // 배치 전체 실패로 기록
      for (const chunk of batch) {
        errors.push({
          chunk_id: chunk.chunk_id,
          error: errorMessage,
        });
      }
      processedCount += batch.length;
      onProgress?.(processedCount, chunks.length);
    }

    // Rate limit 방지를 위한 딜레이
    if (batches.indexOf(batch) < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const estimatedCost = (totalTokens / 1_000_000) * costPer1M;

  // 결과 저장
  if (results.length > 0) {
    saveEmbeddingResults(results, totalTokens, estimatedCost);
  }

  return {
    success: errors.length === 0,
    processed: results.length,
    failed: errors.length,
    results,
    errors,
    total_tokens: totalTokens,
    estimated_cost: estimatedCost,
  };
}

// ============================================================================
// 유틸리티
// ============================================================================

export function getModelConfig(model: EmbeddingModel) {
  return MODEL_CONFIG[model];
}

export function estimateCost(tokenCount: number, model: EmbeddingModel): number {
  const config = MODEL_CONFIG[model];
  return (tokenCount / 1_000_000) * config.costPer1M;
}
