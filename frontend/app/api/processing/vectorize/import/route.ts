/**
 * 벡터 DB 가져오기 API
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

interface VectorData {
  id: string;
  document: string;
  metadata: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vectors } = body as { vectors: VectorData[] };

    if (!vectors || !Array.isArray(vectors) || vectors.length === 0) {
      return NextResponse.json({
        success: false,
        error: "가져올 벡터 데이터가 없습니다."
      }, { status: 400 });
    }

    // 배치 크기
    const batchSize = 100;
    let totalImported = 0;
    let errors: string[] = [];

    // 배치로 처리
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      
      // 각 벡터에 대해 재임베딩 필요 여부 확인
      // 백업 파일에는 벡터가 포함되지 않으므로 재임베딩 필요
      const documentsToEmbed = batch.map(v => ({
        id: v.id,
        document: v.document,
        metadata: v.metadata
      }));

      try {
        // 백엔드에 upsert 요청 (재임베딩 포함)
        const res = await fetch(`${BACKEND_URL}/vectordb/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vectors: documentsToEmbed }),
        });

        if (res.ok) {
          const data = await res.json();
          totalImported += data.imported || batch.length;
        } else {
          const errorData = await res.json().catch(() => ({ detail: "Unknown error" }));
          errors.push(`배치 ${Math.floor(i / batchSize) + 1}: ${errorData.detail || "Unknown error"}`);
        }
      } catch (error) {
        errors.push(`배치 ${Math.floor(i / batchSize) + 1}: Network error`);
      }
    }

    return NextResponse.json({
      success: true,
      imported: totalImported,
      total: vectors.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error("Error importing vector DB:", error);
    
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"))) {
      return NextResponse.json({
        success: false,
        error: "백엔드 서버에 연결할 수 없습니다."
      }, { status: 503 });
    }

    return NextResponse.json({
      success: false,
      error: "가져오기 중 오류가 발생했습니다."
    }, { status: 500 });
  }
}
