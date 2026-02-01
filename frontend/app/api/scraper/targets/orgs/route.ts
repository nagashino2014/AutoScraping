import { NextResponse } from "next/server";
import { readScraperTargets, writeScraperTargets, type Organization } from "@/lib/scraper/targets-store";

export async function GET() {
  const data = readScraperTargets();
  return NextResponse.json({ orgs: data.orgs, updated_at: data.updated_at });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<Organization> | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const org_id = (body.org_id ?? "").trim();
  const org_name = (body.org_name ?? "").trim();
  const base_url = (body.base_url ?? "").trim();

  if (!org_id || !org_name || !base_url) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = readScraperTargets();
  if (data.orgs.some((o) => o.org_id === org_id)) {
    return NextResponse.json({ error: "org_id_exists" }, { status: 409 });
  }

  const nextOrg: Organization = {
    org_id,
    org_name,
    base_url,
    status: body.status ?? "active",
    default_policy: body.default_policy ?? { rps: 0.2, timeout_sec: 30 },
    notes: body.notes ?? "",
    collection_mode: body.collection_mode ?? "web_scraping",
    org_type: body.org_type ?? "유관기관",
    logo_path: body.logo_path,
    api_profile:
      body.api_profile && typeof body.api_profile === "object"
        ? (body.api_profile as Record<string, unknown>)
        : undefined,
  };

  writeScraperTargets({
    orgs: [...data.orgs, nextOrg],
    boards: data.boards,
  });

  return NextResponse.json({ ok: true, org: nextOrg }, { status: 201 });
}


