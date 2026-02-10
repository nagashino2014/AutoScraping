/**
 * 스크래퍼 대상 관리 - 타입 정의
 */

// 기관 관련 타입
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

// 보드 관련 타입
export type BoardAccessMode = "api" | "static_html" | "dynamic_js" | "login_required";
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
  title_body: boolean;
  attachments: {
    enabled: boolean;
    all: boolean;
    hwpx: boolean;
    docx: boolean;
    xlsx: boolean;
    pdf: boolean;
  };
};

export type ScheduleConfig = {
  scheduleMode: "period" | "cycle" | "";
  startDate?: string;
  endDate?: string;
  cycleType?: "monthly" | "weekly" | "interval" | "";
  monthlyDay?: string;
  weeklyDay?: string;
  intervalDays?: string;
  hour?: string;
  minute?: string;
};

export type SiteSearchOption = {
  type: "select" | "text" | "date" | "radio" | "checkbox";
  name: string;
  label: string;
  selector: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  default_value?: string;
  selected_value?: string;
};

export type SiteSearchConfig = {
  form_selector?: string;
  submit_selector?: string;
  submit_type: "form" | "url_param" | "ajax";
  options: SiteSearchOption[];
};

export type AttachmentConfig = {
  pattern_type: "standard_href" | "onclick_fndownload" | "onclick_javascript" | "file_area_button" | "auto";
  container_selector?: string;
  link_selector?: string;
  filename_selector?: string;
  onclick_function?: string;
  download_url_pattern?: string;
};

export type BrowserConfig = {
  browser_type?: "chromium" | "chrome" | "msedge";
  headless?: boolean;
  wait_time?: number;
  wait_for_selector?: string;
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

  board_mode?: BoardMode;
  schedule_cron?: string;
  schedule_timezone?: string;
  schedule_config?: ScheduleConfig;
  dedup_key?: DedupKey;
  collection_range?: CollectionRange;
  collection_targets?: CollectionTargets;
  published_date_rule?: Record<string, unknown>;
  web_config?: Record<string, unknown>;
  api_config?: Record<string, unknown>;
  hybrid_config?: Record<string, unknown>;
  site_search_config?: SiteSearchConfig;
  attachment_config?: AttachmentConfig;
  browser_config?: BrowserConfig;
};

// API 프로파일 관련 타입
export type ApiEndpoint = {
  endpoint_id: string;
  name: string;
  method: "GET" | "POST";
  path: string;
  description?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  body_template?: string;
  response_mapping?: Record<string, string>;
};

export type ApiProfile = {
  base_url: string;
  auth_type?: "none" | "api_key" | "bearer" | "basic";
  auth_config?: Record<string, unknown>;
  endpoints: ApiEndpoint[];
  rate_limit?: {
    requests_per_second?: number;
    max_concurrent?: number;
  };
};

// 사이트 구조 분석 관련 타입
export type SiteStructure = {
  list_container?: string;
  item_selector?: string;
  title_selector?: string;
  link_selector?: string;
  date_selector?: string;
  date_format?: string;
  pagination?: {
    type: "page_number" | "next_button" | "infinite_scroll" | "none";
    selector?: string;
    param_name?: string;
    max_pages?: number;
  };
  sample_data?: {
    titles?: string[];
    dates?: string[];
    links?: string[];
  };
};

// JSON 파일 관련 타입
export type JsonFileInfo = {
  name: string;
  path: string;
  size: number;
  modified: string;
};
