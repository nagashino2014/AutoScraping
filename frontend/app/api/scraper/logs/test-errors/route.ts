import { NextResponse } from "next/server";
import { getDbAsync } from "@/lib/scraper/scraper-db";

/**
 * POST /api/scraper/logs/test-errors
 * 테스트용 에러 로그 생성 (개발/테스트 목적)
 */
export async function POST() {
  try {
    const db = await getDbAsync();
    const now = new Date();
    
    // 테스트 에러 1: 타임아웃 에러
    const log1Id = `log_test_${Date.now()}_1`;
    const started1 = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2시간 전
    const finished1 = new Date(now.getTime() - 2 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString(); // 5분 후
    
    db.run(`
      INSERT INTO scrape_logs (log_id, board_id, schedule_id, started_at, finished_at, status, docs_scraped, docs_skipped, docs_failed, pages_processed, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      log1Id,
      "keiti-notice", // 한국환경산업기술원 공지사항 (실제 board_id)
      null,
      started1,
      finished1,
      "failed",
      15,
      3,
      7,
      5,
      `TimeoutError: Navigation timeout of 30000 ms exceeded
    at Timeout.<anonymous> (/app/node_modules/playwright/lib/utils/async.js:45:11)
    at listOnTimeout (node:internal/timers:573:17)
    at process.processTimers (node:internal/timers:514:7)
    
Caused by: The page at https://www.keiti.re.kr/site/board/notice failed to load within the specified timeout.
Browser context: chromium
URL: https://www.keiti.re.kr/site/board/notice?page=3
Selector waited: table.board-list tbody tr

Possible causes:
- Server response delay
- Heavy page resources
- Network connectivity issues`
    ]);
    
    // 테스트 에러 2: HTTP 오류
    const log2Id = `log_test_${Date.now()}_2`;
    const started2 = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30분 전
    const finished2 = new Date(now.getTime() - 30 * 60 * 1000 + 2 * 60 * 1000).toISOString(); // 2분 후
    
    db.run(`
      INSERT INTO scrape_logs (log_id, board_id, schedule_id, started_at, finished_at, status, docs_scraped, docs_skipped, docs_failed, pages_processed, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      log2Id,
      "law_board1", // 국가법령정보센터 현행법령
      null,
      started2,
      finished2,
      "partial",
      42,
      5,
      3,
      8,
      `HTTPError: Request failed with status code 403 (Forbidden)
    at handleResponse (/app/lib/scraper/browser.ts:127:13)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    
Response details:
- URL: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=123456
- Status: 403 Forbidden
- Headers: {"x-rate-limit-remaining": "0", "retry-after": "60"}

Server response body:
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please try again later.",
  "retry_after_seconds": 60
}

This error typically occurs when:
1. IP-based rate limiting is triggered
2. User-Agent is blocked
3. Request frequency is too high`
    ]);
    
    // DB 저장
    const data = db.export();
    const fs = await import("fs");
    const path = await import("path");
    const dbPath = path.join(process.cwd(), "data", "scraper.db");
    fs.writeFileSync(dbPath, Buffer.from(data));
    
    return NextResponse.json({
      ok: true,
      message: "테스트 에러 로그 2건이 생성되었습니다.",
      logs: [
        { log_id: log1Id, type: "timeout", board: "keiti-notice" },
        { log_id: log2Id, type: "http_error", board: "law_board1" },
      ],
    });
    
  } catch (err: any) {
    console.error("[test-errors] POST error:", err);
    return NextResponse.json({ error: err.message || "생성 실패" }, { status: 500 });
  }
}

/**
 * DELETE /api/scraper/logs/test-errors
 * 테스트용 에러 로그 삭제
 */
export async function DELETE() {
  try {
    const db = await getDbAsync();
    
    // 테스트 로그만 삭제 (log_test_ 프리픽스)
    db.run("DELETE FROM scrape_logs WHERE log_id LIKE 'log_test_%'");
    
    // DB 저장
    const data = db.export();
    const fs = await import("fs");
    const path = await import("path");
    const dbPath = path.join(process.cwd(), "data", "scraper.db");
    fs.writeFileSync(dbPath, Buffer.from(data));
    
    return NextResponse.json({
      ok: true,
      message: "테스트 에러 로그가 삭제되었습니다.",
    });
    
  } catch (err: any) {
    console.error("[test-errors] DELETE error:", err);
    return NextResponse.json({ error: err.message || "삭제 실패" }, { status: 500 });
  }
}
