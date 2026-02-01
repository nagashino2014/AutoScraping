/**
 * 벡터 DB 내보내기 API
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { format = "json" } = body;

    // 백엔드에서 모든 벡터 데이터 조회
    const statusRes = await fetch(`${BACKEND_URL}/vectordb/status`);
    if (!statusRes.ok) {
      return NextResponse.json({
        success: false,
        error: "벡터 DB 상태 조회 실패"
      }, { status: 500 });
    }

    const statusData = await statusRes.json();
    const totalVectors = statusData.total_embeddings || 0;

    if (totalVectors === 0) {
      return NextResponse.json({
        success: false,
        error: "내보낼 데이터가 없습니다."
      }, { status: 400 });
    }

    // 벡터 데이터 조회 (배치로 처리)
    const batchSize = 1000;
    const allData: {
      ids: string[];
      documents: string[];
      metadatas: Record<string, unknown>[];
    } = {
      ids: [],
      documents: [],
      metadatas: []
    };

    // ChromaDB peek API로 데이터 조회
    const peekRes = await fetch(`${BACKEND_URL}/vectordb/peek?limit=${Math.min(totalVectors, 10000)}`);
    
    if (peekRes.ok) {
      const peekData = await peekRes.json();
      if (peekData.success) {
        allData.ids = peekData.ids || [];
        allData.documents = peekData.documents || [];
        allData.metadatas = peekData.metadatas || [];
      }
    }

    // JSON 형식으로 내보내기
    const exportData = {
      export_info: {
        timestamp: new Date().toISOString(),
        total_vectors: allData.ids.length,
        db_type: statusData.db_type,
        collection_name: statusData.collection_name,
      },
      vectors: allData.ids.map((id, index) => ({
        id,
        document: allData.documents[index] || "",
        metadata: allData.metadatas[index] || {},
      }))
    };

    const jsonContent = JSON.stringify(exportData, null, 2);

    return new NextResponse(jsonContent, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="vectordb_backup_${Date.now()}.json"`,
      },
    });

  } catch (error) {
    console.error("Error exporting vector DB:", error);
    
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"))) {
      return NextResponse.json({
        success: false,
        error: "백엔드 서버에 연결할 수 없습니다."
      }, { status: 503 });
    }

    return NextResponse.json({
      success: false,
      error: "내보내기 중 오류가 발생했습니다."
    }, { status: 500 });
  }
}
