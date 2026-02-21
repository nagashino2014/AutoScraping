/**
 * 청킹 및 임베딩 API (Step 3)
 *
 * POST: 추출된 텍스트를 청킹하고 임베딩 생성 후 벡터DB 저장 (SSE 스트리밍)
 * DELETE: 청크 파일 및 벡터 DB 데이터 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import { loadProfile, saveProfile } from "@/lib/rag/site-profile";
import { storage, downloadJson, uploadJson } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 600; // 10분

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
function extractedStorageKey(profileId: string, docId: string): string {
  return `ExtractedData/${profileId}/${docId}_extracted.json`;
}
function chunkStorageKey(profileId: string, docId: string): string {
  return `chunk/${profileId}/${docId}_chunks.json`;
}
function embeddingStorageKey(profileId: string, docId: string): string {
  return `chunk/${profileId}/${docId}_embeddings.json`;
}

// 토큰 추정 함수 (한글 기준 - 보수적 계산)
// 한글은 GPT tokenizer에서 실제로 2~3 토큰/자 사용
function estimateTokens(text: string): number {
  // 한글 문자 수
  const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  // 영문 단어 수 (띄어쓰기 기준)
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  // 숫자 및 특수문자
  const others = text.length - koreanChars - (text.match(/[a-zA-Z]/g) || []).length;
  
  // 한글: 2.5 토큰/자 (보수적), 영문: 0.4 토큰/단어, 기타: 0.5 토큰/자
  return Math.ceil(koreanChars * 2.5 + englishWords * 0.4 + others * 0.5);
}


/**
 * POST: 청킹 및 임베딩 (SSE 스트리밍)
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

    // 추출된 데이터 확인
    const extKey = extractedStorageKey(profileId, docId);
    const extExists = await storage.exists(extKey);
    if (!extExists) {
      return NextResponse.json(
        { success: false, error: "추출된 데이터를 찾을 수 없습니다. 먼저 텍스트 추출을 수행하세요." },
        { status: 404 }
      );
    }

    const extractedData = await downloadJson(extKey);
    const extractedText = extractedData.text || "";

    if (!extractedText) {
      return NextResponse.json(
        { success: false, error: "추출된 텍스트가 없습니다." },
        { status: 400 }
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

    // 비동기 임베딩 프로세스
    (async () => {
      try {
        await sendEvent("progress", { stage: "start", message: "청킹 및 임베딩 시작..." });

        // 프로파일에서 청킹/임베딩 설정 읽기
        const chunkingConfig = profile.ragConfig?.chunkingConfig || { chunkSize: 350, chunkOverlap: 50 };
        const embeddingConfig = profile.ragConfig?.embeddingConfig || { model: "text-embedding-3-small", batchSize: 5 };
        
        await sendEvent("progress", { 
          stage: "config", 
          message: `청킹 설정: ${chunkingConfig.chunkSize}토큰, 오버랩 ${chunkingConfig.chunkOverlap}토큰 | 임베딩: ${embeddingConfig.model}` 
        });

        // 청킹
        await sendEvent("progress", { stage: "chunking", message: "텍스트 청킹 중..." });

        const chunks = chunkTextByTokens(extractedText, {
          profileId,
          profileName: profile.name,
          industryCode: profile.industryCategory,
          docType: doc.docType,
          targetTabs: doc.targetTabs || [],
          sourceFile: doc.originalName,
          docId,
        }, chunkingConfig.chunkSize, chunkingConfig.chunkOverlap);

        await sendEvent("progress", {
          stage: "chunked",
          message: `청킹 완료 (${chunks.length}개 청크)`,
          chunkCount: chunks.length,
        });

        // 청크 저장
        const chunkKey = chunkStorageKey(profileId, docId);
        await uploadJson(chunkKey, chunks);

        // 임베딩 생성
        await sendEvent("progress", { stage: "embedding", message: "임베딩 생성 중..." });

        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        if (!OPENAI_API_KEY) {
          throw new Error("OpenAI API 키가 설정되지 않았습니다.");
        }

        // 프로파일 설정에서 임베딩 모델과 배치 크기 사용
        const embeddingModel = embeddingConfig.model || "text-embedding-3-small";
        const batchSize = embeddingConfig.batchSize || 5;
        const allResults: {
          id: string;
          embedding: number[];
          content: string;
          metadata: Record<string, any>;
        }[] = [];

        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          const texts = batch.map((c) => c.content);
          const currentBatch = Math.floor(i / batchSize) + 1;
          const totalBatches = Math.ceil(chunks.length / batchSize);

          await sendEvent("progress", {
            stage: "embedding",
            message: `임베딩 생성 중... (${Math.min(i + batchSize, chunks.length)}/${chunks.length}) [배치 ${currentBatch}/${totalBatches}]`,
            progress: Math.round(((i + batchSize) / chunks.length) * 100),
          });

          try {
            const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: embeddingModel,
                input: texts,
              }),
            });

            if (!embeddingRes.ok) {
              const errorText = await embeddingRes.text();
              console.error(`[Embed] OpenAI API 오류 (배치 ${currentBatch}):`, embeddingRes.status, errorText);
              await sendEvent("progress", {
                stage: "error",
                message: `임베딩 API 오류 (배치 ${currentBatch}): ${embeddingRes.status}`,
              });
              // Rate limit인 경우 대기 후 재시도
              if (embeddingRes.status === 429) {
                await sendEvent("progress", { stage: "retry", message: "Rate limit - 30초 대기 후 재시도..." });
                await new Promise(resolve => setTimeout(resolve, 30000));
                i -= batchSize; // 현재 배치 재시도
                continue;
              }
              throw new Error(`임베딩 API 오류: ${embeddingRes.status} - ${errorText}`);
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

            // Rate limit 방지를 위한 짧은 딜레이 (100ms)
            if (i + batchSize < chunks.length) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (batchError: any) {
            console.error(`[Embed] 배치 ${currentBatch} 처리 오류:`, batchError);
            await sendEvent("progress", {
              stage: "error",
              message: `배치 ${currentBatch} 오류: ${batchError.message}`,
            });
            throw batchError;
          }
        }

        await sendEvent("progress", {
          stage: "embedded",
          message: `임베딩 생성 완료 (${allResults.length}개)`,
          embeddingCount: allResults.length,
        });

        // 임베딩 결과를 청크 파일에 함께 저장 (벡터DB 저장 실패 시에도 나중에 사용 가능)
        const chunksWithEmbeddings = allResults.map((r) => ({
          id: r.id,
          content: r.content,
          metadata: {
            ...r.metadata,
            profile_id: profileId,
            doc_id: docId,
          },
          embedding: r.embedding,
        }));
        
        const embKey = embeddingStorageKey(profileId, docId);
        await uploadJson(embKey, chunksWithEmbeddings);
        
        await sendEvent("progress", { 
          stage: "saved", 
          message: `임베딩 파일 저장 완료: ${embKey}` 
        });

        // 벡터DB 저장 시도 (실패해도 진행)
        let vectorDbSuccess = false;
        await sendEvent("progress", { stage: "storing", message: "벡터DB 저장 시도 중..." });

        try {
          const upsertRes = await fetch(`${BACKEND_URL}/profile-vectordb/upsert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chunks: chunksWithEmbeddings,
            }),
          });

          if (upsertRes.ok) {
            const upsertData = await upsertRes.json();
            if (upsertData.success) {
              vectorDbSuccess = true;
              await sendEvent("progress", { stage: "stored", message: "벡터DB 저장 완료" });
            } else {
              console.warn("[Embed] 벡터DB 저장 실패:", upsertData.error);
              await sendEvent("progress", { 
                stage: "warning", 
                message: `벡터DB 저장 실패 (임베딩 파일은 저장됨): ${upsertData.error}` 
              });
            }
          } else {
            console.warn("[Embed] 벡터DB 엔드포인트 오류:", upsertRes.status);
            await sendEvent("progress", { 
              stage: "warning", 
              message: `벡터DB 엔드포인트 오류 (${upsertRes.status}): 임베딩 파일로 저장됨` 
            });
          }
        } catch (vectorDbError: any) {
          console.warn("[Embed] 벡터DB 저장 예외:", vectorDbError.message);
          await sendEvent("progress", { 
            stage: "warning", 
            message: `벡터DB 저장 건너뜀: ${vectorDbError.message}` 
          });
        }

        // 프로파일 업데이트 (임베딩 완료로 표시)
        doc.embeddingStatus = "completed";
        doc.chunkCount = chunks.length;
        doc.chunkPath = chunkKey;
        doc.embeddingPath = embKey;
        doc.vectorDbStored = vectorDbSuccess;
        profile.uploadedDocuments[docIndex] = doc;
        saveProfile(profile);

        await sendEvent("complete", {
          success: true,
          chunkCount: chunks.length,
          embeddingCount: allResults.length,
          chunkPath: chunkKey,
          embeddingPath: embKey,
          vectorDbStored: vectorDbSuccess,
        });
      } catch (error: any) {
        // 프로파일 업데이트 (실패)
        doc.embeddingStatus = "failed";
        profile.uploadedDocuments[docIndex] = doc;
        saveProfile(profile);

        await sendEvent("error", { error: error.message });
      } finally {
        await writer.close();
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
    console.error("[Embed] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE: 청크 및 벡터 DB 데이터 삭제
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
    let deletedChunks = 0;
    let deletedEmbeddings = 0;

    // 청크 파일 삭제
    const chunkKey = chunkStorageKey(profileId, docId);
    try {
      if (await storage.exists(chunkKey)) {
        const chunks = await downloadJson<any[]>(chunkKey);
        deletedChunks = chunks.length;
        await storage.delete(chunkKey);
      }
    } catch {
      // 파일이 없을 수 있음
    }

    // 벡터DB에서 해당 docId의 청크 삭제
    try {
      const deleteRes = await fetch(`${BACKEND_URL}/profile-vectordb/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profileId,
          doc_id: docId,
        }),
      });

      if (deleteRes.ok) {
        const deleteData = await deleteRes.json();
        deletedEmbeddings = deleteData.deleted_count || deletedChunks;
      }
    } catch (error) {
      console.warn("[EmbedDelete] VectorDB delete warning:", error);
      // 벡터DB 삭제 실패해도 계속 진행
    }

    // 프로파일 업데이트
    doc.embeddingStatus = "pending";
    doc.chunkCount = undefined;
    doc.chunkPath = undefined;
    profile.uploadedDocuments[docIndex] = doc;
    saveProfile(profile);

    return NextResponse.json({
      success: true,
      deletedChunks,
      deletedEmbeddings,
      message: `"${doc.originalName}"의 청크(${deletedChunks}개) 및 임베딩이 삭제되었습니다.`,
    });
  } catch (error: any) {
    console.error("[EmbedDelete] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * 긴 텍스트를 maxTokens 이하로 강제 분할하는 헬퍼 함수
 */
