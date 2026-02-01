/**
 * 기관/보드별 파일 통계 API
 * 
 * GET /api/scraper/extract/stats
 * - 각 기관/보드별 파일 개수 반환
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readScraperTargets } from "@/lib/scraper/targets-store";

export const runtime = "nodejs";

// ScrapingData 폴더 경로
const SCRAPING_DATA_PATH = path.join(process.cwd(), "save", "ScrapingData");

interface DateFolderStats {
  folder_name: string;
  folder_path: string;
  total_files: number;
}

interface BoardStats {
  board_id: string;
  total_files: number;
  extracted_files: number;
  pending_files: number;
  failed_files: number;
  date_folders: DateFolderStats[];
}

interface OrgStats {
  org_id: string;
  total_files: number;
  extracted_files: number;
  pending_files: number;
  failed_files: number;
  boards: BoardStats[];
}

// 디렉토리 내 파일 개수 카운트 (재귀)
function countFilesInDirectory(dirPath: string): number {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  
  let count = 0;
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    
    if (item.isDirectory()) {
      count += countFilesInDirectory(fullPath);
    } else if (item.isFile()) {
      // 숨김 파일 및 시스템 파일 제외
      if (!item.name.startsWith(".") && !item.name.startsWith("~")) {
        count++;
      }
    }
  }
  
  return count;
}

// 보드 폴더 내 년월 폴더 목록 조회
function getDateFoldersInBoard(boardPath: string): DateFolderStats[] {
  const dateFolders: DateFolderStats[] = [];
  
  if (!fs.existsSync(boardPath)) {
    return dateFolders;
  }
  
  const items = fs.readdirSync(boardPath, { withFileTypes: true });
  
  for (const item of items) {
    if (item.isDirectory()) {
      // 년월 폴더 패턴 체크 (YYYY-MM 형식)
      const isDateFolder = /^\d{4}-\d{2}$/.test(item.name);
      
      if (isDateFolder) {
        const folderFullPath = path.join(boardPath, item.name);
        const fileCount = countFilesInDirectory(folderFullPath);
        
        if (fileCount > 0) {
          dateFolders.push({
            folder_name: item.name,
            folder_path: folderFullPath,
            total_files: fileCount,
          });
        }
      }
    }
  }
  
  // 년월 역순 정렬 (최신이 먼저)
  dateFolders.sort((a, b) => b.folder_name.localeCompare(a.folder_name));
  
  return dateFolders;
}

export async function GET() {
  try {
    // targets 데이터 로드
    const { orgs, boards } = readScraperTargets();
    
    const orgStatsMap: Map<string, OrgStats> = new Map();
    
    for (const org of orgs) {
      const orgBoards = boards.filter((b) => b.org_id === org.org_id && b.enabled);
      const boardStatsList: BoardStats[] = [];
      let orgTotalFiles = 0;
      
      for (const board of orgBoards) {
        // 기관명/보드명 기반 폴더 경로
        const boardPath = path.join(SCRAPING_DATA_PATH, org.org_name, board.board_name);
        const totalFiles = countFilesInDirectory(boardPath);
        
        // 년월 폴더 목록 조회
        const dateFolders = getDateFoldersInBoard(boardPath);
        
        // 현재는 추출 상태를 알 수 없으므로 모두 pending으로 처리
        // TODO: 추출 상태 DB 연동 시 실제 값으로 대체
        const boardStats: BoardStats = {
          board_id: board.board_id,
          total_files: totalFiles,
          extracted_files: 0,
          pending_files: totalFiles,
          failed_files: 0,
          date_folders: dateFolders,
        };
        
        boardStatsList.push(boardStats);
        orgTotalFiles += totalFiles;
      }
      
      orgStatsMap.set(org.org_id, {
        org_id: org.org_id,
        total_files: orgTotalFiles,
        extracted_files: 0,
        pending_files: orgTotalFiles,
        failed_files: 0,
        boards: boardStatsList,
      });
    }
    
    // 전체 통계
    let totalFiles = 0;
    for (const orgStats of orgStatsMap.values()) {
      totalFiles += orgStats.total_files;
    }
    
    return NextResponse.json({
      ok: true,
      org_stats: Object.fromEntries(orgStatsMap),
      total_files: totalFiles,
    });
    
  } catch (err: any) {
    console.error("[extract/stats] Error:", err);
    return NextResponse.json(
      { error: err.message || "통계 조회 실패" },
      { status: 500 }
    );
  }
}
