/**
 * 임베딩 실행 API
 * 
 * POST /api/processing/embedding/execute
 * - 선택된 청크들에 대해 임베딩 벡터를 생성합니다
 * - OpenAI API 또는 HuggingFace 로컬 모델 지원
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateEmbeddingsBatch,
  loadEmbeddingSettings,
  getEmbedding,
  saveEmbeddingResults,
  EmbeddingSettings,
  ChunkForEmbedding,
  EmbeddingResult,
} from "@/lib/chunking/embedding";
import { getChunks, Chunk } from "@/lib/chunking/chunking-store";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 타임아웃

// 백엔드 URL
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// ============================================================================
// HuggingFace 로컬 임베딩 생성
// ============================================================================

async function generateHuggingFaceEmbeddings(
  chunks: ChunkForEmbedding[],
  modelId: string
): Promise<{
  success: boolean;
  results: EmbeddingResult[];
  errors: { chunk_id: string; error: string }[];
  processing_time_ms: number;
}> {
  const results: EmbeddingResult[] = [];
  const errors: { chunk_id: string; error: string }[] = [];
  const batchSize = 32;
  let totalProcessingTime = 0;

  try {
    // 배치 단위로 처리
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.content);

      try {
        console.log(`[HuggingFace] 배치 ${i / batchSize + 1} 처리 중... (${batch.length}개 텍스트)`);
        
        const response = await fetch(`${BACKEND_URL}/embedding/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts,
            model: modelId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP ${response.status}: 백엔드 서버 오류`);
        }

        const data = await response.json();
        console.log(`[HuggingFace] 응답 수신:`, { success: data.success, count: data.count });
        
        // 응답 데이터 검증
        if (!data.embeddings || !Array.isArray(data.embeddings)) {
          throw new Error(`백엔드 응답에 embeddings 배열이 없습니다: ${JSON.stringify(data)}`);
        }
        
        if (data.embeddings.length !== batch.length) {
          throw new Error(`임베딩 개수 불일치: 요청 ${batch.length}개, 응답 ${data.embeddings.length}개`);
        }
        
        totalProcessingTime += data.processing_time_ms || 0;

        // 결과 매핑
        for (let j = 0; j < batch.length; j++) {
          if (!data.embeddings[j] || !Array.isArray(data.embeddings[j])) {
            throw new Error(`임베딩 ${j}번이 유효하지 않습니다`);
          }
          results.push({
            chunk_id: batch[j].chunk_id,
            embedding: data.embeddings[j],
            model: data.model || modelId,
            tokens_used: 0, // 로컬 모델은 토큰 비용 없음
            created_at: new Date().toISOString(),
          });
        }
      } catch (batchError) {
        // 배치 실패 시 개별 청크 에러 기록
        const errorMsg = batchError instanceof Error ? batchError.message : "Unknown error";
        console.error(`[HuggingFace] 배치 오류:`, errorMsg);
        for (const chunk of batch) {
          errors.push({ chunk_id: chunk.chunk_id, error: errorMsg });
        }
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      processing_time_ms: totalProcessingTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      results: [],
      errors: chunks.map((c) => ({ chunk_id: c.chunk_id, error: errorMsg })),
      processing_time_ms: 0,
    };
  }
}

// ============================================================================
// POST: 임베딩 생성 실행
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      chunk_ids,
      doc_ids,
      api_key,
      settings: customSettings,
      skip_existing = true,
    } = body as {
      chunk_ids?: string[];
      doc_ids?: string[];
      api_key?: string;
      settings?: Partial<EmbeddingSettings>;
      skip_existing?: boolean;
    };

    // 설정 로드 및 커스텀 설정 병합
    const settings = { ...loadEmbeddingSettings(), ...customSettings };

    // 모델 타입 확인
    const isOpenAI = settings.model.startsWith("openai");
    const isHuggingFace = settings.model === "ko-sroberta" || settings.model === "bge-m3";

    // OpenAI 모델인 경우 API 키 필요 (환경 변수에서 자동 로드 가능)
    let effectiveApiKey = api_key;
    if (isOpenAI) {
      // 전달된 API 키가 없으면 환경 변수에서 로드
      if (!effectiveApiKey) {
        effectiveApiKey = process.env.OPENAI_API_KEY;
      }
      if (!effectiveApiKey) {
        return NextResponse.json(
          { success: false, error: "OpenAI API 키가 필요합니다. .env.local에 OPENAI_API_KEY를 설정하거나 직접 입력해주세요." },
          { status: 400 }
        );
      }
    }

    // 청크 수집
    let chunks: Chunk[] = [];

    if (chunk_ids && chunk_ids.length > 0) {
      // 특정 청크 ID로 조회
      const allChunks = getChunks();
      chunks = allChunks.filter((c) => chunk_ids.includes(c.chunk_id));
    } else if (doc_ids && doc_ids.length > 0) {
      // 특정 문서의 모든 청크 조회
      for (const docId of doc_ids) {
        const docChunks = getChunks(docId);
        chunks.push(...docChunks);
      }
    } else {
      // 모든 청크 조회
      chunks = getChunks();
    }

    if (chunks.length === 0) {
      return NextResponse.json(
        { success: false, error: "임베딩할 청크가 없습니다." },
        { status: 400 }
      );
    }

    // 이미 임베딩된 청크 제외 (옵션)
    let chunksToEmbed: ChunkForEmbedding[] = [];
    let skippedCount = 0;

    if (skip_existing) {
      for (const chunk of chunks) {
        const existing = getEmbedding(chunk.chunk_id);
        if (existing) {
          skippedCount++;
        } else {
          chunksToEmbed.push({
            chunk_id: chunk.chunk_id,
            content: chunk.content,
          });
        }
      }
    } else {
      chunksToEmbed = chunks.map((c) => ({
        chunk_id: c.chunk_id,
        content: c.content,
      }));
    }

    if (chunksToEmbed.length === 0) {
      return NextResponse.json({
        success: true,
        message: "모든 청크가 이미 임베딩되어 있습니다.",
        processed: 0,
        failed: 0,
        skipped: skippedCount,
        total_tokens: 0,
        estimated_cost: 0,
      });
    }

    // 임베딩 생성 실행
    let embeddingResult: {
      success: boolean;
      results: EmbeddingResult[];
      errors: { chunk_id: string; error: string }[];
      total_tokens: number;
      estimated_cost: number;
      processing_time_ms?: number;
    };

    if (isHuggingFace) {
      // HuggingFace 로컬 모델 사용
      const result = await generateHuggingFaceEmbeddings(
        chunksToEmbed,
        settings.model
      );
      embeddingResult = {
        success: result.success,
        results: result.results,
        errors: result.errors,
        total_tokens: 0,
        estimated_cost: 0,
        processing_time_ms: result.processing_time_ms,
      };
    } else {
      // OpenAI API 사용
      const result = await generateEmbeddingsBatch(
        chunksToEmbed,
        settings,
        effectiveApiKey!
      );
      embeddingResult = {
        success: result.success,
        results: result.results,
        errors: result.errors,
        total_tokens: result.total_tokens,
        estimated_cost: result.estimated_cost,
      };
    }

    // ChromaDB에 저장 (성공한 임베딩만)
    let chromaDbSaved = 0;
    if (embeddingResult.results.length > 0) {
      try {
        // 청크 원본 데이터에서 메타데이터 추출
        const chunkMap = new Map(chunks.map(c => [c.chunk_id, c]));
        
        const vectorDbChunks = embeddingResult.results.map(result => {
          const originalChunk = chunkMap.get(result.chunk_id);
          return {
            id: result.chunk_id,
            embedding: result.embedding,
            content: originalChunk?.content || "",
            metadata: {
              model: result.model,
              tokens_used: result.tokens_used,
              created_at: result.created_at,
              doc_id: originalChunk?.doc_id || "",
              chunk_type: originalChunk?.chunk_type || "text",
              chunk_index: originalChunk?.chunk_index || 0,
            }
          };
        });

        // 백엔드 ChromaDB API 호출
        const vectorDbResponse = await fetch(`${BACKEND_URL}/vectordb/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chunks: vectorDbChunks }),
        });

        if (vectorDbResponse.ok) {
          const vectorDbResult = await vectorDbResponse.json();
          chromaDbSaved = vectorDbResult.added + vectorDbResult.updated;
          console.log(`[ChromaDB] 저장 완료: ${chromaDbSaved}개`);
        } else {
          console.error("[ChromaDB] 저장 실패:", await vectorDbResponse.text());
        }
      } catch (chromaError) {
        console.error("[ChromaDB] 저장 오류:", chromaError);
        // ChromaDB 저장 실패해도 임베딩 자체는 성공으로 처리
      }

      // JSON 백업 저장 제거 - ChromaDB가 주 저장소
      // saveEmbeddingResults(embeddingResult.results, embeddingResult.total_tokens, embeddingResult.estimated_cost);
    }

    // 통계 업데이트 (영구 저장)
    try {
      const statsUrl = new URL("/api/processing/embedding/stats", process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000");
      await fetch(statsUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          chunks_processed: embeddingResult.results.length,
          chunks_failed: embeddingResult.errors.length,
          tokens_used: embeddingResult.total_tokens,
          estimated_cost: embeddingResult.estimated_cost,
          duration_ms: embeddingResult.processing_time_ms || 0,
        }),
      });
    } catch (statsError) {
      console.error("[Stats] 통계 업데이트 실패:", statsError);
      // 통계 업데이트 실패해도 임베딩 자체는 성공으로 처리
    }

    return NextResponse.json({
      success: embeddingResult.success,
      processed: embeddingResult.results.length,
      failed: embeddingResult.errors.length,
      skipped: skippedCount,
      total_tokens: embeddingResult.total_tokens,
      estimated_cost: embeddingResult.estimated_cost,
      chromadb_saved: chromaDbSaved,
      processing_time_ms: embeddingResult.processing_time_ms,
      errors: embeddingResult.errors.length > 0 ? embeddingResult.errors.slice(0, 10) : undefined,
    });

  } catch (error) {
    console.error("Error executing embedding:", error);
    
    const errorMessage = error instanceof Error ? error.message : "임베딩 생성 중 오류가 발생했습니다.";
    
    // 백엔드 연결 오류
    if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("fetch failed")) {
      return NextResponse.json(
        { success: false, error: "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요." },
        { status: 503 }
      );
    }
    
    // OpenAI API 오류 구분
    if (errorMessage.includes("401")) {
      return NextResponse.json(
        { success: false, error: "유효하지 않은 API 키입니다." },
        { status: 401 }
      );
    }
    if (errorMessage.includes("429")) {
      return NextResponse.json(
        { success: false, error: "API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요." },
        { status: 429 }
      );
    }
    if (errorMessage.includes("insufficient_quota")) {
      return NextResponse.json(
        { success: false, error: "API 크레딧이 부족합니다." },
        { status: 402 }
      );
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET: 임베딩 상태 조회
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const chunkId = searchParams.get("chunk_id");
    const chunkIds = searchParams.get("chunk_ids");

    if (chunkId) {
      // 단일 청크 임베딩 조회
      const embedding = getEmbedding(chunkId);
      return NextResponse.json({
        success: true,
        exists: !!embedding,
        embedding: embedding ? {
          chunk_id: embedding.chunk_id,
          model: embedding.model,
          dimensions: embedding.embedding.length,
          tokens_used: embedding.tokens_used,
          created_at: embedding.created_at,
        } : null,
      });
    }

    if (chunkIds) {
      // 복수 청크 임베딩 존재 여부 조회
      const ids = chunkIds.split(",");
      const results: Record<string, boolean> = {};
      for (const id of ids) {
        results[id] = !!getEmbedding(id);
      }
      return NextResponse.json({
        success: true,
        results,
      });
    }

    // 전체 임베딩 통계
    const allChunks = getChunks();
    let embeddedCount = 0;
    for (const chunk of allChunks) {
      if (getEmbedding(chunk.chunk_id)) {
        embeddedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      total_chunks: allChunks.length,
      embedded_chunks: embeddedCount,
      pending_chunks: allChunks.length - embeddedCount,
      embedding_rate: allChunks.length > 0 
        ? Math.round((embeddedCount / allChunks.length) * 100) 
        : 0,
    });

  } catch (error) {
    console.error("Error getting embedding status:", error);
    return NextResponse.json(
      { success: false, error: "임베딩 상태 조회 실패" },
      { status: 500 }
    );
  }
}
