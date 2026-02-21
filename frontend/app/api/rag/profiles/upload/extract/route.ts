/**
 * 텍스트 추출 API (Step 2)
 *
 * POST: 업로드된 파일에서 텍스트 추출 (SSE 스트리밍)
 * DELETE: 추출된 텍스트 데이터 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import http from "http";
import { loadProfile, saveProfile } from "@/lib/rag/site-profile";
import { storage, uploadJson } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 600; // 10분 - 대용량 파일 처리를 위해

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * Node.js http 모듈을 사용한 백엔드 요청
 * 
 * Node.js 내장 fetch(undici)의 headersTimeout 기본값이 300초(5분)이라
 * 대용량 PDF 추출 시 타임아웃 발생. http 모듈로 직접 요청하여 해결.
 */
function fetchBackend(
  url: string,
  body: object,
  timeoutMs: number = 30 * 60 * 1000
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);

    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: parseInt(urlObj.port || "80"),
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 500,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
        res.on("error", reject);
      }
    );

    // 소켓 타임아웃: 30분 (대용량 PDF 추출 대비)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`백엔드 요청 타임아웃 (${Math.round(timeoutMs / 60000)}분 초과)`));
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}
const UPLOAD_DIR = path.join(process.cwd(), "data", "profile-uploads");
function extractedStorageKey(profileId: string, docId: string): string {
  return `ExtractedData/${profileId}/${docId}_extracted.json`;
}

/**
 * POST: 텍스트 추출 (SSE 스트리밍)
 */
