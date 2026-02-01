import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getExtractedDocumentsFromPaths,
  getChunkingStats,
  ExtractedDocument,
} from "@/lib/chunking/chunking-store";

// ============================================================================
// 타입 정의
// ============================================================================

type OrgStatus = "active" | "inactive";
type CollectionMode = "web_scraping" | "api_only" | "hybrid";
type OrganizationType = "국가기관" | "유관기관" | "협회 및 학회";

interface Organization {
  org_id: string;
  org_name: string;
  base_url: string;
  status: OrgStatus;
  notes?: string;
  collection_mode?: CollectionMode;
  org_type?: OrganizationType;
  logo_path?: string;
}

interface Board {
  board_id: string;
  org_id: string;
  board_name: string;
  doc_type?: string;
  enabled: boolean;
}

interface ScraperTargetsFile {
  orgs: Organization[];
  boards: Board[];
}

// ============================================================================
// 경로 설정
// ============================================================================

const TARGETS_FILE = path.join(process.cwd(), "data", "scraper-targets.json");
const EXTRACTED_DATA_PATH = path.join(process.cwd(), "save", "ExtractedData");

// ============================================================================
// 데이터 로드
// ============================================================================

function loadTargets(): ScraperTargetsFile {
  try {
    if (fs.existsSync(TARGETS_FILE)) {
      const content = fs.readFileSync(TARGETS_FILE, "utf-8");
      return JSON.parse(content) as ScraperTargetsFile;
    }
  } catch (error) {
    console.error("Error loading targets:", error);
  }
  return { orgs: [], boards: [] };
}

// ============================================================================
// 년월 폴더 정보
// ============================================================================

interface DateFolderInfo {
  folder_name: string;
  folder_path: string;
  total_files: number;
  total_size: number;
}

// 디렉토리 내 .json 파일 개수와 크기 계산
function getJsonFilesStats(dirPath: string): { count: number; size: number } {
  if (!fs.existsSync(dirPath)) {
    return { count: 0, size: 0 };
  }
  
  let count = 0;
  let size = 0;
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      if (item.endsWith(".json")) {
        const filePath = path.join(dirPath, item);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            count++;
            size += stats.size;
          }
        } catch {
          // 무시
        }
      }
    }
  } catch {
    // 무시
  }
  
  return { count, size };
}

// 보드 폴더 내 년월 폴더 목록 조회
function getDateFoldersInBoard(boardPath: string): DateFolderInfo[] {
  const dateFolders: DateFolderInfo[] = [];
  
  if (!fs.existsSync(boardPath)) {
    return dateFolders;
  }
  
  try {
    const items = fs.readdirSync(boardPath, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isDirectory()) {
        // 년월 폴더 패턴 체크 (YYYY-MM 형식)
        const isDateFolder = /^\d{4}-\d{2}$/.test(item.name);
        
        if (isDateFolder) {
          const folderFullPath = path.join(boardPath, item.name);
          const { count, size } = getJsonFilesStats(folderFullPath);
          
          if (count > 0) {
            dateFolders.push({
              folder_name: item.name,
              folder_path: folderFullPath,
              total_files: count,
              total_size: size,
            });
          }
        }
      }
    }
    
    // 년월 역순 정렬 (최신이 먼저)
    dateFolders.sort((a, b) => b.folder_name.localeCompare(a.folder_name));
  } catch (error) {
    console.error("Error reading date folders:", error);
  }
  
  return dateFolders;
}

// ============================================================================
// 트리 노드 타입
// ============================================================================

export interface TreeNode {
  id: string;
  type: "category" | "organization" | "board" | "date_folder";
  name: string;
  logo?: string;
  docType?: string;
  orgType?: string;
  dateFolderPath?: string;
  children?: TreeNode[];
  isExpanded?: boolean;
  isChecked?: boolean;
  stats?: {
    totalFiles: number;
    totalSize: number;
  };
}

// ============================================================================
// 트리 구조 생성 (등록된 모든 기관/보드 + ExtractedData 통계)
// ============================================================================

