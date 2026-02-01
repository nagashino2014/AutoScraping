/**
 * 표 재조합 API
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table_id } = body;

    if (!table_id) {
      return NextResponse.json({
        success: false,
        error: "table_id가 필요합니다."
      }, { status: 400 });
    }

    const res = await fetch(`${BACKEND_URL}/vectordb/reconstruct-table`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_id }),
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
    console.error("Error reconstructing table:", error);
    
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"))) {
      return NextResponse.json({
        success: false,
        error: "백엔드 서버에 연결할 수 없습니다."
      }, { status: 503 });
    }

    return NextResponse.json({
      success: false,
      error: "표 재조합 중 오류가 발생했습니다."
    }, { status: 500 });
  }
}
