/**
 * 임베딩 백그라운드 Worker
 * 
 * Job Store의 작업을 처리하고 진행률을 업데이트합니다.
 */

import {
  Job,
  loadJob,
  startJob,
  updateJobProgress,
  completeJob,
  failJob,
  JobResult,
} from "./job-store";
import {
  generateEmbeddingsBatch,
  loadEmbeddingSettings,
  getEmbedding,
  EmbeddingSettings,
  ChunkForEmbedding,
  EmbeddingResult,
} from "@/lib/chunking/embedding";
import { getChunks, Chunk } from "@/lib/chunking/chunking-store";

// 백엔드 URL
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// 취소된 작업 ID 목록
const cancelledJobs = new Set<string>();

/**
 * 작업 취소 요청
 */
export function requestJobCancellation(jobId: string): void {
  cancelledJobs.add(jobId);
}

/**
 * 취소 요청 확인
 */
function isCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

/**
 * 취소 요청 제거
 */
function clearCancellation(jobId: string): void {
  cancelledJobs.delete(jobId);
}

// ============================================================
// HuggingFace 로컬 임베딩 생성
// ============================================================

async function generateHuggingFaceEmbeddingsBatch(
  chunks: ChunkForEmbedding[],
  modelId: string,
  jobId: string,
  startIndex: number,
  onProgress: (current: number, message: string) => void
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
    for (let i = 0; i < chunks.length; i += batchSize) {
      // 취소 확인
      if (isCancelled(jobId)) {
        return {
          success: false,
          results,
          errors: [{ chunk_id: "cancelled", error: "작업이 취소되었습니다." }],
          processing_time_ms: totalProcessingTime,
        };
      }
      
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.content);
      const currentIndex = startIndex + i;

      onProgress(currentIndex + batch.length, `배치 ${Math.floor(i / batchSize) + 1} 처리 중...`);

      try {
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
        
        if (!data.embeddings || !Array.isArray(data.embeddings)) {
          throw new Error(`백엔드 응답에 embeddings 배열이 없습니다`);
        }
        
        if (data.embeddings.length !== batch.length) {
          throw new Error(`임베딩 개수 불일치: 요청 ${batch.length}개, 응답 ${data.embeddings.length}개`);
        }
        
        totalProcessingTime += data.processing_time_ms || 0;

        for (let j = 0; j < batch.length; j++) {
          if (!data.embeddings[j] || !Array.isArray(data.embeddings[j])) {
            throw new Error(`임베딩 ${j}번이 유효하지 않습니다`);
          }
          results.push({
            chunk_id: batch[j].chunk_id,
            embedding: data.embeddings[j],
            model: data.model || modelId,
            tokens_used: 0,
            created_at: new Date().toISOString(),
          });
        }
      } catch (batchError) {
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
      results,
      errors: chunks.map((c) => ({ chunk_id: c.chunk_id, error: errorMsg })),
      processing_time_ms: 0,
    };
  }
}

// ============================================================
// 임베딩 작업 실행
// ============================================================

