/**
 * 개별 이슈 관리 API
 * 
 * PUT: 이슈 업데이트 (상태, 내용 수정)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadSession,
  updateIssueStatus,
  updateIssueContent,
  IssueStatus,
} from "@/lib/rag/discovery-store";

interface RouteParams {
  params: Promise<{ sessionId: string; issueId: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId, issueId } = await params;
    const body = await request.json();
    
    const session = loadSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "세션을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    let updatedIssue = null;
    
    // 상태 업데이트
    if (body.status !== undefined) {
      updatedIssue = updateIssueStatus(sessionId, issueId, body.status as IssueStatus);
    }
    
    // 내용 업데이트
    if (body.userTitle !== undefined || body.userSummary !== undefined || body.userNotes !== undefined) {
      updatedIssue = updateIssueContent(sessionId, issueId, {
        userTitle: body.userTitle,
        userSummary: body.userSummary,
        userNotes: body.userNotes,
      });
    }
    
    if (!updatedIssue) {
      return NextResponse.json(
        { success: false, error: "이슈를 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      issue: updatedIssue,
    });
  } catch (error: any) {
    console.error("Failed to update issue:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
