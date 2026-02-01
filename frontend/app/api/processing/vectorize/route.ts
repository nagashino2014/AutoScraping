/**
 * 벡터화 API
 * 
 * GET /api/processing/vectorize - 벡터 DB 상태 조회
 * POST /api/processing/vectorize - 벡터 DB에 청크 저장
 */

import { NextRequest, NextResponse } from "next/server";
import { getChunks, getChunkById } from "@/lib/chunking/chunking-store";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const DATA_DIR = path.join(process.cwd(), "data");
const EMBEDDING_DATA_FILE = path.join(DATA_DIR, "embedding-data.json");

// 임베딩 데이터 로드
function loadEmbeddingData(): { embeddings: Record<string, { embedding: number[]; model: string; tokens_used: number; created_at: string }> } {
  try {
    if (fs.existsSync(EMBEDDING_DATA_FILE)) {
      const content = fs.readFileSync(EMBEDDING_DATA_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Error loading embedding data:", error);
  }
  return { embeddings: {} };
}

// ============================================================================
// GET: 벡터 DB 상태 조회
// ============================================================================

export async function GET() {
  try {
    // 백엔드 상태 조회
    const backendRes = await fetch(`${BACKEND_URL}/vectordb/status`);
    const backendStatus = await backendRes.json();

    // 로컬 임베딩 통계 (embedding-data.json에서 직접 읽기)
    const embeddingData = loadEmbeddingData();
    const embeddedCount = Object.keys(embeddingData.embeddings).length;
    
    // 청킹 데이터에서 총 청크 수
    const allChunks = getChunks();

    return NextResponse.json({
      success: true,
      vectordb: backendStatus,
      local: {
        totalChunks: Math.max(allChunks.length, embeddedCount),
        embeddedChunks: embeddedCount,
        pendingChunks: Math.max(0, allChunks.length - embeddedCount),
        syncedToVectorDB: backendStatus.success ? (backendStatus.total_embeddings || backendStatus.total_vectors || 0) : 0,
      },
      canSync: embeddedCount > 0 && backendStatus.success,
    });

  } catch (error) {
    console.error("Error getting vectorize status:", error);
    
    // 백엔드 연결 실패 시에도 로컬 임베딩 데이터는 표시
    const embeddingData = loadEmbeddingData();
    const embeddedCount = Object.keys(embeddingData.embeddings).length;
    const allChunks = getChunks();

    return NextResponse.json({
      success: false,
      vectordb: {
        success: false,
        status: "disconnected",
        error: "백엔드 서버에 연결할 수 없습니다."
      },
      local: {
        totalChunks: Math.max(allChunks.length, embeddedCount),
        embeddedChunks: embeddedCount,
        pendingChunks: Math.max(0, allChunks.length - embeddedCount),
        syncedToVectorDB: 0,
      },
      canSync: false,
    });
  }
}

// ============================================================================
// POST: 벡터 DB에 청크 저장 (동기화)
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { collection_name = "document_embeddings" } = body;

    // embedding-data.json에서 직접 임베딩 데이터 로드
    const embeddingData = loadEmbeddingData();
    const embeddingEntries = Object.entries(embeddingData.embeddings);

    if (embeddingEntries.length === 0) {
      return NextResponse.json({
        success: false,
        error: "임베딩된 청크가 없습니다. 먼저 임베딩을 생성하세요.",
        synced: 0,
      });
    }

    // 청크 데이터와 매칭하여 동기화할 데이터 준비
    const chunksWithEmbeddings = [];
    
    for (const [chunkId, embeddingInfo] of embeddingEntries) {
      // 청킹 데이터에서 원본 청크 찾기 (있으면 메타데이터 포함)
      const originalChunk = getChunkById(chunkId);
      
      // chunk_id에서 메타데이터 파싱 (형식: org_board_date_docname_type_index)
      const idParts = chunkId.split("_");
      const chunkIndex = parseInt(idParts[idParts.length - 1]) || 0;
      const chunkType = idParts[idParts.length - 2] || "text";
      
      chunksWithEmbeddings.push({
        id: chunkId,
        content: originalChunk?.content || "",
        embedding: embeddingInfo.embedding,
        metadata: originalChunk ? {
          // 기본 메타데이터
          doc_id: originalChunk.metadata.doc_id,
          org_name: originalChunk.metadata.org_name,
          board_name: originalChunk.metadata.board_name,
          date_folder: originalChunk.metadata.date_folder,
          source_file: originalChunk.metadata.source_file,
          chunk_type: originalChunk.metadata.chunk_type,
          chunk_index: originalChunk.metadata.chunk_index,
          total_chunks: originalChunk.metadata.total_chunks,
          token_count: originalChunk.token_count,
          model: embeddingInfo.model,
          created_at: embeddingInfo.created_at,
          // 테이블 관련 메타데이터 (있는 경우)
          ...(originalChunk.metadata.table_id && { table_id: originalChunk.metadata.table_id }),
          ...(originalChunk.metadata.table_title && { table_title: originalChunk.metadata.table_title }),
          ...(originalChunk.metadata.total_rows !== undefined && { total_rows: originalChunk.metadata.total_rows }),
          ...(originalChunk.metadata.total_cols !== undefined && { total_cols: originalChunk.metadata.total_cols }),
          ...(originalChunk.metadata.headers && { headers: JSON.stringify(originalChunk.metadata.headers) }),
          ...(originalChunk.metadata.row_start !== undefined && { row_start: originalChunk.metadata.row_start }),
          ...(originalChunk.metadata.row_end !== undefined && { row_end: originalChunk.metadata.row_end }),
          ...(originalChunk.metadata.is_first_chunk !== undefined && { is_first_chunk: originalChunk.metadata.is_first_chunk }),
          ...(originalChunk.metadata.is_last_chunk !== undefined && { is_last_chunk: originalChunk.metadata.is_last_chunk }),
        } : {
          chunk_id: chunkId,
          chunk_type: chunkType,
          chunk_index: chunkIndex,
          model: embeddingInfo.model,
          tokens_used: embeddingInfo.tokens_used,
          created_at: embeddingInfo.created_at,
        }
      });
    }

    console.log(`[Sync] 동기화할 임베딩: ${chunksWithEmbeddings.length}개`);

    // 백엔드로 전송 (배치 단위)
    const batchSize = 100;
    let totalSynced = 0;
    let totalAdded = 0;
    let totalUpdated = 0;

    for (let i = 0; i < chunksWithEmbeddings.length; i += batchSize) {
      const batch = chunksWithEmbeddings.slice(i, i + batchSize);
      
      console.log(`[Sync] 배치 ${Math.floor(i / batchSize) + 1}: ${batch.length}개 전송 중...`);
      
      const res = await fetch(`${BACKEND_URL}/vectordb/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: batch }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error(`[Sync] 배치 실패:`, errorData);
        throw new Error(errorData.detail || errorData.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      console.log(`[Sync] 배치 결과:`, result);
      
      totalAdded += result.added || 0;
      totalUpdated += result.updated || 0;
      totalSynced += (result.added || 0) + (result.updated || 0);
    }

    return NextResponse.json({
      success: true,
      synced: totalSynced,
      added: totalAdded,
      updated: totalUpdated,
      total: chunksWithEmbeddings.length,
      collection_name,
    });

  } catch (error) {
    console.error("Error syncing to vector DB:", error);
    const errorMessage = error instanceof Error ? error.message : "벡터 DB 동기화 중 오류가 발생했습니다.";
    
    if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("fetch failed")) {
      return NextResponse.json(
        { success: false, error: "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
