/**
 * 백그라운드 작업 관리 API
 * 
 * GET: 작업 목록 조회
 * POST: 새 작업 생성
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createJob,
  listActiveJobs,
  listJobsByType,
  hasRunningJob,
  cleanupOldJobs,
  JobType,
} from "@/lib/jobs/job-store";
import { runEmbeddingJob } from "@/lib/jobs/embedding-worker";

export const runtime = "nodejs";

// GET: 작업 목록 조회
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type") as JobType | null;
    const activeOnly = searchParams.get("active") === "true";
    const limit = parseInt(searchParams.get("limit") || "10");
    
    if (activeOnly) {
      const jobs = listActiveJobs();
      return NextResponse.json({
        success: true,
        jobs,
      });
    }
    
    if (type) {
      const jobs = listJobsByType(type, limit);
      return NextResponse.json({
        success: true,
        jobs,
      });
    }
    
    // 기본: 활성 작업 반환
    const jobs = listActiveJobs();
    return NextResponse.json({
      success: true,
      jobs,
    });
    
  } catch (error: any) {
    console.error("[Jobs] GET error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST: 새 작업 생성
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, params, metadata } = body as {
      type: JobType;
      params: Record<string, any>;
      metadata?: Record<string, any>;
    };
    
    if (!type) {
      return NextResponse.json(
        { success: false, error: "작업 유형이 필요합니다." },
        { status: 400 }
      );
    }
    
    // 동일 유형의 실행 중인 작업이 있는지 확인
    if (hasRunningJob(type)) {
      return NextResponse.json(
        { success: false, error: `이미 실행 중인 ${type} 작업이 있습니다.` },
        { status: 409 }
      );
    }
    
    // 작업 생성
    const job = createJob(type, params, metadata);
    
    // 백그라운드에서 작업 실행 (비동기)
    if (type === "embedding") {
      console.log(`[Jobs] Starting embedding job: ${job.id}`);
      // 즉시 반환하고 백그라운드에서 실행
      // setImmediate 대신 Promise.resolve().then() 사용 (Next.js 호환성)
      Promise.resolve().then(() => {
        console.log(`[Jobs] Running embedding worker for job: ${job.id}`);
        runEmbeddingJob(job.id).catch(err => {
          console.error(`[Jobs] Background job error:`, err);
        });
      });
    }
    
    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
      },
    });
    
  } catch (error: any) {
    console.error("[Jobs] POST error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE: 오래된 작업 정리
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const maxAgeDays = parseInt(searchParams.get("maxAgeDays") || "7");
    
    const deletedCount = cleanupOldJobs(maxAgeDays);
    
    return NextResponse.json({
      success: true,
      deleted: deletedCount,
    });
    
  } catch (error: any) {
    console.error("[Jobs] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
