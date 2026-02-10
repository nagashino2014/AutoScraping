// ============================================================
// 변경 감지 관련 타입 및 상수
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
