import { NextResponse } from "next/server";
import { 
  getErrorStats, 
  getErrorList, 
  getScrapeLogDetail,
  ERROR_TYPE_LABELS,
  type ErrorType 
} from "@/lib/scraper/scraper-db";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { readScraperSchedules } from "@/lib/scraper/schedule-store";

/**
 * GET /api/scraper/logs/errors
 * 
 * Query params:
 * - mode: "stats" | "list" | "detail"
 * - limit, offset: 페이징 (list 모드)
 * - errorType: 에러 유형 필터 (list 모드)
 * - boardId: 보드 필터 (list 모드)
 * - logId: 로그 ID (detail 모드)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "stats";
    
    // 통계 모드
    if (mode === "stats") {
      const stats = await getErrorStats();
      return NextResponse.json({
        ...stats,
        type_labels: ERROR_TYPE_LABELS,
      });
    }
    
    // 상세 조회 모드
    if (mode === "detail") {
      const logId = url.searchParams.get("logId");
      if (!logId) {
        return NextResponse.json({ error: "logId is required" }, { status: 400 });
      }
      
      const log = await getScrapeLogDetail(logId);
      if (!log) {
        return NextResponse.json({ error: "Log not found" }, { status: 404 });
      }
      
      // 보드/기관 정보 추가
      const targets = await readScraperTargets();
      const schedules = await readScraperSchedules();
      
      let boardInfo: { board_name: string; org_name: string; org_id: string } | null = null;
      let scheduleInfo: { name: string; cron: string } | null = null;

      const orgMap = new Map(targets.orgs.map((o) => [o.org_id, o]));
      const boardMap = new Map(targets.boards.map((b) => [b.board_id, b]));
      const b = boardMap.get(log.board_id);
      if (b) {
        const o = orgMap.get(b.org_id);
        boardInfo = {
          board_name: b.board_name || b.board_id,
          org_name: o?.org_name || b.org_id,
          org_id: b.org_id,
        };
      }
      
      if (log.schedule_id) {
        const schedule = (schedules.schedules || []).find((s: any) => s.schedule_id === log.schedule_id);
        if (schedule) {
          scheduleInfo = {
            name: schedule.name || schedule.schedule_id,
            cron: schedule.cron || "",
          };
        }
      }
      
      return NextResponse.json({
        ...log,
        board_info: boardInfo,
        schedule_info: scheduleInfo,
      });
    }
    
    // 목록 모드
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const errorType = url.searchParams.get("errorType") as ErrorType | null;
    const boardId = url.searchParams.get("boardId") || undefined;
    
    const { items, total } = await getErrorList({
      limit,
      offset,
      errorType: errorType || undefined,
      boardId,
    });
    
    // 보드/기관/스케줄 정보 추가
    const targets = await readScraperTargets();
    const schedules = await readScraperSchedules();
    
    const boardMap = new Map<string, { board_name: string; org_name: string; org_id: string }>();
    const orgMap = new Map(targets.orgs.map((o) => [o.org_id, o]));
    for (const board of targets.boards) {
      const org = orgMap.get(board.org_id);
      boardMap.set(board.board_id, {
        board_name: board.board_name || board.board_id,
        org_name: org?.org_name || board.org_id,
        org_id: board.org_id,
      });
    }
    
    const scheduleMap = new Map<string, { name: string; cron: string }>();
    for (const schedule of schedules.schedules || []) {
      scheduleMap.set(schedule.schedule_id, {
        name: schedule.name || schedule.schedule_id,
        cron: schedule.cron || "",
      });
    }
    
    const enrichedItems = items.map((item) => {
      const boardInfo = boardMap.get(item.board_id);
      const scheduleInfo = item.schedule_id ? scheduleMap.get(item.schedule_id) : null;
      
      return {
        ...item,
        board_name: boardInfo?.board_name || item.board_id,
        org_name: boardInfo?.org_name || "-",
        org_id: boardInfo?.org_id || "-",
        schedule_name: scheduleInfo?.name || "-",
      };
    });
    
    return NextResponse.json({
      items: enrichedItems,
      total,
      type_labels: ERROR_TYPE_LABELS,
    });
    
  } catch (err: any) {
    console.error("[scraper/logs/errors] GET error:", err);
    return NextResponse.json({ error: err.message || "조회 실패" }, { status: 500 });
  }
}
