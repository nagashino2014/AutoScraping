import { NextResponse } from "next/server";
import {
  readScraperTargets,
  writeScraperTargets,
  syncTargetsToGitHub,
  type Board,
} from "@/lib/scraper/targets-store";
import {
  readScraperSchedules,
  writeScraperSchedules,
  type ScraperSchedule,
} from "@/lib/scraper/schedule-store";
import {
  updateScheduleJob,
  removeScheduleJob,
} from "@/lib/scraper/scheduler";

/**
 * 보드별 자동 스케줄 생성/업데이트
 * - 보드에 schedule_cron이 설정되면 해당 보드 전용 스케줄을 자동 생성
 * - 이미 존재하면 업데이트, 없으면 새로 생성
 * - 파일 저장 후 in-memory 스케줄러도 즉시 갱신
 */
function syncBoardSchedule(board: Board, orgName: string) {
  if (!board.schedule_cron) return;

  const scheduleId = `sched_${board.board_id}`;
  const scheduleName = `${orgName} - ${board.board_name}`;
  const timezone = board.schedule_timezone || "Asia/Seoul";

  const schedData = readScraperSchedules();
  const existingIdx = schedData.schedules.findIndex((s) => s.schedule_id === scheduleId);

  const schedule: ScraperSchedule = {
    schedule_id: scheduleId,
    name: scheduleName,
    org_ids: [board.org_id],
    targets: [board.board_id],
    cron: board.schedule_cron,
    timezone,
    max_runtime_sec: 1800,
    concurrency: { global: 2, per_org: 1 },
    retry_policy: { max: 3, backoff: "exponential", base_sec: 30 },
    rate_limit: { rps: 0.2, burst: 1 },
    enabled: board.enabled,
  };

  let finalSchedule: ScraperSchedule;
  let nextSchedules: ScraperSchedule[];
  if (existingIdx >= 0) {
    const existing = schedData.schedules[existingIdx];
    finalSchedule = {
      ...schedule,
      max_runtime_sec: existing.max_runtime_sec,
      concurrency: existing.concurrency,
      retry_policy: existing.retry_policy,
      rate_limit: existing.rate_limit,
    };
    nextSchedules = [...schedData.schedules];
    nextSchedules[existingIdx] = finalSchedule;
  } else {
    finalSchedule = schedule;
    nextSchedules = [...schedData.schedules, schedule];
  }

  writeScraperSchedules({
    schedules: nextSchedules,
    runs: schedData.runs,
  });

  try {
    updateScheduleJob(finalSchedule);
    console.log(`[Scheduler] ✓ 스케줄 즉시 반영: ${scheduleName} (${board.schedule_cron})`);
  } catch (e) {
    console.error(`[Scheduler] 스케줄 즉시 반영 실패:`, e);
  }
}

/**
 * 보드의 스케줄 삭제 (보드 삭제 또는 schedule_cron 제거 시)
 */
function removeBoardSchedule(boardId: string) {
  const scheduleId = `sched_${boardId}`;
  const schedData = readScraperSchedules();
  
  if (!schedData.schedules.some((s) => s.schedule_id === scheduleId)) return;

  writeScraperSchedules({
    schedules: schedData.schedules.filter((s) => s.schedule_id !== scheduleId),
    runs: schedData.runs.filter((r) => r.schedule_id !== scheduleId),
  });

  try {
    removeScheduleJob(scheduleId);
    console.log(`[Scheduler] ✓ 스케줄 즉시 제거: ${scheduleId}`);
  } catch (e) {
    console.error(`[Scheduler] 스케줄 즉시 제거 실패:`, e);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await ctx.params;
  const data = readScraperTargets();
  const board = data.boards.find((b) => b.board_id === boardId) ?? null;
  if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ board });
}

