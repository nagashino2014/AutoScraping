/**
 * 보드별 상세 현황 API
 * GET /api/scraper/status/boards
 */

import { NextResponse } from "next/server";
import { getBoardStats, getBoardLatestStatus } from "@/lib/scraper/scraper-db";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { readScraperSchedules } from "@/lib/scraper/schedule-store";

export type BoardStatusItem = {
  board_id: string;
  board_name: string;
  org_id: string;
  org_name: string;
  org_logo: string | null;
  collection_mode: "web_scraping" | "api_only" | "hybrid";
  enabled: boolean;
  status: "active" | "running" | "warning" | "error" | "disabled" | "never";
  last_run_at: string | null;
  next_run_at: string | null;
  stats: {
    document_count: number;
    attachment_count: number;
    total_size_bytes: number;
    last_7d_documents: number;
  };
  last_error: string | null;
  schedule_name: string | null;
};

// 다음 실행 시간 계산 (간단한 cron 해석)
function getNextRunTime(cron: string, timezone: string): string | null {
  // 간단한 구현: 실제로는 cron-parser 라이브러리 사용 권장
  try {
    const parts = cron.split(" ");
    if (parts.length !== 5) return null;
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const now = new Date();
    
    // 매일 실행 (0 9 * * *)
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      const next = new Date(now);
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next.toISOString();
    }
    
    // 매주 특정 요일 (0 9 * * 1)
    if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
      const targetDay = parseInt(dayOfWeek);
      const next = new Date(now);
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0);
      while (next.getDay() !== targetDay || next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next.toISOString();
    }
    
    // 매월 특정일 (0 9 1 * *)
    if (dayOfMonth !== "*" && month === "*") {
      const next = new Date(now);
      next.setDate(parseInt(dayOfMonth));
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
      return next.toISOString();
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // 타겟 정보 로드
    const { orgs, boards } = readScraperTargets();
    const { schedules } = readScraperSchedules();
    
    // DB 통계 로드
    const boardStats = await getBoardStats();
    const boardStatus = await getBoardLatestStatus();
    
    // 맵 변환
    const orgMap = new Map(orgs.map((o) => [o.org_id, o]));
    const statsMap = new Map(boardStats.map((s) => [s.board_id, s]));
    const statusMap = new Map(boardStatus.map((s) => [s.board_id, s]));
    
    // 보드별 스케줄 매핑
    const boardScheduleMap = new Map<string, { cron: string; timezone: string; name: string }>();
    schedules.forEach((sched) => {
      sched.targets.forEach((boardId) => {
        boardScheduleMap.set(boardId, {
          cron: sched.cron,
          timezone: sched.timezone,
          name: sched.name,
        });
      });
    });
    
    // 결과 생성
    const result: BoardStatusItem[] = boards.map((board) => {
      const org = orgMap.get(board.org_id);
      const stats = statsMap.get(board.board_id);
      const status = statusMap.get(board.board_id);
      const schedule = boardScheduleMap.get(board.board_id);
      
      // 상태 결정
      let currentStatus: BoardStatusItem["status"] = "never";
      if (!board.enabled) {
        currentStatus = "disabled";
      } else if (status) {
        if (status.status === "running") {
          currentStatus = "running";
        } else if (status.status === "failed") {
          currentStatus = "error";
        } else if (status.status === "partial") {
          currentStatus = "warning";
        } else if (status.status === "success") {
          currentStatus = "active";
        }
      }
      
      // 모드 결정: board의 access_mode를 기준으로 정확히 판단
      let collectionMode: "web_scraping" | "api_only" | "hybrid" = "web_scraping";
      if (board.board_mode === "api" || board.access_mode === "api") {
        collectionMode = "api_only";
      } else if (board.board_mode === "hybrid") {
        collectionMode = "hybrid";
      }
      // static_html, dynamic_js, login_required는 모두 web_scraping
      
      return {
        board_id: board.board_id,
        board_name: board.board_name,
        org_id: board.org_id,
        org_name: org?.org_name || board.org_id,
        org_logo: org?.logo_path || null,
        collection_mode: collectionMode,
        enabled: board.enabled,
        status: currentStatus,
        last_run_at: status?.last_run_at || null,
        next_run_at: schedule ? getNextRunTime(schedule.cron, schedule.timezone) : null,
        stats: {
          document_count: stats?.document_count || 0,
          attachment_count: stats?.attachment_count || 0,
          total_size_bytes: stats?.total_size_bytes || 0,
          last_7d_documents: stats?.last_7d_documents || 0,
        },
        last_error: status?.error_message || null,
        schedule_name: schedule?.name || null,
      };
    });
    
    // 기관명 + 보드명 순으로 정렬
    result.sort((a, b) => {
      const orgCompare = a.org_name.localeCompare(b.org_name, "ko");
      if (orgCompare !== 0) return orgCompare;
      return a.board_name.localeCompare(b.board_name, "ko");
    });
    
    return NextResponse.json({
      success: true,
      boards: result,
      total: result.length,
    });
  } catch (error) {
    console.error("[status/boards] Error:", error);
    return NextResponse.json(
      { success: false, error: "보드 현황 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
