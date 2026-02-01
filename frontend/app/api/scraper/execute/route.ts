/**
 * 범용 스크래핑 실행 API
 * 
 * POST /api/scraper/execute
 * - board_id: 스크래핑 대상 보드 ID
 * - max_pages?: 최대 페이지 수 (테스트용)
 * - delay_ms?: 요청 간 딜레이
 */

import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { runScraper, type WebConfig } from "@/lib/scraper/scraper-engine";
import type { DedupKeyType } from "@/lib/scraper/scraper-db";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 제한

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { board_id, max_pages, delay_ms } = body;

    if (!board_id || typeof board_id !== "string") {
      return NextResponse.json({ error: "board_id가 필요합니다." }, { status: 400 });
    }

    // 보드 및 기관 정보 조회
    const data = readScraperTargets();
    const board = data.boards.find((b) => b.board_id === board_id);
    
    if (!board) {
      return NextResponse.json({ error: "보드를 찾을 수 없습니다." }, { status: 404 });
    }

    if (!board.list_url) {
      return NextResponse.json({ error: "보드에 list_url이 설정되지 않았습니다." }, { status: 400 });
    }

    if (!board.web_config) {
      return NextResponse.json({ error: "보드에 web_config가 설정되지 않았습니다." }, { status: 400 });
    }

    const org = data.orgs.find((o) => o.org_id === board.org_id);
    if (!org) {
      return NextResponse.json({ error: "소속 기관을 찾을 수 없습니다." }, { status: 404 });
    }

    // 스크래핑 실행
    const result = await runScraper({
      boardId: board.board_id,
      orgId: board.org_id,
      listUrl: board.list_url,
      webConfig: board.web_config as WebConfig,
      dedupKey: (board.dedup_key as DedupKeyType) || "url",
      maxPages: max_pages || undefined,
      delayMs: delay_ms || 500,
    });

    return NextResponse.json({
      ok: result.success,
      log_id: result.log.log_id,
      status: result.log.status,
      stats: {
        docs_scraped: result.log.docs_scraped,
        docs_skipped: result.log.docs_skipped,
        docs_failed: result.log.docs_failed,
        pages_processed: result.log.pages_processed,
      },
      documents_count: result.documents.length,
      errors: result.errors,
    });

  } catch (err: any) {
    console.error("[execute] Error:", err);
    return NextResponse.json(
      { error: err.message || "스크래핑 실행 실패" },
      { status: 500 }
    );
  }
}
