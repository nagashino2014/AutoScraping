import { NextResponse } from "next/server";
import {
  readScraperSchedules,
  writeScraperSchedules,
  type ScraperSchedule,
} from "@/lib/scraper/schedule-store";
import { updateScheduleJob } from "@/lib/scraper/scheduler";
import { syncScheduleWorkflowToGitHub } from "@/lib/scraper/schedule-github-sync";

function isValidScheduleId(schedule_id: string) {
  // 권장 예: daily_moe_press (소문자/숫자/언더스코어)
  return /^[a-z][a-z0-9_]*$/.test(schedule_id);
}

export async function GET() {
  const data = readScraperSchedules();
  return NextResponse.json({ schedules: data.schedules, updated_at: data.updated_at });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<ScraperSchedule> | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const schedule_id = (body.schedule_id ?? "").trim();
  const name = (body.name ?? "").trim();
  const cron = (body.cron ?? "").trim();
  const timezone = (body.timezone ?? "").trim();
  const org_ids = Array.isArray(body.org_ids) ? body.org_ids.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const targets = Array.isArray(body.targets) ? body.targets.map(String).map((s) => s.trim()).filter(Boolean) : [];

  if (!schedule_id || !name || !cron || !timezone || org_ids.length === 0 || targets.length === 0) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  if (!isValidScheduleId(schedule_id)) {
    return NextResponse.json({ error: "invalid_schedule_id_format" }, { status: 400 });
  }

  const data = readScraperSchedules();
  if (data.schedules.some((s) => s.schedule_id === schedule_id)) {
    return NextResponse.json({ error: "schedule_id_exists" }, { status: 409 });
  }

  const nextSchedule: ScraperSchedule = {
    schedule_id,
    name,
    org_ids,
    targets,
    cron,
    timezone,
    max_runtime_sec: Number(body.max_runtime_sec ?? 1800),
    concurrency: body.concurrency ?? { global: 2, per_org: 1 },
    retry_policy: body.retry_policy ?? { max: 3, backoff: "exponential", base_sec: 30 },
    rate_limit: body.rate_limit ?? { rps: 0.2, burst: 1 },
    enabled: Boolean(body.enabled ?? true),
  };

  writeScraperSchedules({
    schedules: [...data.schedules, nextSchedule],
    runs: data.runs,
  });

  // 스케줄러에 새 스케줄 등록
  updateScheduleJob(nextSchedule);

  // GitHub Actions 워크플로우 동기화 (비동기, 실패해도 응답에 영향 없음)
  syncScheduleWorkflowToGitHub().catch(() => {});

  return NextResponse.json({ ok: true, schedule: nextSchedule }, { status: 201 });
}


