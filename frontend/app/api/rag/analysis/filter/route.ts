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
 * 날짜 범위에서 모든 YYYY-MM 값 생성
 * ChromaDB의 $gte/$lte가 문자열에서 불안정할 수 있으므로 $in으로 변환
 */
function generateDateFolderValues(start: string, end: string): string[] {
  const values: string[] = [];
  
  // start와 end에서 연도와 월 추출
  const startMatch = start.match(/^(\d{4})-?(\d{2})?/);
  const endMatch = end.match(/^(\d{4})-?(\d{2})?/);
  
  if (!startMatch || !endMatch) return values;
  
  const startYear = parseInt(startMatch[1]);
  const startMonth = startMatch[2] ? parseInt(startMatch[2]) : 1;
  const endYear = parseInt(endMatch[1]);
  const endMonth = endMatch[2] ? parseInt(endMatch[2]) : 12;
  
  // 시작일부터 종료일까지 모든 YYYY-MM 생성
  for (let year = startYear; year <= endYear; year++) {
    const monthStart = (year === startYear) ? startMonth : 1;
    const monthEnd = (year === endYear) ? endMonth : 12;
    
    for (let month = monthStart; month <= monthEnd; month++) {
      values.push(`${year}-${String(month).padStart(2, "0")}`);
    }
  }
  
  return values;
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
  // $in 연산자로 명시적으로 모든 해당 월을 지정 (ChromaDB 호환성 향상)
  if (filter.dateRange && (filter.dateRange.start || filter.dateRange.end)) {
    const start = filter.dateRange.start || "2020-01";
    const end = filter.dateRange.end || "2030-12";
    const dateFolders = generateDateFolderValues(start, end);
    
    if (dateFolders.length > 0) {
      if (dateFolders.length === 1) {
        conditions.push({ date_folder: dateFolders[0] });
      } else {
        conditions.push({ date_folder: { "$in": dateFolders } });
      }
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
    
    // 백엔드에 필터링된 개수 요청 (전용 count 엔드포인트 사용)
    const res = await fetch(`${BACKEND_URL}/vectordb/count-filtered`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        where: whereClause,
      }),
    });
    
    if (!res.ok) {
      // count-filtered 엔드포인트가 없으면 status에서 전체 개수 반환
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
    
    if (!data.success) {
      throw new Error(data.error || "카운트 조회 실패");
    }
    
    return NextResponse.json({
      success: true,
      count: data.count || 0,
      filtered: data.filtered ?? (whereClause !== null),
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
