/**
 * 사업장 프로파일 문서 업로드 API
 * 
 * POST: 통합환경관리계획서 또는 부분 문서 업로드
 * - PDF/HWP 텍스트 추출
 * - 청킹 및 임베딩
 * - 프로파일 전용 벡터DB 저장
 * - LLM 정보 추출 (별도 API)
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { loadProfile, saveProfile, UploadedDocument } from "@/lib/rag/site-profile";

export const runtime = "nodejs";
export const maxDuration = 600; // 10분 - 대용량 파일 처리를 위해 증가

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const UPLOAD_DIR = path.join(process.cwd(), "data", "profile-uploads");

// 업로드 디렉토리 확인
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const profileId = formData.get("profileId") as string;
    const docType = formData.get("docType") as "full_plan" | "partial" || "full_plan";
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
    // targetTabs: 빈 배열이면 전체 탭 대상, 특정 탭 지정 시 해당 탭만 대상
    const uploadedDoc: UploadedDocument = {
      id: docId,
      filename: savedFileName,
      originalName: fileName,
      fileType: fileExt.slice(1) as "pdf" | "hwp" | "hwpx",
      fileSize: file.size,
      uploadedAt: new Date().toISOString(),
      docType,
      targetTabs: targetTabs.length > 0 ? targetTabs : undefined, // 특정 탭 지정된 경우만 저장
      extractionStatus: "pending",
    };
    
    profile.uploadedDocuments.push(uploadedDoc);
    saveProfile(profile);
    
    // 백엔드로 텍스트 추출 요청
    let extractedText = "";
    let extractionError = null;
    
    try {
      // 저장된 파일 경로를 JSON으로 전송 (FormData 대신)
      const extractRes = await fetch(`${BACKEND_URL}/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file_path: savedPath }),
      });
      
      if (extractRes.ok) {
        const extractData = await extractRes.json();
        if (extractData.success && extractData.text) {
          extractedText = extractData.text;
          uploadedDoc.extractionStatus = "completed";
        } else {
          extractionError = extractData.error || "텍스트 추출 실패";
          uploadedDoc.extractionStatus = "failed";
        }
      } else {
        extractionError = `추출 API 오류: ${extractRes.status}`;
        uploadedDoc.extractionStatus = "failed";
      }
    } catch (error: any) {
      extractionError = error.message;
      uploadedDoc.extractionStatus = "failed";
    }
    
    // 프로파일 업데이트
    const docIndex = profile.uploadedDocuments.findIndex(d => d.id === docId);
    if (docIndex >= 0) {
      profile.uploadedDocuments[docIndex] = uploadedDoc;
      saveProfile(profile);
    }
    
    // 텍스트 추출 실패 시 반환
    if (!extractedText) {
      return NextResponse.json({
        success: false,
        error: extractionError || "텍스트 추출에 실패했습니다.",
        documentId: docId,
        extractionStatus: "failed",
      });
    }
    
    // 청킹
    const chunks = chunkText(extractedText, {
      profileId,
      profileName: profile.name,
      industryCode: profile.industryCategory,
      docType,
      targetTabs,
      sourceFile: fileName,
    });
    
    uploadedDoc.chunkCount = chunks.length;
    
    // 임베딩 생성 및 벡터DB 저장
    let embeddingError = null;
    try {
      const embeddingResult = await generateAndStoreEmbeddings(chunks, profileId);
      if (embeddingResult.success) {
        uploadedDoc.embeddingStatus = "completed";
      } else {
        embeddingError = embeddingResult.error;
        uploadedDoc.embeddingStatus = "failed";
      }
    } catch (error: any) {
      embeddingError = error.message;
      uploadedDoc.embeddingStatus = "failed";
    }
    
    // 최종 프로파일 업데이트
    const finalDocIndex = profile.uploadedDocuments.findIndex(d => d.id === docId);
    if (finalDocIndex >= 0) {
      profile.uploadedDocuments[finalDocIndex] = uploadedDoc;
      saveProfile(profile);
    }
    
    return NextResponse.json({
      success: true,
      documentId: docId,
      filename: fileName,
      extractedLength: extractedText.length,
      chunkCount: chunks.length,
      extractionStatus: uploadedDoc.extractionStatus,
      embeddingStatus: uploadedDoc.embeddingStatus,
      embeddingError,
    });
    
  } catch (error: any) {
    console.error("[ProfileUpload] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// 청킹 함수
function chunkText(
  text: string,
  metadata: {
    profileId: string;
    profileName: string;
    industryCode: string;
    docType: string;
    targetTabs: string[];
    sourceFile: string;
  }
): { id: string; content: string; metadata: Record<string, any> }[] {
  const chunks: { id: string; content: string; metadata: Record<string, any> }[] = [];
  
  // 단락 기준으로 분할
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  let currentChunk = "";
  let chunkIndex = 0;
  const maxChunkSize = 1500;
  const overlap = 200;
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      // 현재 청크 저장
      chunks.push({
        id: `${metadata.profileId}_chunk_${chunkIndex}`,
        content: currentChunk.trim(),
        metadata: {
          ...metadata,
          chunk_index: chunkIndex,
          chunk_type: "text",
          uploaded_at: new Date().toISOString(),
        },
      });
      
      // 오버랩 유지
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + "\n\n" + para;
      chunkIndex++;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }
  
  // 마지막 청크 저장
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: `${metadata.profileId}_chunk_${chunkIndex}`,
      content: currentChunk.trim(),
      metadata: {
        ...metadata,
        chunk_index: chunkIndex,
        chunk_type: "text",
        uploaded_at: new Date().toISOString(),
      },
    });
  }
  
  return chunks;
}

// 임베딩 생성 및 저장
async function generateAndStoreEmbeddings(
  chunks: { id: string; content: string; metadata: Record<string, any> }[],
  profileId: string
): Promise<{ success: boolean; error?: string }> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  if (!OPENAI_API_KEY) {
    return { success: false, error: "OpenAI API 키가 설정되지 않았습니다." };
  }
  
  try {
    // 배치 임베딩 생성
    const batchSize = 20;
    const allResults: { id: string; embedding: number[]; content: string; metadata: Record<string, any> }[] = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.content);
      
      const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-large",
          input: texts,
        }),
      });
      
      if (!embeddingRes.ok) {
        return { success: false, error: `임베딩 API 오류: ${embeddingRes.status}` };
      }
      
      const embeddingData = await embeddingRes.json();
      
      for (let j = 0; j < batch.length; j++) {
        allResults.push({
          id: batch[j].id,
          embedding: embeddingData.data[j].embedding,
          content: batch[j].content,
          metadata: batch[j].metadata,
        });
      }
    }
    
    // 프로파일 벡터DB에 저장
    const upsertRes = await fetch(`${BACKEND_URL}/profile-vectordb/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunks: allResults.map(r => ({
          id: r.id,
          embedding: r.embedding,
          content: r.content,
          metadata: {
            ...r.metadata,
            profile_id: profileId,
          },
        })),
      }),
    });
    
    if (!upsertRes.ok) {
      return { success: false, error: `벡터DB 저장 오류: ${upsertRes.status}` };
    }
    
    const upsertData = await upsertRes.json();
    if (!upsertData.success) {
      return { success: false, error: upsertData.error || "벡터DB 저장 실패" };
    }
    
    return { success: true };
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
