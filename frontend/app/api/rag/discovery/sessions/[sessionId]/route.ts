/**
 * 개별 세션 관리 API
 * 
 * GET: 세션 상세 조회
 * PUT: 세션 업데이트 (이슈 선택 등)
 * DELETE: 세션 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadSession,
  saveSession,
  deleteSession,
  selectIssues,
} from "@/lib/rag/discovery-store";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const session = loadSession(sessionId);
    
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
    console.error("Failed to get session:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    
    const session = loadSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "세션을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    // 이슈 선택 업데이트
    if (body.selectedIssueIds !== undefined) {
      selectIssues(sessionId, body.selectedIssueIds);
    }
    
    // 세션 이름 업데이트
    if (body.name !== undefined) {
      session.name = body.name;
      saveSession(session);
    }
    
    const updatedSession = loadSession(sessionId);
    
    return NextResponse.json({
      success: true,
      session: updatedSession,
    });
  } catch (error: any) {
    console.error("Failed to update session:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const deleted = deleteSession(sessionId);
    
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "세션을 삭제할 수 없습니다." },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: "세션이 삭제되었습니다.",
    });
  } catch (error: any) {
    console.error("Failed to delete session:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
