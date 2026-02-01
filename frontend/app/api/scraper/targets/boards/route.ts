import { NextResponse } from "next/server";
import {
  readScraperTargets,
  writeScraperTargets,
  type Board,
} from "@/lib/scraper/targets-store";
import {
  readScraperSchedules,
  writeScraperSchedules,
  type ScraperSchedule,
} from "@/lib/scraper/schedule-store";

/**
 * 보드별 자동 스케줄 생성
 */
function createBoardSchedule(board: Board, orgName: string) {
  if (!board.schedule_cron) return;

  const scheduleId = `sched_${board.board_id}`;
  const scheduleName = `${orgName} - ${board.board_name}`;
  const timezone = board.schedule_timezone || "Asia/Seoul";

  const schedData = readScraperSchedules();
  
  // 이미 존재하면 생성하지 않음 (중복 방지)
  if (schedData.schedules.some((s) => s.schedule_id === scheduleId)) return;

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

  writeScraperSchedules({
    schedules: [...schedData.schedules, schedule],
    runs: schedData.runs,
  });
}

function isValidBoardId(board_id: string, org_id: string) {
  // 규칙: {org_id}_board{n}
  // - org_id: 영문/숫자/언더스코어 허용(기존 org_id 구조 유지)
  // - n: 1 이상의 정수
  const re = new RegExp(`^${org_id}_board([1-9]\\d*)$`);
  return re.test(board_id);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const org_id = url.searchParams.get("org_id")?.trim() ?? "";

  const data = readScraperTargets();
  const boards = org_id ? data.boards.filter((b) => b.org_id === org_id) : data.boards;
  return NextResponse.json({ boards, updated_at: data.updated_at });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<Board> | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const board_id = (body.board_id ?? "").trim();
  const org_id = (body.org_id ?? "").trim();
  const board_name = (body.board_name ?? "").trim();
  const access_mode = body.access_mode;

  if (!board_id || !org_id || !board_name || !access_mode) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = readScraperTargets();
  if (!data.orgs.some((o) => o.org_id === org_id)) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  if (!isValidBoardId(board_id, org_id)) {
    return NextResponse.json({ error: "invalid_board_id_format" }, { status: 400 });
  }

  if (data.boards.some((b) => b.board_id === board_id)) {
    return NextResponse.json({ error: "board_id_exists" }, { status: 409 });
  }

  const nextBoard: Board = {
    board_id,
    org_id,
    board_name,
    access_mode,
    list_url: (body.list_url ?? "").trim() || undefined,
    doc_type: (body.doc_type ?? "").trim() || undefined,
    domain_tags: Array.isArray(body.domain_tags) ? body.domain_tags.filter(Boolean) : undefined,
    enabled: body.enabled ?? true,

    board_mode: body.board_mode,
    schedule_cron: (body.schedule_cron ?? "").trim() || undefined,
    schedule_timezone: (body.schedule_timezone ?? "").trim() || undefined,
    schedule_config: body.schedule_config && typeof body.schedule_config === "object"
      ? body.schedule_config
      : undefined,
    dedup_key: body.dedup_key,
    published_date_rule:
      body.published_date_rule && typeof body.published_date_rule === "object"
        ? (body.published_date_rule as Record<string, unknown>)
        : undefined,
    
    // 수집 범위 및 대상
    collection_range: body.collection_range && typeof body.collection_range === "object"
      ? body.collection_range
      : undefined,
    collection_targets: body.collection_targets && typeof body.collection_targets === "object"
      ? body.collection_targets
      : undefined,

    web_config: body.web_config && typeof body.web_config === "object" ? (body.web_config as Record<string, unknown>) : undefined,
    api_config: body.api_config && typeof body.api_config === "object" ? (body.api_config as Record<string, unknown>) : undefined,
    hybrid_config:
      body.hybrid_config && typeof body.hybrid_config === "object"
        ? (body.hybrid_config as Record<string, unknown>)
        : undefined,
    site_search_config:
      body.site_search_config && typeof body.site_search_config === "object"
        ? body.site_search_config as Board["site_search_config"]
        : undefined,
  };

  writeScraperTargets({
    orgs: data.orgs,
    boards: [...data.boards, nextBoard],
  });

  // 보드에 스케줄 설정이 있으면 스케줄 자동 생성
  const org = data.orgs.find((o) => o.org_id === org_id);
  const orgName = org?.org_name || org_id;
  createBoardSchedule(nextBoard, orgName);

  return NextResponse.json({ ok: true, board: nextBoard }, { status: 201 });
}


