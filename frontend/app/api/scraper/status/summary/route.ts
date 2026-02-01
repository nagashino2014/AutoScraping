/**
 * 수집 현황 요약 통계 API
 * GET /api/scraper/status/summary
 */

import { NextResponse } from "next/server";
import { getStatusSummary } from "@/lib/scraper/scraper-db";

export async function GET() {
  try {
    const summary = await getStatusSummary();
    
    return NextResponse.json({
      success: true,
      data: {
        ...summary,
        last_updated: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[status/summary] Error:", error);
    return NextResponse.json(
      { success: false, error: "통계 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