export async function runEmbeddingJob(jobId: string): Promise<void> {
  const job = loadJob(jobId);
  if (!job) {
    console.error(`[EmbeddingWorker] Job not found: ${jobId}`);
    return;
  }
  
  const {
    chunk_ids,
    doc_ids,
    api_key,
    settings: customSettings,
    skip_existing = true,
  } = job.params;
  
  try {
    // 설정 로드
    const settings = { ...loadEmbeddingSettings(), ...customSettings };
    const isOpenAI = settings.model.startsWith("openai");
    const isHuggingFace = settings.model === "ko-sroberta" || settings.model === "bge-m3";
    
    // API 키 확인
    let effectiveApiKey = api_key;
    if (isOpenAI && !effectiveApiKey) {
      effectiveApiKey = process.env.OPENAI_API_KEY;
    }
    if (isOpenAI && !effectiveApiKey) {
      failJob(jobId, "OpenAI API 키가 필요합니다.");
      return;
    }
    
    // 청크 수집
    let chunks: Chunk[] = [];
    if (chunk_ids && chunk_ids.length > 0) {
      const allChunks = await getChunks();
      chunks = allChunks.filter((c) => chunk_ids.includes(c.chunk_id));
    } else if (doc_ids && doc_ids.length > 0) {
      for (const docId of doc_ids) {
        const docChunks = await getChunks(docId);
        chunks.push(...docChunks);
      }
    } else {
      chunks = await getChunks();
    }
    
    if (chunks.length === 0) {
      failJob(jobId, "임베딩할 청크가 없습니다.");
      return;
    }
    
    // 이미 임베딩된 청크 제외
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
      completeJob(jobId, {
        success: true,
        processed: 0,
        failed: 0,
        skipped: skippedCount,
      });
      return;
    }
    
    // 작업 시작
    console.log(`[EmbeddingWorker] Starting job ${jobId} with ${chunksToEmbed.length} chunks`);
    startJob(jobId, chunksToEmbed.length);
    
    // 진행률 업데이트 콜백
    const onProgress = (current: number, message: string) => {
      console.log(`[EmbeddingWorker] Progress: ${current}/${chunksToEmbed.length} - ${message}`);
      updateJobProgress(jobId, current, undefined, message);
    };
    
    // 임베딩 생성
    let embeddingResult: {
      success: boolean;
      results: EmbeddingResult[];
      errors: { chunk_id: string; error: string }[];
      total_tokens: number;
      estimated_cost: number;
      processing_time_ms?: number;
    };
    
    if (isHuggingFace) {
      const result = await generateHuggingFaceEmbeddingsBatch(
        chunksToEmbed,
        settings.model,
        jobId,
        0,
        onProgress
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
      // OpenAI API - 배치별로 처리하면서 진행률 업데이트
      const batchSize = settings.batchSize || 100;
      const allResults: EmbeddingResult[] = [];
      const allErrors: { chunk_id: string; error: string }[] = [];
      let totalTokens = 0;
      let totalCost = 0;
      
      for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
        // 취소 확인
        if (isCancelled(jobId)) {
          failJob(jobId, "작업이 취소되었습니다.", {
            success: false,
            processed: allResults.length,
            failed: allErrors.length,
            skipped: skippedCount,
            errors: allErrors.slice(0, 10),
          });
          clearCancellation(jobId);
          return;
        }
        
        const batch = chunksToEmbed.slice(i, i + batchSize);
        onProgress(i + batch.length, `OpenAI 배치 ${Math.floor(i / batchSize) + 1} 처리 중...`);
        
        try {
          const result = await generateEmbeddingsBatch(batch, settings, effectiveApiKey!);
          allResults.push(...result.results);
          allErrors.push(...result.errors);
          totalTokens += result.total_tokens;
          totalCost += result.estimated_cost;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          for (const chunk of batch) {
            allErrors.push({ chunk_id: chunk.chunk_id, error: errorMsg });
          }
        }
      }
      
      embeddingResult = {
        success: allErrors.length === 0,
        results: allResults,
        errors: allErrors,
        total_tokens: totalTokens,
        estimated_cost: totalCost,
      };
    }
    
    // 취소 확인
    if (isCancelled(jobId)) {
      failJob(jobId, "작업이 취소되었습니다.", {
        success: false,
        processed: embeddingResult.results.length,
        failed: embeddingResult.errors.length,
        skipped: skippedCount,
        errors: embeddingResult.errors.slice(0, 10),
      });
      clearCancellation(jobId);
      return;
    }
    
    // ChromaDB에 저장
    let chromaDbSaved = 0;
    if (embeddingResult.results.length > 0) {
      try {
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

        // 배치로 ChromaDB에 저장 (한 번에 1000개씩)
        const chromaBatchSize = 1000;
        for (let i = 0; i < vectorDbChunks.length; i += chromaBatchSize) {
          const batch = vectorDbChunks.slice(i, i + chromaBatchSize);
          
          const vectorDbResponse = await fetch(`${BACKEND_URL}/vectordb/upsert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chunks: batch }),
          });

          if (vectorDbResponse.ok) {
            const vectorDbResult = await vectorDbResponse.json();
            chromaDbSaved += vectorDbResult.added + vectorDbResult.updated;
          }
        }
        
        console.log(`[ChromaDB] 저장 완료: ${chromaDbSaved}개`);
      } catch (chromaError) {
        console.error("[ChromaDB] 저장 오류:", chromaError);
      }
    }
    
    // 작업 완료
    completeJob(jobId, {
      success: embeddingResult.success,
      processed: embeddingResult.results.length,
      failed: embeddingResult.errors.length,
      skipped: skippedCount,
      errors: embeddingResult.errors.length > 0 ? embeddingResult.errors.slice(0, 10) : undefined,
      data: {
        total_tokens: embeddingResult.total_tokens,
        estimated_cost: embeddingResult.estimated_cost,
        chromadb_saved: chromaDbSaved,
        processing_time_ms: embeddingResult.processing_time_ms,
      },
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "임베딩 생성 중 오류가 발생했습니다.";
    console.error(`[EmbeddingWorker] Error:`, error);
    failJob(jobId, errorMessage);
  } finally {
    clearCancellation(jobId);
  }
}
