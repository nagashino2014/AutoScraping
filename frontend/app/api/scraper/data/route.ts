/**
 * 스크래핑 데이터 조회 API
 * 
 * GET /api/scraper/data
 * - board_id?: 특정 보드의 문서만 조회
 * - limit?: 조회 개수 (기본 100)
 * - offset?: 시작 위치
 * 
 * GET /api/scraper/data/stats
 * - 전체 통계
 */

import { NextResponse } from "next/server";
import {
  getDocumentsByBoard,
  countDocumentsByBoard,
  getAttachmentsByDoc,
  getStats,
  getRecentScrapeLogs,
} from "@/lib/scraper/scraper-db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const boardId = url.searchParams.get("board_id");
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const includeAttachments = url.searchParams.get("attachments") === "true";
    const statsOnly = url.searchParams.get("stats") === "true";

    // 통계만 요청
    if (statsOnly) {
      const stats = await getStats();
      return NextResponse.json({ ok: true, stats });
    }

    // 보드 ID가 없으면 전체 통계만 반환
    if (!boardId) {
      const stats = await getStats();
      return NextResponse.json({
        ok: true,
        stats,
        message: "board_id를 지정하면 해당 보드의 문서 목록을 조회할 수 있습니다.",
      });
    }

    // 보드별 문서 조회
    const [documents, totalCount] = await Promise.all([
      getDocumentsByBoard(boardId, { limit, offset }),
      countDocumentsByBoard(boardId),
    ]);

    // 첨부파일 정보 포함 여부
    const documentsWithAttachments = includeAttachments
      ? await Promise.all(
          documents.map(async (doc) => ({
            ...doc,
            attachments: await getAttachmentsByDoc(doc.doc_id),
          }))
        )
      : documents;

    // 최근 로그
    const recentLogs = await getRecentScrapeLogs(boardId, 5);

    return NextResponse.json({
      ok: true,
      board_id: boardId,
      total: totalCount,
      limit,
      offset,
      documents: documentsWithAttachments,
      recent_logs: recentLogs,
    });

  } catch (err: any) {
    console.error("[data] Error:", err);
    return NextResponse.json(
      { error: err.message || "데이터 조회 실패" },
      { status: 500 }
    );
  }
}
