/**
 * 기간별 수집 추이 차트 데이터 API
 * GET /api/scraper/status/chart/timeline?start=2026-01-01&end=2026-01-15&group=day
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollectionTimeline } from "@/lib/scraper/scraper-db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 기본값: 최근 30일
    const endDate = searchParams.get("end") || new Date().toISOString().split("T")[0];
    const startDate = searchParams.get("start") || 
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const groupBy = (searchParams.get("group") || "day") as "day" | "week" | "month";
    
    // 날짜 유효성 검사
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return NextResponse.json(
        { success: false, error: "잘못된 날짜 형식입니다. YYYY-MM-DD 형식을 사용하세요." },
        { status: 400 }
      );
    }
    
    const data = await getCollectionTimeline(
      `${startDate}T00:00:00.000Z`,
      `${endDate}T23:59:59.999Z`,
      groupBy
    );
    
    return NextResponse.json({
      success: true,
      data,
      period: { start: startDate, end: endDate },
      group_by: groupBy,
    });
  } catch (error) {
    console.error("[status/chart/timeline] Error:", error);
    return NextResponse.json(
      { success: false, error: "차트 데이터 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