export async function PUT(req: Request, ctx: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Partial<Board> | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const data = readScraperTargets();
  const idx = data.boards.findIndex((b) => b.board_id === boardId);
  if (idx < 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const current = data.boards[idx];
  const next: Board = {
    ...current,
    board_name: (body.board_name ?? current.board_name).trim(),
    access_mode: body.access_mode ?? current.access_mode,
    list_url: ((body.list_url ?? current.list_url) ?? "").trim() || undefined,
    doc_type: ((body.doc_type ?? current.doc_type) ?? "").trim() || undefined,
    domain_tags: Array.isArray(body.domain_tags)
      ? body.domain_tags.filter(Boolean)
      : current.domain_tags,
    enabled: body.enabled ?? current.enabled,

    board_mode: body.board_mode ?? current.board_mode,
    schedule_cron: ((body.schedule_cron ?? current.schedule_cron) ?? "").trim() || undefined,
    schedule_timezone: ((body.schedule_timezone ?? current.schedule_timezone) ?? "").trim() || undefined,
    schedule_config: body.schedule_config !== undefined
      ? (body.schedule_config && typeof body.schedule_config === "object" ? body.schedule_config : undefined)
      : current.schedule_config,
    dedup_key: body.dedup_key ?? current.dedup_key,
    published_date_rule:
      body.published_date_rule && typeof body.published_date_rule === "object"
        ? (body.published_date_rule as Record<string, unknown>)
        : current.published_date_rule,
    
    // 수집 범위 및 대상
    collection_range: body.collection_range !== undefined
      ? (body.collection_range && typeof body.collection_range === "object" ? body.collection_range : undefined)
      : current.collection_range,
    collection_targets: body.collection_targets !== undefined
      ? (body.collection_targets && typeof body.collection_targets === "object" ? body.collection_targets : undefined)
      : current.collection_targets,

    web_config:
      body.web_config && typeof body.web_config === "object"
        ? (body.web_config as Record<string, unknown>)
        : current.web_config,
    api_config:
      body.api_config && typeof body.api_config === "object"
        ? (body.api_config as Record<string, unknown>)
        : current.api_config,
    hybrid_config:
      body.hybrid_config && typeof body.hybrid_config === "object"
        ? (body.hybrid_config as Record<string, unknown>)
        : current.hybrid_config,
    site_search_config:
      body.site_search_config !== undefined
        ? (body.site_search_config && typeof body.site_search_config === "object" 
            ? body.site_search_config as Board["site_search_config"]
            : undefined)
        : current.site_search_config,
  };

  const boards = [...data.boards];
  boards[idx] = next;
  writeScraperTargets({ orgs: data.orgs, boards });

  // 스케줄 자동 생성/업데이트 또는 삭제
  const org = data.orgs.find((o) => o.org_id === next.org_id);
  const orgName = org?.org_name || next.org_id;
  
  if (next.schedule_cron) {
    syncBoardSchedule(next, orgName);
  } else if (current.schedule_cron && !next.schedule_cron) {
    // schedule_cron이 제거된 경우 스케줄도 삭제
    removeBoardSchedule(boardId);
  }

  // GitHub 자동 동기화 (백그라운드 실행, 실패해도 API 응답은 성공)
  const gitSync = await syncTargetsToGitHub(`update: ${orgName} - ${next.board_name} 설정 변경`).catch(() => ({
    success: false,
    message: "GitHub 동기화 실패",
  }));

  return NextResponse.json({ ok: true, board: next, gitSync });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await ctx.params;
  const data = readScraperTargets();
  const board = data.boards.find((b) => b.board_id === boardId);
  if (!board) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const boards = data.boards.filter((b) => b.board_id !== boardId);
  writeScraperTargets({ orgs: data.orgs, boards });

  // 보드 삭제 시 해당 보드의 자동 생성 스케줄도 삭제
  removeBoardSchedule(boardId);

  // GitHub 자동 동기화
  const gitSync = await syncTargetsToGitHub(`delete: ${board.board_name} 보드 삭제`).catch(() => ({
    success: false,
    message: "GitHub 동기화 실패",
  }));

  return NextResponse.json({ ok: true, gitSync });
}


