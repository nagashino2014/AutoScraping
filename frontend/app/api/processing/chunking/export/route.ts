/**
 * 청킹/임베딩 결과 내보내기 API
 * 
 * GET /api/processing/chunking/export
 * - format: json | csv
 * - include_embeddings: boolean (기본 false, 임베딩 벡터 포함 여부)
 * - doc_ids: 특정 문서만 내보내기 (선택)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getChunks,
  getChunkedDocuments,
  getChunkingStats,
  Chunk,
} from "@/lib/chunking/chunking-store";
import { getEmbeddingStats, getEmbedding } from "@/lib/chunking/embedding";

export const runtime = "nodejs";

// ============================================================================
// GET: 결과 내보내기
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";
    const includeEmbeddings = searchParams.get("include_embeddings") === "true";
    const docIdsParam = searchParams.get("doc_ids");
    const docIds = docIdsParam ? docIdsParam.split(",") : null;

    // 청크 데이터 조회
    let chunks: Chunk[] = [];
    
    if (docIds && docIds.length > 0) {
      // 특정 문서들만
      for (const docId of docIds) {
        chunks.push(...(await getChunks(docId)));
      }
    } else {
      // 모든 청크
      chunks = await getChunks();
    }

    if (chunks.length === 0) {
      return NextResponse.json(
        { success: false, error: "내보낼 데이터가 없습니다." },
        { status: 404 }
      );
    }

    // 내보내기 데이터 가공
    const exportChunks = chunks.map((chunk) => {
      const embeddingResult = getEmbedding(chunk.chunk_id);
      
      const baseData = {
        chunk_id: chunk.chunk_id,
        content: chunk.content,
        token_count: chunk.token_count,
        chunk_type: chunk.metadata.chunk_type,
        chunk_index: chunk.metadata.chunk_index,
        total_chunks: chunk.metadata.total_chunks,
        doc_id: chunk.metadata.doc_id,
        org_name: chunk.metadata.org_name,
        board_name: chunk.metadata.board_name,
        date_folder: chunk.metadata.date_folder,
        source_file: chunk.metadata.source_file,
        // 표 관련 메타데이터
        table_id: chunk.metadata.table_id || null,
        table_title: chunk.metadata.table_title || null,
        headers: chunk.metadata.headers ? chunk.metadata.headers.join(", ") : null,
        total_rows: chunk.metadata.total_rows || null,
        row_start: chunk.metadata.row_start || null,
        row_end: chunk.metadata.row_end || null,
        // 임베딩 정보
        has_embedding: !!embeddingResult,
        embedding_model: embeddingResult?.model || null,
        created_at: chunk.created_at,
      };

      // 임베딩 벡터 포함 (선택적)
      if (includeEmbeddings && embeddingResult) {
        return {
          ...baseData,
          embedding: embeddingResult.embedding,
        };
      }

      return baseData;
    });

    // 통계 정보
    const chunkingStats = getChunkingStats();
    const embeddingStats = getEmbeddingStats();

    if (format === "csv") {
      // CSV 형식 생성
      const csvHeaders = [
        "chunk_id",
        "content",
        "token_count",
        "chunk_type",
        "chunk_index",
        "total_chunks",
        "doc_id",
        "org_name",
        "board_name",
        "date_folder",
        "source_file",
        "table_id",
        "table_title",
        "headers",
        "total_rows",
        "row_start",
        "row_end",
        "has_embedding",
        "embedding_model",
        "created_at",
      ];

      // 임베딩 벡터는 CSV에서 제외 (너무 큼)
      const csvRows = exportChunks.map((chunk) => {
        return csvHeaders.map((header) => {
          const value = chunk[header as keyof typeof chunk];
          if (value === null || value === undefined) return "";
          if (typeof value === "string") {
            // CSV 이스케이프: 쌍따옴표와 줄바꿈 처리
            const escaped = value.replace(/"/g, '""').replace(/\n/g, "\\n");
            return `"${escaped}"`;
          }
          return String(value);
        }).join(",");
      });

      const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");

      // CSV 파일로 응답
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="chunks_export_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // JSON 형식
    const jsonExport = {
      exportedAt: new Date().toISOString(),
      summary: {
        totalChunks: exportChunks.length,
        textChunks: chunkingStats.textChunks,
        tableChunks: chunkingStats.tableChunks,
        totalTokens: chunkingStats.totalTokens,
        embeddedChunks: embeddingStats.embeddedChunks,
        embeddingModel: embeddingStats.totalEmbeddings > 0 ? "text-embedding-3-small" : null,
      },
      chunks: exportChunks,
    };

    // JSON 파일로 응답
    return new NextResponse(JSON.stringify(jsonExport, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="chunks_export_${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });

  } catch (error) {
    console.error("Error exporting chunks:", error);
    return NextResponse.json(
      { success: false, error: "내보내기 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST: 내보내기 정보 조회 (미리보기)
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { doc_ids } = body as { doc_ids?: string[] };

    // 청크 데이터 조회
    let chunks: Chunk[] = [];
    
    if (doc_ids && doc_ids.length > 0) {
      for (const docId of doc_ids) {
        chunks.push(...(await getChunks(docId)));
      }
    } else {
      chunks = await getChunks();
    }

    // 임베딩 정보 수집
    let embeddedCount = 0;
    for (const chunk of chunks) {
      if (getEmbedding(chunk.chunk_id)) {
        embeddedCount++;
      }
    }

    // 예상 파일 크기 계산 (대략적)
    const avgContentLength = chunks.length > 0
      ? chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length
      : 0;
    const estimatedJsonSize = chunks.length * (avgContentLength + 500); // 메타데이터 포함
    const estimatedCsvSize = chunks.length * (avgContentLength + 200);

    return NextResponse.json({
      success: true,
      preview: {
        totalChunks: chunks.length,
        textChunks: chunks.filter(c => c.metadata.chunk_type === "text").length,
        tableChunks: chunks.filter(c => 
          c.metadata.chunk_type === "table_full" || 
          c.metadata.chunk_type === "table_segment"
        ).length,
        embeddedChunks: embeddedCount,
        totalTokens: chunks.reduce((sum, c) => sum + (c.token_count || 0), 0),
        estimatedJsonSize,
        estimatedCsvSize,
        documents: doc_ids?.length || getChunkedDocuments().length,
      },
    });

  } catch (error) {
    console.error("Error getting export preview:", error);
    return NextResponse.json(
      { success: false, error: "미리보기 정보를 가져오는데 실패했습니다." },
      { status: 500 }
    );
  }
}
