/**
 * 임베딩 데이터 마이그레이션 API
 * 
 * POST /api/processing/embedding/migrate
 * - 기존 JSON 파일의 임베딩 데이터를 ChromaDB로 마이그레이션합니다
 */

import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST() {
  try {
    // 백엔드 마이그레이션 API 호출
    const response = await fetch(`${BACKEND_URL}/vectordb/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, error: errorData.detail || `HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error("Error migrating embeddings:", error);
    
    const errorMessage = error instanceof Error ? error.message : "마이그레이션 중 오류가 발생했습니다.";
    
    if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("fetch failed")) {
      return NextResponse.json(
        { success: false, error: "백엔드 서버에 연결할 수 없습니다." },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

// GET: ChromaDB 상태 조회
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/vectordb/status`);
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error("Error getting ChromaDB status:", error);
    
    return NextResponse.json(
      { success: false, error: "ChromaDB 상태 조회 실패" },
      { status: 500 }
    );
  }
}