function splitLongText(text: string, maxTokens: number): string[] {
  const result: string[] = [];
  const sentences = text.split(/(?<=[.!?。])\s+|(?<=\n)/);
  
  let current = "";
  let currentTokens = 0;
  
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    
    // 단일 문장도 너무 길면 문자 단위로 분할
    if (sentenceTokens > maxTokens) {
      if (current) {
        result.push(current.trim());
        current = "";
        currentTokens = 0;
      }
      
      // 문자 단위로 강제 분할 (한글 기준 약 140자 = 350토큰)
      const charsPerChunk = Math.floor(maxTokens / 2.5);
      for (let i = 0; i < sentence.length; i += charsPerChunk) {
        result.push(sentence.slice(i, i + charsPerChunk).trim());
      }
      continue;
    }
    
    if (currentTokens + sentenceTokens > maxTokens && current) {
      result.push(current.trim());
      current = sentence;
      currentTokens = sentenceTokens;
    } else {
      current += sentence;
      currentTokens += sentenceTokens;
    }
  }
  
  if (current.trim()) {
    result.push(current.trim());
  }
  
  return result;
}

/**
 * 토큰 기반 청킹 함수
 * - 프로파일 설정의 chunkSize (토큰)와 chunkOverlap (토큰) 사용
 * - 의미 단위(단락) 보존 시도
 * - 표 데이터의 경우 연관 메타데이터로 청크 간 관계 추적
 * - 단일 단락이 maxTokens 초과 시 강제 분할
 */
