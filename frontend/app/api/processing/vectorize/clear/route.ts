/**
 * 컬렉션 전체 초기화 API
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST() {
  try {
    const res = await fetch(`${BACKEND_URL}/vectordb/clear`, {
      method: "POST",
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
    console.error("Error clearing collection:", error);
    
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"))) {
      return NextResponse.json({
        success: false,
        error: "백엔드 서버에 연결할 수 없습니다."
      }, { status: 503 });
    }

    return NextResponse.json({
      success: false,
      error: "초기화 중 오류가 발생했습니다."
    }, { status: 500 });
  }
}
