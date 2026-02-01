/**
 * 조건부 삭제 API
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filter } = body;

    if (!filter || Object.keys(filter).length === 0) {
      return NextResponse.json({
        success: false,
        error: "삭제 조건을 지정해주세요."
      }, { status: 400 });
    }

    const res = await fetch(`${BACKEND_URL}/vectordb/delete-by-filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filter }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return NextResponse.json({
        success: false,
        error: errorData.detail || `Backend error: ${res.status}`
      });
    }

    const data = await res.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("Error deleting by filter:", error);
    
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"))) {
      return NextResponse.json({
        success: false,
        error: "백엔드 서버에 연결할 수 없습니다."
      }, { status: 503 });
    }

    return NextResponse.json({
      success: false,
      error: "삭제 중 오류가 발생했습니다."
    }, { status: 500 });
  }
}
