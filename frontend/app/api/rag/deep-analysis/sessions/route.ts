/**
 * 심층 분석 세션 API
 * 
 * GET: 분석 세션 목록 조회
 * POST: 분석 세션 생성
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listAnalysisSessions,
  createAnalysisSession,
  getAnalysisSessionByDiscoveryId,
} from "@/lib/rag/analysis-store";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const discoverySessionId = searchParams.get("discoverySessionId");
    
    // 특정 발굴 세션의 분석 결과 조회
    if (discoverySessionId) {
      const session = getAnalysisSessionByDiscoveryId(discoverySessionId);
      return NextResponse.json({
        success: true,
        session,
      });
    }
    
    // 전체 목록 조회
    const sessions = listAnalysisSessions();
    
    return NextResponse.json({
      success: true,
      sessions,
      count: sessions.length,
    });
  } catch (error: any) {
    console.error("[Analysis Sessions] GET error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { discoverySessionId, name, config } = body;
    
    if (!discoverySessionId) {
      return NextResponse.json(
        { success: false, error: "discoverySessionId가 필요합니다." },
        { status: 400 }
      );
    }
    
    const session = createAnalysisSession(
      discoverySessionId,
      name || `심층 분석 ${new Date().toLocaleString("ko-KR")}`,
      config || {
        depth: "standard",
        includeEvidence: true,
        includeRecommendation: true,
        maxSteps: 4,
      }
    );
    
    return NextResponse.json({
      success: true,
      session,
    });
  } catch (error: any) {
    console.error("[Analysis Sessions] POST error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
