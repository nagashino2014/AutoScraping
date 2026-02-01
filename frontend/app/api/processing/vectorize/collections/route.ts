/**
 * 컬렉션 정보 조회 API
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/vectordb/collections`);
    
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Backend error: ${res.status}`,
        collections: []
      });
    }

    const data = await res.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("Error fetching collections:", error);
    
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"))) {
      return NextResponse.json({
        success: false,
        error: "백엔드 서버에 연결할 수 없습니다.",
        collections: []
      });
    }

    return NextResponse.json({
      success: false,
      error: "컬렉션 정보 조회 중 오류가 발생했습니다.",
      collections: []
    });
  }
}
