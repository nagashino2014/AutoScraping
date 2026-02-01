/**
 * 파일 형식별 분포 차트 데이터 API
 * GET /api/scraper/status/chart/file-types
 */

import { NextResponse } from "next/server";
import { getFileTypeStats } from "@/lib/scraper/scraper-db";

// 파일 형식 레이블 매핑
const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  hwp: "HWP",
  hwpx: "HWPX",
  doc: "DOC",
  docx: "DOCX",
  xls: "XLS",
  xlsx: "XLSX",
  ppt: "PPT",
  pptx: "PPTX",
  zip: "ZIP",
  jpg: "JPG",
  jpeg: "JPEG",
  png: "PNG",
  gif: "GIF",
  txt: "TXT",
  csv: "CSV",
  xml: "XML",
  json: "JSON",
  unknown: "기타",
  "": "기타",
};

export async function GET() {
  try {
    const rawData = await getFileTypeStats();
    
    // 레이블 매핑 및 정렬
    const data = rawData.map((item) => ({
      ...item,
      label: FILE_TYPE_LABELS[item.type.toLowerCase()] || item.type.toUpperCase(),
    }));
    
    // 총계 계산
    const totalCount = data.reduce((sum, item) => sum + item.count, 0);
    const totalSizeBytes = data.reduce((sum, item) => sum + item.size_bytes, 0);
    
    return NextResponse.json({
      success: true,
      data,
      total_count: totalCount,
      total_size_bytes: totalSizeBytes,
    });
  } catch (error) {
    console.error("[status/chart/file-types] Error:", error);
    return NextResponse.json(
      { success: false, error: "파일 형식 통계 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
