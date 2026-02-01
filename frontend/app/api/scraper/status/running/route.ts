/**
 * 실행 중인 작업 조회 API
 * GET /api/scraper/status/running
 */

import { NextResponse } from "next/server";
import { getRunningJobs } from "@/lib/scraper/scraper-db";
import { readScraperTargets } from "@/lib/scraper/targets-store";

export async function GET() {
  try {
    const runningJobs = await getRunningJobs();
    const { orgs, boards } = readScraperTargets();
    
    // 맵 변환
    const orgMap = new Map(orgs.map((o) => [o.org_id, o]));
    const boardMap = new Map(boards.map((b) => [b.board_id, b]));
    
    // 상세 정보 추가
    const jobs = runningJobs.map((job) => {
      const board = boardMap.get(job.board_id);
      const org = board ? orgMap.get(board.org_id) : null;
      
      return {
        log_id: job.log_id,
        board_id: job.board_id,
        board_name: board?.board_name || job.board_id,
        org_id: board?.org_id || "",
        org_name: org?.org_name || "",
        org_logo: org?.logo_path || null,
        schedule_id: job.schedule_id,
        started_at: job.started_at,
        docs_scraped: job.docs_scraped,
        docs_skipped: job.docs_skipped,
        docs_failed: job.docs_failed,
        pages_processed: job.pages_processed,
        // 실행 시간 계산 (초 단위)
        elapsed_seconds: Math.floor(
          (Date.now() - new Date(job.started_at).getTime()) / 1000
        ),
      };
    });
    
    return NextResponse.json({
      success: true,
      jobs,
      count: jobs.length,
    });
  } catch (error) {
    console.error("[status/running] Error:", error);
    return NextResponse.json(
      { success: false, error: "실행 중인 작업 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
