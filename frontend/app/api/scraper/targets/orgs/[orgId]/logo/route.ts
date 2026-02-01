import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readScraperTargets, writeScraperTargets } from "@/lib/scraper/targets-store";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function publicLogoDir() {
  return path.join(process.cwd(), "public", "logos", "orgs");
}

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;

  const data = readScraperTargets();
  const idx = data.orgs.findIndex((o) => o.org_id === orgId);
  if (idx < 0) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const dir = publicLogoDir();
  fs.mkdirSync(dir, { recursive: true });

  // 기존 로고 파일 삭제 (캐싱 방지를 위해 타임스탬프 포함 파일명 사용)
  const existingFiles = fs.readdirSync(dir).filter((f) => f.startsWith(`${orgId}_`) || f.startsWith(`${orgId}.`));
  for (const oldFile of existingFiles) {
    try {
      fs.unlinkSync(path.join(dir, oldFile));
    } catch {
      // 삭제 실패해도 계속 진행
    }
  }

  // 타임스탬프를 포함한 파일명으로 저장 (캐시 버스팅)
  const timestamp = Date.now();
  const filename = `${orgId}_${timestamp}.${ext}`;
  const abs = path.join(dir, filename);
  fs.writeFileSync(abs, buf);

  const nextLogoPath = `/logos/orgs/${filename}`;
  const orgs = [...data.orgs];
  orgs[idx] = { ...orgs[idx], logo_path: nextLogoPath };
  writeScraperTargets({ orgs, boards: data.boards });

  return NextResponse.json({ ok: true, logo_path: nextLogoPath, org: orgs[idx] });
}



