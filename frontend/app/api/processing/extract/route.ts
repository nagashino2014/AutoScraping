/**
 * 텍스트 추출 API Route
 * Python 백엔드 서비스와 통신
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.EXTRACTION_BACKEND_URL || "http://localhost:8000";

/**
 * GET /api/processing/extract
 * 추출 대상 파일 목록 조회
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const org_id = searchParams.get("org_id") || "";
    const board_id = searchParams.get("board_id") || "";
    const format = searchParams.get("format") || "";
    const limit = searchParams.get("limit") || "50";

    const params = new URLSearchParams();
    if (org_id) params.append("org_id", org_id);
    if (board_id) params.append("board_id", board_id);
    if (format) params.append("format", format);
    params.append("limit", limit);

    const response = await fetch(`${BACKEND_URL}/files?${params.toString()}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch files" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Extract files error:", error);
    return NextResponse.json(
      { error: "Backend service unavailable", details: String(error) },
      { status: 503 }
    );
  }
}

/**
 * POST /api/processing/extract
 * 텍스트 추출 실행
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file_path, file_paths, mode = "single" } = body;

    // 단일 파일 추출
    if (mode === "single" && file_path) {
      const response = await fetch(`${BACKEND_URL}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return NextResponse.json(
          { error: errorData.detail || "Extraction failed" },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    }

    // 배치 추출
    if (mode === "batch" && file_paths && Array.isArray(file_paths)) {
      const response = await fetch(`${BACKEND_URL}/extract/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_paths }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return NextResponse.json(
          { error: errorData.detail || "Batch extraction failed" },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: "Invalid request. Provide file_path or file_paths with mode" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[API] Extract error:", error);
    return NextResponse.json(
      { error: "Backend service unavailable", details: String(error) },
      { status: 503 }
    );
  }
}
