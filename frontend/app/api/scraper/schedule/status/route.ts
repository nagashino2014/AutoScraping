import { NextResponse } from "next/server";
import { getSchedulerStatus, reloadAllSchedules } from "@/lib/scraper/scheduler";

/**
 * 스케줄러 상태 조회 API
 */
export async function GET() {
  const status = getSchedulerStatus();
  return NextResponse.json(status);
}

/**
 * 스케줄러 다시 로드 API
 */
export async function POST() {
  reloadAllSchedules();
  const status = getSchedulerStatus();
  return NextResponse.json({ ok: true, ...status });
}
