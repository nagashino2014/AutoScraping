/**
 * RAG 분석 통계 API
 * 
 * GET: 벡터 DB의 메타데이터 통계 조회 (기관, 보드, 날짜 범위, 청크 유형)
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

interface ChunkMetadata {
  org_name?: string;
  board_name?: string;
  date_folder?: string;
  chunk_type?: string;
  [key: string]: any;
}

export async function GET() {
  try {
    // 백엔드에서 전체 통계 조회
    const statusRes = await fetch(`${BACKEND_URL}/vectordb/status`);
    
    if (!statusRes.ok) {
      return NextResponse.json({
        success: false,
        error: "벡터 DB 상태를 조회할 수 없습니다.",
        connected: false,
        totalChunks: 0,
        organizations: [],
        boards: [],
        dateRange: { earliest: "", latest: "" },
        chunkTypes: [],
      });
    }
    
    const status = await statusRes.json();
    
    if (!status.success) {
      return NextResponse.json({
        success: false,
        error: status.error || "벡터 DB가 비활성화되어 있습니다.",
        connected: false,
        totalChunks: 0,
        organizations: [],
        boards: [],
        dateRange: { earliest: "", latest: "" },
        chunkTypes: [],
      });
    }
    
    // 샘플 데이터에서 상세 통계 추출
    let organizations: { id: string; name: string; count: number }[] = [];
    let boards: { id: string; name: string; orgName: string; count: number }[] = [];
    let dateRange = { earliest: "", latest: "" };
    let chunkTypes: { type: string; count: number }[] = [];
    
    // org_distribution에서 기관 목록 생성
    if (status.org_distribution) {
      organizations = Object.entries(status.org_distribution).map(([name, count]) => ({
        id: name.toLowerCase().replace(/\s+/g, "_"),
        name,
        count: count as number,
      }));
    }
    
    // 샘플 데이터로 추가 통계 수집 (보드, 날짜, 청크 유형)
    try {
      const peekRes = await fetch(`${BACKEND_URL}/vectordb/peek?limit=1000`);
      
      if (peekRes.ok) {
        const peekData = await peekRes.json();
        
        if (peekData.metadatas && peekData.metadatas.length > 0) {
          const boardMap = new Map<string, { name: string; orgName: string; count: number }>();
          const dateSet = new Set<string>();
          const typeMap = new Map<string, number>();
          
          for (const meta of peekData.metadatas as ChunkMetadata[]) {
            if (!meta) continue;
            
            // 보드 통계
            if (meta.board_name) {
              const key = `${meta.org_name || "unknown"}_${meta.board_name}`;
              const existing = boardMap.get(key);
              if (existing) {
                existing.count++;
              } else {
                boardMap.set(key, {
                  name: meta.board_name,
                  orgName: meta.org_name || "unknown",
                  count: 1,
                });
              }
            }
            
            // 날짜 통계
            if (meta.date_folder) {
              dateSet.add(meta.date_folder);
            }
            
            // 청크 유형 통계
            if (meta.chunk_type) {
              const count = typeMap.get(meta.chunk_type) || 0;
              typeMap.set(meta.chunk_type, count + 1);
            }
          }
          
          // 보드 목록 생성
          boards = Array.from(boardMap.entries()).map(([key, value]) => ({
            id: key,
            name: value.name,
            orgName: value.orgName,
            count: value.count,
          }));
          
          // 날짜 범위 계산
          const dates = Array.from(dateSet).sort();
          if (dates.length > 0) {
            dateRange = {
              earliest: dates[0],
              latest: dates[dates.length - 1],
            };
          }
          
          // 청크 유형 목록 생성
          chunkTypes = Array.from(typeMap.entries()).map(([type, count]) => ({
            type,
            count,
          }));
        }
      }
    } catch (peekError) {
      console.log("[RAG Stats] 샘플 데이터 조회 실패, 기본 통계만 반환:", peekError);
    }
    
    return NextResponse.json({
      success: true,
      connected: true,
      totalChunks: status.total_embeddings || 0,
      organizations,
      boards,
      dateRange,
      chunkTypes,
      collectionName: status.collection_name,
      storagePath: status.storage_path,
    });
    
  } catch (error: any) {
    console.error("[RAG Stats] Error:", error);
    
    const isConnectionError = error.message?.includes("ECONNREFUSED") || 
                              error.message?.includes("fetch failed");
    
    return NextResponse.json({
      success: false,
      error: isConnectionError 
        ? "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요."
        : error.message || "통계 조회 중 오류가 발생했습니다.",
      connected: false,
      totalChunks: 0,
      organizations: [],
      boards: [],
      dateRange: { earliest: "", latest: "" },
      chunkTypes: [],
    });
  }
}
