/**
 * 텍스트 추출 대상 파일 조회 API
 * 
 * GET /api/scraper/extract/files
 * - org_id?: 특정 기관의 파일만 조회
 * - board_id?: 특정 보드의 파일만 조회
 * - org_ids?: 여러 기관 ID (콤마 구분)
 * - board_ids?: 여러 보드 ID (콤마 구분)
 * - date_folder_path?: 특정 년월 폴더 경로 (storage key prefix)
 * 
 * 응답:
 * - files: 파일 목록
 * - stats: 형식별 통계
 * - total: 총 파일 개수
 */

import { NextResponse } from "next/server";
import path from "path";
import crypto from "crypto";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

function generateFileId(orgId: string, boardId: string, relativePath: string): string {
  const hash = crypto.createHash("md5").update(relativePath).digest("hex").slice(0, 12);
  return `${orgId}_${boardId}_${hash}`;
}

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

async function getFilesForOrgBoard(
  orgId: string,
  orgName: string,
  boardId: string,
  boardName: string
): Promise<ScrapedFile[]> {
  const prefix = `ScrapingData/${orgName}/${boardName}/`;
  const items = await storage.list(prefix);

  const files: ScrapedFile[] = [];
  for (const item of items) {
    if (!item.Key) continue;

    const filename = item.Key.split("/").pop() || "";
    if (!filename || filename.startsWith(".") || filename.startsWith("~")) continue;

    const relKey = item.Key.slice(prefix.length);
    const parts = relKey.split("/");
    const dateFolder = parts.length >= 2 ? parts[0] : undefined;

    files.push({
      file_id: generateFileId(orgId, boardId, relKey),
      org_id: orgId,
      board_id: boardId,
      org_name: orgName,
      board_name: boardName,
      original_filename: filename,
      file_format: getFileFormat(filename),
      file_size_bytes: item.Size || 0,
      file_path: item.Key,
      status: "pending",
      date_folder: dateFolder,
    });
  }

  return files;
}

async function getFilesFromDateFolderPath(
  dateFolderPrefix: string,
  orgs: { org_id: string; org_name: string }[],
  boards: { board_id: string; org_id: string; board_name: string }[]
): Promise<ScrapedFile[]> {
  let normalizedPrefix = dateFolderPrefix.replace(/\\/g, "/");
  const cwd = process.cwd().replace(/\\/g, "/");
  if (normalizedPrefix.startsWith(cwd)) {
    normalizedPrefix = normalizedPrefix.slice(cwd.length);
  }
  if (normalizedPrefix.startsWith("/save/")) {
    normalizedPrefix = normalizedPrefix.slice(6);
  } else if (normalizedPrefix.startsWith("save/")) {
    normalizedPrefix = normalizedPrefix.slice(5);
  }
  if (!normalizedPrefix.endsWith("/")) {
    normalizedPrefix += "/";
  }

  const parts = normalizedPrefix.replace("ScrapingData/", "").split("/").filter(Boolean);
  if (parts.length < 2) return [];

  const orgName = parts[0];
  const boardName = parts[1];
  const dateFolder = parts[2] || undefined;

  const org = orgs.find((o) => o.org_name === orgName);
  const board = boards.find((b) => b.board_name === boardName && org && b.org_id === org.org_id);
  if (!org || !board) return [];

  const items = await storage.list(normalizedPrefix);
  const files: ScrapedFile[] = [];

  for (const item of items) {
    if (!item.Key) continue;

    const filename = item.Key.split("/").pop() || "";
    if (!filename || filename.startsWith(".") || filename.startsWith("~")) continue;

    const boardPrefix = `ScrapingData/${orgName}/${boardName}/`;
    const relKey = item.Key.startsWith(boardPrefix) ? item.Key.slice(boardPrefix.length) : item.Key;

    files.push({
      file_id: generateFileId(org.org_id, board.board_id, relKey),
      org_id: org.org_id,
      board_id: board.board_id,
      org_name: orgName,
      board_name: boardName,
      original_filename: filename,
      file_format: getFileFormat(filename),
      file_size_bytes: item.Size || 0,
      file_path: item.Key,
      status: "pending",
      date_folder: dateFolder,
    });
  }

  return files;
}

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
    
    const { orgs, boards } = readScraperTargets();
    
    const allFiles: ScrapedFile[] = [];
    
    if (dateFolderPath) {
      const files = await getFilesFromDateFolderPath(dateFolderPath, orgs, boards);
      allFiles.push(...files);
    }
    else if (boardId) {
      const board = boards.find((b) => b.board_id === boardId);
      const org = orgs.find((o) => o.org_id === board?.org_id);
      
      if (board && org) {
        const files = await getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
        allFiles.push(...files);
      }
    }
    else if (orgId) {
      const org = orgs.find((o) => o.org_id === orgId);
      
      if (org) {
        const orgBoards = boards.filter((b) => b.org_id === orgId && b.enabled);
        for (const board of orgBoards) {
          const files = await getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
          allFiles.push(...files);
        }
      }
    }
    else if (boardIds.length > 0) {
      for (const bId of boardIds) {
        const board = boards.find((b) => b.board_id === bId);
        const org = orgs.find((o) => o.org_id === board?.org_id);
        
        if (board && org) {
          const files = await getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
          allFiles.push(...files);
        }
      }
    }
    else if (orgIds.length > 0) {
      for (const oId of orgIds) {
        const org = orgs.find((o) => o.org_id === oId);
        
        if (org) {
          const orgBoards = boards.filter((b) => b.org_id === oId && b.enabled);
          for (const board of orgBoards) {
            const files = await getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
            allFiles.push(...files);
          }
        }
      }
    }
    else {
      for (const org of orgs) {
        const orgBoards = boards.filter((b) => b.org_id === org.org_id && b.enabled);
        for (const board of orgBoards) {
          const files = await getFilesForOrgBoard(org.org_id, org.org_name, board.board_id, board.board_name);
          allFiles.push(...files);
        }
      }
    }
    
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
