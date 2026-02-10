/**
 * 텍스트 추출 API Route
 * Python 백엔드 서비스와 통신
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

const BACKEND_URL = process.env.EXTRACTION_BACKEND_URL || "http://localhost:8000";

/**
 * GET /api/processing/extract
 * 추출 대상 파일 목록 조회
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const org_id = searchParams.get("org_id") || "";
    const board_id = searchParams.get("board_id") || "";
    const format = searchParams.get("format") || "";
    const limit = searchParams.get("limit") || "50";

    const params = new URLSearchParams();
    if (org_id) params.append("org_id", org_id);
    if (board_id) params.append("board_id", board_id);
    if (format) params.append("format", format);
    params.append("limit", limit);

    const response = await fetch(`${BACKEND_URL}/files?${params.toString()}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch files" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Extract files error:", error);
    return NextResponse.json(
      { error: "Backend service unavailable", details: String(error) },
      { status: 503 }
    );
  }
}

/**
 * POST /api/processing/extract
 * 텍스트 추출 실행
 * - FormData (파일 직접 업로드) 또는 JSON (파일 경로) 지원
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    
    // FormData 처리 (파일 직접 업로드)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      
      if (!file) {
        return NextResponse.json(
          { error: "파일이 필요합니다." },
          { status: 400 }
        );
      }
      
      // 임시 파일로 저장
      const tempDir = os.tmpdir();
      const tempFileName = `extract_${Date.now()}_${file.name}`;
      const tempFilePath = path.join(tempDir, tempFileName);
      
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(tempFilePath, buffer);
      
      try {
        // 백엔드로 추출 요청
        const response = await fetch(`${BACKEND_URL}/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_path: tempFilePath }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          return NextResponse.json(
            { error: errorData.detail || "Extraction failed" },
            { status: response.status }
          );
        }
        
        const data = await response.json();
        return NextResponse.json(data);
      } finally {
        // 임시 파일 삭제
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          // 무시
        }
      }
    }
    
    // JSON 처리 (기존 방식)
    const body = await req.json();
    const { file_path, file_paths, mode = "single" } = body;

    // 단일 파일 추출
    if (mode === "single" && file_path) {
      const response = await fetch(`${BACKEND_URL}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return NextResponse.json(
          { error: errorData.detail || "Extraction failed" },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    }

    // 배치 추출
    if (mode === "batch" && file_paths && Array.isArray(file_paths)) {
      const response = await fetch(`${BACKEND_URL}/extract/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_paths }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return NextResponse.json(
          { error: errorData.detail || "Batch extraction failed" },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: "Invalid request. Provide file_path or file_paths with mode" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[API] Extract error:", error);
    return NextResponse.json(
      { error: "Backend service unavailable", details: String(error) },
      { status: 503 }
    );
  }
}
