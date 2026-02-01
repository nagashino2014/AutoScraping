import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";

// ============================================================
// 타입 정의
// ============================================================

export type ChangeType = "list_url" | "board_structure" | "download_url" | "pagination" | "selector" | "other";

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  list_url: "목록 URL 변경",
  board_structure: "게시판 구조 변경",
  download_url: "다운로드 URL 변경",
  pagination: "페이지네이션 변경",
  selector: "셀렉터 변경",
  other: "기타 변경",
};

export interface BoardChangeInfo {
  board_id: string;
  board_name: string;
  org_id: string;
  org_name: string;
  org_logo?: string;
  access_mode: "web" | "api" | "hybrid";
  has_change: boolean;
  detected_at: string | null;
  change_type: ChangeType | null;
  change_details: string | null;
}

export interface OrgChangeGroup {
  org_id: string;
  org_name: string;
  org_logo?: string;
  boards: BoardChangeInfo[];
  change_count: number;
}

// ============================================================
// 테스트용 변경 감지 데이터 (실제 구현 시 DB에서 조회)
// ============================================================

// 메모리에 저장된 테스트 변경 감지 데이터
let testChangeData: Map<string, {
  detected_at: string;
  change_type: ChangeType;
  change_details: string;
}> = new Map();

/**
 * GET /api/scraper/config/changes
 * 변경 감지 목록 조회
 */
export async function GET() {
  try {
    const targets = readScraperTargets();
    
    // orgs와 boards를 조합하여 기관별 보드 목록 생성
    const orgMap = new Map<string, {
      org_id: string;
      org_name: string;
      org_logo?: string;
      boards: BoardChangeInfo[];
      change_count: number;
    }>();
    
    // 먼저 기관 정보 초기화
    for (const org of targets.orgs || []) {
      orgMap.set(org.org_id, {
        org_id: org.org_id,
        org_name: org.org_name || org.org_id,
        org_logo: org.logo_path,
        boards: [],
        change_count: 0,
      });
    }
    
    // 보드를 기관별로 분류
    for (const board of targets.boards || []) {
      const orgData = orgMap.get(board.org_id);
      if (!orgData) continue;
      
      const changeData = testChangeData.get(board.board_id);
      const hasChange = !!changeData;
      
      if (hasChange) orgData.change_count++;
      
      orgData.boards.push({
        board_id: board.board_id,
        board_name: board.board_name || board.board_id,
        org_id: board.org_id,
        org_name: orgData.org_name,
        org_logo: orgData.org_logo,
        access_mode: board.access_mode || "web",
        has_change: hasChange,
        detected_at: changeData?.detected_at || null,
        change_type: changeData?.change_type || null,
        change_details: changeData?.change_details || null,
      });
    }
    
    // Map을 배열로 변환
    const orgGroups = Array.from(orgMap.values()).filter(org => org.boards.length > 0);
    
    // 변경 감지된 기관을 위로 정렬
    orgGroups.sort((a, b) => b.change_count - a.change_count);
    
    const totalChanges = orgGroups.reduce((sum, org) => sum + org.change_count, 0);
    
    return NextResponse.json({
      organizations: orgGroups,
      total_changes: totalChanges,
      type_labels: CHANGE_TYPE_LABELS,
    });
    
  } catch (err: any) {
    console.error("[config/changes] GET error:", err);
    return NextResponse.json({ error: err.message || "조회 실패" }, { status: 500 });
  }
}

/**
 * GET /api/scraper/config/changes/detail?boardId=xxx
 * 특정 보드의 변경 상세 정보 조회
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, boardId } = body;
    
    // 테스트 데이터 생성
    if (action === "create_test") {
      const now = new Date();
      
      // keiti-notice에 목록 URL 변경 감지
      testChangeData.set("keiti-notice", {
        detected_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        change_type: "list_url",
        change_details: `[목록 URL 변경 감지]

기존 URL: https://www.keiti.re.kr/site/board/notice
새로운 URL: https://www.keiti.re.kr/site/board/noticeList

상세 내용:
- HTTP 301 리다이렉트 감지
- 리다이렉트 대상: /site/board/noticeList
- 기존 URL 응답 상태: 301 Moved Permanently
- 새 URL 응답 상태: 200 OK

영향 범위:
- 목록 페이지 접근 불가
- 페이지네이션 URL 변경 필요
- 상세 페이지 URL 패턴은 유지됨`,
      });
      
      // mcee_board1에 게시판 구조 변경 감지
      testChangeData.set("mcee_board1", {
        detected_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        change_type: "board_structure",
        change_details: `[게시판 구조 변경 감지]

변경된 셀렉터:
- 기존 리스트 행: table.board-list tbody tr
- 새로운 리스트 행: div.board-list .list-item

- 기존 제목: td.title a
- 새로운 제목: .list-item .title a

- 기존 날짜: td.date
- 새로운 날짜: .list-item .date span

DOM 구조 변경 상세:
- 테이블 기반 레이아웃 → DIV 기반 레이아웃으로 전환
- 클래스명 체계 변경
- 첨부파일 아이콘 위치 변경

영향 범위:
- 모든 셀렉터 재설정 필요
- 첨부파일 다운로드 로직 검토 필요`,
      });
      
      return NextResponse.json({
        ok: true,
        message: "테스트 변경 감지 데이터 2건이 생성되었습니다.",
        changes: [
          { board_id: "keiti-notice", type: "list_url" },
          { board_id: "mcee_board1", type: "board_structure" },
        ],
      });
    }
    
    // 테스트 데이터 삭제
    if (action === "clear_test") {
      testChangeData.clear();
      return NextResponse.json({
        ok: true,
        message: "테스트 변경 감지 데이터가 삭제되었습니다.",
      });
    }
    
    // 특정 보드 상세 조회
    if (action === "detail" && boardId) {
      const changeData = testChangeData.get(boardId);
      
      if (!changeData) {
        return NextResponse.json({ error: "변경 감지 데이터가 없습니다." }, { status: 404 });
      }
      
      // 보드 설정 정보 가져오기
      const targets = readScraperTargets();
      const boardConfig = (targets.boards || []).find((b: any) => b.board_id === boardId);
      let orgConfig: any = null;
      
      if (boardConfig) {
        const org = (targets.orgs || []).find((o: any) => o.org_id === boardConfig.org_id);
        if (org) {
          orgConfig = {
            org_id: org.org_id,
            org_name: org.org_name,
            base_url: org.base_url,
          };
        }
      }
      
      return NextResponse.json({
        board_id: boardId,
        board_config: boardConfig,
        org_config: orgConfig,
        change_data: changeData,
        type_label: CHANGE_TYPE_LABELS[changeData.change_type],
      });
    }
    
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    
  } catch (err: any) {
    console.error("[config/changes] POST error:", err);
    return NextResponse.json({ error: err.message || "처리 실패" }, { status: 500 });
  }
}
