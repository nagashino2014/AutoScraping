import fs from "node:fs";
import path from "node:path";

export type OrgStatus = "active" | "inactive";
export type CollectionMode = "web_scraping" | "api_only" | "hybrid";
export type OrganizationType = "국가기관" | "유관기관" | "협회 및 학회";

export type OrgPolicy = {
  rps: number;
  timeout_sec: number;
};

export type Organization = {
  org_id: string;
  org_name: string;
  base_url: string;
  status: OrgStatus;
  default_policy: OrgPolicy;
  notes?: string;
  collection_mode?: CollectionMode;
  org_type?: OrganizationType;
  logo_path?: string;
  api_profile?: Record<string, unknown>;
};

export type BoardAccessMode = "api" | "static_html" | "dynamic_js" | "login_required";

// 헤드리스 브라우저 설정
export type BrowserType = "chromium" | "chrome" | "msedge";

export type BrowserConfig = {
  browser_type?: BrowserType;      // 사용할 브라우저 (기본: chromium)
  headless?: boolean;               // 헤드리스 모드 (기본: true)
  wait_time?: number;               // 페이지 로드 후 추가 대기 시간 (ms)
  wait_for_selector?: string;       // 특정 선택자가 로드될 때까지 대기
};
export type BoardMode = "web_scraping" | "api" | "hybrid";
export type DedupKey = "url" | "id" | "hash";

export type CollectionRangeType = "period" | "relative" | "yearly" | "";

export type CollectionRange = {
  type: CollectionRangeType;
  period_start?: string;
  period_end?: string;
  relative_days?: number;
  years?: number[];
};

export type CollectionTargets = {
  title_body?: boolean;
  attachments?: {
    enabled?: boolean;
    all?: boolean;
    hwpx?: boolean;
    docx?: boolean;
    xlsx?: boolean;
    pdf?: boolean;
  };
};

// 스케줄 설정 상세 (기간/주기 옵션 포함)
export type ScheduleConfig = {
  scheduleMode: "period" | "cycle" | "";  // 기간 설정 vs 주기 설정
  startDate?: string;  // 기간 시작일 (YYYY-MM-DD)
  endDate?: string;    // 기간 종료일 (YYYY-MM-DD)
  cycleType?: "monthly" | "weekly" | "interval" | "";  // 주기 유형
  monthlyDay?: string;   // 매월 N일
  weeklyDay?: string;    // 매주 요일 (mon, tue, ...)
  intervalDays?: string; // N일마다
  hour?: string;         // 실행 시각 (시)
  minute?: string;       // 실행 시각 (분)
};

// 사이트 내 검색 옵션 (드롭다운, 키워드 검색 등)
export type SiteSearchOption = {
  type: "select" | "text" | "date" | "radio" | "checkbox";
  name: string;           // input name 또는 select name
  label: string;          // 레이블 텍스트
  selector: string;       // CSS 선택자
  options?: { value: string; label: string }[];  // select, radio, checkbox용 옵션들
  placeholder?: string;   // text input용 플레이스홀더
  default_value?: string; // 기본값
  selected_value?: string; // 사용자가 선택한 값 (보드 설정에서 저장)
};

export type SiteSearchConfig = {
  form_selector?: string;       // 검색 폼 선택자
  submit_selector?: string;     // 검색 버튼 선택자
  submit_type: "form" | "url_param" | "ajax";  // 검색 제출 방식
  options: SiteSearchOption[];  // 검색 옵션들
};

// 첨부파일 감지 패턴 유형
export type AttachmentPatternType = 
  | "standard_href"           // 표준 href 기반 (환경부 등 대부분 사이트)
  | "onclick_fndownload"      // 국민참여입법센터 패턴: onclick="fnDownload('id','key')"
  | "onclick_javascript"      // onclick="javascript:..." 패턴
  | "file_area_button"        // 파일 영역 내 버튼 클릭
  | "auto";                   // 자동 감지 (기본값)

// 첨부파일 감지 설정
export type AttachmentConfig = {
  pattern_type: AttachmentPatternType;  // 감지 패턴 유형
  container_selector?: string;          // 첨부파일 영역 선택자
  link_selector?: string;               // 첨부파일 링크/버튼 선택자
  filename_selector?: string;           // 파일명 추출 선택자 (없으면 링크 텍스트)
  onclick_function?: string;            // onclick 함수명 (예: "fnDownload")
  download_url_pattern?: string;        // 다운로드 URL 패턴 (예: "/file/download/{id}")
};

export type Board = {
  board_id: string;
  org_id: string;
  board_name: string;
  access_mode: BoardAccessMode;
  list_url?: string;
  doc_type?: string;
  domain_tags?: string[];
  enabled: boolean;

  // --- 개편안(확장) ---
  board_mode?: BoardMode;
  schedule_cron?: string;
  schedule_timezone?: string;  // 스케줄 시간대 (예: Asia/Seoul)
  schedule_config?: ScheduleConfig;  // 스케줄 상세 설정 (기간/주기 옵션)
  dedup_key?: DedupKey;
  published_date_rule?: Record<string, unknown>;

  // 수집 범위 및 대상
  collection_range?: CollectionRange;
  collection_targets?: CollectionTargets;

  // 모드별 상세 설정(1차는 JSON blob 형태로 저장)
  web_config?: Record<string, unknown>;
  api_config?: Record<string, unknown>;
  hybrid_config?: Record<string, unknown>;
  
  // 사이트 내 검색 옵션 설정 (소관부처 선택, 키워드 검색 등)
  site_search_config?: SiteSearchConfig;
  
  // 첨부파일 감지 설정 (사이트별 패턴)
  attachment_config?: AttachmentConfig;
  
  // 헤드리스 브라우저 설정 (dynamic_js 모드에서 사용)
  browser_config?: BrowserConfig;
};

export type ScraperTargetsFile = {
  orgs: Organization[];
  boards: Board[];
  updated_at: string;
};

function targetsFilePath() {
  // 기본은 Next 서버 실행 위치(cwd)/data 를 사용하되,
  // 루트에서 실행되는 경우에도 frontend/data 를 우선하도록 보정한다.
  // (이 설정 파일은 프론트 프로젝트 내부에 존재해야 하므로 저장 위치를 일관되게 유지)
  const cwd = process.cwd();
  const isFrontendCwd = path.basename(cwd).toLowerCase() === "frontend";
  if (isFrontendCwd) {
    return path.join(cwd, "data", "scraper-targets.json");
  }

  const frontendDir = path.join(cwd, "frontend");
  if (fs.existsSync(frontendDir) && fs.statSync(frontendDir).isDirectory()) {
    return path.join(frontendDir, "data", "scraper-targets.json");
  }

  return path.join(cwd, "data", "scraper-targets.json");
}

export function readScraperTargets(): ScraperTargetsFile {
  const p = targetsFilePath();
  if (!fs.existsSync(p)) {
    return { orgs: [], boards: [], updated_at: new Date().toISOString() };
  }
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as ScraperTargetsFile;
}

export function writeScraperTargets(next: Omit<ScraperTargetsFile, "updated_at">) {
  const p = targetsFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload: ScraperTargetsFile = {
    ...next,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
}


