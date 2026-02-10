/**
 * 특정 보드의 상세 통계 API
 * GET /api/scraper/status/boards/[boardId]/stats
 */

import { NextRequest, NextResponse } from "next/server";
import { getDbAsync } from "@/lib/scraper/scraper-db";

interface RouteParams {
  params: Promise<{ boardId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { boardId } = await params;
  
  if (!boardId) {
    return NextResponse.json(
      { success: false, error: "boardId가 필요합니다." },
      { status: 400 }
    );
  }
  
  try {
    const db = await getDbAsync();
    
    // 1. 최근 30일 일별 수집 통계
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    
    const dailyStats = db.exec(`
      SELECT 
        date(scraped_at) as date,
        COUNT(*) as documents,
        COUNT(DISTINCT doc_id) as unique_docs
      FROM documents
      WHERE board_id = '${boardId}'
        AND date(scraped_at) >= '${thirtyDaysAgo}'
      GROUP BY date(scraped_at)
      ORDER BY date ASC
    `);
    
    const timeline = dailyStats[0]?.values.map((row: unknown[]) => ({
      date: row[0] as string,
      documents: row[1] as number,
    })) || [];
    
    // 2. 파일 유형별 통계
    const fileTypeStats = db.exec(`
      SELECT 
        LOWER(a.file_type) as type,
        COUNT(*) as count,
        COALESCE(SUM(a.file_size), 0) as size_bytes
      FROM attachments a
      INNER JOIN documents d ON a.doc_id = d.doc_id
      WHERE d.board_id = '${boardId}'
      GROUP BY LOWER(a.file_type)
      ORDER BY count DESC
    `);
    
    const FILE_TYPE_LABELS: Record<string, string> = {
      pdf: "PDF",
      hwp: "HWP",
      hwpx: "HWPX",
      docx: "Word",
      doc: "Word",
      xlsx: "Excel",
      xls: "Excel",
      csv: "CSV",
      jpg: "이미지",
      jpeg: "이미지",
      png: "이미지",
      gif: "이미지",
      zip: "압축파일",
      rar: "압축파일",
    };
    
    const totalFiles = fileTypeStats[0]?.values.reduce(
      (sum: number, row: unknown[]) => sum + (row[1] as number),
      0
    ) || 0;
    
    const fileTypes = fileTypeStats[0]?.values.map((row: unknown[]) => {
      const type = (row[0] as string) || "기타";
      const count = row[1] as number;
      return {
        type,
        label: FILE_TYPE_LABELS[type] || type.toUpperCase(),
        count,
        size_bytes: row[2] as number || 0,
        percentage: totalFiles > 0 ? Math.round((count / totalFiles) * 100) : 0,
      };
    }) || [];
    
    // 3. 최근 스크래핑 로그 (최근 10건)
    const recentLogs = db.exec(`
      SELECT 
        log_id,
        started_at,
        finished_at,
        status,
        docs_scraped,
        docs_skipped,
        docs_failed,
        pages_processed,
        error_message
      FROM scrape_logs
      WHERE board_id = '${boardId}'
      ORDER BY started_at DESC
      LIMIT 10
    `);
    
    const logs = recentLogs[0]?.values.map((row: unknown[]) => ({
      log_id: row[0] as string,
      started_at: row[1] as string,
      finished_at: row[2] as string | null,
      status: row[3] as string,
      docs_scraped: row[4] as number,
      docs_skipped: row[5] as number,
      docs_failed: row[6] as number,
      pages_processed: row[7] as number,
      error_message: row[8] as string | null,
    })) || [];
    
    // 4. 총 통계
    const totalStats = db.exec(`
      SELECT 
        COUNT(*) as total_documents,
        (SELECT COUNT(*) FROM attachments a INNER JOIN documents d ON a.doc_id = d.doc_id WHERE d.board_id = '${boardId}') as total_attachments,
        (SELECT COALESCE(SUM(a.file_size), 0) FROM attachments a INNER JOIN documents d ON a.doc_id = d.doc_id WHERE d.board_id = '${boardId}') as total_size_bytes
      FROM documents
      WHERE board_id = '${boardId}'
    `);
    
    const totals = totalStats[0]?.values[0]
      ? {
          total_documents: totalStats[0].values[0][0] as number || 0,
          total_attachments: totalStats[0].values[0][1] as number || 0,
          total_size_bytes: totalStats[0].values[0][2] as number || 0,
        }
      : {
          total_documents: 0,
          total_attachments: 0,
          total_size_bytes: 0,
        };
    
    // 5. 성공률 계산 (최근 30일)
    const successRate = db.exec(`
      SELECT 
        COUNT(*) as total_runs,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_runs,
        SUM(docs_scraped) as total_scraped,
        SUM(docs_failed) as total_failed
      FROM scrape_logs
      WHERE board_id = '${boardId}'
        AND date(started_at) >= '${thirtyDaysAgo}'
    `);
    
    const rateData = successRate[0]?.values[0] || [0, 0, 0, 0];
    const totalRuns = rateData[0] as number || 0;
    const successfulRuns = rateData[1] as number || 0;
    
    return NextResponse.json({
      success: true,
      board_id: boardId,
      data: {
        timeline,
        fileTypes,
        logs,
        totals,
        stats: {
          total_runs: totalRuns,
          success_rate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0,
          total_scraped: rateData[2] as number || 0,
          total_failed: rateData[3] as number || 0,
        },
      },
    });
  } catch (error) {
    console.error("[boards/stats] Error:", error);
    return NextResponse.json(
      { success: false, error: "보드 통계 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