function buildTree(orgs: Organization[], boards: Board[]): TreeNode[] {
  // 기관 유형별로 그룹화
  const orgsByType: Record<string, Organization[]> = {
    "국가기관": [],
    "유관기관": [],
    "협회 및 학회": [],
  };

  for (const org of orgs) {
    const type = org.org_type || "유관기관";
    if (!orgsByType[type]) {
      orgsByType[type] = [];
    }
    orgsByType[type].push(org);
  }

  // 트리 생성
  const tree: TreeNode[] = [];

  for (const [category, orgList] of Object.entries(orgsByType)) {
    if (orgList.length === 0) continue;

    const categoryNode: TreeNode = {
      id: `cat_${category}`,
      type: "category",
      name: category,
      isExpanded: category === "국가기관",
      children: [],
      stats: {
        totalFiles: 0,
        totalSize: 0,
      },
    };

    for (const org of orgList) {
      // 해당 기관의 보드 목록
      const orgBoards = boards.filter(b => b.org_id === org.org_id && b.enabled);
      
      let orgTotalFiles = 0;
      let orgTotalSize = 0;

      const orgNode: TreeNode = {
        id: org.org_id,
        type: "organization",
        name: org.org_name,
        logo: org.logo_path,
        orgType: category,
        isExpanded: false,
        children: [],
        stats: {
          totalFiles: 0,
          totalSize: 0,
        },
      };

      for (const board of orgBoards) {
        // ★ 핵심: org_name과 board_name으로 폴더 경로 구성
        const boardPath = path.join(EXTRACTED_DATA_PATH, org.org_name, board.board_name);
        
        // 년월 폴더 목록 조회
        const dateFolders = getDateFoldersInBoard(boardPath);
        
        let boardTotalFiles = 0;
        let boardTotalSize = 0;
        
        // 년월 폴더 노드 생성
        const dateFolderNodes: TreeNode[] = [];
        for (const df of dateFolders) {
          dateFolderNodes.push({
            id: `${board.board_id}_${df.folder_name}`,
            type: "date_folder",
            name: df.folder_name,
            dateFolderPath: df.folder_path,
            stats: {
              totalFiles: df.total_files,
              totalSize: df.total_size,
            },
          });
          boardTotalFiles += df.total_files;
          boardTotalSize += df.total_size;
        }

        const boardNode: TreeNode = {
          id: board.board_id,
          type: "board",
          name: board.board_name,
          docType: board.doc_type,
          isExpanded: false,
          children: dateFolderNodes.length > 0 ? dateFolderNodes : undefined,
          stats: {
            totalFiles: boardTotalFiles,
            totalSize: boardTotalSize,
          },
        };

        orgNode.children!.push(boardNode);
        orgTotalFiles += boardTotalFiles;
        orgTotalSize += boardTotalSize;
      }

      orgNode.stats = {
        totalFiles: orgTotalFiles,
        totalSize: orgTotalSize,
      };

      categoryNode.children!.push(orgNode);
      categoryNode.stats!.totalFiles += orgTotalFiles;
      categoryNode.stats!.totalSize += orgTotalSize;
    }

    tree.push(categoryNode);
  }

  return tree;
}

// ============================================================================
// GET: 트리 구조 및 통계 조회
// ============================================================================

export async function GET() {
  try {
    // 1. scraper-targets.json에서 등록된 모든 기관/보드 로드
    const targets = loadTargets();
    
    // 2. 트리 구조 생성 (org_name/board_name 기반 폴더 경로 사용)
    const tree = buildTree(targets.orgs, targets.boards);
    
    // 3. 전체 통계 계산
    let totalFiles = 0;
    let totalSize = 0;
    for (const category of tree) {
      totalFiles += category.stats?.totalFiles || 0;
      totalSize += category.stats?.totalSize || 0;
    }
    
    // 4. 청킹 통계
    const chunkingStats = getChunkingStats();
    
    return NextResponse.json({
      success: true,
      tree,
      summary: {
        totalOrgs: targets.orgs.length,
        totalBoards: targets.boards.filter(b => b.enabled).length,
        totalFiles,
        totalSize,
      },
      chunkingStats,
    });
    
  } catch (error) {
    console.error("Error getting documents:", error);
    return NextResponse.json(
      { success: false, error: "문서 목록을 불러오는데 실패했습니다." },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST: 선택된 폴더의 문서 목록 조회
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date_folder_paths } = body as { date_folder_paths: string[] };
    
    if (!date_folder_paths || date_folder_paths.length === 0) {
      return NextResponse.json({
        success: true,
        documents: [],
        summary: {
          totalFiles: 0,
          totalSize: 0,
          estimatedTokens: 0,
          estimatedTime: 0,
        },
      });
    }
    
    // 선택된 폴더의 문서 로드
    const documents = getExtractedDocumentsFromPaths(date_folder_paths);
    
    // 통계 계산
    const totalFiles = documents.length;
    const totalSize = documents.reduce((sum, d) => sum + d.file_size, 0);
    const totalTokens = documents.reduce((sum, d) => sum + (d.token_count || 0), 0);
    
    // 토큰이 0이면 파일 크기 기준으로 추정 (한국어 기준 약 2바이트당 1토큰)
    const estimatedTokens = totalTokens > 0 ? totalTokens : Math.ceil(totalSize / 2);
    
    // 예상 처리 시간 (1000 토큰당 약 0.1초 가정)
    const estimatedTime = Math.ceil(estimatedTokens / 10000);
    
    return NextResponse.json({
      success: true,
      documents,
      summary: {
        totalFiles,
        totalSize,
        estimatedTokens,
        estimatedTime, // 초 단위
      },
    });
    
  } catch (error) {
    console.error("Error getting documents:", error);
    return NextResponse.json(
      { success: false, error: "문서 목록을 불러오는데 실패했습니다." },
      { status: 500 }
    );
  }
}
