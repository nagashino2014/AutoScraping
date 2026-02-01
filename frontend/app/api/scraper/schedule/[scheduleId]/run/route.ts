import { NextResponse } from "next/server";
import {
  readScraperSchedules,
  writeScraperSchedules,
  type ScraperRun,
} from "@/lib/scraper/schedule-store";
import { readScraperTargets, type Board } from "@/lib/scraper/targets-store";
import { runScraper, type WebConfig } from "@/lib/scraper/scraper-engine";
import type { DedupKeyType } from "@/lib/scraper/scraper-db";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 제한

function makeRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `run_${ts}_${rand}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(_req: Request, ctx: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await ctx.params;
  const schedule_id = decodeURIComponent(scheduleId);

  const data = readScraperSchedules();
  const schedule = data.schedules.find((s) => s.schedule_id === schedule_id);
  if (!schedule) return NextResponse.json({ error: "schedule_not_found" }, { status: 404 });

  // 중복 실행 방지
  const hasRunning = data.runs.some((r) => r.schedule_id === schedule_id && r.status === "running");
  if (hasRunning) return NextResponse.json({ error: "schedule_running" }, { status: 409 });

  const startedAt = new Date();
  const run: ScraperRun = {
    run_id: makeRunId(),
    schedule_id,
    triggered_by: "manual",
    started_at: startedAt.toISOString(),
    status: "running",
    summary: "스크래핑 실행이 시작되었습니다.",
  };

  writeScraperSchedules({
    schedules: data.schedules,
    runs: [run, ...data.runs].slice(0, 5000),
  });

  const targetsData = readScraperTargets();
  const boardsById = new Map(targetsData.boards.map((b) => [b.board_id, b] as const));

  const boardIds = Array.isArray(schedule.targets) ? schedule.targets : [];
  const orgIds = Array.isArray((schedule as any).org_ids) ? (schedule as any).org_ids : [];

  // 오늘 날짜 체크 (기간 설정용)
  const today = startedAt.toISOString().split("T")[0];

  const isWithinPeriod = (board: Board): boolean => {
    const config = board.schedule_config;
    if (!config || config.scheduleMode !== "period") return true;
    
    const startDate = config.startDate;
    const endDate = config.endDate;
    
    if (startDate && today < startDate) return false;
    if (endDate && today > endDate) return false;
    
    return true;
  };

  // 대상 보드 필터링
  const boards = boardIds
    .map((id) => boardsById.get(id))
    .filter((b): b is Board => b !== undefined)
    .filter((b) => (orgIds.length ? orgIds.includes(b.org_id) : true))
    .filter(isWithinPeriod);

  let totalScraped = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let boardsProcessed = 0;
  const errors: string[] = [];

  // 각 보드에 대해 스크래핑 실행
  for (const board of boards) {
    if (!board.list_url) {
      errors.push(`${board.board_name}: list_url 없음`);
      totalFailed++;
      continue;
    }

    if (!board.web_config) {
      errors.push(`${board.board_name}: web_config 없음`);
      totalFailed++;
      continue;
    }

    try {
      // 스크래핑 엔진 실행
      const result = await runScraper({
        boardId: board.board_id,
        orgId: board.org_id,
        listUrl: board.list_url,
        webConfig: board.web_config as WebConfig,
        dedupKey: (board.dedup_key as DedupKeyType) || "url",
        scheduleId: schedule_id,
        delayMs: Math.round(1000 / (schedule.rate_limit?.rps || 0.5)), // RPS 기반 딜레이
      });

      totalScraped += result.log.docs_scraped;
      totalSkipped += result.log.docs_skipped;
      totalFailed += result.log.docs_failed;
      boardsProcessed++;

      if (result.errors.length > 0) {
        errors.push(`${board.board_name}: ${result.errors.slice(0, 3).join(", ")}`);
      }

    } catch (err: any) {
      errors.push(`${board.board_name}: ${err.message}`);
      totalFailed++;
    }

    // 보드 간 딜레이
    await sleep(500);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const finalStatus: ScraperRun["status"] = 
    totalFailed > 0 && totalScraped === 0 ? "failed" : 
    totalFailed > 0 ? "failed" : "success";

  // 결과 저장
  const data2 = readScraperSchedules();
  const nextRuns = data2.runs.map((r) => {
    if (r.run_id !== run.run_id) return r;
    
    let summary = `스크래핑 완료: ${totalScraped}건 수집, ${totalSkipped}건 스킵`;
    if (totalFailed > 0) {
      summary += `, ${totalFailed}건 실패`;
    }
    summary += ` (${boardsProcessed}/${boards.length} 보드)`;
    
    return {
      ...r,
      finished_at: finishedAt.toISOString(),
      status: finalStatus,
      summary,
      metrics: {
        new_records: totalScraped,
        skipped_duplicates: totalSkipped,
        failed_records: totalFailed,
        duration_ms: durationMs,
      },
    } satisfies ScraperRun;
  });

  writeScraperSchedules({
    schedules: data2.schedules,
    runs: nextRuns,
  });

  const updatedRun = nextRuns.find((r) => r.run_id === run.run_id) ?? run;
  
  return NextResponse.json({ 
    ok: finalStatus !== "failed", 
    run: updatedRun,
    details: {
      boards_processed: boardsProcessed,
      total_boards: boards.length,
      docs_scraped: totalScraped,
      docs_skipped: totalSkipped,
      docs_failed: totalFailed,
      errors: errors.slice(0, 10),
    }
  }, { status: 201 });
}


