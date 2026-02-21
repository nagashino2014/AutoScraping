/**
 * 기관/보드별 파일 통계 API
 * 
 * GET /api/scraper/extract/stats
 * - 각 기관/보드별 파일 개수 반환
 */

import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

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

export async function GET() {
  try {
    const { orgs, boards } = readScraperTargets();

    console.log(`[extract/stats] storage.backend=${storage.backend}, R2_ENDPOINT=${process.env.R2_ENDPOINT ? "SET" : "UNSET"}`);
    const allFiles = await storage.list("ScrapingData/");
    console.log(`[extract/stats] storage.list("ScrapingData/") returned ${allFiles.length} files`);
    if (allFiles.length > 0 && allFiles.length <= 5) {
      console.log(`[extract/stats] sample keys:`, allFiles.map(f => f.Key));
    } else if (allFiles.length > 5) {
      console.log(`[extract/stats] first 3 keys:`, allFiles.slice(0, 3).map(f => f.Key));
    }

    const orgStatsMap: Map<string, OrgStats> = new Map();

    for (const org of orgs) {
      const orgBoards = boards.filter((b) => b.org_id === org.org_id && b.enabled);
      const boardStatsList: BoardStats[] = [];
      let orgTotalFiles = 0;

      for (const board of orgBoards) {
        const prefix = `ScrapingData/${org.org_name}/${board.board_name}/`;
        const boardFiles = allFiles.filter(
          (f) => f.Key && f.Key.startsWith(prefix)
        );

        const dateFolderMap = new Map<string, number>();
        for (const file of boardFiles) {
          const relKey = file.Key!.slice(prefix.length);
          const parts = relKey.split("/");
          if (parts.length >= 2 && /^\d{4}-\d{2}$/.test(parts[0])) {
            const folder = parts[0];
            dateFolderMap.set(folder, (dateFolderMap.get(folder) || 0) + 1);
          } else {
            dateFolderMap.set("_root", (dateFolderMap.get("_root") || 0) + 1);
          }
        }

        const dateFolders: DateFolderStats[] = [];
        for (const [folder, count] of dateFolderMap) {
          if (folder === "_root" || count === 0) continue;
          dateFolders.push({
            folder_name: folder,
            folder_path: `${prefix}${folder}`,
            total_files: count,
          });
        }
        dateFolders.sort((a, b) => b.folder_name.localeCompare(a.folder_name));

        const totalFiles = boardFiles.length;
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

    let totalFiles = 0;
    for (const orgStats of orgStatsMap.values()) {
      totalFiles += orgStats.total_files;
    }

    return NextResponse.json({
      ok: true,
      org_stats: Object.fromEntries(orgStatsMap),
      total_files: totalFiles,
      _debug: {
        storage_backend: storage.backend,
        r2_endpoint_set: !!process.env.R2_ENDPOINT,
        raw_file_count: allFiles.length,
        orgs_count: orgs.length,
        enabled_boards_count: boards.filter(b => b.enabled).length,
        sample_keys: allFiles.slice(0, 3).map(f => f.Key),
      },
    });
    
  } catch (err: any) {
    console.error("[extract/stats] Error:", err);
    return NextResponse.json(
      { error: err.message || "통계 조회 실패" },
      { status: 500 }
    );
  }
}
