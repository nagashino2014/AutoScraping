/**
 * 파일 업로드 전용 API (Step 1)
 *
 * POST: 파일 업로드 및 저장 (텍스트 추출 없이 저장만)
 * DELETE: 저장된 파일 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { loadProfile, saveProfile, UploadedDocument } from "@/lib/rag/site-profile";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_DIR = path.join(process.cwd(), "data", "profile-uploads");

// 업로드 디렉토리 확인
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * POST: 파일 업로드 및 저장
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const profileId = formData.get("profileId") as string;
    const docType = (formData.get("docType") as "full_plan" | "partial") || "full_plan";
    const targetTabsStr = formData.get("targetTabs") as string;
    const targetTabs = targetTabsStr ? JSON.parse(targetTabsStr) : [];

    if (!file) {
      return NextResponse.json(
        { success: false, error: "파일이 필요합니다." },
        { status: 400 }
      );
    }

    if (!profileId) {
      return NextResponse.json(
        { success: false, error: "프로파일 ID가 필요합니다." },
        { status: 400 }
      );
    }

    // 프로파일 확인
    const profile = loadProfile(profileId);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "프로파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 파일 타입 확인
    const fileName = file.name;
    const fileExt = path.extname(fileName).toLowerCase();
    if (![".pdf", ".hwp", ".hwpx"].includes(fileExt)) {
      return NextResponse.json(
        { success: false, error: "지원되지 않는 파일 형식입니다. (PDF, HWP만 지원)" },
        { status: 400 }
      );
    }

    // 파일 저장
    ensureUploadDir();
    const docId = randomUUID();
    const savedFileName = `${profileId}_${docId}${fileExt}`;
    const savedPath = path.join(UPLOAD_DIR, savedFileName);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(savedPath, buffer);

    // 업로드 문서 정보 추가
    const uploadedDoc: UploadedDocument = {
      id: docId,
      filename: savedFileName,
      originalName: fileName,
      fileType: fileExt.slice(1) as "pdf" | "hwp" | "hwpx",
      fileSize: file.size,
      uploadedAt: new Date().toISOString(),
      docType,
      targetTabs: targetTabs.length > 0 ? targetTabs : undefined,
      extractionStatus: "pending",
    };

    profile.uploadedDocuments.push(uploadedDoc);
    saveProfile(profile);

    return NextResponse.json({
      success: true,
      documentId: docId,
      filename: fileName,
      savedPath,
      fileSize: file.size,
      targetTabs,
    });
  } catch (error: any) {
    console.error("[FileUpload] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE: 저장된 파일 삭제
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { docId, profileId } = body;

    if (!docId || !profileId) {
      return NextResponse.json(
        { success: false, error: "docId와 profileId가 필요합니다." },
        { status: 400 }
      );
    }

    // 프로파일 확인
    const profile = loadProfile(profileId);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "프로파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 문서 찾기
    const docIndex = profile.uploadedDocuments.findIndex((d) => d.id === docId);
    if (docIndex === -1) {
      return NextResponse.json(
        { success: false, error: "문서를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const doc = profile.uploadedDocuments[docIndex];
    const filePath = path.join(UPLOAD_DIR, doc.filename);

    // 파일 삭제
    let deletedPath = "";
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deletedPath = filePath;
    }

    // 프로파일에서 문서 정보 제거
    profile.uploadedDocuments.splice(docIndex, 1);
    saveProfile(profile);

    return NextResponse.json({
      success: true,
      deletedPath,
      message: `파일 "${doc.originalName}"이 삭제되었습니다.`,
    });
  } catch (error: any) {
    console.error("[FileDelete] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
