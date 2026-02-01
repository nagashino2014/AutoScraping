import { NextRequest, NextResponse } from "next/server";
import {
  getChunks,
  getChunkById,
  deleteChunksByDocId,
} from "@/lib/chunking/chunking-store";

// GET: 청크 목록 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get("doc_id");
    const chunkId = searchParams.get("chunk_id");
    const chunkType = searchParams.get("chunk_type"); // text, table
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    
    // 단일 청크 조회
    if (chunkId) {
      const chunk = getChunkById(chunkId);
      if (!chunk) {
        return NextResponse.json(
          { success: false, error: "청크를 찾을 수 없습니다." },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, chunk });
    }
    
    // 청크 목록 조회
    let chunks = getChunks(docId || undefined);
    
    // 타입 필터
    if (chunkType) {
      if (chunkType === "text") {
        chunks = chunks.filter(c => c.metadata.chunk_type === "text");
      } else if (chunkType === "table") {
        chunks = chunks.filter(c => 
          c.metadata.chunk_type === "table_full" || 
          c.metadata.chunk_type === "table_segment"
        );
      }
    }
    
    // 페이지네이션
    const total = chunks.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedChunks = chunks.slice(startIndex, endIndex);
    
    // 통계
    const stats = {
      totalChunks: total,
      textChunks: chunks.filter(c => c.metadata.chunk_type === "text").length,
      tableChunks: chunks.filter(c => 
        c.metadata.chunk_type === "table_full" || 
        c.metadata.chunk_type === "table_segment"
      ).length,
      totalTokens: chunks.reduce((sum, c) => sum + (c.token_count || 0), 0),
      embeddedChunks: chunks.filter(c => c.embedding && c.embedding.length > 0).length,
    };
    
    return NextResponse.json({
      success: true,
      chunks: paginatedChunks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats,
    });
    
  } catch (error) {
    console.error("Error getting chunks:", error);
    return NextResponse.json(
      { success: false, error: "청크 목록을 불러오는데 실패했습니다." },
      { status: 500 }
    );
  }
}

// DELETE: 청크 삭제
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get("doc_id");
    
    if (!docId) {
      return NextResponse.json(
        { success: false, error: "doc_id가 필요합니다." },
        { status: 400 }
      );
    }
    
    deleteChunksByDocId(docId);
    
    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error("Error deleting chunks:", error);
    return NextResponse.json(
      { success: false, error: "청크 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
