/**
 * 첨부파일 다운로드 API
 * 
 * POST /api/scraper/attachments/download
 * - board_id: (선택) 특정 보드만 다운로드
 * - org_id: (선택) board_id 지정 시 필요
 * 
 * GET /api/scraper/attachments/download
 * - 대기 중인 첨부파일 목록 조회
 */

import { NextResponse } from "next/server";
import {
  downloadPendingAttachments,
  downloadBoardAttachments,
  type BatchDownloadResult,
} from "@/lib/scraper/attachment-downloader";
import {
  getDbAsync,
  getPendingAttachments,
  getStats,
} from "@/lib/scraper/scraper-db";

export const runtime = "nodejs";

/**
 * 대기 중인 첨부파일 목록 조회
 */
export async function GET() {
  try {
    await getDbAsync();
    
    const pending = await getPendingAttachments(100);
    const stats = await getStats();
    
    return NextResponse.json({
      ok: true,
      pending_count: stats.pending_attachments,
      total_attachments: stats.total_attachments,
      sample: pending.slice(0, 10).map((a) => ({
        file_id: a.file_id,
        file_name: a.file_name,
        file_type: a.file_type,
        download_url: a.download_url,
        status: a.status,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/scraper/attachments/download]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * 첨부파일 다운로드 실행
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { board_id, org_id } = body;
    
    let result: BatchDownloadResult;
    
    if (board_id && org_id) {
      // 특정 보드만 다운로드
      result = await downloadBoardAttachments(board_id, org_id);
    } else {
      // 모든 대기 중인 파일 다운로드
      result = await downloadPendingAttachments();
    }
    
    return NextResponse.json({
      ok: true,
      message: `다운로드 완료: ${result.downloaded}건 성공, ${result.skipped}건 건너뜀, ${result.failed}건 실패`,
      result: {
        total: result.total,
        downloaded: result.downloaded,
        skipped: result.skipped,
        failed: result.failed,
      },
      errors: result.errors.slice(0, 10), // 최대 10개만
    });
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/scraper/attachments/download]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
