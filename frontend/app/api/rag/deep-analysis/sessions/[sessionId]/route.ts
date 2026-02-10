/**
 * 개별 분석 세션 API
 * 
 * GET: 세션 상세 조회
 * DELETE: 세션 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadAnalysisSession,
  deleteAnalysisSession,
  saveAnalysisSession,
} from "@/lib/rag/analysis-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const session = loadAnalysisSession(sessionId);
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: "세션을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      session,
    });
  } catch (error: any) {
    console.error("[Analysis Session] GET error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const session = loadAnalysisSession(sessionId);
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: "세션을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    const body = await request.json();
    
    // 허용된 필드만 업데이트
    if (body.name !== undefined) session.name = body.name;
    if (body.status !== undefined) session.status = body.status;
    if (body.model !== undefined) session.model = body.model;
    if (body.tokenUsage !== undefined) {
      session.tokenUsage = { ...session.tokenUsage, ...body.tokenUsage };
    }
    
    saveAnalysisSession(session);
    
    return NextResponse.json({
      success: true,
      session,
    });
  } catch (error: any) {
    console.error("[Analysis Session] PUT error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const deleted = deleteAnalysisSession(sessionId);
    
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "세션을 찾을 수 없거나 삭제에 실패했습니다." },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: "세션이 삭제되었습니다.",
    });
  } catch (error: any) {
    console.error("[Analysis Session] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
