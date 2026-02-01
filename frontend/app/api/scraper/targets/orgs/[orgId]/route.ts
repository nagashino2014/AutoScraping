import { NextResponse } from "next/server";
import { readScraperTargets, writeScraperTargets, type Organization } from "@/lib/scraper/targets-store";

export async function GET(_req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const data = readScraperTargets();
  const org = data.orgs.find((o) => o.org_id === orgId) ?? null;
  if (!org) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ org });
}

export async function PUT(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Partial<Organization> | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const data = readScraperTargets();
  const idx = data.orgs.findIndex((o) => o.org_id === orgId);
  if (idx < 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const current = data.orgs[idx];
  const next: Organization = {
    ...current,
    org_name: (body.org_name ?? current.org_name).trim(),
    base_url: (body.base_url ?? current.base_url).trim(),
    status: body.status ?? current.status,
    default_policy: body.default_policy ?? current.default_policy,
    notes: body.notes ?? current.notes ?? "",
    collection_mode: body.collection_mode ?? current.collection_mode,
    org_type: body.org_type ?? current.org_type ?? "유관기관",
    logo_path: body.logo_path ?? current.logo_path,
    api_profile:
      body.api_profile && typeof body.api_profile === "object"
        ? (body.api_profile as Record<string, unknown>)
        : current.api_profile,
  };

  const orgs = [...data.orgs];
  orgs[idx] = next;

  writeScraperTargets({ orgs, boards: data.boards });
  return NextResponse.json({ ok: true, org: next });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const data = readScraperTargets();
  if (!data.orgs.some((o) => o.org_id === orgId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const orgs = data.orgs.filter((o) => o.org_id !== orgId);
  const boards = data.boards.filter((b) => b.org_id !== orgId);
  writeScraperTargets({ orgs, boards });
  return NextResponse.json({ ok: true });
}


