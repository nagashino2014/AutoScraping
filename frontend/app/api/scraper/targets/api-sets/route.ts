import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";

// APISet 폴더의 JSON 파일 목록 조회
export async function GET() {
  try {
    const possiblePaths = [
      path.join(process.cwd(), "data", "APISet"),
      path.join(process.cwd(), "frontend", "data", "APISet"),
    ];
    
    let dataDir = "";
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        dataDir = p;
        break;
      }
    }
    
    if (!dataDir) {
      dataDir = path.join(process.cwd(), "data", "APISet");
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(dataDir, f);
        const stat = fs.statSync(filePath);
        
        // JSON 파일 내용 간단히 읽어서 정보 추출
        let info = { org_name: "", total_endpoints: 0 };
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          info.org_name = content.org_name || "";
          info.total_endpoints = content.endpoints?.length || content.total_endpoints || 0;
        } catch {}
        
        return {
          filename: f,
          org_id: f.replace('.json', ''),
          org_name: info.org_name,
          total_endpoints: info.total_endpoints,
          modified_at: stat.mtime.toISOString(),
          size: stat.size
        };
      });
    
    return NextResponse.json({ ok: true, files, dataDir });
  } catch (e: any) {
    console.error("[API Sets] Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// 특정 JSON 파일 내용 조회
export async function POST(req: Request) {
  try {
    const { filename } = await req.json();
    if (!filename) {
      return NextResponse.json({ error: "filename required" }, { status: 400 });
    }
    
    const possiblePaths = [
      path.join(process.cwd(), "data", "APISet"),
      path.join(process.cwd(), "frontend", "data", "APISet"),
    ];
    
    let filePath = "";
    for (const p of possiblePaths) {
      const fp = path.join(p, filename);
      if (fs.existsSync(fp)) {
        filePath = fp;
        break;
      }
    }
    
    if (!filePath) {
      return NextResponse.json({ error: "file_not_found" }, { status: 404 });
    }
    
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return NextResponse.json({ ok: true, data: content });
  } catch (e: any) {
    console.error("[API Sets] Load error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
