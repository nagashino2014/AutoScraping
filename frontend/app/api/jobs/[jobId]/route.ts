/**
 * 개별 작업 관리 API
 * 
 * GET: 작업 상태 조회
 * DELETE: 작업 취소
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadJob,
  cancelJob,
  deleteJob,
} from "@/lib/jobs/job-store";
import { requestJobCancellation } from "@/lib/jobs/embedding-worker";

export const runtime = "nodejs";

// GET: 작업 상태 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = loadJob(jobId);
    
    if (!job) {
      return NextResponse.json(
        { success: false, error: "작업을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      job,
    });
    
  } catch (error: any) {
    console.error("[Job] GET error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE: 작업 취소 또는 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get("action") || "cancel";
    
    const job = loadJob(jobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: "작업을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    if (action === "delete") {
      // 실행 중인 작업은 삭제 불가
      if (job.status === "running") {
        return NextResponse.json(
          { success: false, error: "실행 중인 작업은 삭제할 수 없습니다. 먼저 취소하세요." },
          { status: 400 }
        );
      }
      
      const deleted = deleteJob(jobId);
      return NextResponse.json({
        success: deleted,
        message: deleted ? "작업이 삭제되었습니다." : "삭제 실패",
      });
    }
    
    // 취소
    if (job.status !== "running" && job.status !== "pending") {
      return NextResponse.json(
        { success: false, error: "이미 완료된 작업입니다." },
        { status: 400 }
      );
    }
    
    // Worker에게 취소 요청
    requestJobCancellation(jobId);
    
    // 상태 업데이트
    const cancelledJob = cancelJob(jobId);
    
    return NextResponse.json({
      success: true,
      job: cancelledJob,
      message: "작업 취소가 요청되었습니다.",
    });
    
  } catch (error: any) {
    console.error("[Job] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
