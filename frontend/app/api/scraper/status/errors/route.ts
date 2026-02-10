/**
 * 에러 로그 조회 API
 * GET /api/scraper/status/errors
 */

import { NextRequest, NextResponse } from "next/server";
import { getDbAsync } from "@/lib/scraper/scraper-db";
import { readScraperTargets } from "@/lib/scraper/targets-store";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const days = parseInt(searchParams.get("days") || "7", 10);
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  
  try {
    const db = await getDbAsync();
    const { orgs, boards } = readScraperTargets();
    
    // 맵 변환
    const orgMap = new Map(orgs.map((o) => [o.org_id, o]));
    const boardMap = new Map(boards.map((b) => [b.board_id, b]));
    
    // 기간 설정
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    
    // 에러가 있는 로그 조회 (실패 또는 부분 실패)
    const result = db.exec(`
      SELECT 
        log_id,
        board_id,
        schedule_id,
        started_at,
        finished_at,
        status,
        docs_scraped,
        docs_skipped,
        docs_failed,
        pages_processed,
        error_message
      FROM scrape_logs
      WHERE (status = 'failed' OR docs_failed > 0)
        AND date(started_at) >= '${startDate}'
      ORDER BY started_at DESC
      LIMIT ${limit}
    `);
    
    const logs = result[0]?.values.map((row: unknown[]) => {
      const boardId = row[1] as string;
      const board = boardMap.get(boardId);
      const org = board ? orgMap.get(board.org_id) : null;
      
      return {
        log_id: row[0] as string,
        board_id: boardId,
        board_name: board?.board_name || boardId,
        org_id: board?.org_id || "",
        org_name: org?.org_name || "",
        org_logo: org?.logo_path || null,
        schedule_id: row[2] as string | null,
        started_at: row[3] as string,
        finished_at: row[4] as string | null,
        status: row[5] as string,
        docs_scraped: row[6] as number,
        docs_skipped: row[7] as number,
        docs_failed: row[8] as number,
        pages_processed: row[9] as number,
        error_message: row[10] as string | null,
      };
    }) || [];
    
    return NextResponse.json({
      success: true,
      logs,
      count: logs.length,
    });
  } catch (error) {
    console.error("[status/errors] Error:", error);
    return NextResponse.json(
      { success: false, error: "에러 로그 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
