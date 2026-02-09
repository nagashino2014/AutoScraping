import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  getChunkingSettings,
  addOrUpdateDocument,
  addChunksForDocument,
  deleteChunksByDocId,
  readExtractedDocumentContent,
  ChunkedDocument,
  scanExtractedDocuments,
  CHUNK_DATA_PATH,
} from "@/lib/chunking/chunking-store";
import { chunkDocument, ChunkingResult } from "@/lib/chunking/chunker";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 타임아웃

// 청크 파일명 생성 (Windows 호환 문자 치환)
function getChunkFileNameLocal(orgName: string, boardName: string, dateFolder: string): string {
  const safeOrgName = orgName.replace(/[<>:"/\\|?*]/g, "_");
  const safeBoardName = boardName.replace(/[<>:"/\\|?*]/g, "_");
  const safeDateFolder = dateFolder.replace(/[<>:"/\\|?*]/g, "_");
  return `${safeOrgName}_${safeBoardName}_${safeDateFolder}_chunks.json`;
}

// 청크 파일 경로 생성
function getChunkFilePathLocal(orgName: string, boardName: string, dateFolder: string): string {
  return path.join(
    CHUNK_DATA_PATH,
    orgName,
    boardName,
    dateFolder,
    getChunkFileNameLocal(orgName, boardName, dateFolder)
  );
}

// 기관/보드 정보 로드
import fs from "node:fs";

function loadTargets(): { orgs: Record<string, string>; boards: Record<string, string> } {
  const targetsPath = path.join(process.cwd(), "data", "scraper-targets.json");
  const orgs: Record<string, string> = {};
  const boards: Record<string, string> = {};
  
  try {
    if (fs.existsSync(targetsPath)) {
      const data = JSON.parse(fs.readFileSync(targetsPath, "utf-8"));
      for (const org of data.orgs || []) {
        orgs[org.org_id] = org.org_name;
      }
      for (const board of data.boards || []) {
        boards[board.board_id] = board.board_name;
      }
    }
  } catch {
    // 무시
  }
  
  return { orgs, boards };
}

interface ExecuteRequest {
  doc_ids?: string[];      // 특정 문서 ID 목록
  org_id?: string;         // 기관 ID (해당 기관 전체)
  board_id?: string;       // 보드 ID (해당 보드 전체)
  rechunk?: boolean;       // 기존 청크 삭제 후 재청킹
}

interface ExecuteResult {
  success: boolean;
  processed: number;
  failed: number;
  results: {
    doc_id: string;
    success: boolean;
    chunks?: number;
    tokens?: number;
    error?: string;
  }[];
}

// POST: 청킹 실행 (SSE 스트리밍)
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
      
      try {
        const body = (await request.json()) as ExecuteRequest;
        const { doc_ids, org_id, board_id, rechunk = false } = body;
        
        const settings = getChunkingSettings();
        const { orgs, boards } = loadTargets();
        
        // 1. 처리할 문서 결정 (async)
        let targetDocs = await scanExtractedDocuments();
        
        if (doc_ids && doc_ids.length > 0) {
          targetDocs = targetDocs.filter(d => doc_ids.includes(d.doc_id));
        } else if (org_id) {
          targetDocs = targetDocs.filter(d => d.org_id === org_id);
          if (board_id) {
            targetDocs = targetDocs.filter(d => d.board_id === board_id);
          }
        }
        
        if (targetDocs.length === 0) {
          send({ type: "error", error: "처리할 문서가 없습니다." });
          controller.close();
          return;
        }
        
        // 시작 이벤트
        send({
          type: "started",
          total: targetDocs.length,
        });
        await flush();
        
        // 2. 청킹 실행
        const results: ExecuteResult["results"] = [];
        let processed = 0;
        let failed = 0;
        
        for (let i = 0; i < targetDocs.length; i++) {
          const doc = targetDocs[i];
          
          // 진행률 이벤트
          send({
            type: "progress",
            current: i + 1,
            total: targetDocs.length,
            doc_id: doc.doc_id,
            doc_name: doc.source_file,
            progress: Math.round(((i + 1) / targetDocs.length) * 100),
          });
          await flush();
          
          try {
            // 재청킹이면 기존 청크 삭제 (async)
            if (rechunk) {
              await deleteChunksByDocId(doc.doc_id);
            }
            
            // 문서 상태 업데이트 (청킹 중)
            const now = new Date().toISOString();
            const chunkedDoc: ChunkedDocument = {
              doc_id: doc.doc_id,
              org_id: doc.org_id,
              board_id: doc.board_id,
              org_name: doc.org_name || orgs[doc.org_id] || doc.org_id,
              board_name: doc.board_name || boards[doc.board_id] || doc.board_id,
              date_folder: doc.date_folder,
              source_file: doc.source_file,
              file_path: doc.file_path,
              chunk_file_path: getChunkFilePathLocal(
                doc.org_name || doc.org_id,
                doc.board_name || doc.board_id,
                doc.date_folder
              ),
              status: "chunking",
              total_chunks: 0,
              text_chunks: 0,
              table_chunks: 0,
              total_tokens: 0,
              embedded_chunks: 0,
              created_at: now,
              updated_at: now,
            };
            addOrUpdateDocument(chunkedDoc);
            
            // 파일 읽기 (스토리지 추상화 사용 - R2 또는 로컬)
            const fileContent = await readExtractedDocumentContent(doc.file_path);
            
            // JSON 파일에서 텍스트 내용 추출
            let textContent = "";
            try {
              const jsonData = JSON.parse(fileContent);
              
              if (jsonData.extracted_text) {
                textContent = jsonData.extracted_text;
              } else if (jsonData.content && typeof jsonData.content === 'object' && jsonData.content.text) {
                textContent = jsonData.content.text;
              } else if (typeof jsonData.content === 'string') {
                textContent = jsonData.content;
              } else if (jsonData.text) {
                textContent = jsonData.text;
              }
              
              if (jsonData.sections && Array.isArray(jsonData.sections)) {
                const sectionTexts = jsonData.sections
                  .map((s: { content?: string }) => s.content || "")
                  .filter(Boolean);
                if (sectionTexts.length > 0) {
                  textContent = sectionTexts.join("\n\n");
                }
              }
            } catch {
              textContent = fileContent;
            }
            
            if (!textContent.trim()) {
              throw new Error("파일 내용이 비어있습니다.");
            }
            
            // 청킹 실행
            const result: ChunkingResult = chunkDocument(
              textContent,
              doc.doc_id,
              {
                org_id: doc.org_id,
                org_name: doc.org_name || doc.org_id,
                board_id: doc.board_id,
                board_name: doc.board_name || doc.board_id,
                date_folder: doc.date_folder,
                source_file: doc.source_file,
              },
              settings
            );
            
            // 청크 저장 (async)
            await addChunksForDocument(chunkedDoc, result.chunks);
            
            // 문서 상태 업데이트 (완료)
            chunkedDoc.status = "chunked";
            chunkedDoc.total_chunks = result.chunks.length;
            chunkedDoc.text_chunks = result.textChunks;
            chunkedDoc.table_chunks = result.tableChunks;
            chunkedDoc.total_tokens = result.totalTokens;
            chunkedDoc.updated_at = new Date().toISOString();
            addOrUpdateDocument(chunkedDoc);
            
            results.push({
              doc_id: doc.doc_id,
              success: true,
              chunks: result.chunks.length,
              tokens: result.totalTokens,
            });
            processed++;
            
            // 개별 성공 이벤트
            send({
              type: "doc_complete",
              doc_id: doc.doc_id,
              success: true,
              chunks: result.chunks.length,
              tokens: result.totalTokens,
            });
            await flush();
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류";
            
            // 문서 상태 업데이트 (실패)
            const now = new Date().toISOString();
            addOrUpdateDocument({
              doc_id: doc.doc_id,
              org_id: doc.org_id,
              board_id: doc.board_id,
              org_name: doc.org_name || orgs[doc.org_id] || doc.org_id,
              board_name: doc.board_name || boards[doc.board_id] || doc.board_id,
              date_folder: doc.date_folder,
              source_file: doc.source_file,
              file_path: doc.file_path,
              chunk_file_path: "",
              status: "failed",
              total_chunks: 0,
              text_chunks: 0,
              table_chunks: 0,
              total_tokens: 0,
              embedded_chunks: 0,
              created_at: now,
              updated_at: now,
              error_message: errorMessage,
            });
            
            results.push({
              doc_id: doc.doc_id,
              success: false,
              error: errorMessage,
            });
            failed++;
            
            // 개별 실패 이벤트
            send({
              type: "doc_complete",
              doc_id: doc.doc_id,
              success: false,
              error: errorMessage,
            });
            await flush();
          }
        }
        
        // 완료 이벤트
        send({
          type: "complete",
          success: true,
          processed,
          failed,
          results,
        });
        await flush();
        
      } catch (error) {
        console.error("Error executing chunking:", error);
        send({
          type: "error",
          error: "청킹 실행 중 오류가 발생했습니다.",
        });
      } finally {
        controller.close();
      }
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
