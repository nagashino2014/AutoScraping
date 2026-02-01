import { NextResponse } from "next/server";
import { readScraperSchedules } from "@/lib/scraper/schedule-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const schedule_id = url.searchParams.get("schedule_id")?.trim() ?? "";
  const limitRaw = url.searchParams.get("limit")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(limitRaw || "50"), 1), 200);

  const data = readScraperSchedules();
  const runs = (schedule_id ? data.runs.filter((r) => r.schedule_id === schedule_id) : data.runs)
    .slice()
    .sort((a, b) => (b.started_at > a.started_at ? 1 : -1))
    .slice(0, limit);

  return NextResponse.json({ runs, updated_at: data.updated_at });
}




