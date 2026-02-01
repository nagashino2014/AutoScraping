/**
 * 텍스트 추출 대상 파일 조회 API
 * 
 * GET /api/scraper/extract/files
 * - org_id?: 특정 기관의 파일만 조회
 * - board_id?: 특정 보드의 파일만 조회
 * - org_ids?: 여러 기관 ID (콤마 구분)
 * - board_ids?: 여러 보드 ID (콤마 구분)
 * - date_folder_path?: 특정 년월 폴더 경로 (전체 경로)
 * 
 * 응답:
 * - files: 파일 목록
 * - stats: 형식별 통계
 * - total: 총 파일 개수
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { readScraperTargets } from "@/lib/scraper/targets-store";

export const runtime = "nodejs";

// 파일 경로 기반 고유 ID 생성
function generateFileId(orgId: string, boardId: string, relativePath: string): string {
  const hash = crypto.createHash("md5").update(relativePath).digest("hex").slice(0, 12);
  return `${orgId}_${boardId}_${hash}`;
}

// ScrapingData 폴더 경로
const SCRAPING_DATA_PATH = path.join(process.cwd(), "save", "ScrapingData");

type FileFormat = "pdf" | "hwp" | "hwpx" | "docx" | "xlsx" | "html" | "txt" | "other";
type ExtractStatus = "pending" | "processing" | "completed" | "failed" | "llm_fallback";

interface ScrapedFile {
  file_id: string;
  org_id: string;
  board_id: string;
  org_name: string;
  board_name: string;
  original_filename: string;
  file_format: FileFormat;
  file_size_bytes: number;
  file_path: string;
  status: ExtractStatus;
  date_folder?: string;
}

interface FormatStats {
  format: FileFormat;
  label: string;
  total: number;
  success: number;
  failed: number;
  rate: number;
}

// 파일 확장자로 형식 판별
function getFileFormat(filename: string): FileFormat {
  const ext = path.extname(filename).toLowerCase().slice(1);
  const formatMap: Record<string, FileFormat> = {
    pdf: "pdf",
    hwp: "hwp",
    hwpx: "hwpx",
    docx: "docx",
    doc: "docx",
    xlsx: "xlsx",
    xls: "xlsx",
    html: "html",
    htm: "html",
    txt: "txt",
  };
  return formatMap[ext] || "other";
}

// 형식별 레이블
const FORMAT_LABELS: Record<FileFormat, string> = {
  pdf: "PDF",
  hwp: "HWP",
  hwpx: "HWPX",
  docx: "DOCX",
  xlsx: "XLSX",
  html: "HTML",
  txt: "TXT",
  other: "기타",
};

// 디렉토리 내 모든 파일 재귀 탐색
function scanDirectory(dirPath: string): { filePath: string; stats: fs.Stats }[] {
  const results: { filePath: string; stats: fs.Stats }[] = [];
  
  if (!fs.existsSync(dirPath)) {
    return results;
  }
  
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    
    if (item.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (item.isFile()) {
      try {
        const stats = fs.statSync(fullPath);
        results.push({ filePath: fullPath, stats });
      } catch (err) {
        console.error(`Failed to stat file: ${fullPath}`, err);
      }
    }
  }
  
  return results;
}

// 기관/보드별 파일 조회
function getFilesForOrgBoard(
  orgId: string,
  orgName: string,
  boardId: string,
  boardName: string
): ScrapedFile[] {
  const files: ScrapedFile[] = [];
  
  // 기관명/보드명 기반 폴더 경로
  const boardPath = path.join(SCRAPING_DATA_PATH, orgName, boardName);
  
  if (!fs.existsSync(boardPath)) {
    // 폴더가 없으면 빈 배열 반환
    return files;
  }
  
  const scannedFiles = scanDirectory(boardPath);
  
  for (const { filePath, stats } of scannedFiles) {
    const filename = path.basename(filePath);
    const relativePath = path.relative(boardPath, filePath);
    const dateFolder = path.dirname(relativePath);
    
    // 숨김 파일 및 시스템 파일 제외
    if (filename.startsWith(".") || filename.startsWith("~")) {
      continue;
    }
    
    const format = getFileFormat(filename);
    
    files.push({
      file_id: generateFileId(orgId, boardId, relativePath),
      org_id: orgId,
      board_id: boardId,
      org_name: orgName,
      board_name: boardName,
      original_filename: filename,
      file_format: format,
      file_size_bytes: stats.size,
      file_path: filePath,
      status: "pending", // 기본값: 추출 대기
      date_folder: dateFolder !== "." ? dateFolder : undefined,
    });
  }
  
  return files;
}

// 특정 년월 폴더 경로의 파일만 조회
function getFilesFromDateFolderPath(
  dateFolderPath: string,
  orgs: { org_id: string; org_name: string }[],
  boards: { board_id: string; org_id: string; board_name: string }[]
): ScrapedFile[] {
  const files: ScrapedFile[] = [];
  
  if (!fs.existsSync(dateFolderPath)) {
    return files;
  }
  
  // 경로에서 기관명/보드명/년월폴더 추출
  // 예: ScrapingData/기관명/보드명/2026-01
  let orgName = "";
  let boardName = "";
  let dateFolder = "";
  
  try {
    const relativePath = path.relative(SCRAPING_DATA_PATH, dateFolderPath);
    const parts = relativePath.split(path.sep);
    
    if (parts.length >= 3) {
      orgName = parts[0];
      boardName = parts[1];
      dateFolder = parts[2];
    } else if (parts.length >= 2) {
      // 년월 폴더가 직접 하위에 있는 경우
      orgName = parts[0];
      boardName = parts[1];
    }
  } catch (err) {
    console.error("경로 파싱 실패:", err);
    return files;
  }
  
  // 기관/보드 정보 찾기
  const org = orgs.find((o) => o.org_name === orgName);
  const board = boards.find((b) => b.board_name === boardName && org && b.org_id === org.org_id);
  
  if (!org || !board) {
    console.warn("기관/보드 정보를 찾을 수 없음:", { orgName, boardName });
    return files;
  }
  
  // 해당 폴더의 파일 스캔
  const scannedFiles = scanDirectory(dateFolderPath);
  
  for (const { filePath, stats } of scannedFiles) {
    const filename = path.basename(filePath);
    
    // 숨김 파일 및 시스템 파일 제외
    if (filename.startsWith(".") || filename.startsWith("~")) {
      continue;
    }
    
    const format = getFileFormat(filename);
    const boardPath = path.join(SCRAPING_DATA_PATH, orgName, boardName);
    const relativePath = path.relative(boardPath, filePath);
    
    files.push({
      file_id: generateFileId(org.org_id, board.board_id, relativePath),
      org_id: org.org_id,
      board_id: board.board_id,
      org_name: orgName,
      board_name: boardName,
      original_filename: filename,
      file_format: format,
      file_size_bytes: stats.size,
      file_path: filePath,
      status: "pending",
      date_folder: dateFolder || undefined,
    });
  }
  
  return files;
}

// 형식별 통계 계산
function calculateFormatStats(files: ScrapedFile[]): FormatStats[] {
  const formatCounts: Record<FileFormat, { total: number; success: number; failed: number }> = {
    pdf: { total: 0, success: 0, failed: 0 },
    hwp: { total: 0, success: 0, failed: 0 },
    hwpx: { total: 0, success: 0, failed: 0 },
    docx: { total: 0, success: 0, failed: 0 },
    xlsx: { total: 0, success: 0, failed: 0 },
    html: { total: 0, success: 0, failed: 0 },
    txt: { total: 0, success: 0, failed: 0 },
    other: { total: 0, success: 0, failed: 0 },
  };
  
  for (const file of files) {
    formatCounts[file.file_format].total++;
    if (file.status === "completed") {
      formatCounts[file.file_format].success++;
    } else if (file.status === "failed") {
      formatCounts[file.file_format].failed++;
    }
  }
  
  return Object.entries(formatCounts)
    .filter(([, counts]) => counts.total > 0)
    .map(([format, counts]) => ({
      format: format as FileFormat,
      label: FORMAT_LABELS[format as FileFormat],
      total: counts.total,
      success: counts.success,
      failed: counts.failed,
      rate: counts.total > 0 ? Math.round((counts.success / counts.total) * 100) : 0,
    }));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id");
    const boardId = url.searchParams.get("board_id");
    const orgIds = url.searchParams.get("org_ids")?.split(",").filter(Boolean) || [];
    const boardIds = url.searchParams.get("board_ids")?.split(",").filter(Boolean) || [];
    const dateFolderPath = url.searchParams.get("date_folder_path");
    
    // targets 데이터 로드
    const { orgs, boards } = readScraperTargets();
    
    const allFiles: ScrapedFile[] = [];
    
    // 특정 년월 폴더 경로 조회 (최우선)
    if (dateFolderPath) {
      const files = getFilesFromDateFolderPath(dateFolderPath, orgs, boards);
      allFiles.push(...files);
    }
    // 특정 보드 조회
    else if (boardId) {
      const board = boards.find((b) => b.board_id === boardId);
      const org = orgs.find((o) => o.org_id === board?.org_id);
      
      if (board && org) {
        const files = getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
        allFiles.push(...files);
      }
    }
    // 특정 기관 조회
    else if (orgId) {
      const org = orgs.find((o) => o.org_id === orgId);
      
      if (org) {
        const orgBoards = boards.filter((b) => b.org_id === orgId && b.enabled);
        for (const board of orgBoards) {
          const files = getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
          allFiles.push(...files);
        }
      }
    }
    // 여러 보드 조회
    else if (boardIds.length > 0) {
      for (const bId of boardIds) {
        const board = boards.find((b) => b.board_id === bId);
        const org = orgs.find((o) => o.org_id === board?.org_id);
        
        if (board && org) {
          const files = getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
          allFiles.push(...files);
        }
      }
    }
    // 여러 기관 조회
    else if (orgIds.length > 0) {
      for (const oId of orgIds) {
        const org = orgs.find((o) => o.org_id === oId);
        
        if (org) {
          const orgBoards = boards.filter((b) => b.org_id === oId && b.enabled);
          for (const board of orgBoards) {
            const files = getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
            allFiles.push(...files);
          }
        }
      }
    }
    // 전체 조회 (모든 기관/보드)
    else {
      for (const org of orgs) {
        const orgBoards = boards.filter((b) => b.org_id === org.org_id && b.enabled);
        for (const board of orgBoards) {
          const files = getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
          allFiles.push(...files);
        }
      }
    }
    
    // 통계 계산
    const formatStats = calculateFormatStats(allFiles);
    
    return NextResponse.json({
      ok: true,
      files: allFiles,
      stats: formatStats,
      total: allFiles.length,
    });
    
  } catch (err: any) {
    console.error("[extract/files] Error:", err);
    return NextResponse.json(
      { error: err.message || "파일 조회 실패" },
      { status: 500 }
    );
  }
}
