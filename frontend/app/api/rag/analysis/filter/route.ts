/**
 * RAG 분석 필터링 API
 * 
 * POST: 필터 조건에 맞는 청크 개수 조회
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

interface FilterOptions {
  dateRange?: {
    start: string;
    end: string;
  };
  orgs?: string[];
  boards?: string[];
  chunkTypes?: string[];
}

/**
 * ChromaDB where 절 생성
 */
function buildWhereClause(filter: FilterOptions): Record<string, any> | null {
  const conditions: Record<string, any>[] = [];
  
  // 기관 필터
  if (filter.orgs && filter.orgs.length > 0) {
    if (filter.orgs.length === 1) {
      conditions.push({ org_name: filter.orgs[0] });
    } else {
      conditions.push({ org_name: { "$in": filter.orgs } });
    }
  }
  
  // 보드 필터
  if (filter.boards && filter.boards.length > 0) {
    if (filter.boards.length === 1) {
      conditions.push({ board_name: filter.boards[0] });
    } else {
      conditions.push({ board_name: { "$in": filter.boards } });
    }
  }
  
  // 청크 유형 필터
  if (filter.chunkTypes && filter.chunkTypes.length > 0) {
    if (filter.chunkTypes.length === 1) {
      conditions.push({ chunk_type: filter.chunkTypes[0] });
    } else {
      conditions.push({ chunk_type: { "$in": filter.chunkTypes } });
    }
  }
  
  // 날짜 필터 (date_folder 메타데이터 사용, YYYY-MM 형식)
  if (filter.dateRange) {
    if (filter.dateRange.start) {
      const startMonth = filter.dateRange.start.slice(0, 7);
      conditions.push({ date_folder: { "$gte": startMonth } });
    }
    if (filter.dateRange.end) {
      const endMonth = filter.dateRange.end.slice(0, 7);
      conditions.push({ date_folder: { "$lte": endMonth } });
    }
  }
  
  if (conditions.length === 0) {
    return null;
  }
  
  if (conditions.length === 1) {
    return conditions[0];
  }
  
  return { "$and": conditions };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const filter = body as FilterOptions;
    
    const whereClause = buildWhereClause(filter);
    
    // 백엔드에 필터링된 개수 요청
    // ChromaDB는 직접적인 count + where를 지원하지 않으므로
    // get으로 ID만 조회하여 개수 계산
    const res = await fetch(`${BACKEND_URL}/vectordb/get-filtered`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        where: whereClause,
        include: [],  // ID만 가져오기
        limit: 10000,
      }),
    });
    
    if (!res.ok) {
      // 엔드포인트가 없으면 전체 개수 반환
      const statusRes = await fetch(`${BACKEND_URL}/vectordb/status`);
      if (statusRes.ok) {
        const status = await statusRes.json();
        return NextResponse.json({
          success: true,
          count: status.total_embeddings || 0,
          filtered: false,
          message: "필터링 미지원 - 전체 개수 반환",
        });
      }
      
      throw new Error("벡터 DB 조회 실패");
    }
    
    const data = await res.json();
    
    return NextResponse.json({
      success: true,
      count: data.count || (data.ids ? data.ids.length : 0),
      filtered: true,
      filter,
    });
    
  } catch (error: any) {
    console.error("[RAG Filter] Error:", error);
    
    return NextResponse.json({
      success: false,
      error: error.message || "필터링 중 오류가 발생했습니다.",
      count: 0,
    });
  }
}