export async function POST(request: NextRequest) {
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

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, error: "파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // SSE 스트리밍 설정
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = async (event: string, data: any) => {
      const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(eventData));
    };

    // 비동기 추출 프로세스
    (async () => {
      // 하트비트를 전체 처리 완료까지 유지 (SSE 연결 유지 핵심)
      let elapsedSec = 0;
      const heartbeatInterval = setInterval(async () => {
        elapsedSec += 10;
        const minutes = Math.floor(elapsedSec / 60);
        const seconds = elapsedSec % 60;
        const timeStr = minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
        try {
          await sendEvent("progress", {
            stage: "extracting",
            message: `처리 중... (${timeStr} 경과)`,
          });
        } catch {
          // SSE 쓰기 실패 시 무시 (연결이 이미 끊긴 경우)
        }
      }, 10000);

      try {
        await sendEvent("progress", { stage: "start", message: "텍스트 추출 시작..." });
        await sendEvent("progress", { stage: "extracting", message: "백엔드 추출 중..." });

        // Node.js http 모듈로 백엔드 요청 (undici headersTimeout 300초 제한 우회)
        console.log("[Extract] 백엔드 추출 요청 시작:", filePath);
        const backendResponse = await fetchBackend(
          `${BACKEND_URL}/extract`,
          { file_path: filePath },
          30 * 60 * 1000 // 30분 타임아웃
        );

        if (backendResponse.statusCode !== 200) {
          throw new Error(`추출 API 오류: ${backendResponse.statusCode} - ${backendResponse.body.substring(0, 500)}`);
        }

        console.log("[Extract] 백엔드 응답 수신 완료, 응답 본문 크기:", backendResponse.body.length, "자");
        const responseText = backendResponse.body;

        let extractData: any;
        try {
          extractData = JSON.parse(responseText);
          console.log("[Extract] JSON 파싱 성공, success:", extractData.success, 
            "text_length:", extractData.text?.length || 0,
            "tables:", extractData.tables?.length || 0,
            "pages:", extractData.page_count || 0);
        } catch (parseError: any) {
          console.error("[Extract] JSON 파싱 실패:", parseError.message);
          console.error("[Extract] 응답 앞부분(500자):", responseText.substring(0, 500));
          console.error("[Extract] 응답 뒷부분(500자):", responseText.substring(Math.max(0, responseText.length - 500)));
          throw new Error(`백엔드 응답 JSON 파싱 실패 (응답 크기: ${responseText.length}자): ${parseError.message}`);
        }

        if (!extractData.success) {
          console.error("[Extract] Backend returned success=false:", {
            status: extractData.status,
            quality_score: extractData.quality_score,
            error: extractData.error_message,
            text_length: extractData.text?.length || 0,
            page_count: extractData.page_count,
          });
          
          // 텍스트가 실제로 추출되었으면 성공으로 처리
          if (extractData.text && extractData.text.length > 100) {
            console.log("[Extract] 텍스트가 추출되었으므로 성공으로 처리:", extractData.text.length, "자");
            extractData.success = true;
          } else {
            throw new Error(extractData.error_message || extractData.error || "텍스트 추출 실패");
          }
        }

        const extractedText = extractData.text || "";
        const tables = extractData.tables || [];
        const pageCount = extractData.page_count || 0;

        console.log("[Extract] 추출 데이터 처리 완료, 파일 저장 시작...");

        await sendEvent("progress", {
          stage: "extracted",
          message: `텍스트 추출 완료 (${pageCount}페이지, ${extractedText.length}자)`,
          pageCount,
          textLength: extractedText.length,
          tableCount: tables.length,
        });

        // 추출 결과 저장
        const storageKey = extractedStorageKey(profileId, docId);
        await uploadJson(storageKey, {
          docId,
          profileId,
          originalName: doc.originalName,
          extractedAt: new Date().toISOString(),
          text: extractedText,
          tables,
          pageCount,
          textLength: extractedText.length,
        });
        console.log("[Extract] 추출 JSON 저장 완료:", storageKey);

        // 프로파일 업데이트 (최신 프로파일을 다시 로드하여 덮어쓰기 방지)
        const freshProfile = loadProfile(profileId);
        if (freshProfile) {
          const freshDocIndex = freshProfile.uploadedDocuments.findIndex((d) => d.id === docId);
          if (freshDocIndex !== -1) {
            freshProfile.uploadedDocuments[freshDocIndex].extractionStatus = "completed";
            freshProfile.uploadedDocuments[freshDocIndex].extractedPath = storageKey;
            saveProfile(freshProfile);
            console.log("[Extract] 프로파일 업데이트 완료: extractionStatus=completed");
          }
        } else {
          // 폴백: 원래 프로파일 객체 사용
          doc.extractionStatus = "completed";
          doc.extractedPath = storageKey;
          profile.uploadedDocuments[docIndex] = doc;
          saveProfile(profile);
        }

        await sendEvent("complete", {
          success: true,
          extractedPath: storageKey,
          textLength: extractedText.length,
          tableCount: tables.length,
          pageCount,
        });
        console.log("[Extract] SSE complete 이벤트 전송 완료");
      } catch (error: any) {
        console.error("[Extract] ===== 추출 처리 실패 =====");
        console.error("[Extract] 에러 메시지:", error.message);
        console.error("[Extract] 스택 트레이스:", error.stack);
        console.error("[Extract] docId:", docId, "profileId:", profileId);
        console.error("[Extract] ========================");

        // 프로파일 업데이트 (실패) - 최신 프로파일 로드
        try {
          const freshProfile = loadProfile(profileId);
          if (freshProfile) {
            const freshDocIndex = freshProfile.uploadedDocuments.findIndex((d) => d.id === docId);
            if (freshDocIndex !== -1) {
              freshProfile.uploadedDocuments[freshDocIndex].extractionStatus = "failed";
              saveProfile(freshProfile);
            }
          } else {
            doc.extractionStatus = "failed";
            profile.uploadedDocuments[docIndex] = doc;
            saveProfile(profile);
          }
        } catch (saveErr: any) {
          console.error("[Extract] 프로파일 저장 실패:", saveErr.message);
        }

        try {
          await sendEvent("error", { error: error.message });
        } catch {
          // SSE 쓰기 실패 시 무시
        }
      } finally {
        clearInterval(heartbeatInterval);
        try {
          await writer.close();
        } catch {
          // writer 이미 닫힌 경우 무시
        }
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("[Extract] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE: 추출된 텍스트 데이터 삭제
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { docId, profileId, deleteSourceFile = false } = body;

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
    let deletedExtraction = false;
    let deletedSourceFile = false;

    // 추출된 데이터 삭제
    const extractedKey = extractedStorageKey(profileId, docId);
    try {
      if (await storage.exists(extractedKey)) {
        await storage.delete(extractedKey);
        deletedExtraction = true;
      }
    } catch {
      // 파일이 없을 수 있음
    }

    // 원본 파일도 삭제 요청 시
    if (deleteSourceFile) {
      const sourcePath = path.join(UPLOAD_DIR, doc.filename);
      if (fs.existsSync(sourcePath)) {
        fs.unlinkSync(sourcePath);
        deletedSourceFile = true;
      }
      // 프로파일에서 문서 정보 제거
      profile.uploadedDocuments.splice(docIndex, 1);
    } else {
      // 추출 상태만 초기화
      doc.extractionStatus = "pending";
      doc.extractedPath = undefined;
      profile.uploadedDocuments[docIndex] = doc;
    }

    saveProfile(profile);

    return NextResponse.json({
      success: true,
      deletedExtraction,
      deletedSourceFile,
      message: deleteSourceFile
        ? `파일 "${doc.originalName}"과 추출 데이터가 삭제되었습니다.`
        : `"${doc.originalName}"의 추출 데이터가 삭제되었습니다.`,
    });
  } catch (error: any) {
    console.error("[ExtractDelete] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