function chunkTextByTokens(
  text: string,
  metadata: {
    profileId: string;
    profileName: string;
    industryCode: string;
    docType: string;
    targetTabs: string[];
    sourceFile: string;
    docId: string;
  },
  maxTokens: number = 350,
  overlapTokens: number = 50
): { id: string; content: string; metadata: Record<string, any> }[] {
  const chunks: { id: string; content: string; metadata: Record<string, any> }[] = [];

  // 단락 기준으로 분할 (의미 단위 보존)
  const rawParagraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  
  // 긴 단락을 분할하여 평탄화
  const paragraphs: string[] = [];
  for (const para of rawParagraphs) {
    const paraTokens = estimateTokens(para);
    if (paraTokens > maxTokens) {
      // 긴 단락은 강제 분할
      paragraphs.push(...splitLongText(para, maxTokens));
    } else {
      paragraphs.push(para);
    }
  }

  let currentChunk = "";
  let currentTokens = 0;
  let chunkIndex = 0;
  let isTableContext = false;
  let tableStartIndex = -1;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    
    // 표 감지 (간단한 휴리스틱: 탭이나 파이프 구분자 포함)
    const isTable = /[\t|]/.test(para) || /^\s*[-|+]+\s*$/.test(para);
    
    if (isTable && !isTableContext) {
      isTableContext = true;
      tableStartIndex = chunkIndex;
    } else if (!isTable && isTableContext) {
      isTableContext = false;
    }

    // 현재 청크에 추가하면 maxTokens를 초과하는 경우
    if (currentTokens + paraTokens > maxTokens && currentChunk.length > 0) {
      // 현재 청크 저장
      const chunkMetadata: Record<string, any> = {
        ...metadata,
        chunk_index: chunkIndex,
        chunk_type: isTableContext ? "table" : "text",
        token_count: currentTokens,
        uploaded_at: new Date().toISOString(),
      };
      
      // 표 데이터의 경우 연관 청크 정보 추가
      if (isTableContext && tableStartIndex >= 0) {
        chunkMetadata.table_chunk_group = `${metadata.docId}_table_${tableStartIndex}`;
        chunkMetadata.is_table_continuation = chunkIndex > tableStartIndex;
      }

      chunks.push({
        id: `${metadata.profileId}_${metadata.docId}_chunk_${chunkIndex}`,
        content: currentChunk.trim(),
        metadata: chunkMetadata,
      });

      // 오버랩 처리: 마지막 N 토큰에 해당하는 텍스트 유지
      if (overlapTokens > 0) {
        const words = currentChunk.split(/\s+/);
        let overlapText = "";
        let overlapCount = 0;
        
        for (let i = words.length - 1; i >= 0 && overlapCount < overlapTokens; i--) {
          const wordTokens = estimateTokens(words[i]);
          overlapText = words[i] + " " + overlapText;
          overlapCount += wordTokens;
        }
        
        currentChunk = overlapText.trim() + "\n\n" + para;
        currentTokens = estimateTokens(currentChunk);
      } else {
        currentChunk = para;
        currentTokens = paraTokens;
      }
      
      chunkIndex++;
    } else {
      // 현재 청크에 추가
      currentChunk += (currentChunk ? "\n\n" : "") + para;
      currentTokens += paraTokens;
    }
  }

  // 마지막 청크 저장
  if (currentChunk.trim().length > 0) {
    const chunkMetadata: Record<string, any> = {
      ...metadata,
      chunk_index: chunkIndex,
      chunk_type: isTableContext ? "table" : "text",
      token_count: currentTokens,
      uploaded_at: new Date().toISOString(),
    };
    
    if (isTableContext && tableStartIndex >= 0) {
      chunkMetadata.table_chunk_group = `${metadata.docId}_table_${tableStartIndex}`;
      chunkMetadata.is_table_continuation = chunkIndex > tableStartIndex;
    }

    chunks.push({
      id: `${metadata.profileId}_${metadata.docId}_chunk_${chunkIndex}`,
      content: currentChunk.trim(),
      metadata: chunkMetadata,
    });
  }

  return chunks;
}
