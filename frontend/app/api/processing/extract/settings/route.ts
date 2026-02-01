/**
 * 추출 설정 API Route
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.EXTRACTION_BACKEND_URL || "http://localhost:8000";

/**
 * GET /api/processing/extract/settings
 * 현재 추출 설정 조회
 */
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/settings`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch settings" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Settings GET error:", error);
    return NextResponse.json(
      { error: "Backend service unavailable" },
      { status: 503 }
    );
  }
}

/**
 * PUT /api/processing/extract/settings
 * 추출 설정 업데이트
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch(`${BACKEND_URL}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to update settings" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Settings PUT error:", error);
    return NextResponse.json(
      { error: "Backend service unavailable" },
      { status: 503 }
    );
  }
}
