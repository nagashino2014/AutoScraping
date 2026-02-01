import { NextResponse } from "next/server";
import {
  readScraperSchedules,
  writeScraperSchedules,
  type ScraperSchedule,
} from "@/lib/scraper/schedule-store";
import { updateScheduleJob, removeScheduleJob } from "@/lib/scraper/scheduler";

function isValidScheduleId(schedule_id: string) {
  return /^[a-z][a-z0-9_]*$/.test(schedule_id);
}

export async function GET(_req: Request, ctx: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await ctx.params;
  const schedule_id = decodeURIComponent(scheduleId);
  const data = readScraperSchedules();
  const schedule = data.schedules.find((s) => s.schedule_id === schedule_id);
  if (!schedule) return NextResponse.json({ error: "schedule_not_found" }, { status: 404 });
  return NextResponse.json({ schedule, updated_at: data.updated_at });
}

export async function PUT(req: Request, ctx: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await ctx.params;
  const schedule_id = decodeURIComponent(scheduleId);
  const body = (await req.json().catch(() => null)) as Partial<ScraperSchedule> | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

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
  const idx = data.schedules.findIndex((s) => s.schedule_id === schedule_id);
  if (idx < 0) return NextResponse.json({ error: "schedule_not_found" }, { status: 404 });

  const current = data.schedules[idx];
  const nextSchedule: ScraperSchedule = {
    ...current,
    name,
    org_ids,
    targets,
    cron,
    timezone,
    max_runtime_sec: Number(body.max_runtime_sec ?? current.max_runtime_sec),
    concurrency: body.concurrency ?? current.concurrency,
    retry_policy: body.retry_policy ?? current.retry_policy,
    rate_limit: body.rate_limit ?? current.rate_limit,
    enabled: Boolean(body.enabled ?? current.enabled),
  };

  const nextSchedules = [...data.schedules];
  nextSchedules[idx] = nextSchedule;

  writeScraperSchedules({
    schedules: nextSchedules,
    runs: data.runs,
  });

  // 스케줄러 업데이트
  updateScheduleJob(nextSchedule);

  return NextResponse.json({ ok: true, schedule: nextSchedule });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await ctx.params;
  const schedule_id = decodeURIComponent(scheduleId);
  const data = readScraperSchedules();
  if (!data.schedules.some((s) => s.schedule_id === schedule_id)) {
    return NextResponse.json({ error: "schedule_not_found" }, { status: 404 });
  }

  writeScraperSchedules({
    schedules: data.schedules.filter((s) => s.schedule_id !== schedule_id),
    runs: data.runs.filter((r) => r.schedule_id !== schedule_id),
  });

  // 스케줄러에서 제거
  removeScheduleJob(schedule_id);

  return NextResponse.json({ ok: true });
}


