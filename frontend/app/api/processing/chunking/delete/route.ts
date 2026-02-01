import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

// 저장 경로 정의
const SCRAPING_DATA_PATH = path.join(process.cwd(), "save", "ScrapingData");
const EXTRACTED_DATA_PATH = path.join(process.cwd(), "save", "ExtractedData");
const CHUNK_DATA_PATH = path.join(process.cwd(), "chunk");

interface DeleteRequest {
  doc_ids: string[];
}

interface DeleteResult {
  doc_id: string;
  success: boolean;
  deleted_paths: string[];
  error?: string;
}

// 파일 경로 패턴에서 실제 파일 찾기
function findFilesForDocument(docId: string): { scrapingFiles: string[]; extractedFiles: string[] } {
  const scrapingFiles: string[] = [];
  const extractedFiles: string[] = [];
  
  // doc_id 형식: {org_id}_{board_id}_{date_folder}_{filename}
  // 예: 산업통상자원부_보도참고자료_2026-01_파일명
  const parts = docId.split("_");
  if (parts.length < 4) {
    return { scrapingFiles, extractedFiles };
  }
  
  // 기관, 보드, 날짜폴더 추출
  const orgId = parts[0];
  const boardId = parts[1];
  const dateFolder = parts[2];
  // 나머지는 파일명 (여러 개의 _ 포함 가능)
  const fileBaseName = parts.slice(3).join("_");
  
  // ScrapingData 경로 검색
  const scrapingDir = path.join(SCRAPING_DATA_PATH, orgId, boardId, dateFolder);
  if (fs.existsSync(scrapingDir)) {
    try {
      const files = fs.readdirSync(scrapingDir);
      for (const file of files) {
        // 파일명 기반 일치 (확장자 제외)
        const fileWithoutExt = path.parse(file).name;
        if (fileWithoutExt === fileBaseName || file.startsWith(fileBaseName)) {
          scrapingFiles.push(path.join(scrapingDir, file));
        }
      }
    } catch {
      // 무시
    }
  }
  
  // ExtractedData 경로 검색
  const extractedDir = path.join(EXTRACTED_DATA_PATH, orgId, boardId, dateFolder);
  if (fs.existsSync(extractedDir)) {
    try {
      const files = fs.readdirSync(extractedDir);
      for (const file of files) {
        // 파일명 기반 일치 (확장자 제외)
        const fileWithoutExt = path.parse(file).name;
        if (fileWithoutExt === fileBaseName || file.startsWith(fileBaseName)) {
          extractedFiles.push(path.join(extractedDir, file));
        }
      }
    } catch {
      // 무시
    }
  }
  
  return { scrapingFiles, extractedFiles };
}

// 파일 삭제
function deleteFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// 빈 디렉토리 정리 (선택적)
function cleanupEmptyDirs(dirPath: string, basePath: string): void {
  try {
    // basePath까지만 정리 (상위로 올라가지 않음)
    if (!dirPath.startsWith(basePath) || dirPath === basePath) return;
    
    const files = fs.readdirSync(dirPath);
    if (files.length === 0) {
      fs.rmdirSync(dirPath);
      // 상위 디렉토리도 확인
      cleanupEmptyDirs(path.dirname(dirPath), basePath);
    }
  } catch {
    // 무시
  }
}

// POST: 문서 삭제
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DeleteRequest;
    const { doc_ids } = body;
    
    if (!doc_ids || doc_ids.length === 0) {
      return NextResponse.json({
        success: false,
        error: "삭제할 문서 ID가 없습니다.",
      }, { status: 400 });
    }
    
    const results: DeleteResult[] = [];
    let successCount = 0;
    let failedCount = 0;
    
    for (const docId of doc_ids) {
      try {
        const { scrapingFiles, extractedFiles } = findFilesForDocument(docId);
        const deletedPaths: string[] = [];
        
        // ScrapingData 파일 삭제
        for (const filePath of scrapingFiles) {
          if (deleteFile(filePath)) {
            deletedPaths.push(filePath);
          }
        }
        
        // ExtractedData 파일 삭제
        for (const filePath of extractedFiles) {
          if (deleteFile(filePath)) {
            deletedPaths.push(filePath);
          }
        }
        
        // 빈 디렉토리 정리
        if (scrapingFiles.length > 0) {
          cleanupEmptyDirs(path.dirname(scrapingFiles[0]), SCRAPING_DATA_PATH);
        }
        if (extractedFiles.length > 0) {
          cleanupEmptyDirs(path.dirname(extractedFiles[0]), EXTRACTED_DATA_PATH);
        }
        
        if (deletedPaths.length > 0) {
          results.push({
            doc_id: docId,
            success: true,
            deleted_paths: deletedPaths,
          });
          successCount++;
        } else {
          results.push({
            doc_id: docId,
            success: false,
            deleted_paths: [],
            error: "삭제할 파일을 찾을 수 없습니다.",
          });
          failedCount++;
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류";
        results.push({
          doc_id: docId,
          success: false,
          deleted_paths: [],
          error: errorMessage,
        });
        failedCount++;
      }
    }
    
    return NextResponse.json({
      success: true,
      deleted: successCount,
      failed: failedCount,
      results,
    });
    
  } catch (error) {
    console.error("Error deleting documents:", error);
    return NextResponse.json(
      { success: false, error: "문서 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
