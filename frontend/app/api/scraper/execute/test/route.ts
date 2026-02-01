/**
 * 스크래핑 테스트 API (저장 없이 미리보기)
 * 
 * POST /api/scraper/execute/test
 * - board_id: 테스트 대상 보드 ID
 * 
 * DELETE /api/scraper/execute/test
 * - 테스트 폴더(Test/Attachment)의 모든 파일 삭제
 */

import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { testScraper, type WebConfig } from "@/lib/scraper/scraper-engine";
import type { DedupKeyType } from "@/lib/scraper/scraper-db";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { board_id } = body;

    if (!board_id || typeof board_id !== "string") {
      return NextResponse.json({ error: "board_id가 필요합니다." }, { status: 400 });
    }

    // 보드 정보 조회
    const data = readScraperTargets();
    const board = data.boards.find((b) => b.board_id === board_id);
    
    if (!board) {
      return NextResponse.json({ error: "보드를 찾을 수 없습니다." }, { status: 404 });
    }

    if (!board.list_url) {
      return NextResponse.json({ error: "보드에 list_url이 설정되지 않았습니다." }, { status: 400 });
    }

    if (!board.web_config) {
      return NextResponse.json({ error: "보드에 web_config가 설정되지 않았습니다." }, { status: 400 });
    }

    // 테스트 실행
    const result = await testScraper(
      board.board_id,
      board.org_id,
      board.list_url,
      board.web_config as WebConfig,
      (board.dedup_key as DedupKeyType) || "url"
    );

    return NextResponse.json({
      ok: result.success,
      items: result.items,
      logs: result.logs.join("\n"),
    });

  } catch (err: any) {
    console.error("[execute/test] Error:", err);
    return NextResponse.json(
      { error: err.message || "테스트 실패" },
      { status: 500 }
    );
  }
}

/**
 * 테스트 폴더 파일 삭제
 */
export async function DELETE() {
  try {
    const testAttachmentDir = path.join(process.cwd(), "save", "Test", "Attachment");
    const testDocDir = path.join(process.cwd(), "save", "Test");
    
    let deletedCount = 0;
    const errors: string[] = [];

    // Attachment 폴더 내 파일 삭제
    if (fs.existsSync(testAttachmentDir)) {
      const files = fs.readdirSync(testAttachmentDir);
      for (const file of files) {
        const filePath = path.join(testAttachmentDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (err: any) {
          errors.push(`${file}: ${err.message}`);
        }
      }
    }

    // Test 폴더 내 xlsx 파일 삭제
    if (fs.existsSync(testDocDir)) {
      const files = fs.readdirSync(testDocDir);
      for (const file of files) {
        if (file.endsWith(".xlsx") || file.endsWith(".json")) {
          const filePath = path.join(testDocDir, file);
          try {
            fs.unlinkSync(filePath);
            deletedCount++;
          } catch (err: any) {
            errors.push(`${file}: ${err.message}`);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[execute/test DELETE] Error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "삭제 실패" },
      { status: 500 }
    );
  }
}
