"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Workflow,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

// 타입, 유틸리티, 컴포넌트 import
import type { Organization, Board, JsonFileInfo } from "./types";
import { jsonFetch } from "./utils";
import { DocTypeIcon } from "./components";

// 로컬 타입 정의 (아직 types.ts에 없는 것들)
type OrgStatus = "active" | "inactive";
type CollectionMode = "web_scraping" | "api_only" | "hybrid";
type OrganizationType = "국가기관" | "유관기관" | "협회 및 학회";
type OrgPolicy = { rps: number; timeout_sec: number };

// 로컬 타입 정의 (page에서 사용하는 추가 타입)
type BoardAccessMode = "api" | "static_html" | "dynamic_js" | "login_required";
type BoardMode = "web_scraping" | "api" | "hybrid";
type DedupKey = "url" | "id" | "hash";
type CollectionRangeType = "period" | "relative" | "yearly" | "";
type CollectionRange = {
  type: CollectionRangeType;
  period_start?: string;
  period_end?: string;
  relative_days?: number;
  years?: number[];
};
type CollectionTargets = {
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
type ScheduleConfig = {
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

export default function ScraperTargetsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);

  const [query, setQuery] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.org_id === selectedOrgId) ?? null,
    [orgs, selectedOrgId]
  );

  // 선택된 기관의 api_profile.endpoints 가져오기
  const selectedOrgApiEndpoints = useMemo(() => {
    const apiProfile = (selectedOrg as any)?.api_profile;
    if (!apiProfile) return [];
    return Array.isArray(apiProfile.endpoints) ? apiProfile.endpoints : [];
  }, [selectedOrg]);

  // 선택된 기관의 api_profile.default_params
  const selectedOrgApiDefaultParams = useMemo(() => {
    const apiProfile = (selectedOrg as any)?.api_profile;
    return apiProfile?.default_params ?? {};
  }, [selectedOrg]);

  const filteredOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) => {
      return (
        o.org_id.toLowerCase().includes(q) ||
        o.org_name.toLowerCase().includes(q) ||
        o.base_url.toLowerCase().includes(q)
      );
    });
  }, [orgs, query]);

  const selectedBoards = useMemo(() => {
    if (!selectedOrgId) return [];
    return boards.filter((b) => b.org_id === selectedOrgId);
  }, [boards, selectedOrgId]);

  const nextBoardIdForOrg = useMemo(() => {
    if (!selectedOrgId) return "";
    const re = new RegExp(`^${selectedOrgId}_board(\\d+)$`);
    const nums = boards
      .filter((b) => b.org_id === selectedOrgId)
      .map((b) => {
        const m = b.board_id.match(re);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `${selectedOrgId}_board${next}`;
  }, [boards, selectedOrgId]);

  const boardIdSuggestions = useMemo(() => {
    if (!selectedOrgId) return [];
    // 다음 5개 후보 제공
    const re = new RegExp(`^${selectedOrgId}_board(\\d+)$`);
    const nums = boards
      .filter((b) => b.org_id === selectedOrgId)
      .map((b) => {
        const m = b.board_id.match(re);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const start = (nums.length ? Math.max(...nums) : 0) + 1;
    return Array.from({ length: 5 }).map((_, i) => `${selectedOrgId}_board${start + i}`);
  }, [boards, selectedOrgId]);

  const [orgDraft, setOrgDraft] = useState<Organization | null>(null);
  const [isNewOrg, setIsNewOrg] = useState(false);
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [orgLogoFile, setOrgLogoFile] = useState<File | null>(null);
  const [isApiProfileModalOpen, setIsApiProfileModalOpen] = useState(false);
  const [apiProfileUrl, setApiProfileUrl] = useState("");
  const [apiProfileFile, setApiProfileFile] = useState<File | null>(null);
  const [apiAnalyzeLoading, setApiAnalyzeLoading] = useState(false);
  const [apiAnalyzeError, setApiAnalyzeError] = useState<string | null>(null);
  const [apiProposal, setApiProposal] = useState<Record<string, any> | null>(null);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);
  const [apiSummary, setApiSummary] = useState<string>("");
  const [apiProfileJson, setApiProfileJson] = useState<string>("");
  const [apiRefineText, setApiRefineText] = useState<string>("");
  const [apiRefineLoading, setApiRefineLoading] = useState(false);
  const [apiTestLoading, setApiTestLoading] = useState(false);
  const [apiTestError, setApiTestError] = useState<string | null>(null);
  const [apiTestSecretOverride, setApiTestSecretOverride] = useState<string>("");
  const [apiTestEndpointPath, setApiTestEndpointPath] = useState<string>("");
  const [apiTestParamsJson, setApiTestParamsJson] = useState<string>("{}");
  const [apiTestResult, setApiTestResult] = useState<any>(null);
  const [llmProvider, setLlmProvider] = useState<"openai" | "gemini" | "anthropic">("openai");
  const [llmModelMode, setLlmModelMode] = useState<"auto" | "manual">("auto");
  const [llmModel, setLlmModel] = useState<string>("");
  const [isApiKeySetOpen, setIsApiKeySetOpen] = useState(false);
  const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedEndpoints, setExtractedEndpoints] = useState<{ 
    title: string; 
    category?: string;
    request_url?: string;
    params_count?: number;
    fields_count?: number;
    detail_url?: string;
  }[]>([]);
  const [selectedExtractEndpoints, setSelectedExtractEndpoints] = useState<string[]>([]);
  const [savedJsonPath, setSavedJsonPath] = useState<string | null>(null);
  
  // JSON 불러오기 모달 상태
  const [isJsonLoadModalOpen, setIsJsonLoadModalOpen] = useState(false);
  const [jsonFiles, setJsonFiles] = useState<{ filename: string; org_id: string; org_name: string; total_endpoints: number; modified_at: string }[]>([]);
  const [selectedJsonFile, setSelectedJsonFile] = useState<string | null>(null);
  const [jsonLoadLoading, setJsonLoadLoading] = useState(false);
  const [loadedJsonData, setLoadedJsonData] = useState<any>(null);

  // JSON 파일 목록 불러오기
  const loadJsonFilesList = async () => {
    setJsonLoadLoading(true);
    try {
      const res = await fetch("/api/scraper/targets/api-sets");
      if (!res.ok) throw new Error("목록 로드 실패");
      const data = await res.json();
      setJsonFiles(data.files || []);
    } catch (e) {
      console.error("JSON files list error:", e);
      setJsonFiles([]);
    } finally {
      setJsonLoadLoading(false);
    }
  };

  // 특정 JSON 파일 불러오기
  const loadJsonFile = async (filename: string) => {
    setJsonLoadLoading(true);
    try {
      const res = await fetch("/api/scraper/targets/api-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename })
      });
      if (!res.ok) throw new Error("파일 로드 실패");
      const data = await res.json();
      setLoadedJsonData(data.data);
      
      // 로드된 데이터에서 엔드포인트 추출하여 설정
      if (data.data?.endpoints) {
        const eps = data.data.endpoints.map((ep: any) => ({
          title: ep.title,
          category: ep.category,
          request_url: ep.request_url,
          params_count: ep.request_params?.length || 0,
          fields_count: ep.response_fields?.length || 0,
          detail_url: ep.detail_url
        }));
        setExtractedEndpoints(eps);
        setSelectedExtractEndpoints(eps.map((e: any) => e.title));
        setSavedJsonPath(null);
      }
      
      setIsJsonLoadModalOpen(false);
      alert(`"${filename}" 파일이 로드되었습니다. "API 정보 분석" 버튼을 클릭하여 엔드포인트 목록을 확인하세요.`);
    } catch (e: any) {
      alert("파일 로드 실패: " + e.message);
    } finally {
      setJsonLoadLoading(false);
    }
  };

  // JSON 불러오기 모달 열기
  const openJsonLoadModal = () => {
    setIsJsonLoadModalOpen(true);
    setSelectedJsonFile(null);
    loadJsonFilesList();
  };

  // JSON 로드 후 API 정보 분석 모달 열기 (로드된 데이터가 있으면 바로 표시)
  const openExtractModalWithLoadedData = () => {
    if (loadedJsonData?.endpoints && loadedJsonData.endpoints.length > 0) {
      // 이미 로드된 데이터가 있으면 바로 모달 열기
      setIsExtractModalOpen(true);
    } else {
      // 데이터가 없으면 기존 추출 로직 실행
      runApiExtract();
    }
  };

  const runApiExtract = async () => {
    if (!orgDraft) return;
    if (!apiProfileUrl.trim() && !apiProfileFile) {
      alert("URL 또는 파일을 입력하세요.");
      return;
    }

    setExtractLoading(true);
    setExtractError(null);
    setExtractedEndpoints([]);
    setSavedJsonPath(null);
    setIsExtractModalOpen(true);

    try {
      const fd = new FormData();
      if (apiProfileUrl.trim()) fd.append("url", apiProfileUrl.trim());
      if (apiProfileFile) fd.append("file", apiProfileFile);
      fd.append("save_json", "true"); // 항상 JSON 저장
      
      const res = await fetch(`/api/scraper/targets/orgs/${encodeURIComponent(orgDraft.org_id)}/api-profile/extract`, {
        method: "POST",
        body: fd,
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "extract_failed");
      }

      const data = await res.json();
      console.log("[Extract Result]", data);
      setExtractedEndpoints(data.endpoints || []);
      // 초기에는 모두 선택
      setSelectedExtractEndpoints(data.endpoints?.map((e: any) => e.title) || []);
      // 저장 경로 설정
      if (data.saved_path) {
        setSavedJsonPath(data.saved_path);
      }
    } catch (e: any) {
      console.error("[Extract Error]", e);
      setExtractError(e.message || "추출 실패");
    } finally {
      setExtractLoading(false);
    }
  };

  const saveExtractedJson = async () => {
    if (!orgDraft || extractedEndpoints.length === 0) return;
    
    // 다시 extract API를 호출하되 save_json=true 파라미터 추가 
    // (이미 추출된 데이터를 보내는 게 아니라 서버에서 다시 추출 후 저장하도록 단순화. 
    //  효율을 위해선 추출 데이터를 보내는 API가 필요하지만, 일단 재요청 방식 사용하거나
    //  extract API가 추출 데이터를 받아서 저장만 하는 모드도 지원해야 함. 
    //  여기선 간단히 재요청 방식으로 구현하되, file이 있으면 다시 보내야 함)

    try {
      const fd = new FormData();
      if (apiProfileUrl.trim()) fd.append("url", apiProfileUrl.trim());
      if (apiProfileFile) fd.append("file", apiProfileFile);
      fd.append("save_json", "true");

      const res = await fetch(`/api/scraper/targets/orgs/${encodeURIComponent(orgDraft.org_id)}/api-profile/extract`, {
        method: "POST",
        body: fd,
      });
      
      if (!res.ok) throw new Error("save_failed");
      const data = await res.json();
      setSavedJsonPath(data.saved_path);
      alert(`저장되었습니다: ${data.saved_path}`);
    } catch (e: any) {
      alert("저장 실패: " + e.message);
    }
  };

  const applyExtractedEndpoints = () => {
    // 디버깅: 선택된 엔드포인트 확인
    console.log("[EP Apply] selectedExtractEndpoints:", selectedExtractEndpoints);
    console.log("[EP Apply] extractedEndpoints count:", extractedEndpoints.length);
    console.log("[EP Apply] loadedJsonData?.endpoints count:", loadedJsonData?.endpoints?.length);
    
    // 실제 선택된 개수는 selectedExtractEndpoints 배열의 길이
    const selectedCount = selectedExtractEndpoints.length;
    
    if (selectedCount > 0) {
      alert(`${selectedCount}개 엔드포인트가 선택되었습니다.\nLLM 분석 시 해당 엔드포인트 정보가 자동으로 반영됩니다.`);
    }
    
    setIsExtractModalOpen(false);
  };


  const [boardDraft, setBoardDraft] = useState<Board | null>(null);
  const [isNewBoard, setIsNewBoard] = useState(false);
  const [boardInlineError, setBoardInlineError] = useState<string | null>(null);
  const [boardConflict, setBoardConflict] = useState<Board | null>(null);
  const [isBoardWizardOpen, setIsBoardWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardJsonError, setWizardJsonError] = useState<string | null>(null);
  const [publishedDateRuleText, setPublishedDateRuleText] = useState<string>("");
  const [dateRuleRefinePrompt, setDateRuleRefinePrompt] = useState<string>("");
  const [dateRuleAnalyzing, setDateRuleAnalyzing] = useState(false);
  const [dateRuleTesting, setDateRuleTesting] = useState(false);
  const [dateRuleTestResult, setDateRuleTestResult] = useState<{ success: boolean; message: string; samples?: string[] } | null>(null);
  const [siteStructure, setSiteStructure] = useState<Record<string, unknown> | null>(null);
  const [siteSearchConfig, setSiteSearchConfig] = useState<{
    form_selector?: string;
    submit_selector?: string;
    submit_type: "form" | "url_param" | "ajax";
    options: {
      type: "select" | "text" | "date" | "radio" | "checkbox";
      name: string;
      label: string;
      selector: string;
      options?: { value: string; label: string }[];
      placeholder?: string;
      default_value?: string;
      selected_value?: string;
    }[];
  } | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<{
    pattern_type: "standard_href" | "onclick_fndownload" | "onclick_javascript" | "file_area_button" | "auto";
    container_selector?: string;
    link_selector?: string;
    filename_selector?: string;
    onclick_function?: string;
    download_url_pattern?: string;
    detected_download_url?: string;  // 자동 감지된 실제 다운로드 URL
  } | null>(null);
  const [domAnalyzing, setDomAnalyzing] = useState(false);
  const [detectingDownloadUrl, setDetectingDownloadUrl] = useState(false);
  const [downloadUrlDetectionLog, setDownloadUrlDetectionLog] = useState<string>("");
  const [webConfigText, setWebConfigText] = useState<string>("");
  const [webConfigRefinePrompt, setWebConfigRefinePrompt] = useState<string>("");
  
  // 외부 상세 링크 설정 state
  const [externalDetailEnabled, setExternalDetailEnabled] = useState(false);
  const [externalDetailUrlSelector, setExternalDetailUrlSelector] = useState("");
  const [externalDetailMode, setExternalDetailMode] = useState<"html" | "api_xml">("html");
  const [externalDetailContentSelector, setExternalDetailContentSelector] = useState("");
  const [externalDetailAttachmentsSelector, setExternalDetailAttachmentsSelector] = useState("");
  const [externalDetailUrlTransformEnabled, setExternalDetailUrlTransformEnabled] = useState(false);
  const [externalDetailExtractParam, setExternalDetailExtractParam] = useState("");
  const [externalDetailTemplate, setExternalDetailTemplate] = useState("");
  const [scrapingTestLog, setScrapingTestLog] = useState<string>("");
  const [scrapingTesting, setScrapingTesting] = useState(false);
  const [webConfigGenerating, setWebConfigGenerating] = useState(false);
  const [webConfigTesting, setWebConfigTesting] = useState(false);
  const [webConfigTestResult, setWebConfigTestResult] = useState<{ success: boolean; message: string; details?: string[] } | null>(null);
  const [apiConfigText, setApiConfigText] = useState<string>("");
  const [hybridConfigText, setHybridConfigText] = useState<string>("");

  // API 전용 보드 설정 마법사 state
  // 주 엔드포인트 (필수)
  const [apiEndpointIdx, setApiEndpointIdx] = useState<number>(-1);
  // 보조 엔드포인트 (선택, 최대 1개)
  const [apiSecondaryEndpointIdx, setApiSecondaryEndpointIdx] = useState<number>(-1);
  // 현재 활성 탭 (0: 주 엔드포인트, 1: 보조 엔드포인트)
  const [apiSettingsTab, setApiSettingsTab] = useState<0 | 1>(0);

  // 엔드포인트별 요청 파라미터 (선택/제외 가능)
  type RequestParamConfig = { name: string; enabled: boolean; value: string };
  const [apiParamsPrimary, setApiParamsPrimary] = useState<RequestParamConfig[]>([]);
  const [apiParamsSecondary, setApiParamsSecondary] = useState<RequestParamConfig[]>([]);
  // 엔드포인트별 선택된 응답 필드
  const [apiSelectedFieldsPrimary, setApiSelectedFieldsPrimary] = useState<string[]>([]);
  const [apiSelectedFieldsSecondary, setApiSelectedFieldsSecondary] = useState<string[]>([]);
  // 엔드포인트별 검색 필터
  const [apiSearchFiltersPrimary, setApiSearchFiltersPrimary] = useState<{
    enabled: boolean;
    filters: { field: string; keywords: string[]; match_type: "any" | "all" }[];
  }>({ enabled: false, filters: [] });
  const [apiSearchFiltersSecondary, setApiSearchFiltersSecondary] = useState<{
    enabled: boolean;
    filters: { field: string; keywords: string[]; match_type: "any" | "all" }[];
  }>({ enabled: false, filters: [] });
  // 엔드포인트별 날짜 범위 필터
  const [apiDateFiltersPrimary, setApiDateFiltersPrimary] = useState<{
    enabled: boolean;
    fields: { field: string; start_date: string; end_date: string; format: string; relative_days: "" | "7" | "30" | "90" | "365" }[];
  }>({ enabled: false, fields: [] });
  const [apiDateFiltersSecondary, setApiDateFiltersSecondary] = useState<{
    enabled: boolean;
    fields: { field: string; start_date: string; end_date: string; format: string; relative_days: "" | "7" | "30" | "90" | "365" }[];
  }>({ enabled: false, fields: [] });

  // 페이징 설정 (전역)
  const [apiPagination, setApiPagination] = useState<{
    enabled: boolean;
    type: "page" | "offset";
    param_name: string;
    page_size: number;
    max_pages: number;
  }>({ enabled: false, type: "page", param_name: "page", page_size: 20, max_pages: 5 });

  // 2단계 호출 설정 (보조 엔드포인트 → 주 엔드포인트 연결)
  // - 보조 엔드포인트(목록)를 먼저 호출하고, 응답의 특정 필드를 주 엔드포인트(본문)의 요청 파라미터로 매핑
  const [apiTwoPhaseConfig, setApiTwoPhaseConfig] = useState<{
    enabled: boolean;
    // 보조 엔드포인트 응답 필드 → 주 엔드포인트 요청 파라미터 매핑 (Secondary → Primary)
    field_mappings: { source_field: string; target_param: string }[];
    // 주 엔드포인트 검색필터 → 보조 엔드포인트 필드 매핑 (Primary 검색필터 → Secondary 필드)
    // 보조 엔드포인트 결과에서 주 엔드포인트의 검색필터를 적용하여 필터링
    filter_mappings: { 
      primary_filter_idx: number;  // 주 엔드포인트의 검색필터 인덱스 (apiSearchFiltersPrimary.filters)
      secondary_field: string;     // 필터를 적용할 보조 엔드포인트의 필드명
    }[];
    // 검색 필터 키워드를 보조 엔드포인트 query로 사용 (키워드별 순차 검색)
    use_filter_keywords: boolean;
    query_param_name: string;      // query 파라미터명 (기본값: "query")
    // 보조 엔드포인트 호출 시 최대 조회 건수 (목록에서 가져올 항목 수)
    max_list_items: number;
    // 주 엔드포인트 호출 시 최대 건수 (본문 조회할 항목 수)
    max_detail_items: number;
  }>({
    enabled: false,
    field_mappings: [],
    filter_mappings: [],
    use_filter_keywords: false,
    query_param_name: "query",
    max_list_items: 100,
    max_detail_items: 10,
  });

  // 테스트 호출
  const [apiBoardTestLoading, setApiBoardTestLoading] = useState(false);
  const [apiBoardTestResult, setApiBoardTestResult] = useState<any>(null);
  const [apiBoardTestError, setApiBoardTestError] = useState<string | null>(null);

  // 필드 선택 팝업
  const [fieldSelectorOpen, setFieldSelectorOpen] = useState(false);
  const [fieldSelectorTarget, setFieldSelectorTarget] = useState<"response_field" | "search_filter" | "date_filter" | null>(null);
  const [fieldSelectorTempSelected, setFieldSelectorTempSelected] = useState<string[]>([]);

  // ----- 레거시 호환 (기존 단일 설정 변수들 → 사용중지 예정) -----
  const [apiParams, setApiParams] = useState<{ key: string; value: string }[]>([]);
  const [apiFieldMapping, setApiFieldMapping] = useState<{ field: string; xpath: string }[]>([
    { field: "title", xpath: "" },
    { field: "url", xpath: "" },
    { field: "date", xpath: "" },
    { field: "id", xpath: "" },
  ]);
  const [apiSearchFilters, setApiSearchFilters] = useState<{
    enabled: boolean;
    filters: { param: string; keywords: string[]; match_type: "any" | "all" }[];
  }>({ enabled: false, filters: [] });
  const [apiDateFilter, setApiDateFilter] = useState<{
    enabled: boolean;
    target_param: string;
    start_param: string;
    end_param: string;
    format: string;
    relative_days?: number;
  }>({ enabled: false, target_param: "", start_param: "", end_param: "", format: "YYYYMMDD" });
  type ResponseField = { name: string; name_ko?: string; description?: string; type?: string };
  const [apiResponseFields, setApiResponseFields] = useState<ResponseField[]>([]);
  const [selectedResponseFields, setSelectedResponseFields] = useState<string[]>([]);
  const [apiDateFilterFields, setApiDateFilterFields] = useState<{
    field: string;
    start_date: string;
    end_date: string;
    format: string;
    relative_days: "" | "7" | "30" | "90" | "365";
  }[]>([]);

  // 스케쥴 설정 모달
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleConfig, setScheduleConfig] = useState<{
    scheduleMode: "period" | "cycle" | "";  // 기간 설정 vs 주기 설정
    startDate: string;
    endDate: string;
    cycleType: "monthly" | "weekly" | "interval" | "";
    monthlyDay: string;
    weeklyDay: string;
    intervalDays: string;
    timezone: string;
    hour: string;
    minute: string;
    calendarSelectTarget: "start" | "end";  // 캘린더에서 선택 중인 대상
  }>({
    scheduleMode: "",
    startDate: "",
    endDate: "",
    cycleType: "",
    monthlyDay: "1",
    weeklyDay: "mon",
    intervalDays: "1",
    timezone: "Asia/Tokyo",
    hour: "9",
    minute: "0",
    calendarSelectTarget: "start",
  });
  
  // 캘린더 표시용 현재 연월
  const [calendarViewDate, setCalendarViewDate] = useState(() => new Date());
  
  // 캘린더 날짜 생성 헬퍼
  const getCalendarDays = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay(); // 0(일) ~ 6(토)
    const totalDays = lastDay.getDate();
    
    const days: { date: number; month: number; year: number; isCurrentMonth: boolean }[] = [];
    
    // 이전 달 날짜들
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startPadding - 1; i >= 0; i--) {
      days.push({ date: prevMonthLastDay - i, month: month - 1, year: month === 0 ? year - 1 : year, isCurrentMonth: false });
    }
    
    // 현재 달 날짜들
    for (let d = 1; d <= totalDays; d++) {
      days.push({ date: d, month, year, isCurrentMonth: true });
    }
    
    // 다음 달 날짜들 (6주 채우기)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: d, month: month + 1, year: month === 11 ? year + 1 : year, isCurrentMonth: false });
    }
    
    return days;
  };
  
  // 날짜 선택 핸들러
  const handleCalendarDateClick = (day: { date: number; month: number; year: number }) => {
    const dateStr = `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.date).padStart(2, "0")}`;
    if (scheduleConfig.calendarSelectTarget === "start") {
      setScheduleConfig(p => ({ ...p, startDate: dateStr, calendarSelectTarget: "end" }));
    } else {
      setScheduleConfig(p => ({ ...p, endDate: dateStr }));
    }
  };

  // 스케쥴 설정을 cron 표현식 및 요약 문자열로 변환
  const buildScheduleSummary = () => {
    const { scheduleMode, cycleType, monthlyDay, weeklyDay, intervalDays, hour, minute, startDate, endDate, timezone } = scheduleConfig;
    
    const h = String(hour).padStart(2, "0");
    const m = String(minute).padStart(2, "0");
    const timeStr = `${h}:${m}`;
    const tzMap: Record<string, string> = { "Asia/Tokyo": "JST", "Asia/Seoul": "KST", "UTC": "UTC" };
    const tzStr = tzMap[timezone] || timezone;
    
    if (scheduleMode === "period") {
      if (!startDate && !endDate) return "";
      return `${startDate || "?"} ~ ${endDate || "?"} ${timeStr} (${tzStr})`;
    } else if (scheduleMode === "cycle") {
      if (!cycleType) return "";
      let cycleStr = "";
      if (cycleType === "monthly") {
        cycleStr = `매월 ${monthlyDay}일`;
      } else if (cycleType === "weekly") {
        const dayMap: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
        cycleStr = `매주 ${dayMap[weeklyDay] || weeklyDay}요일`;
      } else if (cycleType === "interval") {
        cycleStr = `${intervalDays}일 마다`;
      }
      return `${cycleStr} ${timeStr} (${tzStr})`;
    }
    return "";
  };

  // 스케쥴 설정을 cron 표현식으로 변환
  const buildScheduleCron = () => {
    const { scheduleMode, cycleType, monthlyDay, weeklyDay, intervalDays, hour, minute } = scheduleConfig;
    
    const h = parseInt(hour) || 0;
    const m = parseInt(minute) || 0;
    
    if (scheduleMode === "period") {
      // 기간 설정: 매일 실행
      return `${m} ${h} * * *`;
    } else if (scheduleMode === "cycle") {
      if (cycleType === "monthly") {
        return `${m} ${h} ${monthlyDay} * *`;
      } else if (cycleType === "weekly") {
        const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        return `${m} ${h} * * ${dayMap[weeklyDay] ?? 1}`;
      } else if (cycleType === "interval") {
        const days = parseInt(intervalDays) || 1;
        if (days === 1) return `${m} ${h} * * *`;
        return `${m} ${h} */${days} * *`;
      }
    }
    return "";
  };

  // DOM 분석 (cheerio로 실제 DOM 파싱)
  const analyzeDom = async () => {
    if (!boardDraft?.list_url) {
      alert("목록 URL을 먼저 입력해주세요.");
      return;
    }
    setDomAnalyzing(true);
    setDateRuleTestResult(null);
    setSiteStructure(null);
    setSiteSearchConfig(null);
    setPublishedDateRuleText("");
    try {
      const res = await fetch("/api/scraper/targets/boards/analyze-dom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_url: boardDraft.list_url }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "DOM 분석 실패");
      }
      
      // 사이트 구조 저장
      setSiteStructure({
        board_type: data.board_type,
        rendering: data.rendering,
        list: data.list,
        pagination: data.pagination,
        sample_data: data.samples,
      });
      
      // 사이트 내 검색 옵션 저장
      if (data.site_search_config) {
        setSiteSearchConfig(data.site_search_config);
      }
      
      // 첨부파일 패턴 저장
      if (data.attachment_config) {
        setAttachmentConfig(data.attachment_config);
      }
      
      // 게시일 규칙 자동 생성
      if (data.published_date_rule) {
        setPublishedDateRuleText(JSON.stringify(data.published_date_rule, null, 2));
      }
      
      // 검색 옵션 발견 여부 알림에 추가
      const searchOptCount = data.site_search_config?.options?.length || 0;
      const attachPatternType = data.attachment_config?.pattern_type || "auto";
      
      // 페이지네이션 정보 문자열 생성
      let paginationInfo = data.pagination?.type || "none";
      if (data.pagination?.param) {
        paginationInfo += ` (파라미터: ${data.pagination.param})`;
      }
      if (data.pagination?.start !== undefined) {
        paginationInfo += ` (시작: ${data.pagination.start})`;
      }
      if (data.pagination?.step) {
        paginationInfo += ` (증가: ${data.pagination.step})`;
      }
      if (data.pagination?.detected_method) {
        paginationInfo += `\n  ↳ ${data.pagination.detected_method}`;
      }
      
      alert(`✓ DOM 분석 완료!\n- 게시판 유형: ${data.board_type}\n- 발견된 항목: ${data.list.item_count}개\n- 샘플 제목: ${data.samples.titles[0] || "(없음)"}${searchOptCount > 0 ? `\n- 검색 옵션: ${searchOptCount}개 감지됨` : ""}\n- 첨부파일 패턴: ${attachPatternType}\n- 페이지네이션: ${paginationInfo}`);
    } catch (err: any) {
      alert(`DOM 분석 오류: ${err.message}`);
    } finally {
      setDomAnalyzing(false);
    }
  };

  // 다운로드 URL 자동 감지 (헤드리스 브라우저 사용)
  const detectDownloadUrl = async () => {
    // 목록 URL 확인
    const listUrl = boardDraft?.list_url;
    if (!listUrl) {
      alert("다운로드 URL 감지를 위해 목록 URL을 먼저 입력해주세요.");
      return;
    }

    // DOM 분석 결과에서 링크 선택자 가져오기 (있으면 사용)
    const listInfo = (siteStructure as Record<string, unknown>)?.list as { 
      container_selector?: string;
      item_selector?: string;
      link_selector?: string;
    } | undefined;
    
    // DOM 분석 결과에서 샘플 링크 가져오기 (siteStructure에 sample_data로 저장됨)
    const samples = (siteStructure as Record<string, unknown>)?.sample_data as {
      links?: string[];
    } | undefined;
    
    // 링크 선택자 조합 (DOM 분석 결과 활용)
    let linkSelector: string | undefined;
    if (listInfo?.container_selector && listInfo?.item_selector && listInfo?.link_selector) {
      linkSelector = `${listInfo.container_selector} ${listInfo.item_selector} ${listInfo.link_selector}`;
    }

    setDetectingDownloadUrl(true);
    setDownloadUrlDetectionLog("");
    
    try {
      const res = await fetch("/api/scraper/targets/boards/detect-download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_url: listUrl,
          link_selector: linkSelector,
          button_selector: attachmentConfig?.link_selector,
          // DOM 분석에서 추출된 샘플 게시글 링크들 전달
          sample_article_links: samples?.links || [],
        }),
      });

      const data = await res.json();
      
      // 로그 표시
      if (data.logs && Array.isArray(data.logs)) {
        setDownloadUrlDetectionLog(data.logs.join("\n"));
      }

      if (data.success && data.url_pattern) {
        // 감지된 URL 패턴으로 attachmentConfig 업데이트
        setAttachmentConfig(prev => ({
          ...prev,
          pattern_type: prev?.pattern_type || "auto",
          download_url_pattern: data.url_pattern,
          detected_download_url: data.download_url,
          onclick_function: data.onclick_function || prev?.onclick_function,
        }));

        alert(
          `✅ 다운로드 URL 자동 감지 성공!\n\n` +
          `📍 감지된 URL:\n${data.download_url}\n\n` +
          `📐 추출된 패턴:\n${data.url_pattern}\n\n` +
          `📄 파일명: ${data.filename || "(알 수 없음)"}\n` +
          `🔧 함수: ${data.onclick_function || "(없음)"}\n` +
          `📊 시도한 게시글: ${data.tried_articles || 1}개`
        );
      } else {
        alert(
          `❌ 다운로드 URL 감지 실패\n\n` +
          `${data.error || "알 수 없는 오류"}\n\n` +
          `💡 시도한 게시글: ${data.tried_articles || 0}개\n` +
          `💡 수동으로 다운로드 URL 패턴을 입력해주세요.`
        );
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert(`다운로드 URL 감지 오류: ${errorMsg}`);
    } finally {
      setDetectingDownloadUrl(false);
    }
  };

  // URL Hash 분석 - DOM 분석 결과를 기반으로 게시일 규칙 생성 (LLM 없이)
  const analyzeDateRuleFromUrl = async (refinePrompt?: string) => {
    if (!boardDraft?.list_url) {
      alert("목록 URL을 먼저 입력해주세요.");
      return;
    }
    
    // DOM 분석이 안 되어 있으면 먼저 DOM 분석 실행
    if (!siteStructure) {
      alert("먼저 'DOM 분석' 버튼을 클릭하여 게시판 구조를 분석해주세요.");
      return;
    }
    
    setDateRuleAnalyzing(true);
    setDateRuleTestResult(null);
    try {
      // siteStructure에서 게시일 규칙 생성
      const list = siteStructure.list as Record<string, unknown> | undefined;
      if (!list) {
        throw new Error("DOM 분석 결과에 list 정보가 없습니다.");
      }
      
      const dateRule = {
        source: "list",
        selector: `${list.container_selector || ""} ${list.item_selector || ""} ${list.date_selector || ""}`.trim().replace(/\s+/g, " "),
        format: (siteStructure.sample_data as Record<string, string[]>)?.dates?.[0]
          ? detectDateFormatClient((siteStructure.sample_data as Record<string, string[]>).dates[0])
          : "YYYY-MM-DD",
      };
      
      setPublishedDateRuleText(JSON.stringify(dateRule, null, 2));
    } catch (err: any) {
      alert(`Hash 분석 오류: ${err.message}`);
    } finally {
      setDateRuleAnalyzing(false);
    }
  };
  
  // 날짜 형식 감지 (클라이언트)
  const detectDateFormatClient = (dateStr: string): string => {
    if (/\d{4}-\d{2}-\d{2}/.test(dateStr)) return "YYYY-MM-DD";
    if (/\d{4}\.\d{2}\.\d{2}/.test(dateStr)) return "YYYY.MM.DD";
    if (/\d{4}\/\d{2}\/\d{2}/.test(dateStr)) return "YYYY/MM/DD";
    if (/\d{2}-\d{2}-\d{2}/.test(dateStr)) return "YY-MM-DD";
    if (/\d{2}\.\d{2}\.\d{2}/.test(dateStr)) return "YY.MM.DD";
    return "YYYY-MM-DD";
  };

  // 게시일 규칙 테스트
  const testDateRule = async () => {
    if (!boardDraft?.list_url) {
      alert("목록 URL을 먼저 입력해주세요.");
      return;
    }
    if (!publishedDateRuleText.trim()) {
      alert("게시일 규칙을 먼저 생성해주세요.");
      return;
    }
    setDateRuleTesting(true);
    setDateRuleTestResult(null);
    try {
      let ruleJson: Record<string, unknown>;
      try {
        ruleJson = JSON.parse(publishedDateRuleText);
      } catch {
        throw new Error("게시일 규칙이 유효한 JSON 형식이 아닙니다.");
      }
      const res = await fetch("/api/scraper/targets/boards/test-date-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_url: boardDraft.list_url,
          published_date_rule: ruleJson,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDateRuleTestResult({ success: false, message: data.error || "테스트 실패" });
      } else {
        setDateRuleTestResult({
          success: data.success,
          message: data.message || (data.success ? "테스트 성공" : "테스트 실패"),
          samples: data.samples,
        });
      }
    } catch (err: any) {
      setDateRuleTestResult({ success: false, message: err.message });
    } finally {
      setDateRuleTesting(false);
    }
  };

  // web_config 정합성 테스트
  const testWebConfig = async () => {
    if (!boardDraft?.list_url) {
      alert("목록 URL을 먼저 입력해주세요.");
      return;
    }
    if (!webConfigText.trim()) {
      alert("web_config를 먼저 작성해주세요.");
      return;
    }
    setWebConfigTesting(true);
    setWebConfigTestResult(null);
    try {
      let configJson: Record<string, unknown>;
      try {
        configJson = JSON.parse(webConfigText);
      } catch {
        throw new Error("web_config가 유효한 JSON 형식이 아닙니다.");
      }
      
      // 게시일 규칙도 함께 전송
      let dateRule: Record<string, unknown> | null = null;
      if (publishedDateRuleText.trim()) {
        try {
          dateRule = JSON.parse(publishedDateRuleText);
        } catch {
          // 무시
        }
      }
      
      const res = await fetch("/api/scraper/targets/boards/test-web-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_url: boardDraft.list_url,
          web_config: configJson,
          published_date_rule: dateRule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWebConfigTestResult({ success: false, message: data.error || "테스트 실패" });
      } else {
        setWebConfigTestResult({
          success: data.success,
          message: data.message || (data.success ? "정합성 테스트 성공" : "정합성 테스트 실패"),
          details: data.details,
        });
      }
    } catch (err: any) {
      setWebConfigTestResult({ success: false, message: err.message });
    } finally {
      setWebConfigTesting(false);
    }
  };

  // 스크래핑/API 테스트 (실제 데이터 수집 시뮬레이션)
  const testScraping = async () => {
    if (!boardDraft) return;
    
    const currentMode = boardDraft.board_mode ?? inferBoardMode(boardDraft);
    
    // API 모드인 경우
    if (currentMode === "api") {
      // apiEndpointIdx가 선택되지 않았지만 저장된 api_config가 있는 경우 사용
      let apiConfig: Record<string, unknown> | null = null;
      
      if (apiEndpointIdx >= 0) {
        try {
          apiConfig = JSON.parse(buildApiConfigJson());
        } catch {
          apiConfig = null;
        }
      } else if (boardDraft.api_config && Object.keys(boardDraft.api_config).length > 0) {
        apiConfig = boardDraft.api_config;
      }
      
      if (!apiConfig) {
        alert("API 설정을 먼저 구성해주세요.");
        return;
      }
      
      setScrapingTesting(true);
      setScrapingTestLog("========================================\n       🔍 API 테스트 시작\n========================================\n");
      try {
        // 선택된 org의 api_profile 가져오기
        const selectedOrg = orgs.find((o) => o.org_id === boardDraft.org_id);
        const apiProfile = selectedOrg?.api_profile ?? {};
        const primaryEndpoint = (apiConfig as any).primary_endpoint ?? {};
        const paramsConfig = (apiConfig as any).params ?? {};
        
        setScrapingTestLog((prev) => prev + `[INFO] 엔드포인트: ${primaryEndpoint.name ?? "N/A"}\n`);
        setScrapingTestLog((prev) => prev + `[INFO] 경로: ${primaryEndpoint.path ?? "N/A"}\n`);
        setScrapingTestLog((prev) => prev + `[INFO] 파라미터: ${JSON.stringify(paramsConfig)}\n`);
        setScrapingTestLog((prev) => prev + `[DEBUG] api_profile.base_url: ${apiProfile.base_url ?? "(없음 - 서버에서 가져옴)"}\n\n`);
        
        // API 테스트 호출 - api_profile과 endpoint 객체 전달
        const requestBody = {
          api_profile: apiProfile,
          endpoint: {
            name: primaryEndpoint.name,
            path: primaryEndpoint.path,
            method: primaryEndpoint.method ?? "GET",
            fixed_params: primaryEndpoint.fixed_params ?? {},
          },
          params: paramsConfig,
        };
        console.log("[API Test] Request:", JSON.stringify(requestBody, null, 2));
        
        const res = await fetch(`/api/scraper/targets/orgs/${boardDraft.org_id}/api-profile/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const data = await res.json();
        
        if (data.ok) {
          setScrapingTestLog((prev) => prev + "✅ API 호출 성공!\n\n");
          setScrapingTestLog((prev) => prev + `[RESPONSE] 상태: ${data.status ?? 200}\n`);
          setScrapingTestLog((prev) => prev + `[URL] ${data.url ?? "N/A"}\n\n`);
          if (data.body_preview) {
            const preview = data.body_preview.length > 1500 ? data.body_preview.substring(0, 1500) + "..." : data.body_preview;
            setScrapingTestLog((prev) => prev + `[SAMPLE RESPONSE]\n${preview}\n`);
          }
        } else {
          setScrapingTestLog((prev) => prev + `❌ API 호출 실패: ${data.error ?? "알 수 없는 오류"}\n`);
          if (data.hint) {
            setScrapingTestLog((prev) => prev + `\n💡 힌트:\n${data.hint}\n`);
          }
        }
      } catch (err: any) {
        setScrapingTestLog((prev) => prev + `[ERROR] API 테스트 실패: ${err.message}\n`);
      } finally {
        setScrapingTesting(false);
      }
      return;
    }
    
    // 웹 스크래핑 모드인 경우
    if (!boardDraft.list_url) {
      alert("목록 URL을 먼저 입력해주세요.");
      return;
    }
    if (currentMode === "web_scraping" && !webConfigText.trim()) {
      alert("web_config를 먼저 작성해주세요.");
      return;
    }
    if (currentMode === "hybrid" && !hybridConfigText.trim()) {
      alert("hybrid_config를 먼저 작성해주세요.");
      return;
    }
    
    setScrapingTesting(true);
    setScrapingTestLog("스크래핑 테스트 시작...\n");
    try {
      let configToUse = currentMode === "hybrid" ? hybridConfigText : webConfigText;
      
      // 외부 상세 링크 설정을 config에 병합
      if (externalDetailEnabled && configToUse) {
        try {
          const parsed = JSON.parse(configToUse);
          const merged = mergeExternalDetailToWebConfig(parsed);
          configToUse = JSON.stringify(merged, null, 2);
        } catch {
          // JSON 파싱 실패 시 그대로 사용
        }
      }
      
      const res = await fetch("/api/scraper/targets/boards/test-scraping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_url: boardDraft.list_url,
          web_config: configToUse,
          site_search_config: siteSearchConfig,  // 사이트 내 검색 옵션 전달
          attachment_config: attachmentConfig,   // 첨부파일 패턴 전달
        }),
      });
      const data = await res.json();
      if (data.logs) {
        setScrapingTestLog(data.logs);
      } else if (data.error) {
        setScrapingTestLog(`[ERROR] ${data.error}`);
      }
    } catch (err: any) {
      setScrapingTestLog(`[ERROR] 테스트 실패: ${err.message}`);
    } finally {
      setScrapingTesting(false);
    }
  };

  // web_config 자동 생성 (LLM 호출 또는 site_structure 기반)
  const generateWebConfig = async (refinePrompt?: string) => {
    if (!boardDraft?.list_url) {
      alert("목록 URL을 먼저 입력해주세요.");
      return;
    }
    
    // site_structure가 없으면 먼저 URL 분석 필요
    if (!siteStructure && !refinePrompt) {
      alert("먼저 'DOM 분석'을 실행하여 사이트 구조를 분석해주세요.");
      return;
    }
    
    setWebConfigGenerating(true);
    setWebConfigTestResult(null);
    try {
      // 게시일 규칙
      let dateRule: Record<string, unknown> | null = null;
      if (publishedDateRuleText.trim()) {
        try {
          dateRule = JSON.parse(publishedDateRuleText);
        } catch {
          // 무시
        }
      }
      
      const res = await fetch("/api/scraper/targets/boards/generate-web-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_url: boardDraft.list_url,
          board_name: boardDraft.board_name || "",
          doc_type: boardDraft.doc_type || "",
          domain_tags: boardDraft.domain_tags || [],
          collection_range: boardDraft.collection_range || null,
          collection_targets: boardDraft.collection_targets || null,
          published_date_rule: dateRule,
          site_structure: siteStructure || null,
          refine_prompt: refinePrompt || undefined,
          current_config: webConfigText.trim() ? webConfigText : undefined,
          access_mode: boardDraft.access_mode, // 접근 방식 전달
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "config 생성 실패");
      }
      if (data.web_config) {
        // 생성된 config에 external_detail UI 상태 병합
        let generatedConfig = typeof data.web_config === "string"
          ? JSON.parse(data.web_config)
          : data.web_config;
        generatedConfig = mergeExternalDetailToWebConfig(generatedConfig) || generatedConfig;
        setWebConfigText(JSON.stringify(generatedConfig, null, 2));
      }
    } catch (err: any) {
      alert(`config 생성 오류: ${err.message}`);
    } finally {
      setWebConfigGenerating(false);
    }
  };

  // 엔드포인트에서 요청 파라미터 정보 추출 (api_profile.endpoints[idx].request_params)
  const getEndpointRequestParams = useMemo(() => {
    return (idx: number): ResponseField[] => {
      if (idx < 0 || idx >= selectedOrgApiEndpoints.length) return [];
      const ep = selectedOrgApiEndpoints[idx];
      // api_profile에서 request_params 우선 사용
      if (Array.isArray(ep.request_params) && ep.request_params.length > 0) {
        return ep.request_params.map((p: any) => ({
          name: p.name,
          name_ko: p.name_ko,
          description: p.description,
          type: p.type,
        }));
      }
      // fallback: required_params, fixed_params, variable_params 조합
      const params: ResponseField[] = [];
      const seen = new Set<string>();
      const addParam = (name: string) => {
        if (!seen.has(name)) {
          seen.add(name);
          params.push({ name, name_ko: undefined, description: "", type: "string" });
        }
      };
      if (Array.isArray(ep.required_params)) ep.required_params.forEach(addParam);
      if (ep.fixed_params) Object.keys(ep.fixed_params).forEach(addParam);
      if (Array.isArray(ep.variable_params)) ep.variable_params.forEach(addParam);
      Object.keys(selectedOrgApiDefaultParams).forEach(addParam);
      return params;
    };
  }, [selectedOrgApiEndpoints, selectedOrgApiDefaultParams]);

  // 엔드포인트에서 응답 필드 정보 추출 (api_profile.endpoints[idx].response_fields)
  // 중복 필드명 제거: 같은 name이 여러 개 있으면 첫 번째만 유지
  const getEndpointResponseFields = useMemo(() => {
    return (idx: number): ResponseField[] => {
      if (idx < 0 || idx >= selectedOrgApiEndpoints.length) return [];
      const ep = selectedOrgApiEndpoints[idx];
      if (Array.isArray(ep.response_fields) && ep.response_fields.length > 0) {
        const seenNames = new Set<string>();
        const deduplicatedFields: ResponseField[] = [];
        
        for (const f of ep.response_fields) {
          const fieldName = f.name;
          if (!seenNames.has(fieldName)) {
            seenNames.add(fieldName);
            deduplicatedFields.push({
              name: f.name,
              name_ko: f.name_ko,
              description: f.description,
              type: f.type,
            });
          } else {
            console.log(`[Response Fields] 중복 필드 제거: ${fieldName}`);
          }
        }
        
        return deduplicatedFields;
      }
      return []; // api_profile에 response_fields가 없으면 빈 배열
    };
  }, [selectedOrgApiEndpoints]);

  // 주 엔드포인트의 요청 파라미터 & 응답 필드
  const primaryRequestParams = useMemo(() => getEndpointRequestParams(apiEndpointIdx), [getEndpointRequestParams, apiEndpointIdx]);
  const primaryResponseFields = useMemo(() => getEndpointResponseFields(apiEndpointIdx), [getEndpointResponseFields, apiEndpointIdx]);
  // 보조 엔드포인트의 요청 파라미터 & 응답 필드
  const secondaryRequestParams = useMemo(() => getEndpointRequestParams(apiSecondaryEndpointIdx), [getEndpointRequestParams, apiSecondaryEndpointIdx]);
  const secondaryResponseFields = useMemo(() => getEndpointResponseFields(apiSecondaryEndpointIdx), [getEndpointResponseFields, apiSecondaryEndpointIdx]);

  // 현재 탭에 해당하는 요청 파라미터 & 응답 필드
  const currentRequestParams = apiSettingsTab === 0 ? primaryRequestParams : secondaryRequestParams;
  const currentResponseFields = apiSettingsTab === 0 ? primaryResponseFields : secondaryResponseFields;
  // 현재 탭에 해당하는 선택된 응답 필드
  const currentSelectedFields = apiSettingsTab === 0 ? apiSelectedFieldsPrimary : apiSelectedFieldsSecondary;
  const setCurrentSelectedFields = apiSettingsTab === 0 ? setApiSelectedFieldsPrimary : setApiSelectedFieldsSecondary;
  // 현재 탭에 해당하는 검색 필터
  const currentSearchFilters = apiSettingsTab === 0 ? apiSearchFiltersPrimary : apiSearchFiltersSecondary;
  const setCurrentSearchFilters = apiSettingsTab === 0 ? setApiSearchFiltersPrimary : setApiSearchFiltersSecondary;
  // 현재 탭에 해당하는 날짜 필터
  const currentDateFilters = apiSettingsTab === 0 ? apiDateFiltersPrimary : apiDateFiltersSecondary;
  const setCurrentDateFilters = apiSettingsTab === 0 ? setApiDateFiltersPrimary : setApiDateFiltersSecondary;
  // 현재 탭에 해당하는 파라미터 설정
  const currentParamsConfig = apiSettingsTab === 0 ? apiParamsPrimary : apiParamsSecondary;
  const setCurrentParamsConfig = apiSettingsTab === 0 ? setApiParamsPrimary : setApiParamsSecondary;

  // 날짜 관련 필드만 필터링 (한글명 끝이 '일', '일시', '일자', '기간')
  const currentDateRelatedFields = useMemo(() => {
    return currentResponseFields.filter((f) => {
      const nameKo = f.name_ko ?? f.name;
      return /[일시자]$|기간$/.test(nameKo) || f.type === "date";
    });
  }, [currentResponseFields]);

  // 레거시: 기존 코드 호환용
  const currentEndpointAllParams = useMemo(() => {
    return primaryRequestParams.map((p) => p.name);
  }, [primaryRequestParams]);

  const dateRelatedFields = useMemo(() => {
    return apiResponseFields.filter((f) => {
      const nameKo = f.name_ko ?? f.name;
      return /[일시자]$|기간$/.test(nameKo);
    });
  }, [apiResponseFields]);

  const DOC_TYPE_OPTIONS = useMemo(
    () =>
      [
        "보도자료",
        "공지",
        "고시·훈령·예규",
        "입법예고",
        "법령",
        "기술문서",
        "정책",
        "연보·월보",
        "통계자료",
        "산업동향",
      ] as const,
    []
  );
  const DOMAIN_TAG_OPTIONS = useMemo(
    () => ["대기", "수질", "폐기물", "기후", "에너지", "기타"] as const,
    []
  );

  const DEDUP_KEY_OPTIONS = useMemo(() => ["url", "id", "hash"] as const, []);

  const inferBoardMode = (b: Board): BoardMode => {
    if (b.board_mode) return b.board_mode;
    return b.access_mode === "api" ? "api" : "web_scraping";
  };

  const openBoardWizard = (nextDraft: Board, step: 1 | 2 | 3 = 1) => {
    setBoardDraft(nextDraft);
    setWizardStep(step);
    setWizardJsonError(null);
    setPublishedDateRuleText(
      nextDraft.published_date_rule ? JSON.stringify(nextDraft.published_date_rule, null, 2) : ""
    );
    setWebConfigText(nextDraft.web_config ? JSON.stringify(nextDraft.web_config, null, 2) : "");
    
    // 외부 상세 링크 설정 복원
    const extDetail = (nextDraft.web_config as any)?.external_detail;
    if (extDetail?.enabled) {
      setExternalDetailEnabled(true);
      setExternalDetailUrlSelector(extDetail.url_selector || "");
      setExternalDetailMode(extDetail.mode || "html");
      setExternalDetailContentSelector(extDetail.content_selector || "");
      setExternalDetailAttachmentsSelector(extDetail.attachments_selector || "");
      if (extDetail.url_transform) {
        setExternalDetailUrlTransformEnabled(true);
        setExternalDetailExtractParam(extDetail.url_transform.extract_param || "");
        setExternalDetailTemplate(extDetail.url_transform.template || "");
      } else {
        setExternalDetailUrlTransformEnabled(false);
        setExternalDetailExtractParam("");
        setExternalDetailTemplate("");
      }
    } else {
      setExternalDetailEnabled(false);
      setExternalDetailUrlSelector("");
      setExternalDetailMode("html");
      setExternalDetailContentSelector("");
      setExternalDetailAttachmentsSelector("");
      setExternalDetailUrlTransformEnabled(false);
      setExternalDetailExtractParam("");
      setExternalDetailTemplate("");
    }
    
    setApiConfigText(nextDraft.api_config ? JSON.stringify(nextDraft.api_config, null, 2) : "");
    setHybridConfigText(
      nextDraft.hybrid_config ? JSON.stringify(nextDraft.hybrid_config, null, 2) : ""
    );
    
    // API 설정 복원 (api_config가 있을 때)
    const apiConfig = nextDraft.api_config as any;
    if (apiConfig && Object.keys(apiConfig).length > 0) {
      // org의 api_profile에서 endpoints 가져오기
      const org = orgs.find((o) => o.org_id === nextDraft.org_id);
      const endpoints = (org as any)?.api_profile?.endpoints ?? [];
      
      // 주 엔드포인트 인덱스 찾기
      const primaryEp = apiConfig.primary_endpoint;
      if (primaryEp) {
        const idx = endpoints.findIndex((ep: any) => 
          ep.path === primaryEp.path || ep.name === primaryEp.name
        );
        setApiEndpointIdx(idx >= 0 ? idx : -1);
        
        // 주 엔드포인트 파라미터 복원
        if (idx >= 0) {
          const epParams = endpoints[idx]?.request_params ?? [];
          const savedParams = apiConfig.params ?? {};
          const restoredParams = epParams.map((p: any) => ({
            name: p.name,
            // 저장된 params에 있거나, 빈 값이 아닌 경우 enabled
            enabled: savedParams.hasOwnProperty(p.name) || (p.required === true),
            value: savedParams[p.name] ?? "",
          }));
          setApiParamsPrimary(restoredParams);
          
          // 응답 필드 목록 복원 (endpoint의 response_fields 사용)
          const epResponseFields = endpoints[idx]?.response_fields ?? [];
          if (epResponseFields.length > 0) {
            setApiResponseFields(epResponseFields.map((f: any) => ({
              name: f.name,
              name_ko: f.name_ko || f.name,
              description: f.description || "",
              type: f.type || "string",
            })));
          }
        }
      } else {
        setApiEndpointIdx(-1);
        setApiParamsPrimary([]);
      }
      
      // 보조 엔드포인트 복원
      const secondaryEps = apiConfig.secondary_endpoints ?? [];
      if (secondaryEps.length > 0) {
        const secEp = secondaryEps[0];
        const secIdx = endpoints.findIndex((ep: any) => 
          ep.path === secEp.path || ep.name === secEp.name
        );
        setApiSecondaryEndpointIdx(secIdx >= 0 ? secIdx : -1);
        
        // 보조 엔드포인트 파라미터 복원
        if (secIdx >= 0) {
          const secEpParams = endpoints[secIdx]?.request_params ?? [];
          const savedSecParams = secEp.params ?? {};
          const restoredSecParams = secEpParams.map((p: any) => ({
            name: p.name,
            enabled: savedSecParams.hasOwnProperty(p.name) || (p.required === true),
            value: savedSecParams[p.name] ?? "",
          }));
          setApiParamsSecondary(restoredSecParams);
        }
        
        // 보조 엔드포인트 응답 필드 복원
        setApiSelectedFieldsSecondary(secEp.response_fields ?? []);
      } else {
        setApiSecondaryEndpointIdx(-1);
        setApiParamsSecondary([]);
        setApiSelectedFieldsSecondary([]);
      }
      
      // 응답 필드 복원 (주 엔드포인트)
      setApiSelectedFieldsPrimary(apiConfig.response_fields ?? []);
      
      // 페이징 설정 복원
      if (apiConfig.pagination) {
        setApiPagination({
          enabled: true,
          type: apiConfig.pagination.type ?? "page",
          param_name: apiConfig.pagination.param_name ?? "pageNo",
          page_size: apiConfig.pagination.page_size ?? 10,
          max_pages: apiConfig.pagination.max_pages ?? 10,
        });
      } else {
        setApiPagination({
          enabled: false,
          type: "page",
          param_name: "pageNo",
          page_size: 10,
          max_pages: 10,
        });
      }
      
      // 검색 필터 복원 (주 엔드포인트)
      if (apiConfig.search_filters && apiConfig.search_filters.length > 0) {
        setApiSearchFiltersPrimary({
          enabled: true,
          filters: apiConfig.search_filters.map((f: any) => ({
            field: f.field ?? "",
            keywords: f.keywords ?? [],
            match_type: f.match_type ?? "any",
          })),
        });
      } else {
        setApiSearchFiltersPrimary({ enabled: false, filters: [] });
      }
      
      // 날짜 범위 필터 복원 (주 엔드포인트)
      if (apiConfig.date_filters && apiConfig.date_filters.length > 0) {
        setApiDateFiltersPrimary({
          enabled: true,
          fields: apiConfig.date_filters.map((df: any) => ({
            field: df.field ?? "",
            start_date: df.start_date ?? "",
            end_date: df.end_date ?? "",
            format: df.format ?? "YYYYMMDD",
            relative_days: df.relative_days ? String(df.relative_days) : "",
          })),
        });
      } else {
        setApiDateFiltersPrimary({ enabled: false, fields: [] });
      }
      
      // 2단계 호출 설정 복원
      if (apiConfig.two_phase) {
        setApiTwoPhaseConfig({
          enabled: apiConfig.two_phase.enabled ?? false,
          field_mappings: apiConfig.two_phase.field_mappings ?? [],
          filter_mappings: apiConfig.two_phase.filter_mappings ?? [],
          use_filter_keywords: apiConfig.two_phase.use_filter_keywords ?? false,
          query_param_name: apiConfig.two_phase.query_param_name ?? "query",
          max_list_items: apiConfig.two_phase.max_list_items ?? 100,
          max_detail_items: apiConfig.two_phase.max_detail_items ?? 10,
        });
      } else {
        setApiTwoPhaseConfig({
          enabled: false,
          field_mappings: [],
          filter_mappings: [],
          use_filter_keywords: false,
          query_param_name: "query",
          max_list_items: 100,
          max_detail_items: 10,
        });
      }
    } else {
      // api_config가 없으면 초기화
      setApiEndpointIdx(-1);
      setApiSecondaryEndpointIdx(-1);
      setApiParamsPrimary([]);
      setApiParamsSecondary([]);
      setApiSelectedFieldsPrimary([]);
      setApiSelectedFieldsSecondary([]);
      setApiPagination({ enabled: false, type: "page", param_name: "pageNo", page_size: 10, max_pages: 10 });
      setApiSearchFiltersPrimary({ enabled: false, filters: [] });
      setApiSearchFiltersSecondary({ enabled: false, filters: [] });
      setApiDateFiltersPrimary({ enabled: false, fields: [] });
      setApiDateFiltersSecondary({ enabled: false, fields: [] });
      setApiTwoPhaseConfig({ enabled: false, field_mappings: [], filter_mappings: [], use_filter_keywords: false, query_param_name: "query", max_list_items: 100, max_detail_items: 10 });
    }
    
    // 스케줄 설정 복원
    if (nextDraft.schedule_config) {
      setScheduleConfig({
        scheduleMode: nextDraft.schedule_config.scheduleMode || "",
        startDate: nextDraft.schedule_config.startDate || "",
        endDate: nextDraft.schedule_config.endDate || "",
        cycleType: nextDraft.schedule_config.cycleType || "",
        monthlyDay: nextDraft.schedule_config.monthlyDay || "1",
        weeklyDay: nextDraft.schedule_config.weeklyDay || "mon",
        intervalDays: nextDraft.schedule_config.intervalDays || "1",
        timezone: nextDraft.schedule_timezone || "Asia/Tokyo",
        hour: nextDraft.schedule_config.hour || "9",
        minute: nextDraft.schedule_config.minute || "0",
        calendarSelectTarget: "start",
      });
    } else {
      // 스케줄 설정이 없으면 기본값으로 초기화
      setScheduleConfig({
        scheduleMode: "",
        startDate: "",
        endDate: "",
        cycleType: "",
        monthlyDay: "1",
        weeklyDay: "mon",
        intervalDays: "1",
        timezone: nextDraft.schedule_timezone || "Asia/Tokyo",
        hour: "9",
        minute: "0",
        calendarSelectTarget: "start",
      });
    }
    
    // 사이트 내 검색 옵션 복원
    if (nextDraft.site_search_config) {
      setSiteSearchConfig(nextDraft.site_search_config as typeof siteSearchConfig);
    } else {
      setSiteSearchConfig(null);
    }
    
    // 첨부파일 패턴 복원
    if (nextDraft.attachment_config) {
      setAttachmentConfig(nextDraft.attachment_config as typeof attachmentConfig);
    } else {
      setAttachmentConfig(null);
    }
    
    // DOM 분석 관련 상태 초기화
    setSiteStructure(null);
    setDateRuleTestResult(null);
    
    setIsBoardWizardOpen(true);
  };

  const closeBoardWizard = () => {
    setIsBoardWizardOpen(false);
    setWizardJsonError(null);
  };

  const parseJsonOrEmpty = (raw: string, fieldLabel: string): Record<string, unknown> | undefined => {
    const v = raw.trim();
    if (!v) return undefined;
    try {
      const obj = JSON.parse(v) as unknown;
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        throw new Error("invalid_object");
      }
      return obj as Record<string, unknown>;
    } catch {
      throw new Error(`${fieldLabel} JSON 형식이 올바르지 않습니다.`);
    }
  };

  // web_config에 external_detail 설정 병합
  const mergeExternalDetailToWebConfig = (config: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (!config) return config;
    if (externalDetailEnabled) {
      const extDetail: Record<string, unknown> = {
        enabled: true,
        url_selector: externalDetailUrlSelector,
        mode: externalDetailMode,
        content_selector: externalDetailContentSelector || undefined,
        attachments_selector: externalDetailAttachmentsSelector || undefined,
      };
      if (externalDetailUrlTransformEnabled && externalDetailExtractParam && externalDetailTemplate) {
        extDetail.url_transform = {
          extract_param: externalDetailExtractParam,
          template: externalDetailTemplate,
        };
      }
      return { ...config, external_detail: extDetail };
    } else {
      // 비활성화 시 external_detail 제거
      const { external_detail, ...rest } = config;
      return rest;
    }
  };

  const loadAll = async (autoSelect = true) => {
    setLoading(true);
    setError(null);
    try {
      const orgRes = await jsonFetch<{ orgs: Organization[] }>("/api/scraper/targets/orgs", {
        method: "GET",
      });
      setOrgs(orgRes.orgs);

      const boardRes = await jsonFetch<{ boards: Board[] }>("/api/scraper/targets/boards", {
        method: "GET",
      });
      setBoards(boardRes.boards);

      if (autoSelect) {
        const next = selectedOrgId ?? orgRes.orgs[0]?.org_id ?? null;
        setSelectedOrgId(next);
      }
    } catch (e: any) {
      setError(e?.message ?? "load_failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOrgDraft(selectedOrg);
    setIsNewOrg(false);
    setOrgLogoFile(null);
    setIsOrgModalOpen(false);
    setIsApiProfileModalOpen(false);
    setApiProfileUrl("");
    setApiProfileFile(null);
    setApiAnalyzeLoading(false);
    setApiAnalyzeError(null);
    setApiProposal(null);
    setApiWarnings([]);
    setApiSummary("");
    setApiProfileJson("");
    setApiRefineText("");
    setApiRefineLoading(false);
    setApiTestLoading(false);
    setApiTestError(null);
    setApiTestSecretOverride("");
    setApiTestEndpointPath("");
    setApiTestParamsJson("{}");
    setApiTestResult(null);
    setLlmProvider("openai");
    setLlmModelMode("auto");
    setLlmModel("");
    setIsApiKeySetOpen(false);
    setBoardDraft(null);
    setIsNewBoard(false);
    setIsBoardWizardOpen(false);
  }, [selectedOrgId, selectedOrg]);

  const parseJsonText = (raw: string, label: string) => {
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") throw new Error("invalid");
      return obj as any;
    } catch {
      throw new Error(`${label} JSON 형식이 올바르지 않습니다.`);
    }
  };

  const buildEnvTemplateFromApiProfile = (orgId: string) => {
    const upper = orgId.toUpperCase();
    let profile: any = null;
    try {
      if (apiProfileJson.trim()) profile = parseJsonText(apiProfileJson, "api_profile");
      else profile = orgDraft?.api_profile ?? null;
    } catch {
      profile = orgDraft?.api_profile ?? null;
    }

    const orgVars = new Set<string>();

    // 1) auth.secret_ref (ENV:XXX)
    const secretRef = String(profile?.auth?.secret_ref ?? "").trim();
    if (secretRef.startsWith("ENV:") && secretRef.slice(4).trim()) {
      orgVars.add(secretRef.slice(4).trim());
    }

    // 2) OC 같은 파라미터(비시크릿이지만 운영 편의상 env로 두고 싶어하는 경우가 많음)
    // - default_params 또는 param_schema에 OC가 있으면 기본 env 템플릿에 포함
    const defaultParams = profile?.default_params ?? {};
    if (defaultParams && typeof defaultParams === "object" && "OC" in defaultParams) {
      orgVars.add(`SCRAPER_${upper}_OC`);
    }
    const paramSchema = Array.isArray(profile?.param_schema) ? profile.param_schema : [];
    if (paramSchema.some((p: any) => String(p?.name ?? "").toUpperCase() === "OC")) {
      orgVars.add(`SCRAPER_${upper}_OC`);
    }

    // 3) 아무것도 못 찾으면 최소 권장 템플릿(기관별 AUTHKEY) 제공
    if (orgVars.size === 0) {
      orgVars.add(`SCRAPER_${upper}_AUTHKEY`);
    }

    return [
      "# ChatGPT(OpenAI)",
      "OPENAI_API_KEY=",
      "",
      "# Gemini(Google)",
      "GEMINI_API_KEY=",
      "",
      "# Claude(Anthropic)",
      "ANTHROPIC_API_KEY=",
      "ANTHROPIC_MODEL=claude-3-5-sonnet-latest",
      "",
      `# (기관별) api_profile 기반 변수 (자동 생성)`,
      ...Array.from(orgVars)
        .sort()
        .map((v) => `${v}=`),
      "",
      "# 참고:",
      "# - 시크릿 값(API Key/토큰)은 여기(로컬 env)에만 두고 scraper-targets.json에는 저장하지 않습니다.",
      "# - api_profile.auth.secret_ref가 ENV:변수명 형태로 이 값을 참조합니다.",
    ].join("\n");
  };

  const runApiAnalyze = async () => {
    if (!orgDraft) return;
    setApiAnalyzeLoading(true);
    setApiAnalyzeError(null);
    setApiProposal(null);
    setApiWarnings([]);
    setApiSummary("");
    setApiTestResult(null);
    try {
      const fd = new FormData();
      if (apiProfileUrl.trim()) fd.append("url", apiProfileUrl.trim());
      if (apiProfileFile) fd.append("file", apiProfileFile);
      
      // 사용자 수정 요청만 전송 (EP 데이터 제외)
      fd.append("context", apiRefineText.trim());
      
      // 선택된 엔드포인트 정보 별도 전송 (전체 데이터 포함)
      if (selectedExtractEndpoints.length > 0) {
        console.log("[Analyze] Selected endpoint titles:", selectedExtractEndpoints);
        console.log("[Analyze] loadedJsonData?.endpoints:", loadedJsonData?.endpoints?.length);
        console.log("[Analyze] extractedEndpoints:", extractedEndpoints.length);
        
        // loadedJsonData에 전체 데이터가 있으면 그것을 사용
        let fullEndpoints: any[] = [];
        if (loadedJsonData?.endpoints && loadedJsonData.endpoints.length > 0) {
          // loadedJsonData의 title과 selectedExtractEndpoints 비교
          const loadedTitles = loadedJsonData.endpoints.map((ep: any) => ep.title);
          console.log("[Analyze] Loaded titles:", loadedTitles);
          
          fullEndpoints = loadedJsonData.endpoints.filter((ep: any) => 
            selectedExtractEndpoints.includes(ep.title)
          );
          console.log("[Analyze] Filtered from loadedJsonData:", fullEndpoints.length);
        } else {
          // extractedEndpoints에서 선택된 것만 추출 (요약 데이터)
          fullEndpoints = extractedEndpoints.filter(e => 
            selectedExtractEndpoints.includes(e.title)
          );
          console.log("[Analyze] Filtered from extractedEndpoints:", fullEndpoints.length);
        }
        
        if (fullEndpoints.length > 0) {
          console.log("[Analyze] Sending endpoints count:", fullEndpoints.length);
          console.log("[Analyze] First endpoint sample:", fullEndpoints[0]);
          fd.append("selected_endpoints", JSON.stringify(fullEndpoints));
        } else {
          console.warn("[Analyze] No endpoints matched! Check title matching.");
        }
      }
      
      fd.append("provider", llmProvider);
      fd.append("model_mode", llmModelMode);
      if (llmModel.trim()) fd.append("model", llmModel.trim());

      const res = await fetch(
        `/api/scraper/targets/orgs/${encodeURIComponent(orgDraft.org_id)}/api-profile/analyze`,
        { method: "POST", body: fd }
      );
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(data?.error ?? "analyze_failed");

      const proposal = data?.proposal?.api_profile ?? null;
      if (!proposal) throw new Error("invalid_proposal");
      setApiProposal(proposal);
      setApiWarnings((data?.proposal?.warnings ?? []) as string[]);
      setApiSummary(String(data?.proposal?.summary ?? ""));
      setApiProfileJson(JSON.stringify(proposal, null, 2));
      // 기본 테스트 엔드포인트(있으면 첫번째)
      const endpoints = (proposal?.endpoints ?? []) as any[];
      const firstPath = endpoints?.[0]?.path ?? endpoints?.[0]?.url ?? "";
      setApiTestEndpointPath(String(firstPath ?? ""));
    } catch (e: any) {
      setApiAnalyzeError(e?.message ?? "analyze_failed");
    } finally {
      setApiAnalyzeLoading(false);
    }
  };

  const runApiRefine = async () => {
    if (!orgDraft) return;
    setApiRefineLoading(true);
    setApiAnalyzeError(null);
    try {
      const current = parseJsonText(apiProfileJson, "api_profile");
      const res = await fetch(
        `/api/scraper/targets/orgs/${encodeURIComponent(orgDraft.org_id)}/api-profile/refine`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_api_profile: current,
            user_feedback: apiRefineText.trim(),
            user_context: "",
            provider: llmProvider,
            model_mode: llmModelMode,
            model: llmModel.trim() || undefined,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(data?.error ?? "refine_failed");
      const next = data?.result?.api_profile;
      if (!next) throw new Error("invalid_refine_result");
      setApiProposal(next);
      setApiWarnings((data?.result?.warnings ?? []) as string[]);
      setApiProfileJson(JSON.stringify(next, null, 2));
    } catch (e: any) {
      setApiAnalyzeError(e?.message ?? "refine_failed");
    } finally {
      setApiRefineLoading(false);
    }
  };

  const runApiTest = async () => {
    if (!orgDraft) return;
    setApiTestLoading(true);
    setApiTestError(null);
    setApiTestResult(null);
    try {
      const current = parseJsonText(apiProfileJson, "api_profile");
      const params = parseJsonText(apiTestParamsJson, "params");
      const res = await fetch(
        `/api/scraper/targets/orgs/${encodeURIComponent(orgDraft.org_id)}/api-profile/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_profile: current,
            endpoint: { path: apiTestEndpointPath, method: "GET" },
            params,
            secret_override: apiTestSecretOverride.trim() || undefined,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(data?.error ?? "test_failed");
      setApiTestResult(data);
    } catch (e: any) {
      setApiTestError(e?.message ?? "test_failed");
    } finally {
      setApiTestLoading(false);
    }
  };

  // 엔드포인트 선택 시 파라미터 자동 채우기
  const handleApiEndpointSelect = (idx: number) => {
    setApiEndpointIdx(idx);
    setApiSettingsTab(0); // 탭을 주 엔드포인트로 리셋
    setApiSecondaryEndpointIdx(-1); // 보조 엔드포인트 리셋
    if (idx < 0 || idx >= selectedOrgApiEndpoints.length) {
      setApiParams([]);
      setApiParamsPrimary([]);
      setApiSelectedFieldsPrimary([]);
      return;
    }
    const ep = selectedOrgApiEndpoints[idx];
    const fixed = ep.fixed_params ?? {};
    const variable = ep.variable_params ?? [];
    const defaultParams = selectedOrgApiDefaultParams;

    // fixed_params + default_params 합쳐서 초기값 설정 (레거시)
    const merged: Record<string, string> = { ...defaultParams, ...fixed };
    const params: { key: string; value: string }[] = Object.entries(merged).map(([k, v]) => ({
      key: k,
      value: String(v ?? ""),
    }));
    // variable_params 중 아직 없는 것 추가 (빈 값)
    for (const v of variable) {
      if (!params.some((p) => p.key === v)) {
        params.push({ key: v, value: "" });
      }
    }
    setApiParams(params);

    // 새 구조: api_profile의 request_params 사용
    const reqParams = ep.request_params ?? [];
    if (reqParams.length > 0) {
      setApiParamsPrimary(reqParams.map((p: any) => ({ name: p.name, enabled: true, value: "" })));
    } else {
      // fallback
      const allParamNames = new Set<string>();
      if (Array.isArray(ep.required_params)) ep.required_params.forEach((p: string) => allParamNames.add(p));
      if (ep.fixed_params) Object.keys(ep.fixed_params).forEach((p) => allParamNames.add(p));
      if (Array.isArray(ep.variable_params)) ep.variable_params.forEach((p: string) => allParamNames.add(p));
      Object.keys(defaultParams).forEach((p) => allParamNames.add(p));
      setApiParamsPrimary(Array.from(allParamNames).map((name) => ({ name, enabled: true, value: "" })));
    }
    // 선택된 응답 필드 초기화
    setApiSelectedFieldsPrimary([]);
    // 검색/날짜 필터 초기화
    setApiSearchFiltersPrimary({ enabled: false, filters: [] });
    setApiDateFiltersPrimary({ enabled: false, fields: [] });
  };

  // API 보드 테스트 호출 (마법사 Step2용)
  const runApiBoardTest = async () => {
    if (!selectedOrg || apiEndpointIdx < 0) return;
    setApiBoardTestLoading(true);
    setApiBoardTestError(null);
    setApiBoardTestResult(null);
    try {
      const apiProfile = (selectedOrg as any)?.api_profile ?? {};
      const ep = selectedOrgApiEndpoints[apiEndpointIdx] ?? {};
      const paramsObj: Record<string, string> = {};
      for (const p of apiParams) {
        if (p.key.trim()) paramsObj[p.key.trim()] = p.value;
      }
      const res = await fetch(
        `/api/scraper/targets/orgs/${encodeURIComponent(selectedOrg.org_id)}/api-profile/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_profile: apiProfile,
            endpoint: { path: ep.path, method: ep.method ?? "GET", fixed_params: ep.fixed_params },
            params: paramsObj,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(data?.error ?? "test_failed");
      setApiBoardTestResult(data);
      // 응답에서 필드 목록 파싱 (XML의 경우 첫 번째 아이템의 태그들)
      if (data?.body) {
        const body = String(data.body);
        const fields: ResponseField[] = [];
        // XML 태그 파싱 (첫 번째 아이템에서 필드 추출)
        const itemMatch = body.match(/<(?:law|item|row|data)[^>]*>[\s\S]*?<\/(?:law|item|row|data)>/i);
        if (itemMatch) {
          const tagRegex = /<([가-힣a-zA-Z_][가-힣a-zA-Z0-9_]*)>([^<]*)<\/\1>/g;
          let match;
          const seen = new Set<string>();
          while ((match = tagRegex.exec(itemMatch[0])) !== null) {
            const tagName = match[1];
            if (!seen.has(tagName)) {
              seen.add(tagName);
              // 영문/한글 구분
              const isKorean = /[가-힣]/.test(tagName);
              fields.push({
                name: tagName,
                name_ko: isKorean ? tagName : undefined,
                description: "",
              });
            }
          }
        }
        if (fields.length > 0) {
          setApiResponseFields(fields);
        }
      }
    } catch (e: any) {
      setApiBoardTestError(e?.message ?? "test_failed");
    } finally {
      setApiBoardTestLoading(false);
    }
  };

  // apiConfigText를 UI state에서 자동 생성 (새 구조 사용)
  const buildApiConfigJson = () => {
    if (apiEndpointIdx < 0) return "{}";
    const ep = selectedOrgApiEndpoints[apiEndpointIdx] ?? {};
    
    // 주 엔드포인트 파라미터 (새 구조: apiParamsPrimary 사용)
    // 빈 값은 저장하지 않음 - API 호출 시 default_params나 인증에서 채워짐
    const paramsObj: Record<string, string> = {};
    for (const p of apiParamsPrimary) {
      if (p.enabled && p.name.trim()) {
        // fixed_params나 default_params에서 값 가져오기
        const fixedValue = ep.fixed_params?.[p.name] ?? selectedOrgApiDefaultParams[p.name] ?? p.value;
        const finalValue = String(fixedValue ?? "").trim();
        // 빈 값은 저장하지 않음 (인증 파라미터는 api_profile.auth에서 자동 추가됨)
        if (finalValue) {
          paramsObj[p.name.trim()] = finalValue;
        }
      }
    }
    
    const config: any = {
      primary_endpoint: {
        name: ep.name ?? "",
        path: ep.path ?? "",
        method: ep.method ?? "GET",
      },
      params: paramsObj,
    };
    
    // 보조 엔드포인트 (최대 1개)
    if (apiSecondaryEndpointIdx >= 0) {
      const sec = selectedOrgApiEndpoints[apiSecondaryEndpointIdx] ?? {};
      const secParamsObj: Record<string, string> = {};
      for (const p of apiParamsSecondary) {
        if (p.enabled && p.name.trim()) {
          const fixedValue = sec.fixed_params?.[p.name] ?? selectedOrgApiDefaultParams[p.name] ?? p.value;
          const finalValue = String(fixedValue ?? "").trim();
          // 빈 값은 저장하지 않음
          if (finalValue) {
            secParamsObj[p.name.trim()] = finalValue;
          }
        }
      }
      config.secondary_endpoints = [
        {
          name: sec.name ?? "",
          path: sec.path ?? "",
          method: sec.method ?? "GET",
          params: secParamsObj,
        },
      ];
      // 보조 엔드포인트 선택된 필드
      if (apiSelectedFieldsSecondary.length > 0) {
        config.secondary_endpoints[0].response_fields = apiSelectedFieldsSecondary;
      }
    }
    
    // 페이징 설정
    if (apiPagination.enabled) {
      config.pagination = {
        type: apiPagination.type,
        param_name: apiPagination.param_name,
        page_size: apiPagination.page_size,
        max_pages: apiPagination.max_pages,
      };
    }
    
    // 주 엔드포인트 선택된 응답 필드 (새 구조: apiSelectedFieldsPrimary 사용)
    if (apiSelectedFieldsPrimary.length > 0) {
      config.response_fields = apiSelectedFieldsPrimary;
    }
    
    // 주 엔드포인트 검색 필터 설정 (새 구조: apiSearchFiltersPrimary 사용)
    if (apiSearchFiltersPrimary.enabled && apiSearchFiltersPrimary.filters.length > 0) {
      const validFilters = apiSearchFiltersPrimary.filters.filter((f) => f.field.trim() && f.keywords.length > 0);
      if (validFilters.length > 0) {
        config.search_filters = validFilters.map((f) => ({
          field: f.field.trim(),
          keywords: f.keywords.filter(k => k.trim()), // 빈 키워드 제거
          match_type: f.match_type,
        }));
      }
    }
    
    // 주 엔드포인트 날짜 범위 필터 (새 구조: apiDateFiltersPrimary 사용)
    if (apiDateFiltersPrimary.enabled && apiDateFiltersPrimary.fields.length > 0) {
      const validDateFilters = apiDateFiltersPrimary.fields.filter((df) => df.field.trim());
      if (validDateFilters.length > 0) {
        config.date_filters = validDateFilters.map((df) => ({
          field: df.field,
          start_date: df.start_date,
          end_date: df.end_date,
          format: df.format,
          relative_days: df.relative_days ? Number(df.relative_days) : undefined,
        }));
      }
    }
    
    // 2단계 호출 설정 (보조 엔드포인트 → 주 엔드포인트 연결)
    if (apiTwoPhaseConfig.enabled && apiSecondaryEndpointIdx >= 0) {
      const validMappings = apiTwoPhaseConfig.field_mappings.filter(
        (m) => m.source_field.trim() && m.target_param.trim()
      );
      const validFilterMappings = apiTwoPhaseConfig.filter_mappings.filter(
        (fm) => fm.primary_filter_idx >= 0 && fm.secondary_field.trim()
      );
      
      config.two_phase = {
        enabled: true,
        field_mappings: validMappings,
        filter_mappings: validFilterMappings.length > 0 ? validFilterMappings : undefined,
        use_filter_keywords: apiTwoPhaseConfig.use_filter_keywords || undefined,
        query_param_name: apiTwoPhaseConfig.use_filter_keywords ? apiTwoPhaseConfig.query_param_name : undefined,
        max_list_items: apiTwoPhaseConfig.max_list_items,
        max_detail_items: apiTwoPhaseConfig.max_detail_items,
      };
    }
    
    return JSON.stringify(config, null, 2);
  };

  const approveAndSaveApiProfile = async () => {
    if (!orgDraft) return;
    setApiTestError(null);
    try {
      const current = parseJsonText(apiProfileJson, "api_profile");
      // 승인 후 저장: 비시크릿만 org.api_profile에 저장
      const res = await fetch(`/api/scraper/targets/orgs/${encodeURIComponent(orgDraft.org_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_profile: current }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(data?.error ?? "save_failed");
      setOrgDraft((p) => (p ? { ...p, api_profile: current } : p));
      await loadAll(false);
      setIsApiProfileModalOpen(false);
    } catch (e: any) {
      setApiTestError(e?.message ?? "save_failed");
    }
  };

  const startNewOrg = () => {
    setIsNewOrg(true);
    setOrgDraft({
      org_id: "",
      org_name: "",
      base_url: "",
      status: "active",
      default_policy: { rps: 0.2, timeout_sec: 30 },
      notes: "",
      collection_mode: "web_scraping",
      org_type: "유관기관",
      logo_path: "",
    });
    setOrgLogoFile(null);
    setIsOrgModalOpen(true);
  };

  const uploadOrgLogoIfNeeded = async (org_id: string) => {
    if (!orgLogoFile) return null;
    const form = new FormData();
    form.append("file", orgLogoFile);
    const res = await fetch(`/api/scraper/targets/orgs/${encodeURIComponent(org_id)}/logo`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const msg = data?.error ? String(data.error) : "logo_upload_failed";
      throw new Error(msg);
    }
    return data?.org as Organization;
  };

  const saveOrg = async () => {
    if (!orgDraft) return;
    setLoading(true);
    setError(null);
    try {
      if (isNewOrg) {
        const res = await jsonFetch<{ org: Organization }>("/api/scraper/targets/orgs", {
          method: "POST",
          body: JSON.stringify(orgDraft),
        });
        const orgAfterLogo = (await uploadOrgLogoIfNeeded(res.org.org_id)) ?? res.org;
        setOrgs((prev) => [...prev, orgAfterLogo]);
        setSelectedOrgId(orgAfterLogo.org_id);
        setIsNewOrg(false);
        setIsOrgModalOpen(false);
        setOrgLogoFile(null);
      } else {
        const res = await jsonFetch<{ org: Organization }>(
          `/api/scraper/targets/orgs/${encodeURIComponent(orgDraft.org_id)}`,
          { method: "PUT", body: JSON.stringify(orgDraft) }
        );
        const orgAfterLogo = (await uploadOrgLogoIfNeeded(res.org.org_id)) ?? res.org;
        setOrgs((prev) => prev.map((o) => (o.org_id === orgAfterLogo.org_id ? orgAfterLogo : o)));
        // 기관 수정 후 orgDraft도 업데이트 (로고 경로 반영)
        setOrgDraft(orgAfterLogo);
        setOrgLogoFile(null);
      }
    } catch (e: any) {
      setError(e?.message ?? "save_failed");
    } finally {
      setLoading(false);
    }
  };

  const cancelNewOrg = () => {
    setIsOrgModalOpen(false);
    setIsNewOrg(false);
    setOrgLogoFile(null);
    setOrgDraft(selectedOrg);
  };

  const deleteOrg = async () => {
    if (!selectedOrg) return;
    if (!confirm(`기관 '${selectedOrg.org_name}'을(를) 삭제할까요? 연결된 보드도 함께 삭제됩니다.`)) return;
    setLoading(true);
    setError(null);
    try {
      await jsonFetch(`/api/scraper/targets/orgs/${encodeURIComponent(selectedOrg.org_id)}`, {
        method: "DELETE",
      });
      setOrgs((prev) => prev.filter((o) => o.org_id !== selectedOrg.org_id));
      setBoards((prev) => prev.filter((b) => b.org_id !== selectedOrg.org_id));
      setSelectedOrgId((prev) => {
        if (prev !== selectedOrg.org_id) return prev;
        const remaining = orgs.filter((o) => o.org_id !== selectedOrg.org_id);
        return remaining[0]?.org_id ?? null;
      });
    } catch (e: any) {
      setError(e?.message ?? "delete_failed");
    } finally {
      setLoading(false);
    }
  };

  const startNewBoard = () => {
    if (!selectedOrgId) return;
    const mode = selectedOrg?.collection_mode ?? "web_scraping";
    // collection_mode 중심 설계 방향에 맞춰 “기본 접근 방식”을 자동 세팅
    // - api_only: API 기반이므로 api 고정
    // - hybrid: (현재 목표) API 목록 + 스크래핑 상세/첨부 → 우선 api로 시작(추후 hybrid 전용 마법사에서 상세 분기)
    // - web_scraping: 기본은 static_html
    const defaultAccessMode: BoardAccessMode =
      mode === "api_only" ? "api" : mode === "hybrid" ? "api" : "static_html";
    const defaultBoardMode: BoardMode =
      mode === "api_only" ? "api" : mode === "hybrid" ? "hybrid" : "web_scraping";
    // API 전용/하이브리드는 dedup_key 기본값을 "id"로 (API는 보통 고유 ID 제공)
    const defaultDedupKey: DedupKey = mode === "api_only" || mode === "hybrid" ? "id" : "url";
    setIsNewBoard(true);
    const draft: Board = {
      board_id: nextBoardIdForOrg || `${selectedOrgId}_board1`,
      org_id: selectedOrgId,
      board_name: "",
      access_mode: defaultAccessMode,
      list_url: "",
      doc_type: "",
      domain_tags: [],
      enabled: true,
      board_mode: defaultBoardMode,
      schedule_cron: "",
      dedup_key: defaultDedupKey,
      collection_range: { type: "", period_start: "", period_end: "", relative_days: 30, years: [] },
      collection_targets: { title_body: true, attachments: { enabled: false, all: false, hwpx: false, docx: false, xlsx: false, pdf: false } },
      published_date_rule: undefined,
      web_config: undefined,
      api_config: undefined,
      hybrid_config: undefined,
    };
    setBoardInlineError(null);
    setBoardConflict(null);
    setWizardJsonError(null);
    // 마법사로 바로 진입
    openBoardWizard(draft, 1);
  };

  const editBoard = (b: Board) => {
    setIsNewBoard(false);
    const draft: Board = { ...b, domain_tags: b.domain_tags ?? [], board_mode: inferBoardMode(b) };
    setBoardInlineError(null);
    setBoardConflict(null);
    setWizardJsonError(null);
    openBoardWizard(draft, 1);
  };

  const saveBoard = async (draftOverride?: Board) => {
    const draft = draftOverride ?? boardDraft;
    if (!draft) return;
    let ok = false;
    const missing: string[] = [];
    if (!draft.board_id?.trim()) missing.push("보드 ID(board_id)");
    if (!draft.board_name?.trim()) missing.push("보드명(board_name)");
    if (!draft.access_mode) missing.push("접근 방식(access_mode)");
    if (missing.length > 0) {
      setBoardInlineError(`필수 입력: ${missing.join(", ")}`);
      return;
    }

    // 보드 ID 규칙: {org_id}_board{n}
    if (isNewBoard) {
      const orgId = (draft.org_id ?? "").trim();
      const id = draft.board_id.trim();
      const re = new RegExp(`^${orgId}_board([1-9]\\d*)$`);
      if (!re.test(id)) {
        setBoardInlineError(`보드 ID 형식 오류: ${orgId}_board{n} 형식만 허용됩니다.`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setBoardInlineError(null);
    setBoardConflict(null);
    try {
      if (isNewBoard) {
        const res = await jsonFetch<{ board: Board }>("/api/scraper/targets/boards", {
          method: "POST",
          body: JSON.stringify(draft),
        });
        setBoards((prev) => [...prev, res.board]);
        setIsNewBoard(false);
        setBoardDraft(res.board);
        // 서버 저장소와 동기화(환경에 따라 경로/핫리로드 영향 방지)
        await loadAll(false);
        ok = true;
      } else {
        const res = await jsonFetch<{ board: Board }>(
          `/api/scraper/targets/boards/${encodeURIComponent(draft.board_id)}`,
          { method: "PUT", body: JSON.stringify(draft) }
        );
        setBoards((prev) => prev.map((b) => (b.board_id === res.board.board_id ? res.board : b)));
        setBoardDraft(res.board);
        await loadAll(false);
        ok = true;
      }
    } catch (e: any) {
      setError(e?.message ?? "save_failed");
      const msg = e?.message ?? "save_failed";
      if (msg === "board_id_exists" && isNewBoard && draft.board_id?.trim()) {
        // 이미 존재하는 보드라면, 해당 보드를 조회해서 “어느 기관에 있는지” 안내 + 이동 제공
        try {
          const existing = await jsonFetch<{ board: Board }>(
            `/api/scraper/targets/boards/${encodeURIComponent(draft.board_id.trim())}`,
            { method: "GET" }
          );
          setBoardConflict(existing.board);
          const orgName =
            orgs.find((o) => o.org_id === existing.board.org_id)?.org_name ?? existing.board.org_id;
          setBoardInlineError(`이미 존재하는 보드 ID입니다. 소속 기관: ${orgName}`);
        } catch {
          setBoardInlineError("이미 존재하는 보드 ID입니다. (기존 보드 조회 실패)");
        }
      } else {
        setBoardInlineError(msg);
      }
    } finally {
      setLoading(false);
    }
    return ok;
  };

  const deleteBoard = async (boardId: string) => {
    const b = boards.find((x) => x.board_id === boardId);
    if (!b) return;
    if (!confirm(`보드 '${b.board_name}'을(를) 삭제할까요?`)) return;
    setLoading(true);
    setError(null);
    try {
      await jsonFetch(`/api/scraper/targets/boards/${encodeURIComponent(boardId)}`, {
        method: "DELETE",
      });
      setBoards((prev) => prev.filter((x) => x.board_id !== boardId));
      if (boardDraft?.board_id === boardId) {
        setBoardDraft(null);
        setIsNewBoard(false);
      }
    } catch (e: any) {
      setError(e?.message ?? "delete_failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 relative min-h-full pb-6">
      {/* Header */}
      <section className="glass-panel p-6 rounded-3xl relative overflow-hidden">
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-stone-800 mb-2">
              대상 기관 관리
            </h1>
            <p className="text-stone-600 text-sm">
              기관(Organization) 및 보드(Board) 설정을 관리합니다. (설정은 로컬 JSON에 저장됩니다)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadAll(false)}
              className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700 flex items-center gap-2"
              disabled={loading}
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              새로고침
            </button>
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      {error && (
        <div className="glass-panel p-4 rounded-2xl border border-red-200 bg-red-50/30">
          <div className="text-sm font-semibold text-red-700">오류: {error}</div>
          <div className="text-xs text-red-600 mt-1">
            입력값이 누락되었거나(ID 중복 등), 서버 저장소 쓰기 권한 문제가 있을 수 있습니다.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-6">
        {/* Left: Org list */}
        <section className="glass-panel p-5 rounded-3xl flex flex-col gap-4 min-h-[520px]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-extrabold text-stone-800">기관 목록</div>
            <button
              onClick={startNewOrg}
              className="flex items-center gap-2 bg-stone-800 hover:bg-stone-900 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-stone-800/20 transition-all active:scale-95 font-bold"
            >
              <Plus className="w-4 h-4 text-white" />
              <span className="text-white text-sm">기관 추가</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색: org_id / 기관명 / URL"
              className="ui-field"
            />
          </div>

          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            {(() => {
              const groups: { label: OrganizationType; items: Organization[] }[] = [
                { label: "국가기관", items: [] },
                { label: "유관기관", items: [] },
                { label: "협회 및 학회", items: [] },
              ];
              for (const o of filteredOrgs) {
                const t = o.org_type ?? "유관기관";
                const g = groups.find((x) => x.label === t) ?? groups[1];
                g.items.push(o);
              }
              return groups;
            })().map((g) => (
              <div key={g.label} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-extrabold text-stone-600 tracking-wide">
                    {g.label}
                  </div>
                  <div className="text-[11px] text-stone-400 font-semibold">{g.items.length}개</div>
                </div>
                <div className="p-3 rounded-2xl bg-white/20 border border-white/50">
                  {g.items.length === 0 ? (
                    <div className="text-xs text-stone-500 px-2 py-3">해당 유형의 기관이 없습니다.</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {g.items.map((o) => {
                        const active = o.org_id === selectedOrgId && !isNewOrg;
                        const isInactive = o.status === "inactive";
                        return (
                          <button
                            key={o.org_id}
                            onClick={() => setSelectedOrgId(o.org_id)}
                            className={cn(
                              "text-left rounded-2xl border transition-all overflow-hidden",
                              "bg-white/40 border-white/60 hover:bg-white/60",
                              "shadow-sm hover:shadow-xl hover:-translate-y-0.5",
                              active && "bg-white/80 border-primary/40 ring-2 ring-primary/15 shadow-lg"
                            )}
                          >
                            <div className="p-4 flex items-center gap-3">
                              <div className="w-[60px] h-[38px] rounded-xl bg-white/60 border border-white/70 shadow-inner flex items-center justify-center shrink-0 overflow-hidden">
                                {o.logo_path ? (
                                  <Image
                                    src={o.logo_path}
                                    alt={`${o.org_name} 로고`}
                                    width={60}
                                    height={38}
                                    className="object-contain"
                                    style={{ width: 'auto', height: 'auto', maxWidth: '60px', maxHeight: '38px' }}
                                  />
                                ) : (
                                  <ImageIcon className="w-5 h-5 text-stone-400" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-extrabold text-stone-800 truncate">
                                    {o.org_name}
                                  </div>
                                  {isInactive && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
                                      비활성
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-stone-500 mt-1 truncate font-bold">{o.org_id}</div>
                                <div className="text-xs text-stone-400 mt-1 truncate">{o.base_url}</div>
                              </div>
                              <ChevronRight className="w-4 h-4 opacity-30 shrink-0" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {filteredOrgs.length === 0 && (
              <div className="text-sm text-stone-500 p-4">검색 결과가 없습니다.</div>
            )}
          </div>
        </section>

        {/* Right: Details */}
        <section className="glass-panel p-6 rounded-3xl flex flex-col gap-6 min-h-[520px]">
          {/* Org editor */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-extrabold text-stone-800">기관 상세</div>
              <div className="text-xs text-stone-500 mt-1">
                {isNewOrg ? "새 기관 추가" : selectedOrg ? `org_id: ${selectedOrg.org_id}` : "기관을 선택하세요"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isNewOrg && selectedOrg && (
                <button
                  onClick={deleteOrg}
                  className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-red-700 flex items-center gap-2"
                  disabled={loading}
                >
                  <Trash2 className="w-4 h-4" />
                  삭제
                </button>
              )}
              <button
                onClick={saveOrg}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-95",
                  "bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/20"
                )}
                disabled={loading || !orgDraft}
              >
                <Save className="w-4 h-4" />
                저장
              </button>
            </div>
          </div>

          {!orgDraft ? (
            <div className="flex-1 flex items-center justify-center text-stone-500 text-sm">
              왼쪽에서 기관을 선택하거나 “기관 추가”를 눌러주세요.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">영문약자(org_id) (불변 권장)</label>
                <input
                  value={orgDraft.org_id}
                  onChange={(e) =>
                    setOrgDraft((p) => (p ? { ...p, org_id: e.target.value } : p))
                  }
                  disabled={!isNewOrg}
                  className={cn(
                    "ui-field",
                    !isNewOrg && "opacity-80"
                  )}
                  placeholder="예: moe / lawgo"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">기관명(org_name)</label>
                <input
                  value={orgDraft.org_name}
                  onChange={(e) =>
                    setOrgDraft((p) => (p ? { ...p, org_name: e.target.value } : p))
                  }
                  className="ui-field"
                  placeholder="표시명"
                />
              </div>
              <div className="flex flex-col gap-2 lg:col-span-2">
                <label className="text-xs font-bold text-stone-600">메인페이지 주소(base_url)</label>
                <input
                  value={orgDraft.base_url}
                  onChange={(e) =>
                    setOrgDraft((p) => (p ? { ...p, base_url: e.target.value } : p))
                  }
                  className="ui-field"
                  placeholder="https://..."
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">상태(status)</label>
                <select
                  value={orgDraft.status}
                  onChange={(e) =>
                    setOrgDraft((p) =>
                      p ? { ...p, status: e.target.value as OrgStatus } : p
                    )
                  }
                  className="ui-field"
                >
                  <option value="active">활성(active)</option>
                  <option value="inactive">비활성(inactive)</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">수집 모드(collection_mode)</label>
                <select
                  value={orgDraft.collection_mode ?? "web_scraping"}
                  onChange={(e) =>
                    setOrgDraft((p) =>
                      p ? { ...p, collection_mode: e.target.value as CollectionMode } : p
                    )
                  }
                  className="ui-field"
                >
                  <option value="web_scraping">웹 스크래핑(web_scraping)</option>
                  <option value="api_only">API 전용(api_only)</option>
                  <option value="hybrid">혼합(hybrid)</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">기관 종류(org_type)</label>
                <select
                  value={orgDraft.org_type ?? "유관기관"}
                  onChange={(e) =>
                    setOrgDraft((p) =>
                      p ? { ...p, org_type: e.target.value as OrganizationType } : p
                    )
                  }
                  className="ui-field"
                >
                  <option value="국가기관">국가기관</option>
                  <option value="유관기관">유관기관</option>
                  <option value="협회 및 학회">협회 및 학회</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">기관 로고(logo)</label>
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/50 border border-white/70">
                  <div className="w-[60px] h-[38px] rounded-xl bg-white/60 border border-white/70 shadow-inner flex items-center justify-center shrink-0 overflow-hidden">
                    {orgDraft.logo_path ? (
                      <Image
                        src={orgDraft.logo_path}
                        alt={`${orgDraft.org_name} 로고`}
                        width={60}
                        height={38}
                        className="object-contain"
                        style={{ width: 'auto', height: 'auto', maxWidth: '60px', maxHeight: '38px' }}
                      />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-stone-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-stone-500 font-semibold">
                      png/jpg/webp, 최대 2MB (저장 시 업로드/교체)
                    </div>
                    {orgDraft.logo_path && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-stone-600 min-w-0">
                        <span className="font-semibold text-stone-500 shrink-0">현재:</span>
                        <span className="font-mono truncate">{orgDraft.logo_path}</span>
                        <a
                          href={orgDraft.logo_path}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-primary font-bold hover:underline"
                        >
                          이미지 열기
                        </a>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setOrgLogoFile(e.target.files?.[0] ?? null)}
                      className="mt-2 block w-full text-xs text-stone-600 transition-all hover:opacity-90 active:scale-[0.99] file:mr-3 file:rounded-lg file:border-0 file:bg-white/70 file:px-3 file:py-2 file:text-xs file:font-bold file:text-stone-700 file:transition-all file:hover:bg-white file:hover:shadow-md file:hover:shadow-stone-200/40 file:active:scale-95"
                    />
                    {orgLogoFile && (
                      <div className="mt-2 text-xs text-stone-600">
                        선택됨: <span className="font-bold">{orgLogoFile.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">요청 제한(rps)</label>
                <input
                  type="number"
                  step="0.01"
                  value={orgDraft.default_policy?.rps ?? 0.2}
                  onChange={(e) =>
                    setOrgDraft((p) =>
                      p
                        ? {
                            ...p,
                            default_policy: {
                              ...p.default_policy,
                              rps: Number(e.target.value),
                            },
                          }
                        : p
                    )
                  }
                  className="ui-field"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">타임아웃(timeout_sec)</label>
                <input
                  type="number"
                  step="1"
                  value={orgDraft.default_policy?.timeout_sec ?? 30}
                  onChange={(e) =>
                    setOrgDraft((p) =>
                      p
                        ? {
                            ...p,
                            default_policy: {
                              ...p.default_policy,
                              timeout_sec: Number(e.target.value),
                            },
                          }
                        : p
                    )
                  }
                  className="ui-field"
                />
              </div>

              <div className="flex flex-col gap-2 lg:col-span-2">
                <label className="text-xs font-bold text-stone-600">운영 메모(notes)</label>
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-start">
                  <textarea
                    value={orgDraft.notes ?? ""}
                    onChange={(e) =>
                      setOrgDraft((p) => (p ? { ...p, notes: e.target.value } : p))
                    }
                    className="ui-textarea min-h-[92px]"
                    placeholder="운영 메모"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      // 기관에 저장된 api_profile이 있으면 불러오기
                      const existingProfile = (orgDraft as any)?.api_profile;
                      if (existingProfile && typeof existingProfile === "object") {
                        setApiProfileJson(JSON.stringify(existingProfile, null, 2));
                        setApiProposal(existingProfile);
                        setApiWarnings([]);
                        setApiSummary("저장된 api_profile을 불러왔습니다. 수정 후 승인/저장하세요.");
                        // 첫 번째 엔드포인트를 테스트 기본값으로 설정
                        const endpoints = existingProfile?.endpoints ?? [];
                        const firstPath = endpoints?.[0]?.path ?? endpoints?.[0]?.url ?? "";
                        setApiTestEndpointPath(String(firstPath ?? ""));
                      }
                      setIsApiProfileModalOpen(true);
                    }}
                    disabled={
                      (orgDraft.collection_mode ?? "web_scraping") === "web_scraping" || isNewOrg
                    }
                    className={cn(
                      "glass-button px-4 py-3 rounded-2xl text-sm font-extrabold text-stone-700 h-[92px] flex items-center justify-center",
                      ((orgDraft.collection_mode ?? "web_scraping") === "web_scraping" || isNewOrg) &&
                        "opacity-50 cursor-not-allowed"
                    )}
                    title={
                      (orgDraft.collection_mode ?? "web_scraping") === "web_scraping"
                        ? "collection_mode가 api_only 또는 hybrid일 때 활성화됩니다."
                        : "API 초기 세팅(설계 단계)"
                    }
                  >
                    API 초기 세팅
                  </button>
                </div>
                <div className="text-[11px] text-stone-500 font-semibold">
                  * API/하이브리드 기관은 보드 설정 전에 기관 레벨 <span className="font-bold">api_profile</span>을 먼저 정의하는 것을 권장합니다.
                </div>
              </div>
            </div>
          )}

          {/* Boards */}
          <div className="h-px bg-stone-200/70" />

          <div className="grid grid-cols-1 lg:grid-cols-[6.5fr_3.5fr] gap-4">
            {/* Header row */}
            <div>
              <div className="text-sm font-extrabold text-stone-800">보드 목록</div>
              <div className="text-xs text-stone-500 mt-1">
                {selectedOrgId ? `${selectedBoards.length}개 보드` : "기관을 선택하면 보드를 볼 수 있습니다."}
              </div>
            </div>
            <div>
              <div className="text-sm font-extrabold text-stone-800">보드 설정 마법사</div>
              <div className="text-xs text-stone-500 mt-1">
                {boardDraft
                  ? isNewBoard
                    ? "새 보드 추가"
                    : `board_id: ${boardDraft.board_id}`
                  : "왼쪽에서 보드를 선택하거나 추가하세요"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[6.5fr_3.5fr] gap-4">
            {/* Board list */}
            <div className="flex flex-col gap-2">
              {selectedOrgId ? (
                selectedBoards.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {selectedBoards.map((b) => (
                      <div
                        key={b.board_id}
                        className={cn(
                          "p-3 rounded-2xl border bg-white/40 border-white/60 hover:bg-white/60 transition-all",
                          "hover:shadow-md hover:shadow-stone-200/40 hover:-translate-y-0.5",
                          boardDraft?.board_id === b.board_id && !isNewBoard
                            ? "ring-2 ring-primary/15 border-primary/40 bg-white/80 shadow-lg"
                            : ""
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-xl bg-white/60 border border-white/70 shadow-inner flex items-center justify-center">
                                <DocTypeIcon doc_type={b.doc_type} />
                              </div>
                              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                                <span className="text-sm font-extrabold text-stone-800 truncate">
                                  {b.board_name}
                                </span>
                                {b.doc_type && (
                                  <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-white/70">
                                    {b.doc_type}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-xs text-stone-500 mt-1 truncate font-bold">
                              {b.board_id}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {!b.enabled && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
                                  비활성
                                </span>
                              )}
                              {b.access_mode === "api" && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                                  api
                                </span>
                              )}
                              {b.access_mode === "login_required" && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                  login
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => editBoard(b)}
                              className="glass-button w-9 h-9 rounded-xl flex items-center justify-center"
                              title="수정"
                            >
                              <Pencil className="w-4 h-4 text-stone-600" />
                            </button>
                            <button
                              onClick={() => void deleteBoard(b.board_id)}
                              className="glass-button w-9 h-9 rounded-xl flex items-center justify-center"
                              title="삭제"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-white/40 border border-white/60 text-sm text-stone-500">
                    아직 보드가 없습니다. 목록의 ✎ 버튼으로 보드를 생성하세요.
                  </div>
                )
              ) : (
                <div className="p-4 rounded-2xl bg-white/40 border border-white/60 text-sm text-stone-500">
                  기관을 선택하세요.
                </div>
              )}
            </div>

            {/* Board editor */}
            <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
              <div className="flex items-end justify-end gap-2">
                <button
                  onClick={startNewBoard}
                  className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700 flex items-center gap-2"
                  disabled={!selectedOrgId}
                >
                  <Plus className="w-4 h-4" />
                  새 보드
                </button>
                <button
                  onClick={() => boardDraft && openBoardWizard(boardDraft, 1)}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-95",
                    "bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/20"
                  )}
                  disabled={!boardDraft}
                >
                  <Pencil className="w-4 h-4" />
                  마법사 열기
                </button>
              </div>

              {boardInlineError && (
                <div className="mt-3 text-sm text-red-700 bg-red-50/60 border border-red-200 rounded-2xl px-4 py-3">
                  <div className="font-semibold">{boardInlineError}</div>
                  {boardConflict && (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-xs text-red-700/80 min-w-0">
                        <span className="font-bold">기존 보드:</span>{" "}
                        <span className="font-mono">{boardConflict.board_id}</span>{" "}
                        <span className="text-red-700/70">({boardConflict.board_name})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOrgId(boardConflict.org_id);
                          editBoard(boardConflict);
                          setBoardInlineError(null);
                          setBoardConflict(null);
                        }}
                        className="glass-button px-3 py-2 rounded-xl text-xs font-extrabold text-red-700 border border-red-200 bg-red-50/40"
                      >
                        해당 보드로 이동
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 text-sm text-stone-600">
                {boardDraft ? (
                  <div className="flex flex-col gap-2">
                    <div>
                      <span className="font-extrabold text-stone-800">{boardDraft.board_name}</span>{" "}
                      <span className="text-stone-500 font-mono">({boardDraft.board_id})</span>
                    </div>
                    <div className="text-xs text-stone-500">
                      마크다운 설계안 기준으로 보드 설정은 <span className="font-bold">3단계 마법사</span>에서 관리합니다.
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-stone-500">
                    목록에서 보드를 선택하거나 ✎ 버튼을 눌러 마법사를 시작하세요.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* New Org Modal */}
      {isOrgModalOpen && isNewOrg && orgDraft && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={cancelNewOrg}
          />
          <div className="relative w-full max-w-4xl rounded-3xl glass-panel border border-white/70 shadow-2xl shadow-stone-900/20 overflow-hidden">
            <div className="p-6 flex items-start justify-between gap-4 border-b border-white/60 bg-white/20">
              <div>
                <div className="text-lg font-extrabold text-stone-800">기관 추가</div>
                <div className="text-xs text-stone-500 mt-1">
                  기관 정보를 입력하고 저장하세요. (저장 시 로고 업로드/교체도 함께 적용됩니다)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelNewOrg}
                  className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700"
                  disabled={loading}
                >
                  취소
                </button>
                <button
                  onClick={saveOrg}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-95 bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/20"
                  disabled={loading}
                >
                  <Save className="w-4 h-4" />
                  저장
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-600">영문약자(org_id) (불변 권장)</label>
                  <input
                    value={orgDraft.org_id}
                    onChange={(e) =>
                      setOrgDraft((p) => (p ? { ...p, org_id: e.target.value } : p))
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                    placeholder="예: moe / lawgo"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-600">기관명(org_name)</label>
                  <input
                    value={orgDraft.org_name}
                    onChange={(e) =>
                      setOrgDraft((p) => (p ? { ...p, org_name: e.target.value } : p))
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                    placeholder="표시명"
                  />
                </div>

                <div className="flex flex-col gap-2 lg:col-span-2">
                  <label className="text-xs font-bold text-stone-600">메인페이지 주소(base_url)</label>
                  <input
                    value={orgDraft.base_url}
                    onChange={(e) =>
                      setOrgDraft((p) => (p ? { ...p, base_url: e.target.value } : p))
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                    placeholder="https://..."
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-600">기관 종류(org_type)</label>
                  <select
                    value={orgDraft.org_type ?? "유관기관"}
                    onChange={(e) =>
                      setOrgDraft((p) =>
                        p ? { ...p, org_type: e.target.value as OrganizationType } : p
                      )
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                  >
                    <option value="국가기관">국가기관</option>
                    <option value="유관기관">유관기관</option>
                    <option value="협회 및 학회">협회 및 학회</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-600">상태(status)</label>
                  <select
                    value={orgDraft.status}
                    onChange={(e) =>
                      setOrgDraft((p) =>
                        p ? { ...p, status: e.target.value as OrgStatus } : p
                      )
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                  >
                    <option value="active">활성(active)</option>
                    <option value="inactive">비활성(inactive)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-600">수집 모드(collection_mode)</label>
                  <select
                    value={orgDraft.collection_mode ?? "web_scraping"}
                    onChange={(e) =>
                      setOrgDraft((p) =>
                        p ? { ...p, collection_mode: e.target.value as CollectionMode } : p
                      )
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                  >
                    <option value="web_scraping">웹 스크래핑(web_scraping)</option>
                    <option value="api_only">API 전용(api_only)</option>
                    <option value="hybrid">혼합(hybrid)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-600">요청 제한(rps)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={orgDraft.default_policy?.rps ?? 0.2}
                    onChange={(e) =>
                      setOrgDraft((p) =>
                        p
                          ? {
                              ...p,
                              default_policy: {
                                ...p.default_policy,
                                rps: Number(e.target.value),
                              },
                            }
                          : p
                      )
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-600">타임아웃(timeout_sec)</label>
                  <input
                    type="number"
                    step="1"
                    value={orgDraft.default_policy?.timeout_sec ?? 30}
                    onChange={(e) =>
                      setOrgDraft((p) =>
                        p
                          ? {
                              ...p,
                              default_policy: {
                                ...p.default_policy,
                                timeout_sec: Number(e.target.value),
                              },
                            }
                          : p
                      )
                    }
                    className="px-4 py-2.5 rounded-xl bg-white/60 border border-white/70 text-sm font-semibold text-stone-700 outline-none"
                  />
                </div>

                <div className="flex flex-col gap-2 lg:col-span-2">
                  <label className="text-xs font-bold text-stone-600">기관 로고(logo)</label>
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/50 border border-white/70">
                    <div className="w-[60px] h-[38px] rounded-xl bg-white/60 border border-white/70 shadow-inner flex items-center justify-center shrink-0 overflow-hidden">
                      {orgDraft.logo_path ? (
                        <Image
                          src={orgDraft.logo_path}
                          alt={`${orgDraft.org_name} 로고`}
                          width={60}
                          height={38}
                          className="object-contain"
                          style={{ width: 'auto', height: 'auto', maxWidth: '60px', maxHeight: '38px' }}
                        />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-stone-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-stone-500 font-semibold">
                        png/jpg/webp, 최대 2MB (저장 시 업로드)
                      </div>
                      {orgDraft.logo_path && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-stone-600 min-w-0">
                          <span className="font-semibold text-stone-500 shrink-0">현재:</span>
                          <span className="font-mono truncate">{orgDraft.logo_path}</span>
                          <a
                            href={orgDraft.logo_path}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-primary font-bold hover:underline"
                          >
                            이미지 열기
                          </a>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => setOrgLogoFile(e.target.files?.[0] ?? null)}
                        className="mt-2 block w-full text-xs text-stone-600 transition-all hover:opacity-90 active:scale-[0.99] file:mr-3 file:rounded-lg file:border-0 file:bg-white/70 file:px-3 file:py-2 file:text-xs file:font-bold file:text-stone-700 file:transition-all file:hover:bg-white file:hover:shadow-md file:hover:shadow-stone-200/40 file:active:scale-95"
                      />
                      {orgLogoFile && (
                        <div className="mt-2 text-xs text-stone-600">
                          선택됨: <span className="font-bold">{orgLogoFile.name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 lg:col-span-2">
                  <label className="text-xs font-bold text-stone-600">운영 메모(notes)</label>
                  <textarea
                    value={orgDraft.notes ?? ""}
                    onChange={(e) =>
                      setOrgDraft((p) => (p ? { ...p, notes: e.target.value } : p))
                    }
                    className="px-4 py-3 rounded-2xl bg-white/60 border border-white/70 text-sm font-medium text-stone-700 outline-none min-h-[92px]"
                    placeholder="운영 메모"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Board Wizard Modal (보드 편집 마법사) */}
      {isBoardWizardOpen && boardDraft && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeBoardWizard} />

          <div className="relative w-full max-w-5xl rounded-3xl glass-panel border border-white/70 shadow-2xl shadow-stone-900/20 overflow-hidden">
            <div className="p-6 flex items-start justify-between gap-4 border-b border-white/60 bg-white/20">
              <div className="min-w-0">
                <div className="text-lg font-extrabold text-stone-800">보드 설정 마법사</div>
                <div className="text-xs text-stone-500 mt-1 truncate">
                  {boardDraft.board_id} · {orgs.find((o) => o.org_id === boardDraft.org_id)?.org_name ?? boardDraft.org_id}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setWizardStep(n as 1 | 2 | 3)}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-extrabold border transition-all",
                      wizardStep === n
                        ? "bg-stone-900 text-white border-stone-900"
                        : "bg-white/40 text-stone-700 border-white/70 hover:bg-white/70"
                    )}
                  >
                    Step {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={closeBoardWizard}
                  className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto">
              {wizardJsonError && (
                <div className="mb-4 text-sm text-red-700 bg-red-50/60 border border-red-200 rounded-2xl px-4 py-3">
                  {wizardJsonError}
                </div>
              )}

              {/* Step 1: 기본 정보 */}
              {wizardStep === 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">보드 ID(board_id)</label>
                    <input
                      value={boardDraft.board_id}
                      onChange={(e) =>
                        setBoardDraft((p) => (p ? { ...p, board_id: e.target.value.trim() } : p))
                      }
                      disabled={!isNewBoard}
                      className={cn("ui-field", !isNewBoard && "opacity-80")}
                      placeholder={`${boardDraft.org_id}_board1`}
                      list={isNewBoard ? "wizard-board-id-suggestions" : undefined}
                    />
                    {isNewBoard && boardIdSuggestions.length > 0 && (
                      <datalist id="wizard-board-id-suggestions">
                        {boardIdSuggestions.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-stone-500 font-semibold">
                        규칙: <span className="font-mono">{boardDraft.org_id}_board{`{n}`}</span>
                      </div>
                      {isNewBoard && (
                        <button
                          type="button"
                          onClick={() =>
                            setBoardDraft((p) =>
                              p
                                ? {
                                    ...p,
                                    board_id: nextBoardIdForOrg || `${p.org_id}_board1`,
                                  }
                                : p
                            )
                          }
                          className="glass-button px-3 py-1.5 rounded-lg text-[11px] font-extrabold text-stone-700"
                        >
                          자동 생성
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">보드 모드(board_mode)</label>
                    <div className="flex flex-wrap gap-2">
                      {(["web_scraping", "api", "hybrid"] as const).map((m) => {
                        const selected = (boardDraft.board_mode ?? inferBoardMode(boardDraft)) === m;
                        const label =
                          m === "web_scraping" ? "웹 스크래핑" : m === "api" ? "API" : "하이브리드";
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              setBoardDraft((p) => {
                                if (!p) return p;
                                const next: Board = { ...p, board_mode: m };
                                if (m === "api" || m === "hybrid") {
                                  next.access_mode = "api";
                                } else if (m === "web_scraping" && next.access_mode === "api") {
                                  next.access_mode = "static_html";
                                }
                                return next;
                              });
                            }}
                            className={cn("ui-chip", selected ? "ui-chip--on" : "ui-chip--off")}
                          >
                            {label}({m})
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-[11px] text-stone-500 font-semibold">
                      기관 수집 모드(collection_mode)를 기준으로 기본값이 추천되며, 필요 시 보드 단위로 조정할 수 있습니다.
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:col-span-2">
                    <label className="text-xs font-bold text-stone-600">보드명(board_name)</label>
                    <input
                      value={boardDraft.board_name}
                      onChange={(e) =>
                        setBoardDraft((p) => (p ? { ...p, board_name: e.target.value } : p))
                      }
                      className="ui-field"
                      placeholder="예: 보도자료"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">문서 유형(doc_type)</label>
                    <select
                      value={boardDraft.doc_type ?? ""}
                      onChange={(e) =>
                        setBoardDraft((p) => (p ? { ...p, doc_type: e.target.value } : p))
                      }
                      className="ui-field"
                    >
                      <option value="">선택(미지정)</option>
                      {DOC_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">분야 태그(domain_tags) (복수)</label>
                    <div className="p-3 rounded-2xl bg-white/50 border border-white/70">
                      <div className="flex flex-wrap gap-2">
                        {DOMAIN_TAG_OPTIONS.map((tag) => {
                          const selected = (boardDraft.domain_tags ?? []).includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setBoardDraft((p) => {
                                  if (!p) return p;
                                  const cur = p.domain_tags ?? [];
                                  const next = selected ? cur.filter((x) => x !== tag) : [...cur, tag];
                                  return { ...p, domain_tags: next };
                                })
                              }
                              className={cn("ui-chip", selected ? "ui-chip--on" : "ui-chip--off")}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-[11px] text-stone-500 font-semibold">
                        선택됨: {(boardDraft.domain_tags ?? []).length}개
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">스케줄 설정</label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setIsScheduleModalOpen(true)}
                        className="glass-button px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 shrink-0"
                        style={{ width: "120px" }}
                      >
                        스케쥴 설정
                      </button>
                      <div className={cn(
                        "flex-1 px-3 py-2 rounded-xl text-xs font-semibold",
                        boardDraft.schedule_cron 
                          ? "bg-primary/10 border border-primary/30 text-primary"
                          : "bg-stone-100/80 border border-stone-200/60 text-stone-400"
                      )}>
                        {boardDraft.schedule_cron 
                          ? (buildScheduleSummary() || "실행 주기 미설정")
                          : "미설정"
                        }
                      </div>
                      <div className={cn(
                        "w-[140px] px-3 py-2 rounded-xl text-xs font-mono font-semibold shrink-0",
                        boardDraft.schedule_cron 
                          ? "bg-stone-800 border border-stone-700 text-stone-100"
                          : "bg-stone-100/80 border border-stone-200/60 text-stone-400"
                      )}>
                        {boardDraft.schedule_cron || "cron 미설정"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-bold text-stone-600">중복 기준(dedup_key)</label>
                      <div className="group relative">
                        <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                        <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-64 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                          <div className="font-bold mb-1.5">중복 제거 기준</div>
                          <div className="text-stone-300 leading-relaxed">
                            동일한 문서를 중복 수집하지 않기 위한 고유 식별 기준입니다.
                          </div>
                          <ul className="mt-2 space-y-1 text-stone-300">
                            <li><span className="font-mono text-amber-400">url</span> - 문서 URL로 구분 (기본값, 대부분 적합)</li>
                            <li><span className="font-mono text-amber-400">id</span> - 문서 고유 ID로 구분 (API 등에서 ID 제공 시)</li>
                            <li><span className="font-mono text-amber-400">hash</span> - 본문 내용 해시로 구분 (URL이 변경될 수 있는 경우)</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    <select
                      value={boardDraft.dedup_key ?? "url"}
                      onChange={(e) =>
                        setBoardDraft((p) => (p ? { ...p, dedup_key: e.target.value as DedupKey } : p))
                      }
                      className="ui-field"
                    >
                      {DEDUP_KEY_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 수집 범위(게시일 기준) - API 모드에서는 숨김 */}
                  {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) !== "api" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-bold text-stone-600">수집 범위(게시일 기준)</label>
                      <div className="group relative">
                        <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                        <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-72 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                          <div className="font-bold mb-1.5">수집 범위 설정</div>
                          <div className="text-stone-300 leading-relaxed">
                            게시판에서 수집할 문서의 게시일 범위를 지정합니다. 세 가지 옵션 중 하나를 선택하세요.
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* 옵션 1: 기간 설정 */}
                    <div 
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all cursor-pointer",
                        boardDraft.collection_range?.type === "period"
                          ? "bg-primary/5 border-primary/30"
                          : "bg-white/40 border-white/60 hover:bg-white/60"
                      )}
                      onClick={() => setBoardDraft(p => p ? { ...p, collection_range: { ...p.collection_range, type: p.collection_range?.type === "period" ? "" : "period" } as CollectionRange } : p)}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <input
                          type="checkbox"
                          checked={boardDraft.collection_range?.type === "period"}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-sm font-semibold text-stone-700 whitespace-nowrap">기간 설정 :</span>
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <input
                              type="date"
                              value={boardDraft.collection_range?.period_start || ""}
                              onChange={(e) => { e.stopPropagation(); setBoardDraft(p => p ? { ...p, collection_range: { ...p.collection_range, type: "period", period_start: e.target.value } as CollectionRange } : p); }}
                              onClick={(e) => e.stopPropagation()}
                              className="ui-field text-sm pr-8"
                              style={{ width: "150px" }}
                              disabled={boardDraft.collection_range?.type !== "period"}
                            />
                            <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                          </div>
                          <span className="text-stone-500 font-semibold">~</span>
                          <div className="relative">
                            <input
                              type="date"
                              value={boardDraft.collection_range?.period_end || ""}
                              onChange={(e) => { e.stopPropagation(); setBoardDraft(p => p ? { ...p, collection_range: { ...p.collection_range, type: "period", period_end: e.target.value } as CollectionRange } : p); }}
                              onClick={(e) => e.stopPropagation()}
                              className="ui-field text-sm pr-8"
                              style={{ width: "150px" }}
                              disabled={boardDraft.collection_range?.type !== "period"}
                            />
                            <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* 옵션 2: 상대 일수 */}
                    <div 
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all cursor-pointer",
                        boardDraft.collection_range?.type === "relative"
                          ? "bg-primary/5 border-primary/30"
                          : "bg-white/40 border-white/60 hover:bg-white/60"
                      )}
                      onClick={() => setBoardDraft(p => p ? { ...p, collection_range: { ...p.collection_range, type: p.collection_range?.type === "relative" ? "" : "relative" } as CollectionRange } : p)}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={boardDraft.collection_range?.type === "relative"}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-sm font-semibold text-stone-700 whitespace-nowrap">수집일로부터</span>
                        <select
                          value={boardDraft.collection_range?.relative_days || 30}
                          onChange={(e) => { e.stopPropagation(); setBoardDraft(p => p ? { ...p, collection_range: { ...p.collection_range, type: "relative", relative_days: Number(e.target.value) } as CollectionRange } : p); }}
                          onClick={(e) => e.stopPropagation()}
                          className="ui-field text-sm"
                          style={{ width: "80px" }}
                          disabled={boardDraft.collection_range?.type !== "relative"}
                        >
                          <option value={7}>7</option>
                          <option value={30}>30</option>
                          <option value={90}>90</option>
                          <option value={180}>180</option>
                          <option value={365}>365</option>
                        </select>
                        <span className="text-sm font-semibold text-stone-700 whitespace-nowrap">일 이전까지</span>
                      </div>
                    </div>
                    
                    {/* 옵션 3: 연도 선택 */}
                    <div 
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all cursor-pointer",
                        boardDraft.collection_range?.type === "yearly"
                          ? "bg-primary/5 border-primary/30"
                          : "bg-white/40 border-white/60 hover:bg-white/60"
                      )}
                      onClick={() => setBoardDraft(p => p ? { ...p, collection_range: { ...p.collection_range, type: p.collection_range?.type === "yearly" ? "" : "yearly", years: p.collection_range?.years || [] } as CollectionRange } : p)}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <input
                          type="checkbox"
                          checked={boardDraft.collection_range?.type === "yearly"}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-sm font-semibold text-stone-700 whitespace-nowrap">연도 선택 :</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          {(() => {
                            const currentYear = new Date().getFullYear();
                            return Array.from({ length: 6 }, (_, i) => currentYear - 5 + i).map(year => {
                              const isSelected = boardDraft.collection_range?.years?.includes(year) || false;
                              return (
                                <button
                                  key={year}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBoardDraft(p => {
                                      if (!p) return p;
                                      const currentYears = p.collection_range?.years || [];
                                      const newYears = isSelected 
                                        ? currentYears.filter(y => y !== year)
                                        : [...currentYears, year].sort();
                                      return { ...p, collection_range: { ...p.collection_range, type: "yearly", years: newYears } as CollectionRange };
                                    });
                                  }}
                                  disabled={boardDraft.collection_range?.type !== "yearly"}
                                  className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                    isSelected
                                      ? "bg-primary text-white shadow-md"
                                      : "bg-white/60 text-stone-600 border border-stone-200 hover:bg-white/80",
                                    boardDraft.collection_range?.type !== "yearly" && "opacity-50 cursor-not-allowed"
                                  )}
                                >
                                  {year}
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                  )}

                  {/* 수집 대상 - API 모드에서는 숨김 */}
                  {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) !== "api" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-bold text-stone-600">수집 대상</label>
                      <div className="group relative">
                        <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                        <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-72 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                          <div className="font-bold mb-1.5">수집 대상 설정</div>
                          <div className="text-stone-300 leading-relaxed">
                            목록 URL의 게시판에서 어떤 자료를 수집/추출할지 선택합니다. 중복 선택이 가능합니다.
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* 게시글 제목/본문 */}
                    <div 
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all cursor-pointer",
                        boardDraft.collection_targets?.title_body
                          ? "bg-primary/5 border-primary/30"
                          : "bg-white/40 border-white/60 hover:bg-white/60"
                      )}
                      onClick={() => setBoardDraft(p => p ? { ...p, collection_targets: { ...p.collection_targets!, title_body: !p.collection_targets?.title_body } } : p)}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={boardDraft.collection_targets?.title_body || false}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <div>
                          <span className="text-sm font-semibold text-stone-700">게시글 제목/본문</span>
                          <div className="text-xs text-stone-500 mt-0.5">게시글 제목과 본문에 대한 수집 및 추출</div>
                        </div>
                      </div>
                    </div>
                    
                    {/* 첨부파일 */}
                    <div 
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all",
                        boardDraft.collection_targets?.attachments?.enabled
                          ? "bg-primary/5 border-primary/30"
                          : "bg-white/40 border-white/60"
                      )}
                    >
                      <div 
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => setBoardDraft(p => {
                          if (!p) return p;
                          const newEnabled = !p.collection_targets?.attachments?.enabled;
                          return { 
                            ...p, 
                            collection_targets: { 
                              ...p.collection_targets!, 
                              attachments: { 
                                ...p.collection_targets?.attachments!, 
                                enabled: newEnabled,
                                // 비활성화 시 하위 옵션 초기화
                                ...(newEnabled ? {} : { all: false, hwpx: false, docx: false, xlsx: false, pdf: false })
                              } 
                            } 
                          };
                        })}
                      >
                        <input
                          type="checkbox"
                          checked={boardDraft.collection_targets?.attachments?.enabled || false}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <div>
                          <span className="text-sm font-semibold text-stone-700">첨부파일</span>
                          <div className="text-xs text-stone-500 mt-0.5">첨부파일 수집 (파일 유형별 선택 가능)</div>
                        </div>
                      </div>
                      
                      {boardDraft.collection_targets?.attachments?.enabled && (
                        <div className="mt-3 ml-7 flex items-center gap-2 flex-wrap">
                          {/* 전부 수집 */}
                          <button
                            type="button"
                            onClick={() => setBoardDraft(p => {
                              if (!p) return p;
                              const newAll = !p.collection_targets?.attachments?.all;
                              return { 
                                ...p, 
                                collection_targets: { 
                                  ...p.collection_targets!, 
                                  attachments: { 
                                    ...p.collection_targets?.attachments!, 
                                    all: newAll,
                                    // 전부 수집 선택 시 다른 옵션 해제
                                    ...(newAll ? { hwpx: false, docx: false, xlsx: false, pdf: false } : {})
                                  } 
                                } 
                              };
                            })}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                              boardDraft.collection_targets?.attachments?.all
                                ? "bg-primary text-white shadow-md"
                                : "bg-white/60 text-stone-600 border border-stone-200 hover:bg-white/80"
                            )}
                          >
                            전부 수집
                          </button>
                          
                          {/* 개별 파일 형식 */}
                          {(["hwpx", "docx", "xlsx", "pdf"] as const).map(fileType => (
                            <button
                              key={fileType}
                              type="button"
                              onClick={() => setBoardDraft(p => {
                                if (!p || p.collection_targets?.attachments?.all) return p;
                                return { 
                                  ...p, 
                                  collection_targets: { 
                                    ...p.collection_targets!, 
                                    attachments: { 
                                      ...p.collection_targets?.attachments!, 
                                      [fileType]: !p.collection_targets?.attachments?.[fileType]
                                    } 
                                  } 
                                };
                              })}
                              disabled={boardDraft.collection_targets?.attachments?.all}
                              className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                boardDraft.collection_targets?.attachments?.[fileType]
                                  ? "bg-primary text-white shadow-md"
                                  : "bg-white/60 text-stone-600 border border-stone-200 hover:bg-white/80",
                                boardDraft.collection_targets?.attachments?.all && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              {fileType === "xlsx" ? "xlsx(csv)" : fileType}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  <div className="flex items-center justify-between p-4 rounded-2xl bg-white/50 border border-white/70 lg:col-span-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all",
                          boardDraft.enabled ? "bg-primary border-primary text-white" : "border-stone-300 text-transparent"
                        )}
                      >
                        <Check className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-extrabold text-stone-800">enabled</div>
                        <div className="text-xs text-stone-500">수집 대상 여부</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBoardDraft((p) => (p ? { ...p, enabled: !p.enabled } : p))}
                      className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700"
                    >
                      {boardDraft.enabled ? "비활성화" : "활성화"}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: 모드별 설정 */}
              {wizardStep === 2 && (
                <div className="flex flex-col gap-4">
                  <div className="p-4 rounded-2xl bg-white/40 border border-white/60">
                    <div className="text-sm font-extrabold text-stone-800">모드별 설정</div>
                    <div className="text-xs text-stone-500 mt-1">
                      현재 모드:{" "}
                      <span className="font-bold">{boardDraft.board_mode ?? inferBoardMode(boardDraft)}</span>
                    </div>
                  </div>

                  {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) === "web_scraping" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-stone-600">접근 방식(access_mode)</label>
                        <select
                          value={boardDraft.access_mode}
                          onChange={(e) =>
                            setBoardDraft((p) =>
                              p ? { ...p, access_mode: e.target.value as BoardAccessMode } : p
                            )
                          }
                          className="ui-field"
                        >
                          <option value="static_html">정적 HTML(static_html)</option>
                          <option value="dynamic_js">동적 JS - Playwright(dynamic_js)</option>
                          <option value="login_required">로그인 필요(login_required)</option>
                        </select>
                        
                        {/* 동적 JS 모드일 때 브라우저 설정 표시 */}
                        {boardDraft.access_mode === "dynamic_js" && (
                          <div className="mt-3 p-3 rounded-xl bg-indigo-50/50 border border-indigo-200/50">
                            <div className="text-xs font-bold text-indigo-700 mb-2 flex items-center gap-1.5">
                              <Globe className="w-3.5 h-3.5" />
                              헤드리스 브라우저 설정
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-indigo-600">브라우저</label>
                                <select
                                  value={boardDraft.browser_config?.browser_type || "chromium"}
                                  onChange={(e) =>
                                    setBoardDraft((p) =>
                                      p ? {
                                        ...p,
                                        browser_config: {
                                          ...p.browser_config,
                                          browser_type: e.target.value as "chromium" | "chrome" | "msedge",
                                        },
                                      } : p
                                    )
                                  }
                                  className="ui-field text-xs py-1.5"
                                >
                                  <option value="chromium">Chromium (기본)</option>
                                  <option value="chrome">Chrome (시스템)</option>
                                  <option value="msedge">Edge (시스템)</option>
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-indigo-600">대기 시간(ms)</label>
                                <input
                                  type="number"
                                  value={boardDraft.browser_config?.wait_time || 2000}
                                  onChange={(e) =>
                                    setBoardDraft((p) =>
                                      p ? {
                                        ...p,
                                        browser_config: {
                                          ...p.browser_config,
                                          wait_time: parseInt(e.target.value) || 2000,
                                        },
                                      } : p
                                    )
                                  }
                                  className="ui-field text-xs py-1.5"
                                  min={500}
                                  max={10000}
                                  step={500}
                                />
                              </div>
                            </div>
                            <div className="mt-2 text-[10px] text-indigo-500">
                              💡 동적 JS 모드는 JavaScript로 로드되는 콘텐츠를 Playwright 브라우저로 렌더링합니다.
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-stone-600">목록 URL(list_url)</label>
                        <input
                          value={boardDraft.list_url ?? ""}
                          onChange={(e) =>
                            setBoardDraft((p) => (p ? { ...p, list_url: e.target.value } : p))
                          }
                          className="ui-field"
                          placeholder="https://..."
                        />
                      </div>
                      {/* 게시일 규칙 - LLM 분석 UI */}
                      <div className="lg:col-span-2 p-4 rounded-2xl bg-white/50 border border-white/60">
                        <div className="flex items-center gap-1.5 mb-3">
                          <label className="text-sm font-extrabold text-stone-800">게시일 규칙(published_date_rule)</label>
                          <div className="group relative">
                            <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                            <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-80 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                              <div className="font-bold mb-1.5">게시일 추출 규칙</div>
                              <div className="text-stone-300 leading-relaxed">
                                문서의 게시일(작성일)을 어디서 어떻게 추출할지 정의합니다. 날짜 기반 필터링, 정렬에 사용됩니다.
                              </div>
                              <div className="mt-2 text-stone-400 font-bold">주요 필드:</div>
                              <ul className="mt-1 space-y-1 text-stone-300">
                                <li><span className="font-mono text-amber-400">source</span> - 추출 위치 (<code className="bg-stone-700 px-1 rounded">list</code>: 목록 페이지, <code className="bg-stone-700 px-1 rounded">detail</code>: 상세 페이지)</li>
                                <li><span className="font-mono text-amber-400">selector</span> - CSS 선택자 또는 XPath</li>
                                <li><span className="font-mono text-amber-400">format</span> - 날짜 형식 (예: <code className="bg-stone-700 px-1 rounded">YYYY-MM-DD</code>)</li>
                                <li><span className="font-mono text-amber-400">regex</span> - 정규식으로 날짜 부분 추출 (선택)</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* LLM 분석 결과 */}
                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold text-stone-600">LLM 분석</label>
                            <textarea
                              value={publishedDateRuleText}
                              onChange={(e) => setPublishedDateRuleText(e.target.value)}
                              className="ui-textarea min-h-[120px] font-mono text-xs"
                              placeholder='{ "source": "list", "selector": ".date", "format": "YYYY-MM-DD" }'
                            />
                          </div>
                          
                          {/* 수정 프롬프트 입력 */}
                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold text-stone-600">수정 프롬프트 입력</label>
                            <textarea
                              value={dateRuleRefinePrompt}
                              onChange={(e) => setDateRuleRefinePrompt(e.target.value)}
                              className="ui-textarea min-h-[120px] text-xs"
                              placeholder="예: 날짜가 게시글 제목 옆에 있습니다. 형식은 'YYYY.MM.DD' 입니다."
                            />
                          </div>
                        </div>
                        
                        {/* 버튼 영역 - 오른쪽 정렬 */}
                        <div className="mt-4 flex justify-end">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={analyzeDom}
                              disabled={domAnalyzing || !boardDraft.list_url}
                              className="px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-600/20 flex items-center gap-2"
                            >
                              {domAnalyzing ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  DOM 분석 중...
                                </>
                              ) : (
                                "DOM 분석"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={testDateRule}
                              disabled={dateRuleTesting || !publishedDateRuleText.trim()}
                              className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700 flex items-center gap-2"
                            >
                              {dateRuleTesting ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  테스트 중...
                                </>
                              ) : (
                                "규칙 테스트"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => analyzeDateRuleFromUrl(dateRuleRefinePrompt)}
                              disabled={dateRuleAnalyzing || !boardDraft.list_url || !dateRuleRefinePrompt.trim()}
                              className="px-4 py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center gap-2"
                            >
                              {dateRuleAnalyzing ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  수정 중...
                                </>
                              ) : (
                                "LLM 수정 요청"
                              )}
                            </button>
                          </div>
                        </div>
                        
                        {/* 테스트 결과 */}
                        {dateRuleTestResult && (
                          <div className={cn(
                            "mt-4 p-3 rounded-xl text-sm",
                            dateRuleTestResult.success
                              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                              : "bg-red-50 border border-red-200 text-red-800"
                          )}>
                            <div className="font-bold mb-1">
                              {dateRuleTestResult.success ? "✓ 테스트 성공" : "✗ 테스트 실패"}
                            </div>
                            <div className="text-xs">{dateRuleTestResult.message}</div>
                            {dateRuleTestResult.samples && dateRuleTestResult.samples.length > 0 && (
                              <div className="mt-2 text-xs">
                                <div className="font-semibold mb-1">추출된 날짜 샘플:</div>
                                <div className="flex flex-wrap gap-2">
                                  {dateRuleTestResult.samples.map((s, i) => (
                                    <span key={i} className="px-2 py-1 rounded bg-white/80 font-mono">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* 사이트 구조 분석 결과 */}
                        {siteStructure && (
                          <div className="mt-4 p-3 rounded-xl text-sm bg-blue-50 border border-blue-200 text-blue-800">
                            <div className="font-bold mb-2">📊 사이트 구조 분석 완료</div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div><span className="font-semibold">게시판 유형:</span> {String((siteStructure as Record<string, unknown>).board_type || "미확인")}</div>
                              <div><span className="font-semibold">렌더링:</span> {String((siteStructure as Record<string, unknown>).rendering || "static_html")}</div>
                            </div>
                            {/* 페이지네이션 상세 정보 */}
                            {Boolean((siteStructure as Record<string, unknown>).pagination) && (
                              <div className="mt-2 p-2 rounded-lg bg-blue-100/50 text-xs">
                                <div className="font-semibold mb-1">📄 페이지네이션 분석 결과:</div>
                                <div className="grid grid-cols-2 gap-1">
                                  <div>타입: <span className="font-mono bg-white/70 px-1 rounded">{String(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.type || "none")}</span></div>
                                  {Boolean(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.param) && (
                                    <div>파라미터: <span className="font-mono bg-white/70 px-1 rounded">{String(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.param)}</span></div>
                                  )}
                                  {((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.start !== undefined && (
                                    <div>시작값: <span className="font-mono bg-white/70 px-1 rounded">{String(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.start)}</span></div>
                                  )}
                                  {Boolean(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.step) && (
                                    <div>증가값: <span className="font-mono bg-white/70 px-1 rounded">{String(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.step)}</span></div>
                                  )}
                                  {Boolean(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.max_pages) && (
                                    <div>최대 페이지: <span className="font-mono bg-white/70 px-1 rounded">{String(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.max_pages)}</span></div>
                                  )}
                                </div>
                                {Boolean(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.detected_method) && (
                                  <div className="mt-1 text-blue-600 italic">
                                    ↳ {String(((siteStructure as Record<string, unknown>).pagination as Record<string, unknown>)?.detected_method)}
                                  </div>
                                )}
                              </div>
                            )}
                            {Boolean((siteStructure as Record<string, unknown>).sample_data) && (
                              <div className="mt-2 text-xs">
                                <div className="font-semibold mb-1">샘플 데이터:</div>
                                <div className="flex flex-wrap gap-1">
                                  {(((siteStructure as Record<string, unknown>).sample_data as Record<string, string[]>)?.titles || []).slice(0, 2).map((t: string, i: number) => (
                                    <span key={i} className="px-2 py-0.5 rounded bg-white/80 truncate max-w-[200px]">{t}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* 첨부파일 다운로드 URL 자동 감지 */}
                            <div className="mt-3 pt-3 border-t border-blue-200">
                              <div className="flex items-center justify-between mb-2">
                                <div className="font-semibold text-xs">📎 첨부파일 다운로드 URL</div>
                                <button
                                  type="button"
                                  onClick={detectDownloadUrl}
                                  disabled={detectingDownloadUrl}
                                  className={cn(
                                    "px-2.5 py-1 rounded-lg text-xs font-bold transition-all",
                                    detectingDownloadUrl
                                      ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                                      : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm hover:shadow"
                                  )}
                                >
                                  {detectingDownloadUrl ? (
                                    <span className="flex items-center gap-1">
                                      <span className="animate-spin">⏳</span> 감지 중...
                                    </span>
                                  ) : (
                                    "🔍 자동 감지"
                                  )}
                                </button>
                              </div>
                              {attachmentConfig?.download_url_pattern && (
                                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                                  <div className="font-mono text-emerald-700">{attachmentConfig.download_url_pattern}</div>
                                  {attachmentConfig.detected_download_url && (
                                    <div className="mt-1 text-emerald-600 text-[10px] truncate">
                                      예: {attachmentConfig.detected_download_url}
                                    </div>
                                  )}
                                </div>
                              )}
                              {!attachmentConfig?.download_url_pattern && (
                                <div className="text-[10px] text-blue-600">
                                  💡 자동 감지 버튼을 클릭하면 헤드리스 브라우저로 실제 다운로드 URL을 분석합니다.
                                </div>
                              )}
                              {downloadUrlDetectionLog && (
                                <details className="mt-2">
                                  <summary className="text-[10px] text-blue-500 cursor-pointer hover:text-blue-700">감지 로그 보기</summary>
                                  <pre className="mt-1 p-2 rounded bg-white/70 text-[9px] font-mono max-h-32 overflow-auto whitespace-pre-wrap">{downloadUrlDetectionLog}</pre>
                                </details>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 사이트 내 검색 옵션 - DOM 분석으로 감지된 검색 필터 */}
                      {siteSearchConfig && siteSearchConfig.options.length > 0 && (
                        <div className="lg:col-span-2 p-4 rounded-2xl bg-gradient-to-br from-amber-50/80 to-orange-50/80 border border-amber-200/60">
                          <div className="flex items-center gap-1.5 mb-3">
                            <label className="text-sm font-extrabold text-amber-900">🔍 사이트 내 검색 옵션</label>
                            <div className="group relative">
                              <HelpCircle className="w-3.5 h-3.5 text-amber-600 cursor-help" />
                              <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-80 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                                <div className="font-bold mb-1.5">사이트 내 검색 옵션</div>
                                <div className="text-stone-300 leading-relaxed">
                                  DOM 분석을 통해 감지된 사이트 내 검색 필터입니다. 소관부처, 법령종류, 키워드 검색 등의 옵션을 설정하여 특정 조건의 게시물만 수집할 수 있습니다.
                                </div>
                                <div className="mt-2 text-stone-400 font-bold">사용 예시:</div>
                                <ul className="mt-1 space-y-1 text-stone-300">
                                  <li>• 소관부처를 "기후에너지환경부"로 선택하여 해당 부처 입법예고만 수집</li>
                                  <li>• 키워드 검색으로 특정 주제의 게시물만 필터링</li>
                                </ul>
                              </div>
                            </div>
                            <span className="ml-auto text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-bold">
                              {siteSearchConfig.options.length}개 옵션 감지됨
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {siteSearchConfig.options.map((opt, idx) => (
                              <div key={idx} className="p-3 rounded-xl bg-white/70 border border-amber-200/50">
                                <label className="text-xs font-bold text-amber-800 mb-1.5 flex items-center gap-2">
                                  <span className={cn(
                                    "w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold",
                                    opt.type === "select" && "bg-blue-100 text-blue-700",
                                    opt.type === "text" && "bg-emerald-100 text-emerald-700",
                                    opt.type === "date" && "bg-purple-100 text-purple-700",
                                    opt.type === "radio" && "bg-orange-100 text-orange-700",
                                    opt.type === "checkbox" && "bg-pink-100 text-pink-700"
                                  )}>
                                    {opt.type === "select" && "▼"}
                                    {opt.type === "text" && "T"}
                                    {opt.type === "date" && "📅"}
                                    {opt.type === "radio" && "○"}
                                    {opt.type === "checkbox" && "☑"}
                                  </span>
                                  {opt.label}
                                </label>
                                
                                {opt.type === "select" && opt.options && (
                                  <select
                                    value={opt.selected_value || opt.default_value || ""}
                                    onChange={(e) => {
                                      setSiteSearchConfig((prev) => {
                                        if (!prev) return prev;
                                        const newOptions = [...prev.options];
                                        newOptions[idx] = { ...newOptions[idx], selected_value: e.target.value };
                                        return { ...prev, options: newOptions };
                                      });
                                    }}
                                    className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                  >
                                    {opt.options.map((o, oIdx) => (
                                      <option key={oIdx} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                
                                {opt.type === "text" && (
                                  <input
                                    type="text"
                                    value={opt.selected_value || ""}
                                    onChange={(e) => {
                                      setSiteSearchConfig((prev) => {
                                        if (!prev) return prev;
                                        const newOptions = [...prev.options];
                                        newOptions[idx] = { ...newOptions[idx], selected_value: e.target.value };
                                        return { ...prev, options: newOptions };
                                      });
                                    }}
                                    placeholder={opt.placeholder || "검색어 입력..."}
                                    className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                  />
                                )}
                                
                                {opt.type === "date" && (
                                  <input
                                    type="date"
                                    value={opt.selected_value || ""}
                                    onChange={(e) => {
                                      setSiteSearchConfig((prev) => {
                                        if (!prev) return prev;
                                        const newOptions = [...prev.options];
                                        newOptions[idx] = { ...newOptions[idx], selected_value: e.target.value };
                                        return { ...prev, options: newOptions };
                                      });
                                    }}
                                    className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                  />
                                )}
                                
                                {opt.type === "radio" && opt.options && (
                                  <div className="flex flex-wrap gap-2 mt-1">
                                    {opt.options.map((o, oIdx) => (
                                      <label key={oIdx} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`site-search-${opt.name}`}
                                          value={o.value}
                                          checked={(opt.selected_value || opt.default_value) === o.value}
                                          onChange={(e) => {
                                            setSiteSearchConfig((prev) => {
                                              if (!prev) return prev;
                                              const newOptions = [...prev.options];
                                              newOptions[idx] = { ...newOptions[idx], selected_value: e.target.value };
                                              return { ...prev, options: newOptions };
                                            });
                                          }}
                                          className="accent-amber-600"
                                        />
                                        {o.label}
                                      </label>
                                    ))}
                                  </div>
                                )}
                                
                                <div className="mt-1.5 text-[10px] text-amber-600 font-mono truncate" title={opt.selector}>
                                  {opt.name && <span className="bg-amber-100 px-1 rounded mr-1">{opt.name}</span>}
                                  {opt.selector}
                                </div>
                              </div>
                            ))}
                          </div>
                          
                          <div className="mt-3 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                // 모든 옵션 초기화
                                setSiteSearchConfig((prev) => {
                                  if (!prev) return prev;
                                  const newOptions = prev.options.map((opt) => ({
                                    ...opt,
                                    selected_value: opt.default_value || "",
                                  }));
                                  return { ...prev, options: newOptions };
                                });
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 transition-colors"
                            >
                              초기화
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {/* web_config - LLM 분석 UI */}
                      <div className="lg:col-span-2 p-4 rounded-2xl bg-white/50 border border-white/60">
                        <div className="flex items-center gap-1.5 mb-3">
                          <label className="text-sm font-extrabold text-stone-800">web_config (JSON)</label>
                          <div className="group relative">
                            <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                            <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-80 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                              <div className="font-bold mb-1.5">웹 스크래핑 설정</div>
                              <div className="text-stone-300 leading-relaxed">
                                목록/상세 페이지에서 데이터를 추출하기 위한 파싱 규칙을 정의합니다.
                              </div>
                              <div className="mt-2 text-stone-400 font-bold">주요 필드:</div>
                              <ul className="mt-1 space-y-1 text-stone-300">
                                <li><span className="font-mono text-amber-400">parse_rules</span> - 제목, 날짜, 본문 등 선택자</li>
                                <li><span className="font-mono text-amber-400">pagination</span> - 페이지네이션 방식</li>
                                <li><span className="font-mono text-amber-400">rendering</span> - 렌더링 방식 (static/dynamic)</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* LLM 분석 결과 */}
                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold text-stone-600">LLM 분석</label>
                            <textarea
                              value={webConfigText}
                              onChange={(e) => setWebConfigText(e.target.value)}
                              className="ui-textarea min-h-[180px] font-mono text-xs"
                              placeholder='{ "parse_rules": { "title": ".subject", "date": ".date" }, "pagination": { "type": "page_param", "param": "page" } }'
                            />
                          </div>
                          
                          {/* 수정 프롬프트 입력 */}
                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold text-stone-600">수정 프롬프트 입력</label>
                            <textarea
                              value={webConfigRefinePrompt}
                              onChange={(e) => setWebConfigRefinePrompt(e.target.value)}
                              className="ui-textarea min-h-[180px] text-xs"
                              placeholder="예: 게시판이 테이블 구조입니다. tr 태그 안에 제목, 날짜, 작성자가 있습니다. 페이지네이션은 'page' 파라미터를 사용합니다."
                            />
                          </div>
                        </div>
                        
                        {/* 버튼 영역 - 오른쪽 정렬 */}
                        <div className="mt-4 flex justify-end">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => generateWebConfig()}
                              disabled={webConfigGenerating || !boardDraft.list_url || !siteStructure}
                              className="px-4 py-2.5 rounded-xl text-sm font-bold bg-stone-900 text-white hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-stone-900/20 flex items-center gap-2"
                              title={!siteStructure ? "먼저 'DOM 분석'을 실행하세요" : ""}
                            >
                              {webConfigGenerating ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  생성 중...
                                </>
                              ) : (
                                "config 생성"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={testWebConfig}
                              disabled={webConfigTesting || !webConfigText.trim() || !boardDraft.list_url}
                              className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700 flex items-center gap-2"
                            >
                              {webConfigTesting ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  테스트 중...
                                </>
                              ) : (
                                "정합성 테스트"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                // 정합성 테스트 실패 시 오류 로그 자동 포함
                                let prompt = webConfigRefinePrompt;
                                if (webConfigTestResult && !webConfigTestResult.success && webConfigTestResult.details) {
                                  const errorLog = webConfigTestResult.details.join("\n");
                                  if (errorLog) {
                                    prompt = `[정합성 테스트 오류]\n${errorLog}\n\n위 오류를 해결하도록 선택자를 수정해주세요.${prompt ? `\n\n[추가 요청]\n${prompt}` : ""}`;
                                  }
                                }
                                generateWebConfig(prompt || "정합성 테스트에서 실패한 선택자들을 수정해주세요.");
                              }}
                              disabled={webConfigGenerating || !boardDraft.list_url || (!webConfigRefinePrompt.trim() && !(webConfigTestResult && !webConfigTestResult.success))}
                              className="px-4 py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center gap-2"
                              title={webConfigTestResult && !webConfigTestResult.success ? "테스트 실패 오류를 LLM에 전달하여 수정합니다" : ""}
                            >
                              {webConfigGenerating ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  수정 중...
                                </>
                              ) : webConfigTestResult && !webConfigTestResult.success ? (
                                "오류 기반 LLM 수정"
                              ) : (
                                "LLM 수정 요청"
                              )}
                            </button>
                          </div>
                        </div>
                        
                        {/* 테스트 결과 */}
                        {webConfigTestResult && (
                          <div className={cn(
                            "mt-4 p-3 rounded-xl text-sm",
                            webConfigTestResult.success
                              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                              : "bg-red-50 border border-red-200 text-red-800"
                          )}>
                            <div className="font-bold mb-1">
                              {webConfigTestResult.success ? "✓ 정합성 테스트 성공" : "✗ 정합성 테스트 실패"}
                            </div>
                            <div className="text-xs">{webConfigTestResult.message}</div>
                            {webConfigTestResult.details && webConfigTestResult.details.length > 0 && (
                              <div className="mt-2 text-xs">
                                <div className="font-semibold mb-1">상세 결과:</div>
                                <ul className="space-y-1 list-disc list-inside">
                                  {webConfigTestResult.details.map((d, i) => (
                                    <li key={i}>{d}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 외부 상세 링크 스크래핑 설정 */}
                      <div className="lg:col-span-2 p-4 rounded-2xl bg-white/50 border border-white/60">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-1.5">
                            <label className="text-sm font-extrabold text-stone-800">외부 링크 스크래핑</label>
                            <div className="group relative">
                              <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                              <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-80 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                                <div className="font-bold mb-1.5">외부 링크 스크래핑</div>
                                <div className="text-stone-300 leading-relaxed">
                                  게시글 상세 페이지에 외부 사이트 링크가 있고, 해당 외부 페이지에서 본문과 첨부파일을 수집해야 하는 경우 사용합니다.
                                </div>
                                <div className="mt-2 text-stone-400 font-bold">예시:</div>
                                <ul className="mt-1 space-y-1 text-stone-300">
                                  <li>환경부 고시·훈령·예규 → 국가법령정보센터 링크</li>
                                  <li>정부 부처 게시판 → 법령정보센터 링크</li>
                                </ul>
                              </div>
                            </div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={externalDetailEnabled}
                              onChange={(e) => setExternalDetailEnabled(e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </div>

                        {externalDetailEnabled && (
                          <div className="space-y-3">
                            {/* 외부 링크 선택자 */}
                            <div>
                              <label className="text-xs font-bold text-stone-600 mb-1 block">외부 링크 CSS 선택자</label>
                              <input
                                type="text"
                                value={externalDetailUrlSelector}
                                onChange={(e) => setExternalDetailUrlSelector(e.target.value)}
                                className="ui-input text-xs font-mono w-full"
                                placeholder="예: a[href*='law.go.kr/DRF'], a.external-link"
                              />
                              <div className="text-[10px] text-stone-400 mt-0.5">상세 페이지에서 외부 링크를 찾을 CSS 선택자</div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                              {/* 처리 모드 */}
                              <div>
                                <label className="text-xs font-bold text-stone-600 mb-1 block">처리 모드</label>
                                <select
                                  value={externalDetailMode}
                                  onChange={(e) => setExternalDetailMode(e.target.value as "html" | "api_xml")}
                                  className="ui-input text-xs w-full"
                                >
                                  <option value="html">HTML 파싱</option>
                                  <option value="api_xml">API XML 파싱</option>
                                </select>
                              </div>

                              {/* 본문 선택자 */}
                              <div>
                                <label className="text-xs font-bold text-stone-600 mb-1 block">본문 CSS 선택자</label>
                                <input
                                  type="text"
                                  value={externalDetailContentSelector}
                                  onChange={(e) => setExternalDetailContentSelector(e.target.value)}
                                  className="ui-input text-xs font-mono w-full"
                                  placeholder="예: .view_con, article, #content"
                                />
                              </div>
                            </div>

                            {/* 첨부파일 선택자 */}
                            <div>
                              <label className="text-xs font-bold text-stone-600 mb-1 block">첨부파일 CSS 선택자</label>
                              <input
                                type="text"
                                value={externalDetailAttachmentsSelector}
                                onChange={(e) => setExternalDetailAttachmentsSelector(e.target.value)}
                                className="ui-input text-xs font-mono w-full"
                                placeholder="예: a[href*='flDownload'], a[href*='download']"
                              />
                              <div className="text-[10px] text-stone-400 mt-0.5">외부 페이지에서 첨부파일 다운로드 링크를 찾을 선택자 (비워두면 기본 선택자 사용)</div>
                            </div>

                            {/* URL 변환 설정 */}
                            <div className="p-3 rounded-xl bg-stone-50/50 border border-stone-200/50">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                  <label className="text-xs font-bold text-stone-600">URL 변환</label>
                                  <div className="group relative">
                                    <HelpCircle className="w-3 h-3 text-stone-400 cursor-help" />
                                    <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-72 p-2.5 rounded-xl bg-stone-900 text-white text-[10px] shadow-lg">
                                      외부 링크 URL을 다른 형태로 변환해야 할 때 사용합니다.
                                      예: DRF API URL에서 ID를 추출하여 공개 웹 페이지 URL로 변환
                                    </div>
                                  </div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={externalDetailUrlTransformEnabled}
                                    onChange={(e) => setExternalDetailUrlTransformEnabled(e.target.checked)}
                                    className="sr-only peer"
                                  />
                                  <div className="w-8 h-4 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                              </div>

                              {externalDetailUrlTransformEnabled && (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] font-semibold text-stone-500 mb-0.5 block">추출 파라미터</label>
                                    <input
                                      type="text"
                                      value={externalDetailExtractParam}
                                      onChange={(e) => setExternalDetailExtractParam(e.target.value)}
                                      className="ui-input text-xs font-mono w-full"
                                      placeholder="예: ID, admRulSeq"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-semibold text-stone-500 mb-0.5 block">변환 URL 템플릿</label>
                                    <input
                                      type="text"
                                      value={externalDetailTemplate}
                                      onChange={(e) => setExternalDetailTemplate(e.target.value)}
                                      className="ui-input text-xs font-mono w-full"
                                      placeholder="예: https://www.law.go.kr/LSW/admRulInfoR.do?admRulSeq={ID}"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) === "api" && (
                    <div className="flex flex-col gap-5">
                      {/* 엔드포인트 선택 (복수 선택 가능) */}
                      <div className="p-4 rounded-2xl bg-white/50 border border-white/60">
                        <div className="flex items-center gap-1.5 mb-3">
                          <div className="text-xs font-extrabold text-stone-700">엔드포인트 선택</div>
                          <div className="group relative">
                            <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                            <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-72 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                              <div className="font-bold mb-1.5">복수 엔드포인트 선택</div>
                              <div className="text-stone-300 leading-relaxed">
                                연관된 엔드포인트를 함께 선택할 수 있습니다.
                                <br />예: &quot;목록 조회&quot; + &quot;본문 조회&quot;를 함께 선택하면 목록에서 ID를 가져와 본문을 조회하는 파이프라인 구성이 가능합니다.
                              </div>
                              <div className="mt-2 text-amber-400 text-[10px]">
                                * 첫 번째 선택 = 주 엔드포인트(Primary), 나머지 = 보조 엔드포인트(Secondary)
                              </div>
                            </div>
                          </div>
                        </div>
                        {selectedOrgApiEndpoints.length === 0 ? (
                          <div className="text-sm text-amber-700 bg-amber-50/80 p-3 rounded-xl">
                            ⚠️ 선택된 기관에 api_profile이 없습니다. 먼저 기관 상세에서 &quot;API 초기 세팅&quot;을 완료하세요.
                          </div>
                        ) : (
                          <>
                            {/* 주 엔드포인트 선택 */}
                            <div className="mb-3">
                              <label className="text-[10px] text-stone-500 font-bold">주 엔드포인트 (Primary)</label>
                              <select
                                value={apiEndpointIdx}
                                onChange={(e) => handleApiEndpointSelect(Number(e.target.value))}
                                className="ui-field w-full mt-1"
                              >
                                <option value={-1}>-- 엔드포인트 선택 --</option>
                                {selectedOrgApiEndpoints.map((ep: any, i: number) => (
                                  <option key={i} value={i}>
                                    {ep.name ?? ep.path} ({ep.path})
                                  </option>
                                ))}
                              </select>
                            </div>
                            {/* 보조 엔드포인트 (드롭다운, 1개만 선택 가능) */}
                            {apiEndpointIdx >= 0 && selectedOrgApiEndpoints.length > 1 && (
                              <div className="mt-3">
                                <label className="text-[10px] text-stone-500 font-bold">보조 엔드포인트 (Secondary) - 선택사항 (최대 1개)</label>
                                <select
                                  value={apiSecondaryEndpointIdx}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setApiSecondaryEndpointIdx(val);
                                    // 보조 엔드포인트의 파라미터 초기화
                                    if (val >= 0) {
                                      const ep = selectedOrgApiEndpoints[val];
                                      const reqParams = ep?.request_params ?? [];
                                      setApiParamsSecondary(reqParams.map((p: any) => ({ name: p.name, enabled: true, value: "" })));
                                    } else {
                                      setApiParamsSecondary([]);
                                      setApiSelectedFieldsSecondary([]);
                                    }
                                  }}
                                  className="ui-field w-full mt-1"
                                >
                                  <option value={-1}>-- 보조 엔드포인트 선택 안 함 --</option>
                                  {selectedOrgApiEndpoints.map((ep: any, i: number) => {
                                    if (i === apiEndpointIdx) return null; // 주 엔드포인트는 제외
                                    return (
                                      <option key={i} value={i}>
                                        {ep.name ?? ep.path} ({ep.path})
                                      </option>
                                    );
                                  })}
                                </select>
                                {apiSecondaryEndpointIdx >= 0 && (
                                  <div className="mt-2 text-[10px] text-primary font-semibold">
                                    ✓ 보조 엔드포인트 선택됨: {selectedOrgApiEndpoints[apiSecondaryEndpointIdx]?.name}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 2단계 호출 설정 (보조 엔드포인트 선택 시 표시) */}
                            {apiEndpointIdx >= 0 && apiSecondaryEndpointIdx >= 0 && (
                              <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-amber-50/80 to-orange-50/60 border border-amber-200/60">
                                <div className="flex items-center gap-3 mb-3">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={apiTwoPhaseConfig.enabled}
                                      onChange={(e) =>
                                        setApiTwoPhaseConfig((prev) => ({ ...prev, enabled: e.target.checked }))
                                      }
                                      className="w-4 h-4 text-primary rounded border-stone-300"
                                    />
                                    <span className="text-sm font-bold text-amber-800">2단계 호출 활성화</span>
                                  </label>
                                  <span className="text-[10px] text-amber-600 bg-amber-100/80 px-2 py-0.5 rounded-full">
                                    보조(목록) → 주(본문) 순서로 호출
                                  </span>
                                </div>
                                
                                {apiTwoPhaseConfig.enabled && (
                                  <div className="space-y-4">
                                    <p className="text-[11px] text-amber-700 leading-relaxed">
                                      <strong>보조 엔드포인트(목록)</strong>를 먼저 호출하여 ID/일련번호를 얻고,<br/>
                                      해당 값을 <strong>주 엔드포인트(본문)</strong>의 요청 파라미터로 전달합니다.
                                    </p>

                                    {/* 키워드별 순차 검색 옵션 */}
                                    {apiSearchFiltersPrimary.enabled && apiSearchFiltersPrimary.filters.length > 0 && (
                                      <div className="p-3 bg-green-50/80 rounded-lg border border-green-200/60">
                                        <div className="flex items-center gap-3 mb-2">
                                          <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={apiTwoPhaseConfig.use_filter_keywords}
                                              onChange={(e) =>
                                                setApiTwoPhaseConfig((prev) => ({ ...prev, use_filter_keywords: e.target.checked }))
                                              }
                                              className="w-4 h-4 text-green-600 rounded border-stone-300"
                                            />
                                            <span className="text-xs font-bold text-green-800">키워드별 순차 검색</span>
                                          </label>
                                          <span className="text-[9px] text-green-600 bg-green-100/80 px-1.5 py-0.5 rounded">
                                            검색필터 키워드로 각각 검색
                                          </span>
                                        </div>
                                        {apiTwoPhaseConfig.use_filter_keywords && (
                                          <div className="mt-2 space-y-2">
                                            <p className="text-[10px] text-green-700 leading-relaxed">
                                              검색 필터의 각 키워드를 보조 엔드포인트의 <code className="bg-green-100 px-1 rounded">query</code> 파라미터로 사용하여 순차 검색합니다.
                                            </p>
                                            <div className="flex items-center gap-2">
                                              <span className="text-[10px] text-green-700">Query 파라미터명:</span>
                                              <input
                                                type="text"
                                                value={apiTwoPhaseConfig.query_param_name}
                                                onChange={(e) =>
                                                  setApiTwoPhaseConfig((prev) => ({ ...prev, query_param_name: e.target.value }))
                                                }
                                                className="text-xs px-2 py-1 rounded border border-green-200 bg-white/80 w-24"
                                                placeholder="query"
                                              />
                                            </div>
                                            <div className="text-[9px] text-green-600 bg-green-100/60 p-2 rounded">
                                              <strong>검색할 키워드:</strong>
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {apiSearchFiltersPrimary.filters.flatMap(f => f.keywords).map((kw, i) => (
                                                  <span key={i} className="bg-white/80 px-1.5 py-0.5 rounded text-green-800">
                                                    &quot;{kw.slice(0, 15)}{kw.length > 15 ? "..." : ""}&quot;
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Primary 검색필터 → Secondary 필드 매핑 */}
                                    {apiSearchFiltersPrimary.enabled && apiSearchFiltersPrimary.filters.length > 0 && !apiTwoPhaseConfig.use_filter_keywords && (
                                      <div className="p-3 bg-blue-50/80 rounded-lg border border-blue-200/60">
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-xs font-bold text-blue-800">Primary 검색필터 → Secondary 필드 (결과 필터링)</span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setApiTwoPhaseConfig((prev) => ({
                                                ...prev,
                                                filter_mappings: [...prev.filter_mappings, { primary_filter_idx: -1, secondary_field: "" }],
                                              }))
                                            }
                                            className="text-[10px] px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                                          >
                                            + 필터 매핑 추가
                                          </button>
                                        </div>
                                        <p className="text-[10px] text-blue-600 mb-2">
                                          보조 엔드포인트 결과에서 검색필터 키워드로 필터링합니다. (키워드별 순차 검색과 함께 사용 불가)
                                        </p>
                                        
                                        {apiTwoPhaseConfig.filter_mappings.length === 0 ? (
                                          <p className="text-[10px] text-blue-500 py-2 bg-blue-100/50 rounded px-2">
                                            검색필터 매핑이 없습니다. 목록에서 특정 조건으로 필터링하려면 매핑을 추가하세요.
                                          </p>
                                        ) : (
                                          <div className="space-y-2">
                                            {apiTwoPhaseConfig.filter_mappings.map((fm, idx) => (
                                              <div key={idx} className="flex items-center gap-2">
                                                {/* 주 엔드포인트 검색필터 선택 */}
                                                <select
                                                  value={fm.primary_filter_idx}
                                                  onChange={(e) => {
                                                    const newFilterMappings = [...apiTwoPhaseConfig.filter_mappings];
                                                    newFilterMappings[idx] = { ...newFilterMappings[idx], primary_filter_idx: Number(e.target.value) };
                                                    setApiTwoPhaseConfig((prev) => ({ ...prev, filter_mappings: newFilterMappings }));
                                                  }}
                                                  className="flex-1 text-xs px-2 py-1.5 rounded-md border border-blue-200/60 bg-white/80"
                                                >
                                                  <option value={-1}>Primary 검색필터 선택</option>
                                                  {apiSearchFiltersPrimary.filters.map((f, fi) => (
                                                    <option key={fi} value={fi}>
                                                      {f.field.slice(0, 15)}{f.field.length > 15 ? "..." : ""}: {f.keywords.slice(0, 2).map(k => k.slice(0, 10) + (k.length > 10 ? "..." : "")).join(", ")}{f.keywords.length > 2 ? ` 외 ${f.keywords.length - 2}개` : ""}
                                                    </option>
                                                  ))}
                                                </select>

                                                <span className="text-blue-600 font-bold">→</span>

                                                {/* 보조 엔드포인트 필드 선택 */}
                                                <select
                                                  value={fm.secondary_field}
                                                  onChange={(e) => {
                                                    const newFilterMappings = [...apiTwoPhaseConfig.filter_mappings];
                                                    newFilterMappings[idx] = { ...newFilterMappings[idx], secondary_field: e.target.value };
                                                    setApiTwoPhaseConfig((prev) => ({ ...prev, filter_mappings: newFilterMappings }));
                                                  }}
                                                  className="flex-1 text-xs px-2 py-1.5 rounded-md border border-blue-200/60 bg-white/80"
                                                >
                                                  <option value="">Secondary 필드 선택</option>
                                                  {secondaryResponseFields.map((f: any, fi: number) => (
                                                    <option key={fi} value={f.name}>
                                                      {f.name_ko || f.name} {f.name_ko ? `(${f.name})` : ""}
                                                    </option>
                                                  ))}
                                                </select>

                                                {/* 삭제 버튼 */}
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const newFilterMappings = apiTwoPhaseConfig.filter_mappings.filter((_, i) => i !== idx);
                                                    setApiTwoPhaseConfig((prev) => ({ ...prev, filter_mappings: newFilterMappings }));
                                                  }}
                                                  className="text-red-400 hover:text-red-600 p-1"
                                                >
                                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                  </svg>
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Secondary 필드 → Primary 파라미터 매핑 */}
                                    <div className="p-3 bg-white/70 rounded-lg border border-amber-200/40">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-amber-800">Secondary 필드 → Primary 파라미터 매핑</span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setApiTwoPhaseConfig((prev) => ({
                                              ...prev,
                                              field_mappings: [...prev.field_mappings, { source_field: "", target_param: "" }],
                                            }))
                                          }
                                          className="text-[10px] px-2 py-1 bg-amber-500 text-white rounded-md hover:bg-amber-600 transition-colors"
                                        >
                                          + 매핑 추가
                                        </button>
                                      </div>
                                      
                                      {apiTwoPhaseConfig.field_mappings.length === 0 ? (
                                        <p className="text-[10px] text-amber-600 py-2">
                                          매핑이 없습니다. &quot;+ 매핑 추가&quot; 버튼을 클릭하세요.
                                        </p>
                                      ) : (
                                        <div className="space-y-2">
                                          {apiTwoPhaseConfig.field_mappings.map((mapping, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                              {/* 보조 엔드포인트 응답 필드 선택 */}
                                              <select
                                                value={mapping.source_field}
                                                onChange={(e) => {
                                                  const newMappings = [...apiTwoPhaseConfig.field_mappings];
                                                  newMappings[idx] = { ...newMappings[idx], source_field: e.target.value };
                                                  setApiTwoPhaseConfig((prev) => ({ ...prev, field_mappings: newMappings }));
                                                }}
                                                className="flex-1 text-xs px-2 py-1.5 rounded-md border border-amber-200/60 bg-white/80"
                                              >
                                                <option value="">Secondary 응답 필드 선택</option>
                                                {secondaryResponseFields.map((f: any, fi: number) => (
                                                  <option key={fi} value={f.name}>
                                                    {f.name_ko || f.name} {f.name_ko ? `(${f.name})` : ""}
                                                  </option>
                                                ))}
                                              </select>

                                              <span className="text-amber-600 font-bold">→</span>

                                              {/* 주 엔드포인트 요청 파라미터 선택 */}
                                              <select
                                                value={mapping.target_param}
                                                onChange={(e) => {
                                                  const newMappings = [...apiTwoPhaseConfig.field_mappings];
                                                  newMappings[idx] = { ...newMappings[idx], target_param: e.target.value };
                                                  setApiTwoPhaseConfig((prev) => ({ ...prev, field_mappings: newMappings }));
                                                }}
                                                className="flex-1 text-xs px-2 py-1.5 rounded-md border border-amber-200/60 bg-white/80"
                                              >
                                                <option value="">Primary 요청 파라미터 선택</option>
                                                {primaryRequestParams.map((p: any, pi: number) => (
                                                  <option key={pi} value={p.name}>
                                                    {p.name} {p.description ? `- ${p.description}` : ""}
                                                  </option>
                                                ))}
                                              </select>

                                              {/* 삭제 버튼 */}
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const newMappings = apiTwoPhaseConfig.field_mappings.filter((_, i) => i !== idx);
                                                  setApiTwoPhaseConfig((prev) => ({ ...prev, field_mappings: newMappings }));
                                                }}
                                                className="text-red-400 hover:text-red-600 p-1"
                                              >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    {/* 호출 제한 설정 */}
                                    <div className="grid grid-cols-2 gap-3">
                                      <div>
                                        <label className="text-[10px] text-amber-700 font-semibold">
                                          목록 최대 조회 건수
                                        </label>
                                        <input
                                          type="number"
                                          value={apiTwoPhaseConfig.max_list_items}
                                          onChange={(e) =>
                                            setApiTwoPhaseConfig((prev) => ({
                                              ...prev,
                                              max_list_items: Number(e.target.value) || 100,
                                            }))
                                          }
                                          min={1}
                                          max={1000}
                                          className="w-full mt-1 text-xs px-2 py-1.5 rounded-md border border-amber-200/60 bg-white/80"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-amber-700 font-semibold">
                                          본문 최대 조회 건수
                                        </label>
                                        <input
                                          type="number"
                                          value={apiTwoPhaseConfig.max_detail_items}
                                          onChange={(e) =>
                                            setApiTwoPhaseConfig((prev) => ({
                                              ...prev,
                                              max_detail_items: Number(e.target.value) || 10,
                                            }))
                                          }
                                          min={1}
                                          max={100}
                                          className="w-full mt-1 text-xs px-2 py-1.5 rounded-md border border-amber-200/60 bg-white/80"
                                        />
                                      </div>
                                    </div>

                                    {/* 호출 순서 안내 */}
                                    <div className="text-[10px] text-amber-700 bg-amber-100/60 px-3 py-2 rounded-lg">
                                      <strong>호출 순서:</strong><br/>
                                      1. 보조 엔드포인트 ({selectedOrgApiEndpoints[apiSecondaryEndpointIdx]?.name}) 호출<br/>
                                      2. 응답에서 매핑된 필드 값 추출<br/>
                                      3. 추출된 값을 주 엔드포인트 ({selectedOrgApiEndpoints[apiEndpointIdx]?.name}) 파라미터로 전달
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                        {apiEndpointIdx >= 0 && selectedOrgApiEndpoints[apiEndpointIdx] && (
                          <div className="mt-3 text-xs text-stone-500">
                            <span className="font-mono bg-stone-200/60 px-1.5 py-0.5 rounded">
                              {selectedOrgApiEndpoints[apiEndpointIdx].method ?? "GET"}{" "}
                              {selectedOrgApiEndpoints[apiEndpointIdx].path}
                            </span>
                            {selectedOrgApiEndpoints[apiEndpointIdx].description && (
                              <span className="ml-2">{selectedOrgApiEndpoints[apiEndpointIdx].description}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 엔드포인트별 설정 탭 */}
                      {apiEndpointIdx >= 0 && (
                        <div className="p-4 rounded-2xl bg-white/50 border border-white/60">
                          {/* 탭 바 */}
                          <div className="flex gap-2 mb-4 border-b border-stone-200/60 pb-3">
                            <button
                              type="button"
                              onClick={() => setApiSettingsTab(0)}
                              className={cn(
                                "px-4 py-2 rounded-t-lg text-sm font-bold transition-all",
                                apiSettingsTab === 0
                                  ? "bg-primary text-white shadow-lg shadow-primary/20"
                                  : "bg-white/60 text-stone-600 hover:bg-white/80"
                              )}
                            >
                              주 엔드포인트
                              <span className="ml-1 text-[10px] opacity-70">
                                ({selectedOrgApiEndpoints[apiEndpointIdx]?.name?.slice(0, 10) ?? "Primary"}...)
                              </span>
                            </button>
                            {apiSecondaryEndpointIdx >= 0 && (
                              <button
                                type="button"
                                onClick={() => setApiSettingsTab(1)}
                                className={cn(
                                  "px-4 py-2 rounded-t-lg text-sm font-bold transition-all",
                                  apiSettingsTab === 1
                                    ? "bg-primary text-white shadow-lg shadow-primary/20"
                                    : "bg-white/60 text-stone-600 hover:bg-white/80"
                                )}
                              >
                                보조 엔드포인트
                                <span className="ml-1 text-[10px] opacity-70">
                                  ({selectedOrgApiEndpoints[apiSecondaryEndpointIdx]?.name?.slice(0, 10) ?? "Secondary"}...)
                                </span>
                              </button>
                            )}
                          </div>

                          {/* 호출 파라미터 (요청 변수) */}
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-1.5">
                                <div className="text-xs font-extrabold text-stone-700">호출 파라미터 (요청 변수)</div>
                                <div className="group relative">
                                  <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                                  <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-72 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                                    <div className="font-bold mb-1.5">호출 파라미터 설정</div>
                                    <div className="text-stone-300 leading-relaxed">
                                      API 호출 시 전달할 요청 변수입니다. 체크를 해제하면 해당 파라미터가 호출에서 제외됩니다.
                                    </div>
                                    <div className="mt-2 text-[10px] text-stone-400">
                                      * api_profile에서 정의된 모든 요청 변수가 표시됩니다.
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {currentRequestParams.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const ep = selectedOrgApiEndpoints[apiSettingsTab === 0 ? apiEndpointIdx : apiSecondaryEndpointIdx];
                                      const newConfig = currentRequestParams.map((param) => {
                                        const isFixed = ep?.fixed_params && param.name in ep.fixed_params;
                                        const existing = currentParamsConfig.find((c) => c.name === param.name);
                                        return { name: param.name, enabled: isFixed ? (existing?.enabled ?? true) : true, value: existing?.value ?? "" };
                                      });
                                      setCurrentParamsConfig(newConfig);
                                    }}
                                    className="text-[10px] font-bold text-primary hover:underline"
                                  >
                                    전체 선택
                                  </button>
                                  <span className="text-stone-300">|</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const ep = selectedOrgApiEndpoints[apiSettingsTab === 0 ? apiEndpointIdx : apiSecondaryEndpointIdx];
                                      const newConfig = currentRequestParams.map((param) => {
                                        const isFixed = ep?.fixed_params && param.name in ep.fixed_params;
                                        const existing = currentParamsConfig.find((c) => c.name === param.name);
                                        return { name: param.name, enabled: isFixed ? (existing?.enabled ?? true) : false, value: existing?.value ?? "" };
                                      });
                                      setCurrentParamsConfig(newConfig);
                                    }}
                                    className="text-[10px] font-bold text-stone-500 hover:underline"
                                  >
                                    전체 해제
                                  </button>
                                </div>
                              )}
                            </div>
                            {currentRequestParams.length === 0 ? (
                              <div className="text-xs text-amber-700 bg-amber-50/80 p-3 rounded-xl">
                                api_profile에 요청 파라미터 정보가 없습니다. API 초기 세팅에서 LLM 분석을 다시 실행하세요.
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {currentRequestParams.map((param) => {
                                  const config = currentParamsConfig.find((c) => c.name === param.name);
                                  const isEnabled = config?.enabled ?? true;
                                  const ep = selectedOrgApiEndpoints[apiSettingsTab === 0 ? apiEndpointIdx : apiSecondaryEndpointIdx];
                                  const isFixed = ep?.fixed_params && param.name in ep.fixed_params;
                                  return (
                                    <div
                                      key={param.name}
                                      className={cn(
                                        "p-2 rounded-lg border transition-all",
                                        isEnabled
                                          ? "bg-white/60 border-primary/30"
                                          : "bg-stone-100/50 border-stone-200/60 opacity-60"
                                      )}
                                    >
                                      <div className="flex items-center gap-2 mb-1">
                                        <input
                                          type="checkbox"
                                          checked={isEnabled}
                                          disabled={isFixed}
                                          onChange={(e) => {
                                            const newConfig = currentParamsConfig.map((c) =>
                                              c.name === param.name ? { ...c, enabled: e.target.checked } : c
                                            );
                                            if (!newConfig.find((c) => c.name === param.name)) {
                                              newConfig.push({ name: param.name, enabled: e.target.checked, value: "" });
                                            }
                                            setCurrentParamsConfig(newConfig);
                                          }}
                                          className="w-3.5 h-3.5"
                                        />
                                        <span className="text-xs font-bold text-stone-700 truncate" title={param.name}>
                                          {param.name}
                                        </span>
                                        {isFixed && (
                                          <span className="text-[9px] px-1 bg-amber-100 text-amber-700 rounded">고정</span>
                                        )}
                                      </div>
                                      {param.name_ko && (
                                        <div className="text-[10px] text-stone-500 truncate">{param.name_ko}</div>
                                      )}
                                      {isEnabled && !isFixed && (
                                        <input
                                          value={config?.value ?? ""}
                                          onChange={(e) => {
                                            const newConfig = currentParamsConfig.map((c) =>
                                              c.name === param.name ? { ...c, value: e.target.value } : c
                                            );
                                            if (!newConfig.find((c) => c.name === param.name)) {
                                              newConfig.push({ name: param.name, enabled: true, value: e.target.value });
                                            }
                                            setCurrentParamsConfig(newConfig);
                                          }}
                                          placeholder="값 입력"
                                          className="ui-field w-full text-[10px] font-mono mt-1 px-2 py-1"
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 레거시 호출 파라미터 (key-value) - 숨김 처리, 나중에 제거 */}
                          <div className="hidden p-4 rounded-2xl bg-white/50 border border-white/60">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-1.5">
                              <div className="text-xs font-extrabold text-stone-700">(레거시) 호출 파라미터</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setApiParams((p) => [...p, { key: "", value: "" }])}
                              className="text-xs font-bold text-primary hover:underline"
                            >
                              + 파라미터 추가
                            </button>
                          </div>
                          <div className="flex flex-col gap-2">
                            {apiParams.map((p, i) => {
                              const ep = selectedOrgApiEndpoints[apiEndpointIdx];
                              const isFixed = ep?.fixed_params && p.key in ep.fixed_params;
                              return (
                                <div key={i} className="flex items-center gap-2">
                                  <input
                                    value={p.key}
                                    onChange={(e) =>
                                      setApiParams((arr) =>
                                        arr.map((x, j) => (j === i ? { ...x, key: e.target.value } : x))
                                      )
                                    }
                                    placeholder="key"
                                    className={cn("ui-field flex-1 font-mono text-xs", isFixed && "bg-stone-100/80")}
                                    disabled={isFixed}
                                  />
                                  <input
                                    value={p.value}
                                    onChange={(e) =>
                                      setApiParams((arr) =>
                                        arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))
                                      )
                                    }
                                    placeholder="value"
                                    className={cn("ui-field flex-[2] font-mono text-xs", isFixed && "bg-stone-100/80")}
                                    disabled={isFixed}
                                  />
                                  {isFixed ? (
                                    <span className="text-[10px] text-stone-400 w-12">고정</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setApiParams((arr) => arr.filter((_, j) => j !== i))}
                                      className="text-xs text-red-500 hover:text-red-700 w-12"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {apiParams.length === 0 && (
                              <div className="text-xs text-stone-400">파라미터가 없습니다.</div>
                            )}
                          </div>
                        </div>

                      {/* 응답 필드 매핑 (api_profile에서 불러옴) */}
                      {apiEndpointIdx >= 0 && (
                        <div className="mb-4 p-3 rounded-xl bg-stone-50/50 border border-stone-200/60">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-1.5">
                                <div className="text-xs font-extrabold text-stone-700">응답 필드 매핑</div>
                                <div className="group relative">
                                  <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                                  <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-80 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                                    <div className="font-bold mb-1.5">응답 필드 매핑</div>
                                    <div className="text-stone-300 leading-relaxed">
                                      API 응답에서 수집할 필드를 선택합니다. api_profile에 정의된 response_fields를 표시합니다.
                                    </div>
                                    <div className="mt-2 text-amber-400 text-[10px]">
                                      * api_profile에 응답 필드가 없다면 API 초기 세팅에서 LLM 분석을 다시 실행하세요.
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {currentResponseFields.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCurrentSelectedFields(currentResponseFields.map((f) => f.name));
                                    }}
                                    className="text-[10px] font-bold text-primary hover:underline"
                                  >
                                    전체 선택
                                  </button>
                                  <span className="text-stone-300">|</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCurrentSelectedFields([]);
                                    }}
                                    className="text-[10px] font-bold text-stone-500 hover:underline"
                                  >
                                    전체 해제
                                  </button>
                                </div>
                              )}
                            </div>
                            {/* 필드 목록 (4열 태그 버튼) */}
                            <div className="mb-3">
                              <div className="text-[10px] text-stone-500 font-bold mb-2">필드 목록 (클릭하여 선택/해제)</div>
                              {currentResponseFields.length === 0 ? (
                                <div className="text-xs text-amber-700 bg-amber-50/80 p-3 rounded-xl">
                                  api_profile에 응답 필드 정보가 없습니다. API 초기 세팅에서 LLM 분석을 다시 실행하여 response_fields를 추가하세요.
                                </div>
                              ) : (
                                <div className="grid grid-cols-4 gap-2">
                                  {currentResponseFields.map((f, fIdx) => {
                                    const isSelected = currentSelectedFields.includes(f.name);
                                    return (
                                      <button
                                        key={`field-${f.name}-${fIdx}`}
                                        type="button"
                                        onClick={() => {
                                          if (isSelected) {
                                            setCurrentSelectedFields((prev) => prev.filter((x) => x !== f.name));
                                          } else {
                                            setCurrentSelectedFields((prev) => [...prev, f.name]);
                                          }
                                        }}
                                        className={cn(
                                          "px-2 py-1.5 rounded-lg text-[10px] font-bold truncate transition-all",
                                          isSelected
                                            ? "bg-primary text-white shadow-lg shadow-primary/20"
                                            : "bg-white/60 border border-white/70 text-stone-700 hover:bg-white/80 hover:shadow-md"
                                        )}
                                        title={`${f.name_ko ?? f.name}${f.type ? ` (${f.type})` : ""}`}
                                      >
                                        {f.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {/* 선택된 필드 목록 */}
                            {currentSelectedFields.length > 0 && (
                              <div className="p-3 rounded-xl bg-white/60 border border-white/70">
                                <div className="text-[10px] text-stone-500 font-bold mb-2">선택된 필드 ({currentSelectedFields.length}개)</div>
                                <div className="flex flex-col gap-1.5">
                                  {currentSelectedFields.map((fieldName, fieldIdx) => {
                                    const f = currentResponseFields.find((x) => x.name === fieldName);
                                    return (
                                      <div key={`${fieldName}-${fieldIdx}`} className="flex items-center justify-between gap-2 text-xs bg-white/80 px-3 py-2 rounded-lg">
                                        <div className="flex-1 min-w-0">
                                          <span className="font-bold text-stone-800">{fieldName}</span>
                                          {f?.name_ko && f.name_ko !== fieldName && (
                                            <span className="text-stone-500 ml-1">({f.name_ko})</span>
                                          )}
                                          {f?.type && f.type !== "string" && (
                                            <span className="text-amber-600 ml-1 text-[9px]">[{f.type}]</span>
                                          )}
                                          {f?.description && (
                                            <span className="text-stone-400 ml-2 text-[10px]">{f.description}</span>
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setCurrentSelectedFields((prev) => prev.filter((x) => x !== fieldName))}
                                          className="text-red-500 hover:text-red-700 text-[10px]"
                                        >
                                          삭제
                                        </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 페이징 설정 */}
                      {apiEndpointIdx >= 0 && (
                        <div className="p-4 rounded-2xl bg-white/50 border border-white/60">
                          <div className="flex items-center gap-3 mb-3">
                            <input
                              type="checkbox"
                              id="api-pagination-enabled"
                              checked={apiPagination.enabled}
                              onChange={(e) =>
                                setApiPagination((p) => ({ ...p, enabled: e.target.checked }))
                              }
                              className="w-4 h-4"
                            />
                            <label htmlFor="api-pagination-enabled" className="text-xs font-extrabold text-stone-700">
                              페이징 설정
                            </label>
                          </div>
                          {apiPagination.enabled && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-stone-500">방식</label>
                                <select
                                  value={apiPagination.type}
                                  onChange={(e) =>
                                    setApiPagination((p) => ({ ...p, type: e.target.value as "page" | "offset" }))
                                  }
                                  className="ui-field text-xs"
                                >
                                  <option value="page">페이지 번호</option>
                                  <option value="offset">오프셋</option>
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-stone-500">파라미터명</label>
                                <input
                                  value={apiPagination.param_name}
                                  onChange={(e) =>
                                    setApiPagination((p) => ({ ...p, param_name: e.target.value }))
                                  }
                                  className="ui-field text-xs font-mono"
                                  placeholder="page"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-stone-500">페이지당 건수</label>
                                <input
                                  type="number"
                                  value={apiPagination.page_size}
                                  onChange={(e) =>
                                    setApiPagination((p) => ({ ...p, page_size: Number(e.target.value) || 20 }))
                                  }
                                  className="ui-field text-xs"
                                  min={1}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-stone-500">최대 페이지</label>
                                <input
                                  type="number"
                                  value={apiPagination.max_pages}
                                  onChange={(e) =>
                                    setApiPagination((p) => ({ ...p, max_pages: Number(e.target.value) || 5 }))
                                  }
                                  className="ui-field text-xs"
                                  min={0}
                                  placeholder="0=전체"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 검색 필터 (키워드 검색) - 탭별 */}
                          <div className="mb-4 p-3 rounded-xl bg-stone-50/50 border border-stone-200/60">
                            <div className="flex items-center gap-3 mb-3">
                              <input
                                type="checkbox"
                                id={`api-search-filter-enabled-${apiSettingsTab}`}
                                checked={currentSearchFilters.enabled}
                                onChange={(e) =>
                                  setCurrentSearchFilters((p) => ({ ...p, enabled: e.target.checked }))
                                }
                                className="w-4 h-4"
                              />
                              <label htmlFor={`api-search-filter-enabled-${apiSettingsTab}`} className="flex items-center gap-1.5">
                                <span className="text-xs font-extrabold text-stone-700">검색 필터 (키워드)</span>
                                <div className="group relative">
                                  <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                                  <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-72 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                                    <div className="font-bold mb-1.5">검색 필터 설정</div>
                                    <div className="text-stone-300 leading-relaxed">
                                      선택한 응답 필드에서 키워드로 필터링합니다.
                                    </div>
                                    <ul className="mt-2 space-y-1 text-stone-300">
                                      <li><span className="text-amber-400">OR</span> - 키워드 중 하나라도 포함</li>
                                      <li><span className="text-amber-400">AND</span> - 모든 키워드 포함</li>
                                    </ul>
                                  </div>
                                </div>
                              </label>
                            </div>
                            {currentSearchFilters.enabled && (
                              <div className="flex flex-col gap-3">
                                {currentSearchFilters.filters.map((f, i) => (
                                  <div key={`filter-${i}`} className="p-3 rounded-xl bg-white/60 border border-white/70">
                                    {/* 필드명 행: 필드명 (넓게) + OR/AND 드롭박스 + 삭제(휴지통) 버튼 */}
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="flex-1 font-bold text-xs text-stone-800 whitespace-nowrap">{f.field}</div>
                                      <select
                                        value={f.match_type}
                                        onChange={(e) =>
                                          setCurrentSearchFilters((p) => ({
                                            ...p,
                                            filters: p.filters.map((x, j) =>
                                              j === i ? { ...x, match_type: e.target.value as "any" | "all" } : x
                                            ),
                                          }))
                                        }
                                        className="ui-field text-xs text-center"
                                        style={{ width: "100px" }}
                                      >
                                        <option value="any">or</option>
                                        <option value="all">and</option>
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setCurrentSearchFilters((p) => ({
                                            ...p,
                                            filters: p.filters.filter((_, j) => j !== i),
                                          }))
                                        }
                                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                        title="삭제"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                    {/* 키워드 입력: 세로 배치 (각 행: 텍스트박스 + 삭제버튼 + 마지막행이면 +버튼) */}
                                    <div className="flex flex-col gap-2">
                                      {/* 기존 키워드들을 각 행에 표시 */}
                                      {f.keywords.map((kw, ki) => {
                                        const isLastKeyword = ki === f.keywords.length - 1;
                                        return (
                                          <div key={`kw-${i}-${ki}`} className="flex items-center gap-3">
                                            <input
                                              type="text"
                                              value={kw}
                                              onChange={(e) => {
                                                const newVal = e.target.value;
                                                setCurrentSearchFilters((p) => ({
                                                  ...p,
                                                  filters: p.filters.map((x, j) =>
                                                    j === i
                                                      ? { ...x, keywords: x.keywords.map((k, kj) => kj === ki ? newVal : k) }
                                                      : x
                                                  ),
                                                }));
                                              }}
                                              placeholder={`키워드 ${ki + 1}`}
                                              className="ui-field text-xs flex-1"
                                            />
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setCurrentSearchFilters((p) => ({
                                                  ...p,
                                                  filters: p.filters.map((x, j) =>
                                                    j === i
                                                      ? { ...x, keywords: x.keywords.filter((_, kj) => kj !== ki) }
                                                      : x
                                                  ),
                                                }))
                                              }
                                              className="text-red-400 hover:text-red-600 text-sm font-bold flex-shrink-0"
                                            >
                                              ×
                                            </button>
                                            {/* + 버튼: 마지막 키워드 행에만 표시, 5개 미만일 때 */}
                                            {isLastKeyword && f.keywords.length < 5 ? (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setCurrentSearchFilters((p) => ({
                                                    ...p,
                                                    filters: p.filters.map((x, j) =>
                                                      j === i ? { ...x, keywords: [...x.keywords, ""] } : x
                                                    ),
                                                  }))
                                                }
                                                className="flex-shrink-0 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-lg font-bold border border-primary/30"
                                                style={{ width: "40px", height: "32px" }}
                                              >
                                                +
                                              </button>
                                            ) : (
                                              <div style={{ width: "40px" }} />
                                            )}
                                          </div>
                                        );
                                      })}
                                      {/* 키워드가 없으면 빈 텍스트박스 1개 + 버튼 표시 */}
                                      {f.keywords.length === 0 && (
                                        <div className="flex items-center gap-3">
                                          <input
                                            type="text"
                                            placeholder="키워드 1"
                                            className="ui-field text-xs flex-1"
                                            onBlur={(e) => {
                                              const val = e.target.value.trim();
                                              if (val) {
                                                setCurrentSearchFilters((p) => ({
                                                  ...p,
                                                  filters: p.filters.map((x, j) =>
                                                    j === i ? { ...x, keywords: [val] } : x
                                                  ),
                                                }));
                                                e.target.value = "";
                                              }
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                const val = (e.target as HTMLInputElement).value.trim();
                                                if (val) {
                                                  setCurrentSearchFilters((p) => ({
                                                    ...p,
                                                    filters: p.filters.map((x, j) =>
                                                      j === i ? { ...x, keywords: [val] } : x
                                                    ),
                                                  }));
                                                  (e.target as HTMLInputElement).value = "";
                                                }
                                              }
                                            }}
                                          />
                                          <div style={{ width: "40px" }} />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (currentSelectedFields.length === 0) {
                                      alert("먼저 응답 필드 매핑에서 필드를 선택하세요.");
                                      return;
                                    }
                                    setFieldSelectorTarget("search_filter");
                                    setFieldSelectorTempSelected([]);
                                    setFieldSelectorOpen(true);
                                  }}
                                  className="text-xs font-bold text-primary hover:underline self-start flex items-center gap-1"
                                >
                                  + 필드별 검색 필터 추가
                                </button>
                              </div>
                            )}
                          </div>

                      {/* 날짜 범위 필터 - 탭별 */}
                          <div className="mb-4 p-3 rounded-xl bg-stone-50/50 border border-stone-200/60">
                            <div className="flex items-center gap-3 mb-3">
                              <input
                                type="checkbox"
                                id={`api-date-filter-enabled-${apiSettingsTab}`}
                                checked={currentDateFilters.enabled}
                                onChange={(e) =>
                                  setCurrentDateFilters((p) => ({ ...p, enabled: e.target.checked }))
                                }
                                className="w-4 h-4"
                              />
                              <label htmlFor={`api-date-filter-enabled-${apiSettingsTab}`} className="flex items-center gap-1.5">
                                <span className="text-xs font-extrabold text-stone-700">날짜 범위 필터</span>
                                <div className="group relative">
                                  <HelpCircle className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                                  <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-50 w-72 p-3 rounded-xl bg-stone-900 text-white text-xs shadow-lg">
                                    <div className="font-bold mb-1.5">날짜 범위 필터</div>
                                    <div className="text-stone-300 leading-relaxed">
                                      시계열 데이터나 기간별 검색이 필요한 API에서 사용합니다.
                                    </div>
                                    <div className="mt-2 text-amber-400 text-[10px]">
                                      * &quot;최근 N일&quot;을 설정하면 수집 시점 기준으로 자동 계산됩니다.
                                    </div>
                                  </div>
                                </div>
                              </label>
                            </div>
                            {currentDateFilters.enabled && (
                              <div className="flex flex-col gap-3">
                                {/* 필드별 날짜 필터 목록 */}
                                {currentDateFilters.fields.map((df, i) => (
                                  <div key={i} className="p-3 rounded-xl bg-white/60 border border-white/70">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-bold text-xs text-stone-800">{df.field}</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setCurrentDateFilters((prev) => ({
                                            ...prev,
                                            fields: prev.fields.filter((_, j) => j !== i),
                                          }))
                                        }
                                        className="text-xs text-red-500 hover:text-red-700"
                                      >
                                        삭제
                                      </button>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                      <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-stone-500">시작일</label>
                                        <input
                                          value={df.start_date}
                                          onChange={(e) => {
                                            let val = e.target.value.replace(/[^0-9]/g, "");
                                            if (val.length >= 8) {
                                              val = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
                                            }
                                            setCurrentDateFilters((prev) => ({
                                              ...prev,
                                              fields: prev.fields.map((x, j) => (j === i ? { ...x, start_date: val } : x)),
                                            }));
                                          }}
                                          placeholder="YYYYMMDD"
                                          className="ui-field text-xs font-mono"
                                        />
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-stone-500">종료일</label>
                                        <input
                                          value={df.end_date}
                                          onChange={(e) => {
                                            let val = e.target.value.replace(/[^0-9]/g, "");
                                            if (val.length >= 8) {
                                              val = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
                                            }
                                            setCurrentDateFilters((prev) => ({
                                              ...prev,
                                              fields: prev.fields.map((x, j) => (j === i ? { ...x, end_date: val } : x)),
                                            }));
                                          }}
                                          placeholder="YYYYMMDD"
                                          className="ui-field text-xs font-mono"
                                        />
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-stone-500">날짜 형식</label>
                                        <select
                                          value={df.format}
                                          onChange={(e) =>
                                            setCurrentDateFilters((prev) => ({
                                              ...prev,
                                              fields: prev.fields.map((x, j) => (j === i ? { ...x, format: e.target.value } : x)),
                                            }))
                                          }
                                          className="ui-field text-xs"
                                        >
                                          <option value="YYYYMMDD">YYYYMMDD</option>
                                          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                                          <option value="YYYY/MM/DD">YYYY/MM/DD</option>
                                          <option value="timestamp">Unix Timestamp</option>
                                        </select>
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-stone-500">최근 N일</label>
                                        <select
                                          value={df.relative_days}
                                          onChange={(e) =>
                                            setCurrentDateFilters((prev) => ({
                                              ...prev,
                                              fields: prev.fields.map((x, j) =>
                                                j === i
                                                  ? { ...x, relative_days: e.target.value as "" | "7" | "30" | "90" | "365" }
                                                  : x
                                              ),
                                            }))
                                          }
                                          className="ui-field text-xs"
                                        >
                                          <option value="">직접 입력</option>
                                          <option value="7">7일</option>
                                          <option value="30">30일</option>
                                          <option value="90">90일</option>
                                          <option value="365">1년</option>
                                        </select>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (currentDateRelatedFields.length === 0) {
                                      alert("날짜 관련 필드가 없습니다. api_profile에 응답 필드 정보가 있어야 합니다.");
                                      return;
                                    }
                                    setFieldSelectorTarget("date_filter");
                                    setFieldSelectorTempSelected([]);
                                    setFieldSelectorOpen(true);
                                  }}
                                  className="text-xs font-bold text-primary hover:underline self-start flex items-center gap-1"
                                >
                                  + 필드별 날짜 필터 추가
                                </button>
                              </div>
                            )}
                          </div>

                        </div>
                      )}

                      {/* 테스트 호출 */}
                      {apiEndpointIdx >= 0 && (
                        <div className="p-4 rounded-2xl bg-white/50 border border-white/60">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-xs font-extrabold text-stone-700">테스트 호출</div>
                            <button
                              type="button"
                              onClick={runApiBoardTest}
                              disabled={apiBoardTestLoading}
                              className={cn(
                                "glass-button px-3 py-1.5 rounded-lg text-xs font-bold",
                                apiBoardTestLoading && "opacity-60"
                              )}
                            >
                              {apiBoardTestLoading ? "호출 중..." : "테스트 실행"}
                            </button>
                          </div>
                          {apiBoardTestError && (
                            <div className="text-xs text-red-600 bg-red-50/80 p-2 rounded-lg mb-2">
                              오류: {apiBoardTestError}
                            </div>
                          )}
                          {apiBoardTestResult && (
                            <div className="text-xs">
                              <div className="flex gap-3 mb-2">
                                <span className="text-stone-500">status:</span>
                                <span className={cn("font-bold", apiBoardTestResult.status === 200 ? "text-green-700" : "text-red-700")}>
                                  {apiBoardTestResult.status}
                                </span>
                                <span className="text-stone-500">content-type:</span>
                                <span className="font-mono">{apiBoardTestResult.content_type || "-"}</span>
                              </div>
                              <div className="text-stone-500 mb-1">url: <span className="font-mono text-stone-700 break-all">{apiBoardTestResult.url}</span></div>
                              <div className="bg-stone-100/80 rounded-lg p-2 max-h-40 overflow-auto">
                                <pre className="text-[10px] whitespace-pre-wrap break-all">{apiBoardTestResult.body_preview?.slice(0, 2000)}</pre>
                              </div>
                              
                              {/* 설정된 필터 정보 표시 */}
                              {(apiSelectedFieldsPrimary.length > 0 || apiSearchFiltersPrimary.filters.length > 0 || apiDateFiltersPrimary.fields.length > 0) && (
                                <div className="mt-3 p-2 rounded-lg bg-blue-50/80 border border-blue-200/60">
                                  <div className="font-bold text-blue-700 mb-1">📋 설정된 필터 (응답 데이터 처리 시 적용)</div>
                                  <div className="text-blue-600 space-y-1">
                                    {apiSelectedFieldsPrimary.length > 0 && (
                                      <div>• 선택된 필드: <span className="font-mono">{apiSelectedFieldsPrimary.length}개</span></div>
                                    )}
                                    {apiSearchFiltersPrimary.enabled && apiSearchFiltersPrimary.filters.length > 0 && (
                                      <div>
                                        • 키워드 검색: {apiSearchFiltersPrimary.filters.map((f, fi) => (
                                          <span key={fi} className="inline-block ml-1 px-1.5 py-0.5 bg-blue-100 rounded text-[10px]">
                                            {f.field} ({f.match_type === "any" ? "OR" : "AND"}: {f.keywords.filter(k => k.trim()).join(", ") || "미입력"})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {apiDateFiltersPrimary.enabled && apiDateFiltersPrimary.fields.length > 0 && (
                                      <div>
                                        • 날짜 필터: {apiDateFiltersPrimary.fields.map((df, dfi) => (
                                          <span key={dfi} className="inline-block ml-1 px-1.5 py-0.5 bg-blue-100 rounded text-[10px]">
                                            {df.field} ({df.relative_days ? `최근 ${df.relative_days}일` : `${df.start_date || "시작"} ~ ${df.end_date || "종료"}`})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-blue-500 mt-1">
                                    ※ 위 필터는 API 응답 수신 후 로컬에서 적용됩니다. 테스트 호출은 API 연결만 확인합니다.
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 생성된 api_config JSON 미리보기 */}
                      {apiEndpointIdx >= 0 && (
                        <div className="p-4 rounded-2xl bg-stone-100/60 border border-white/60">
                          <div className="text-xs font-extrabold text-stone-600 mb-2">api_config (자동 생성)</div>
                          <pre className="text-[10px] font-mono text-stone-700 whitespace-pre-wrap max-h-32 overflow-auto">
                            {buildApiConfigJson()}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) === "hybrid" && (
                    <div className="grid grid-cols-1 gap-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-stone-600">접근 방식(access_mode)</label>
                        <input value="api" disabled className="ui-field opacity-80" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-stone-600">hybrid_config (JSON)</label>
                        <textarea
                          value={hybridConfigText}
                          onChange={(e) => setHybridConfigText(e.target.value)}
                          className="ui-textarea min-h-[260px] font-mono text-xs"
                          placeholder='예: { "list_source": { "endpoint": "https://api.example.com/list" }, "detail_source": { "list_url": "https://site/list", "parse_rules": {} }, "join_key": { "from":"$.id", "to":"detail_url_param" } }'
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: 요약/저장 */}
              {wizardStep === 3 && (
                <div className="flex flex-col gap-4">
                  {/* 기본 정보 */}
                  <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
                    <div className="text-sm font-extrabold text-stone-800">기본 정보</div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-stone-500 font-semibold">board_id</span>
                        <span className="font-mono font-bold text-stone-800">{boardDraft.board_id}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-stone-500 font-semibold">board_mode</span>
                        <span className="font-bold text-stone-800">{boardDraft.board_mode ?? inferBoardMode(boardDraft)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-stone-500 font-semibold">board_name</span>
                        <span className="font-bold text-stone-800 truncate">{boardDraft.board_name}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-stone-500 font-semibold">doc_type</span>
                        <span className="font-bold text-stone-800">{boardDraft.doc_type || "-"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 md:col-span-2">
                        <span className="text-stone-500 font-semibold">list_url</span>
                        <span className="font-mono font-bold text-stone-800 truncate max-w-[400px]" title={boardDraft.list_url || "-"}>
                          {boardDraft.list_url || "-"}
                        </span>
                      </div>
                      {boardDraft.domain_tags && boardDraft.domain_tags.length > 0 && (
                        <div className="flex items-center justify-between gap-2 md:col-span-2">
                          <span className="text-stone-500 font-semibold">분류 태그</span>
                          <div className="flex flex-wrap gap-1">
                            {boardDraft.domain_tags.map((tag) => (
                              <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-stone-200 text-stone-700">{tag}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 스케쥴 설정 */}
                  <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
                    <div className="text-sm font-extrabold text-stone-800">스케쥴 설정</div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-stone-500 font-semibold">schedule_cron</span>
                        <span className="font-mono font-bold text-stone-800">{boardDraft.schedule_cron || "-"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-stone-500 font-semibold">dedup_key</span>
                        <span className="font-bold text-stone-800">{boardDraft.dedup_key || "url"}</span>
                      </div>
                    </div>
                  </div>

                  {/* 수집 범위 - API 모드에서는 숨김 */}
                  {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) !== "api" && (
                  <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
                    <div className="text-sm font-extrabold text-stone-800">수집 범위</div>
                    <div className="mt-3 text-sm">
                      {!boardDraft.collection_range?.type ? (
                        <span className="text-stone-500">설정되지 않음 (전체 수집)</span>
                      ) : boardDraft.collection_range.type === "period" ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded-lg bg-blue-100 text-blue-700 text-xs font-bold">기간 설정</span>
                          <span className="font-bold text-stone-800">
                            {boardDraft.collection_range.period_start || "시작일 미설정"} ~ {boardDraft.collection_range.period_end || "종료일 미설정"}
                          </span>
                        </div>
                      ) : boardDraft.collection_range.type === "relative" ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">상대 일수</span>
                          <span className="font-bold text-stone-800">
                            수집일 기준 {boardDraft.collection_range.relative_days || 30}일 전까지
                          </span>
                        </div>
                      ) : boardDraft.collection_range.type === "yearly" ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold">연도 선택</span>
                          <span className="font-bold text-stone-800">
                            {boardDraft.collection_range.years && boardDraft.collection_range.years.length > 0
                              ? boardDraft.collection_range.years.sort((a, b) => a - b).join(", ") + "년"
                              : "선택된 연도 없음"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-stone-500">알 수 없는 설정</span>
                      )}
                    </div>
                  </div>
                  )}

                  {/* 수집 대상 - API 모드에서는 숨김 */}
                  {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) !== "api" && (
                  <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
                    <div className="text-sm font-extrabold text-stone-800">수집 대상</div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      {/* 게시글 제목/본문 */}
                      <div className="flex items-center gap-2">
                        <span className="text-stone-500 font-semibold">게시글 제목/본문</span>
                        {boardDraft.collection_targets?.title_body ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">수집</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-stone-200 text-stone-500">미수집</span>
                        )}
                      </div>
                      
                      {/* 첨부파일 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-stone-500 font-semibold">첨부파일</span>
                        {!boardDraft.collection_targets?.attachments?.enabled ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-stone-200 text-stone-500">미수집</span>
                        ) : boardDraft.collection_targets.attachments.all ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">전체 수집</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {boardDraft.collection_targets.attachments.hwpx && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">hwpx</span>
                            )}
                            {boardDraft.collection_targets.attachments.docx && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">docx</span>
                            )}
                            {boardDraft.collection_targets.attachments.xlsx && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">xlsx</span>
                            )}
                            {boardDraft.collection_targets.attachments.pdf && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">pdf</span>
                            )}
                            {!boardDraft.collection_targets.attachments.hwpx &&
                             !boardDraft.collection_targets.attachments.docx &&
                             !boardDraft.collection_targets.attachments.xlsx &&
                             !boardDraft.collection_targets.attachments.pdf && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-stone-200 text-stone-500">선택 없음</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Config & 스크래핑 테스트 로그 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* 왼쪽: Config 정보 (1열 배치) */}
                    <div className="flex flex-col gap-3">
                      <div className="p-3 rounded-2xl bg-white/40 border border-white/60">
                        <div className="text-xs font-extrabold text-stone-700">published_date_rule</div>
                        <pre className="mt-1.5 text-[10px] text-stone-700 overflow-auto whitespace-pre-wrap max-h-[80px]">
                          {publishedDateRuleText.trim() ? publishedDateRuleText : "{}"}
                        </pre>
                      </div>
                      <div className="p-3 rounded-2xl bg-white/40 border border-white/60">
                        <div className="text-xs font-extrabold text-stone-700">
                          {(boardDraft.board_mode ?? inferBoardMode(boardDraft))}_config
                        </div>
                        <pre className="mt-1.5 text-[10px] text-stone-700 overflow-auto whitespace-pre-wrap max-h-[120px]">
                          {(boardDraft.board_mode ?? inferBoardMode(boardDraft)) === "web_scraping"
                            ? webConfigText.trim() || "{}"
                            : (boardDraft.board_mode ?? inferBoardMode(boardDraft)) === "api"
                              ? buildApiConfigJson()
                              : hybridConfigText.trim() || "{}"}
                        </pre>
                      </div>
                    </div>
                    
                    {/* 오른쪽: 스크래핑 테스트 로그 */}
                    <div className="p-4 rounded-2xl bg-stone-900 border border-stone-700">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-extrabold text-stone-300">🔍 Scraping Testing Log</div>
                        {scrapingTesting && (
                          <div className="flex items-center gap-1.5 text-xs text-amber-400">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            테스트 중...
                          </div>
                        )}
                      </div>
                      <pre className="text-[10px] text-stone-400 font-mono overflow-auto whitespace-pre-wrap h-[270px] leading-relaxed">
                        {scrapingTestLog || "스크래핑 테스트를 실행하면 결과가 여기에 표시됩니다.\n\n테스트 내용:\n- 목록 페이지 첫 페이지 스크래핑\n- 각 게시글 제목, 날짜 추출\n- 상세 페이지 본문 요약 (50자)\n- 첨부파일 목록 및 다운로드 링크 확인"}
                      </pre>
                    </div>
                  </div>

                  <div className="text-xs text-stone-500 px-2">
                    저장 시 JSON 설정은 서버에 그대로 보관됩니다. 스크래핑 테스트로 실제 데이터 수집이 정상 작동하는지 확인할 수 있습니다.
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/60 bg-white/20 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  if (wizardStep === 1) return closeBoardWizard();
                  setWizardStep((s) => (s === 3 ? 2 : 1));
                }}
                className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700"
              >
                {wizardStep === 1 ? "취소" : "이전"}
              </button>

              <div className="flex items-center gap-2">
                {wizardStep < 3 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setWizardJsonError(null);
                      try {
                        // Step2 진입/이탈 시 JSON 유효성 검사(개편안 기반)
                        if (wizardStep === 2) {
                          const mode = boardDraft.board_mode ?? inferBoardMode(boardDraft);
                          const next: Board = {
                            ...boardDraft,
                            published_date_rule: parseJsonOrEmpty(
                              publishedDateRuleText,
                              "published_date_rule"
                            ),
                          };
                          if (mode === "web_scraping") {
                            next.web_config = mergeExternalDetailToWebConfig(parseJsonOrEmpty(webConfigText, "web_config"));
                            next.api_config = undefined;
                            next.hybrid_config = undefined;
                          } else if (mode === "api") {
                            // API 모드는 UI에서 생성한 JSON 사용
                            next.api_config = JSON.parse(buildApiConfigJson());
                            next.web_config = undefined;
                            next.hybrid_config = undefined;
                            next.access_mode = "api";
                          } else {
                            next.hybrid_config = parseJsonOrEmpty(hybridConfigText, "hybrid_config");
                            next.web_config = undefined;
                            next.api_config = undefined;
                            next.access_mode = "api";
                          }
                          setBoardDraft(next);
                        }
                        setWizardStep((s) => (s === 1 ? 2 : 3));
                      } catch (e: any) {
                        setWizardJsonError(e?.message ?? "JSON 형식 오류");
                      }
                    }}
                    className="px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-95 bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/20"
                  >
                    다음
                  </button>
                ) : (
                  <>
                    {/* 스크래핑 테스트 버튼 - board_mode에 따라 조건 분기 */}
                    {(() => {
                      const currentMode = boardDraft.board_mode ?? inferBoardMode(boardDraft);
                      let hasConfig = false;
                      let isDisabled = scrapingTesting;
                      let buttonLabel = "🔍 스크래핑 테스트";
                      
                      if (currentMode === "api") {
                        // API 모드: apiEndpointIdx가 선택되었거나, api_config가 이미 있으면 테스트 가능
                        hasConfig = apiEndpointIdx >= 0 || (!!boardDraft.api_config && Object.keys(boardDraft.api_config).length > 0);
                        isDisabled = scrapingTesting || !hasConfig;
                        buttonLabel = "🔍 API 테스트";
                      } else if (currentMode === "web_scraping") {
                        hasConfig = !!webConfigText.trim();
                        isDisabled = scrapingTesting || !boardDraft.list_url || !hasConfig;
                      } else {
                        // hybrid
                        hasConfig = !!hybridConfigText.trim();
                        isDisabled = scrapingTesting || !boardDraft.list_url || !hasConfig;
                      }
                      
                      return (
                        <button
                          type="button"
                          onClick={testScraping}
                          disabled={isDisabled}
                          className="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-95 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {scrapingTesting ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              테스트 중...
                            </>
                          ) : (
                            buttonLabel
                          )}
                        </button>
                      );
                    })()}
                    
                    {/* 저장 버튼 */}
                    <button
                      type="button"
                      onClick={async () => {
                        setWizardJsonError(null);
                        try {
                          const mode = boardDraft.board_mode ?? inferBoardMode(boardDraft);
                          const next: Board = {
                            ...boardDraft,
                            published_date_rule: parseJsonOrEmpty(publishedDateRuleText, "published_date_rule"),
                          };
                          if (mode === "web_scraping") {
                            next.web_config = mergeExternalDetailToWebConfig(parseJsonOrEmpty(webConfigText, "web_config"));
                            if (next.web_config && typeof next.web_config === "object") {
                              const wc = next.web_config as Record<string, unknown>;
                              if (boardDraft.collection_range?.type) {
                                const cr = boardDraft.collection_range;
                                const rc: Record<string, unknown> = { type: cr.type };
                                if (cr.type === "period") { rc.start_date = cr.period_start || null; rc.end_date = cr.period_end || null; }
                                else if (cr.type === "relative") { rc.days_before = cr.relative_days || 30; }
                                else if (cr.type === "yearly") { rc.years = cr.years || []; }
                                wc.collection_range = rc;
                              }
                              const att = boardDraft.collection_targets?.attachments;
                              if (att) {
                                const ft: string[] = [];
                                if (!att.all && att.enabled !== false) {
                                  if (att.hwpx) ft.push("hwpx", "hwp");
                                  if (att.docx) ft.push("docx", "doc");
                                  if (att.xlsx) ft.push("xlsx", "xls", "csv");
                                  if (att.pdf) ft.push("pdf");
                                }
                                wc.attachments = {
                                  ...(wc.attachments as Record<string, unknown> || {}),
                                  enabled: att.enabled !== false,
                                  collect_all: att.all || false,
                                  file_types: ft.length > 0 ? ft : undefined,
                                };
                              }
                              wc.collect_body = boardDraft.collection_targets?.title_body !== false;
                            }
                            next.api_config = undefined;
                            next.hybrid_config = undefined;
                            // 사이트 내 검색 옵션 저장 (웹 스크래핑 모드)
                            if (siteSearchConfig && siteSearchConfig.options.length > 0) {
                              next.site_search_config = siteSearchConfig;
                            } else {
                              next.site_search_config = undefined;
                            }
                            // 첨부파일 패턴 저장
                            next.attachment_config = attachmentConfig || undefined;
                          } else if (mode === "api") {
                            // API 모드는 UI에서 생성한 JSON 사용
                            next.api_config = JSON.parse(buildApiConfigJson());
                            next.web_config = undefined;
                            next.hybrid_config = undefined;
                            next.site_search_config = undefined;
                            next.attachment_config = undefined;
                            next.access_mode = "api";
                          } else {
                            next.hybrid_config = parseJsonOrEmpty(hybridConfigText, "hybrid_config");
                            next.web_config = undefined;
                            next.api_config = undefined;
                            // 사이트 내 검색 옵션 저장 (하이브리드 모드)
                            if (siteSearchConfig && siteSearchConfig.options.length > 0) {
                              next.site_search_config = siteSearchConfig;
                            } else {
                              next.site_search_config = undefined;
                            }
                            // 첨부파일 패턴 저장
                            next.attachment_config = attachmentConfig || undefined;
                            next.access_mode = "api";
                          }
                          setBoardDraft(next);
                          const ok = await saveBoard(next);
                          if (ok) closeBoardWizard();
                        } catch (e: any) {
                          setWizardJsonError(e?.message ?? "저장 실패");
                        }
                      }}
                      className="px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-95 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
                      disabled={loading}
                    >
                      <Save className="w-4 h-4" />
                      저장
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 필드 선택 팝업 */}
      {fieldSelectorOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setFieldSelectorOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl glass-panel border border-white/70 shadow-xl overflow-hidden">
            <div className="p-4 border-b border-white/60 bg-white/20">
              <div className="text-sm font-extrabold text-stone-800">
                {fieldSelectorTarget === "search_filter" ? "검색 필터 필드 선택" : "날짜 필터 필드 선택"}
              </div>
              <div className="text-xs text-stone-500 mt-1">
                복수 선택 가능 · 클릭하여 선택/해제 후 &quot;적용&quot; 버튼 클릭
              </div>
            </div>
            <div className="p-4 max-h-[50vh] overflow-y-auto">
              {(() => {
                // 현재 탭의 필드 사용
                const fields =
                  fieldSelectorTarget === "date_filter"
                    ? currentDateRelatedFields
                    : currentResponseFields.filter((f) => currentSelectedFields.includes(f.name));
                if (fields.length === 0) {
                  return (
                    <div className="text-sm text-amber-700 bg-amber-50/80 p-3 rounded-xl">
                      {fieldSelectorTarget === "date_filter"
                        ? "날짜 관련 필드가 없습니다. (필드명 끝이 '일', '일시', '일자', '기간'인 필드)"
                        : "선택된 응답 필드가 없습니다. 먼저 응답 필드 매핑에서 필드를 선택하세요."}
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-3 gap-2">
                    {fields.map((f, fIdx) => {
                      const isSelected = fieldSelectorTempSelected.includes(f.name);
                      return (
                        <button
                          key={`selector-${f.name}-${fIdx}`}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setFieldSelectorTempSelected((prev) => prev.filter((x) => x !== f.name));
                            } else {
                              setFieldSelectorTempSelected((prev) => [...prev, f.name]);
                            }
                          }}
                          className={cn(
                            "px-3 py-2 rounded-xl text-xs font-bold transition-all text-left",
                            isSelected
                              ? "bg-primary text-white shadow-lg shadow-primary/20"
                              : "bg-white/60 border border-white/70 text-stone-700 hover:bg-white/80 hover:shadow-md"
                          )}
                        >
                          <div className="truncate">{f.name}</div>
                          {f.name_ko && f.name_ko !== f.name && (
                            <div className="text-[10px] opacity-70 truncate">{f.name_ko}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="p-4 border-t border-white/60 bg-white/20 flex justify-between gap-2">
              <div className="text-xs text-stone-500">
                {fieldSelectorTempSelected.length}개 선택됨
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFieldSelectorOpen(false)}
                  className="glass-button px-4 py-2 rounded-xl text-sm font-semibold text-stone-700"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (fieldSelectorTarget === "search_filter") {
                      // 검색 필터에 새 필드 추가 (현재 탭 기준)
                      const newFilters = fieldSelectorTempSelected
                        .filter((fn) => !currentSearchFilters.filters.some((f) => f.field === fn))
                        .map((fn) => ({ field: fn, keywords: [], match_type: "any" as const }));
                      setCurrentSearchFilters((p) => ({
                        ...p,
                        filters: [...p.filters, ...newFilters],
                      }));
                    } else if (fieldSelectorTarget === "date_filter") {
                      // 날짜 필터에 새 필드 추가 (현재 탭 기준)
                      const newFields = fieldSelectorTempSelected
                        .filter((fn) => !currentDateFilters.fields.some((f) => f.field === fn))
                        .map((fn) => ({
                          field: fn,
                          start_date: "",
                          end_date: "",
                          format: "YYYYMMDD",
                          relative_days: "" as const,
                        }));
                      setCurrentDateFilters((prev) => ({
                        ...prev,
                        fields: [...prev.fields, ...newFields],
                      }));
                    }
                    setFieldSelectorOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-extrabold bg-primary text-white shadow-lg shadow-primary/20 transition-all active:scale-95"
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Org API Profile Modal (설계/와이어프레임 단계) */}
      {isApiProfileModalOpen && orgDraft && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsApiProfileModalOpen(false)}
          />

          <div className="relative w-full max-w-5xl rounded-3xl glass-panel border border-white/70 shadow-2xl shadow-stone-900/20 overflow-hidden">
            <div className="p-6 flex items-start justify-between gap-4 border-b border-white/60 bg-white/20">
              <div className="min-w-0">
                <div className="text-lg font-extrabold text-stone-800">API 초기 세팅(기관 레벨)</div>
                <div className="text-xs text-stone-500 mt-1 truncate">
                  {orgDraft.org_name} · {orgDraft.org_id} · collection_mode:{" "}
                  <span className="font-bold">{orgDraft.collection_mode ?? "web_scraping"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsApiProfileModalOpen(false)}
                  className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto flex flex-col gap-6">
              {/* 저장된 프로파일 상태 표시 */}
              {(orgDraft as any)?.api_profile && (
                <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-600" />
                    <div>
                      <div className="text-sm font-extrabold text-emerald-800">저장된 api_profile 있음</div>
                      <div className="text-xs text-emerald-600 mt-0.5">
                        status:{" "}
                        <span className="font-bold">{((orgDraft as any)?.api_profile as any)?.status ?? "-"}</span> ·
                        endpoints: <span className="font-bold">{((orgDraft as any)?.api_profile as any)?.endpoints?.length ?? 0}개</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setApiProfileJson("");
                        setApiProposal(null);
                        setApiWarnings([]);
                        setApiSummary("");
                        setApiTestResult(null);
                      }}
                      className="glass-button px-3 py-2 rounded-xl text-xs font-semibold text-stone-700"
                    >
                      초기화(새로 분석)
                    </button>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-white/40 border border-white/60">
                <div className="text-sm font-extrabold text-stone-800">안내</div>
                <div className="text-xs text-stone-600 mt-1 leading-relaxed">
                  - 시크릿(API Key/토큰 값)은 저장하지 않습니다. <span className="font-mono">auth.secret_ref</span>로{" "}
                  <span className="font-mono">ENV:변수명</span>을 사용하세요.
                  <br />- LLM 분석 결과는 "제안"이며, 테스트/승인 후 저장됩니다.
                  <br />- 저장된 프로파일이 있으면 자동 불러옴. 수정 후 &quot;승인 후 저장&quot;을 누르세요.
                </div>
                {apiAnalyzeError && (
                  <div className="mt-3 text-sm text-red-700 bg-red-50/60 border border-red-200 rounded-2xl px-4 py-3">
                    오류: {apiAnalyzeError}
                    {(apiAnalyzeError === "llm_not_configured" ||
                      apiAnalyzeError === "llm_not_configured_openai") && (
                      <div className="mt-1 text-xs text-red-700/80">
                        서버 환경변수 <span className="font-mono">OPENAI_API_KEY</span>를 설정해야 합니다.
                      </div>
                    )}
                    {apiAnalyzeError === "openai_model_not_chat_compatible" && (
                      <div className="mt-1 text-xs text-red-700/80">
                        선택된 OpenAI 모델이 채팅 엔드포인트와 호환되지 않습니다.{" "}
                        <span className="font-bold">모델 선택을 Auto(최신)</span>로 두거나 chat 가능한 모델을 Manual로 입력하세요.
                      </div>
                    )}
                    {apiAnalyzeError === "openai_model_responses_only" && (
                      <div className="mt-1 text-xs text-red-700/80">
                        선택된 OpenAI 모델은 <code>/v1/responses</code> 전용입니다(o1/o3/o4 계열).{" "}
                        <span className="font-bold">모델 선택을 Auto(최신)</span>로 두거나, gpt-4o/gpt-4o-mini 같은 chat 호환 모델을 입력하세요.
                      </div>
                    )}
                    {apiAnalyzeError === "openai_model_temperature_not_supported" && (
                      <div className="mt-1 text-xs text-red-700/80">
                        선택된 OpenAI 모델이 <span className="font-mono">temperature</span> 파라미터를 지원하지 않습니다.
                        서버에서 자동 재시도를 수행하지만 계속 실패하면 <span className="font-bold">모델을 Auto(최신)</span>로 변경해 주세요.
                      </div>
                    )}
                    {apiAnalyzeError === "openai_model_response_format_not_supported" && (
                      <div className="mt-1 text-xs text-red-700/80">
                        선택된 OpenAI 모델이 <span className="font-mono">response_format: json_object</span>를 지원하지 않습니다.
                        <span className="font-bold">모델을 Auto(최신)</span>로 두면(검색 계열 모델 제외) 해결됩니다.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tab 1: 입력 */}
              <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
                <div className="text-sm font-extrabold text-stone-800">1) 입력</div>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">가이드 URL</label>
                    <input
                      className="ui-field"
                      placeholder="예: https://open.law.go.kr/LSO/openApi/guideList.do"
                      value={apiProfileUrl}
                      onChange={(e) => setApiProfileUrl(e.target.value)}
                    />
                    <div className="text-[11px] text-stone-500 font-semibold">
                      예시 링크: `https://open.law.go.kr/LSO/openApi/guideList.do`
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">가이드 문서 업로드</label>
                    <input
                      type="file"
                      className="ui-field"
                      accept=".pdf,.docx,.xlsx,.txt,.md,.hwp,.hwpx"
                      onChange={(e) => setApiProfileFile(e.target.files?.[0] ?? null)}
                    />
                    <div className="text-[11px] text-stone-500 font-semibold">
                      PDF/DOCX/XLSX/TXT/HWPX 지원. HWP는 미지원(추후 검토).
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">LLM 제공자</label>
                    <select
                      className="ui-field"
                      value={llmProvider}
                      onChange={(e) => setLlmProvider(e.target.value as any)}
                    >
                      <option value="openai">ChatGPT(OpenAI)</option>
                      <option value="gemini">Gemini(Google)</option>
                      <option value="anthropic">Claude(Anthropic)</option>
                    </select>
                    <div className="text-[11px] text-stone-500 font-semibold">
                      모델은 기본적으로 <span className="font-bold">Auto(최신 감지)</span>로 동작합니다.
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">모델 선택</label>
                    <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2">
                      <select
                        className="ui-field"
                        value={llmModelMode}
                        onChange={(e) => setLlmModelMode(e.target.value as any)}
                      >
                        <option value="auto">Auto(최신)</option>
                        <option value="manual">Manual</option>
                      </select>
                      <input
                        className={cn("ui-field", llmModelMode !== "manual" && "opacity-70")}
                        value={llmModel}
                        onChange={(e) => setLlmModel(e.target.value)}
                        placeholder="(Manual) 예: gpt-4o-mini / gemini-... / claude-... "
                        disabled={llmModelMode !== "manual"}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-stone-500 font-semibold">
                    URL/파일 입력 후 분석하거나, 저장된 JSON을 불러오세요.
                  </div>
                  <div className="flex items-center gap-2">
                    {/* JSON 불러오기 버튼 */}
                    <button
                      type="button"
                      onClick={openJsonLoadModal}
                      className={cn(
                        "px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all active:scale-95",
                        "bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-300"
                      )}
                    >
                      <FolderOpen className="w-4 h-4" />
                      JSON 불러오기
                    </button>
                    {/* API 정보 분석 버튼 */}
                    <button
                      type="button"
                      onClick={() => {
                        if (extractedEndpoints.length > 0) {
                          // 이미 로드된 데이터가 있으면 바로 모달 열기
                          setIsExtractModalOpen(true);
                        } else {
                          // 데이터가 없으면 추출 실행
                          runApiExtract();
                        }
                      }}
                      disabled={extractLoading || (extractedEndpoints.length === 0 && !apiProfileUrl.trim() && !apiProfileFile)}
                      className={cn(
                        "px-5 py-2.5 rounded-xl text-sm font-extrabold flex items-center gap-2 transition-all active:scale-95",
                        "bg-stone-700 hover:bg-stone-800 text-white shadow-lg shadow-stone-900/10",
                        (extractLoading || (extractedEndpoints.length === 0 && !apiProfileUrl.trim() && !apiProfileFile)) && "opacity-60"
                      )}
                    >
                      <RefreshCw className={cn("w-4 h-4", extractLoading && "animate-spin")} />
                      API 정보 분석 {extractedEndpoints.length > 0 && `(${extractedEndpoints.length})`}
                    </button>
                    {/* LLM 분석 버튼 */}
                    <button
                      type="button"
                      onClick={runApiAnalyze}
                      disabled={apiAnalyzeLoading || (!apiProfileUrl.trim() && !apiProfileFile && selectedExtractEndpoints.length === 0)}
                      className={cn(
                        "px-5 py-2.5 rounded-xl text-sm font-extrabold flex items-center gap-2 transition-all active:scale-95",
                        "bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/30",
                        (apiAnalyzeLoading || (!apiProfileUrl.trim() && !apiProfileFile && selectedExtractEndpoints.length === 0)) && "opacity-60"
                      )}
                    >
                      {apiAnalyzeLoading ? (
                        <>
                          <Save className="w-4 h-4 animate-spin" />
                          분석 중...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          LLM 분석
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Tab 2: 분석 결과(제안안) */}
              <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
                <div className="text-sm font-extrabold text-stone-800">2) 분석 결과(제안안)</div>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">api_profile(비시크릿) 제안(JSON)</label>
                    <textarea
                      className="ui-textarea min-h-[260px] font-mono text-xs"
                      value={apiProfileJson}
                      onChange={(e) => setApiProfileJson(e.target.value)}
                      placeholder="LLM 분석 결과가 여기 표시됩니다."
                    />
                    {apiSummary && (
                      <div className="text-xs text-stone-600 bg-white/40 border border-white/60 rounded-2xl px-3 py-2">
                        <span className="font-bold">요약:</span> {apiSummary}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">수정 요청 (선택사항)</label>
                    <textarea
                      className="ui-textarea min-h-[100px]"
                      value={apiRefineText}
                      onChange={(e) => setApiRefineText(e.target.value)}
                      placeholder="LLM에 추가 요청 사항이 있으면 입력하세요.&#10;예: authKey는 query로 전달 / 응답은 JSON / 특정 파라미터 필수로 설정 등"
                    />
                    {/* 선택된 엔드포인트 요약 표시 */}
                    {selectedExtractEndpoints.length > 0 && (
                      <div className="p-3 rounded-xl bg-green-50/80 border border-green-200/60 text-xs">
                        <div className="flex items-center gap-2 text-green-700 font-bold mb-1">
                          <Check className="w-3.5 h-3.5" />
                          선택된 엔드포인트: {selectedExtractEndpoints.length}개
                        </div>
                        <div className="text-green-600/80 text-[10px] leading-relaxed max-h-[60px] overflow-y-auto">
                          {selectedExtractEndpoints.slice(0, 5).join(", ")}
                          {selectedExtractEndpoints.length > 5 && ` 외 ${selectedExtractEndpoints.length - 5}개`}
                        </div>
                      </div>
                    )}
                    <div className="p-4 rounded-2xl bg-white/50 border border-white/70 text-xs text-stone-700 leading-relaxed">
                      시크릿 저장 위치(권장):
                      <br />- 개발: <span className="font-mono">frontend/.env.local</span> (커밋 금지)
                      <br />- 운영: 배포 환경 Secret Manager / 환경변수
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={runApiRefine}
                        disabled={apiRefineLoading || !apiProfileJson.trim() || !apiRefineText.trim()}
                        className={cn(
                          "glass-button px-4 py-2.5 rounded-xl text-sm font-extrabold text-stone-700",
                          (apiRefineLoading || !apiProfileJson.trim() || !apiRefineText.trim()) && "opacity-60"
                        )}
                      >
                        {apiRefineLoading ? "수정 반영 중..." : "LLM에 수정 요청"}
                      </button>
                    </div>

                    {apiWarnings.length > 0 && (
                      <div className="p-4 rounded-2xl bg-red-50/50 border border-red-200 text-xs text-red-800 leading-relaxed">
                        <div className="font-extrabold mb-2">주의/경고</div>
                        <ul className="list-disc pl-5 space-y-1">
                          {apiWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Tab 3: 테스트/승인 */}
              <div className="p-5 rounded-3xl bg-white/40 border border-white/60">
                <div className="text-sm font-extrabold text-stone-800">3) 테스트/승인</div>
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">테스트 엔드포인트(path 또는 url)</label>
                    <input
                      className="ui-field"
                      value={apiTestEndpointPath}
                      onChange={(e) => setApiTestEndpointPath(e.target.value)}
                      placeholder="예: /LSO/.... 또는 https://..."
                    />
                    <label className="text-xs font-bold text-stone-600 mt-2">params (JSON)</label>
                    <textarea
                      className="ui-textarea min-h-[140px] font-mono text-xs"
                      value={apiTestParamsJson}
                      onChange={(e) => setApiTestParamsJson(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-stone-600">시크릿(테스트용, 저장되지 않음)</label>
                    <input
                      className="ui-field"
                      value={apiTestSecretOverride}
                      onChange={(e) => setApiTestSecretOverride(e.target.value)}
                      placeholder="(선택) authKey 값 등을 일시 입력"
                    />
                    {apiTestError && (
                      <div className="text-sm text-red-700 bg-red-50/60 border border-red-200 rounded-2xl px-4 py-3">
                        오류: {apiTestError}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsApiKeySetOpen(true)}
                        className="glass-button px-4 py-2.5 rounded-xl text-sm font-extrabold text-stone-700"
                      >
                        API Key Set
                      </button>
                      <div className="flex-1" />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={runApiTest}
                          disabled={apiTestLoading || !apiProfileJson.trim() || !apiTestEndpointPath.trim()}
                          className={cn(
                            "glass-button px-4 py-2.5 rounded-xl text-sm font-extrabold text-stone-700",
                            (apiTestLoading || !apiProfileJson.trim() || !apiTestEndpointPath.trim()) && "opacity-60"
                          )}
                        >
                          {apiTestLoading ? "테스트 중..." : "테스트 호출"}
                        </button>
                        <button
                          type="button"
                          onClick={approveAndSaveApiProfile}
                          disabled={!apiProfileJson.trim()}
                          className={cn(
                            "px-4 py-2.5 rounded-xl text-sm font-extrabold bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/30 transition-all active:scale-95",
                            !apiProfileJson.trim() && "opacity-60"
                          )}
                        >
                          승인 후 저장
                        </button>
                      </div>
                    </div>

                    {apiTestResult && (
                      <div className="mt-3 p-4 rounded-2xl bg-white/50 border border-white/70">
                        <div className="text-xs font-extrabold text-stone-700">테스트 결과</div>
                        <div className="mt-2 text-xs text-stone-600">
                          status: <span className="font-bold">{apiTestResult.status}</span>
                          <br />
                          content-type: {apiTestResult.content_type || "-"}
                          <br />
                          url: <span className="font-mono break-all">{apiTestResult.url}</span>
                        </div>
                        <pre className="mt-3 text-[11px] text-stone-700 whitespace-pre-wrap overflow-auto max-h-[220px]">
                          {apiTestResult.body_preview}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-white/60 bg-white/20">
              <div className="text-xs text-stone-600">
                저장 위치 요약: <span className="font-bold">비시크릿</span>은 `frontend/data/scraper-targets.json`에,
                <span className="font-bold"> 시크릿</span>은 `.env.local`/Secret Manager에 저장(참조는 `ENV:...`).
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Key Set Modal */}
      {/* API Extract Modal */}
      {isExtractModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsExtractModalOpen(false)} />
          <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-3xl bg-white/95 border border-white/60 shadow-2xl shadow-stone-900/30 overflow-hidden">
            <div className="p-5 border-b border-stone-200/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-lg font-extrabold text-stone-800">API 정보 분석 및 추출</div>
                {extractLoading && (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold animate-pulse">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    추출 진행 중...
                  </div>
                )}
              </div>
              <button onClick={() => setIsExtractModalOpen(false)} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
                <span className="sr-only">닫기</span>
                <svg className="w-5 h-5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-stone-50/50">
              {extractLoading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-6">
                  {/* 도넛 애니메이션 */}
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 rounded-full border-4 border-stone-200" />
                    <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                  </div>
                  <div className="text-stone-500 font-semibold animate-pulse">
                    문서를 분석하고 엔드포인트를 추출하고 있습니다...
                  </div>
                </div>
              ) : extractError ? (
                <div className="flex flex-col items-center justify-center h-64 gap-4 text-red-600">
                  <div className="p-4 rounded-full bg-red-50 mb-2">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="font-bold">오류가 발생했습니다</div>
                  <div className="text-sm bg-red-50 px-4 py-2 rounded-lg">{extractError}</div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-bold text-stone-700">
                      추출된 엔드포인트 ({extractedEndpoints.length}개)
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedExtractEndpoints(extractedEndpoints.map(e => e.title))}
                        className="text-xs text-primary font-semibold hover:underline"
                      >
                        전체 선택
                      </button>
                      <button
                        onClick={() => setSelectedExtractEndpoints([])}
                        className="text-xs text-stone-500 font-semibold hover:underline"
                      >
                        선택 해제
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {extractedEndpoints.map((ep, i) => {
                      const isSelected = selectedExtractEndpoints.includes(ep.title);
                      return (
                      <div
                        key={`ep-${i}-${ep.title}`}
                        className={cn(
                          "p-3 rounded-xl border-2 transition-all cursor-pointer hover:shadow-md",
                          isSelected
                            ? "bg-primary/15 border-primary shadow-md ring-2 ring-primary/20"
                            : "bg-white border-stone-200 hover:border-stone-300"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedExtractEndpoints(prev => 
                            isSelected 
                              ? prev.filter(t => t !== ep.title)
                              : [...prev, ep.title]
                          );
                        }}
                      >
                        <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm text-stone-800 truncate" title={ep.title}>
                              {ep.title}
                            </div>
                            {ep.category && (
                              <div className="text-[10px] text-primary/80 font-semibold mt-0.5">
                                {ep.category}
                              </div>
                            )}
                            <div className="flex gap-3 mt-1.5 text-xs text-stone-500">
                              {typeof ep.params_count === "number" && (
                                <span>요청변수: <strong>{ep.params_count}</strong>개</span>
                              )}
                              {typeof ep.fields_count === "number" && (
                                <span>응답필드: <strong>{ep.fields_count}</strong>개</span>
                              )}
                            </div>
                            {ep.request_url && (
                              <div className="text-[10px] text-stone-400 mt-1 truncate font-mono">
                                {ep.request_url}
                              </div>
                            )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-stone-200/50 bg-white flex justify-between items-center">
              <div className="text-xs text-stone-500 font-medium">
                {savedJsonPath ? (
                  <span className="text-green-600 font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    저장됨: {savedJsonPath.split(/[/\\]/).pop()}
                  </span>
                ) : (
                  <span>선택된 항목: {selectedExtractEndpoints.length}개</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveExtractedJson}
                  disabled={extractedEndpoints.length === 0 || extractLoading}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors disabled:opacity-50"
                >
                  JSON으로 저장
                </button>
                <button
                  type="button"
                  onClick={applyExtractedEndpoints}
                  disabled={selectedExtractEndpoints.length === 0}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-stone-900 text-white hover:bg-black transition-colors shadow-lg shadow-stone-900/20 disabled:opacity-50"
                >
                  EP 적용
                </button>
                <button
                  type="button"
                  onClick={() => setIsExtractModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-stone-500 hover:bg-stone-100 transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* JSON 불러오기 모달 */}
      {isJsonLoadModalOpen && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsJsonLoadModalOpen(false)} />
          <div className="relative w-full max-w-2xl max-h-[70vh] flex flex-col rounded-3xl bg-white/95 border border-white/60 shadow-2xl shadow-stone-900/30 overflow-hidden">
            <div className="p-5 border-b border-stone-200/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-5 h-5 text-stone-600" />
                <div className="text-lg font-extrabold text-stone-800">저장된 API 정보 불러오기</div>
              </div>
              <button onClick={() => setIsJsonLoadModalOpen(false)} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
                <svg className="w-5 h-5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-stone-50/50">
              {jsonLoadLoading ? (
                <div className="flex items-center justify-center h-40 gap-3 text-stone-500">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>파일 목록 로딩 중...</span>
                </div>
              ) : jsonFiles.length === 0 ? (
                <div className="text-center py-12 text-stone-500">
                  <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <div className="font-semibold">저장된 API 정보 파일이 없습니다.</div>
                  <div className="text-xs mt-1">API 가이드 URL을 입력하고 "API 정보 분석"을 실행하면 JSON 파일이 생성됩니다.</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {jsonFiles.map((file) => (
                    <div
                      key={file.filename}
                      className={cn(
                        "p-4 rounded-xl border-2 cursor-pointer transition-all hover:shadow-md",
                        selectedJsonFile === file.filename
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-stone-200 bg-white hover:border-stone-300"
                      )}
                      onClick={() => setSelectedJsonFile(file.filename)}
                      onDoubleClick={() => loadJsonFile(file.filename)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-2 rounded-lg",
                          selectedJsonFile === file.filename ? "bg-primary text-white" : "bg-stone-100 text-stone-500"
                        )}>
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-stone-800 truncate">
                            {file.org_id.toUpperCase()}.json
                          </div>
                          {file.org_name && (
                            <div className="text-xs text-stone-500 truncate">{file.org_name}</div>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-stone-400">
                            <span>엔드포인트: {file.total_endpoints}개</span>
                            <span>{new Date(file.modified_at).toLocaleDateString('ko-KR')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-stone-200/50 bg-white flex items-center justify-between">
              <div className="text-xs text-stone-500">
                {selectedJsonFile ? (
                  <span className="text-primary font-semibold">선택됨: {selectedJsonFile}</span>
                ) : (
                  <span>파일을 선택하거나 더블클릭하여 불러오세요</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => selectedJsonFile && loadJsonFile(selectedJsonFile)}
                  disabled={!selectedJsonFile || jsonLoadLoading}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-stone-900 text-white hover:bg-black transition-colors disabled:opacity-50"
                >
                  불러오기
                </button>
                <button
                  type="button"
                  onClick={() => setIsJsonLoadModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-stone-500 hover:bg-stone-100 transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isApiKeySetOpen && orgDraft && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setIsApiKeySetOpen(false)} />
          <div className="relative w-full max-w-3xl rounded-3xl glass-panel border border-white/70 shadow-2xl shadow-stone-900/20 overflow-hidden">
            <div className="p-6 flex items-start justify-between gap-4 border-b border-white/60 bg-white/20">
              <div>
                <div className="text-lg font-extrabold text-stone-800">API Key Set (안내)</div>
                <div className="text-xs text-stone-500 mt-1">
                  보안/브라우저 정책상 웹앱이 사용자의 로컬 <span className="font-mono">.env</span> 파일을 직접 생성/수정할 수는 없습니다.
                  대신 필요한 환경변수 템플릿을 제공해 직접 설정하도록 합니다.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsApiKeySetOpen(false)}
                className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-700"
              >
                닫기
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div className="p-4 rounded-2xl bg-white/40 border border-white/60 text-sm text-stone-700 leading-relaxed">
                - 개발 환경: <span className="font-mono">frontend/.env.local</span>에 환경변수를 추가하세요(커밋 금지).
                <br />- 운영 환경: 배포 플랫폼의 Secret Manager/환경변수 기능을 사용하세요.
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-stone-600">예시 .env.local 템플릿</label>
                <textarea
                  className="ui-textarea min-h-[180px] font-mono text-xs"
                  readOnly
                  value={buildEnvTemplateFromApiProfile(orgDraft.org_id)}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const text = buildEnvTemplateFromApiProfile(orgDraft.org_id);
                      await navigator.clipboard.writeText(text);
                    }}
                    className="glass-button px-4 py-2.5 rounded-xl text-sm font-extrabold text-stone-700"
                  >
                    복사
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const text = buildEnvTemplateFromApiProfile(orgDraft.org_id);
                      const blob = new Blob([text], { type: "text/plain" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = ".env.local.template";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    className="glass-button px-4 py-2.5 rounded-xl text-sm font-extrabold text-stone-700"
                  >
                    파일로 받기
                  </button>
                </div>
              </div>
              <div className="text-[11px] text-stone-500 font-semibold">
                * 시크릿을 앱이 파일로 직접 저장하도록 만드는 것은 보안 위험이 커서(권한/감사/유출) 권장하지 않습니다.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 스케쥴 설정 모달 */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsScheduleModalOpen(false)} />
          <div className="relative w-full max-w-5xl rounded-3xl bg-gradient-to-br from-white/95 to-stone-50/95 border border-white/60 shadow-2xl overflow-hidden">
            {/* 헤더 */}
            <div className="p-5 border-b border-stone-200/50 flex items-center justify-between bg-white/80 backdrop-blur-sm">
              <div className="text-lg font-extrabold text-stone-800">📅 스케쥴 설정</div>
              <button 
                onClick={() => setIsScheduleModalOpen(false)} 
                className="p-2 hover:bg-stone-100 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* 본문 */}
            <div className="p-6 bg-gradient-to-br from-stone-50/50 to-stone-100/30">
              <div className="flex gap-6 items-stretch">
                {/* 왼쪽: 기간 설정 + 캘린더 */}
                <div className="w-[380px] flex-shrink-0 flex flex-col">
                  <div className={cn(
                    "p-4 rounded-2xl border shadow-lg transition-all duration-300 flex-1 flex flex-col",
                    scheduleConfig.scheduleMode === "period" 
                      ? "bg-white/90 backdrop-blur-sm border-primary/30 shadow-primary/10" 
                      : scheduleConfig.scheduleMode === "cycle"
                        ? "bg-stone-100/50 border-stone-200/60 opacity-60"
                        : "bg-white/80 border-stone-200/60"
                  )}>
                    {/* 체크 옵션 + 라벨 */}
                    <label className="flex items-center gap-3 mb-4 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scheduleConfig.scheduleMode === "period"}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setScheduleConfig(p => ({ ...p, scheduleMode: "period" }));
                          } else {
                            setScheduleConfig(p => ({ ...p, scheduleMode: "" }));
                          }
                        }}
                        className="w-5 h-5 rounded-md accent-primary"
                      />
                      <span className="text-sm font-bold text-stone-700">기간 설정</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 font-semibold">특정 기간 동안 매일 수집</span>
                    </label>
                    
                    {/* 시작일/종료일 텍스트 박스 */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div 
                        className={cn(
                          "cursor-pointer transition-all",
                          scheduleConfig.calendarSelectTarget === "start" && scheduleConfig.scheduleMode === "period" && "ring-2 ring-primary/50 rounded-xl"
                        )}
                        onClick={() => scheduleConfig.scheduleMode === "period" && setScheduleConfig(p => ({ ...p, calendarSelectTarget: "start" }))}
                      >
                        <label className="text-xs text-stone-500 font-semibold mb-1 block">시작일</label>
                        <div className={cn(
                          "ui-field text-sm w-full h-10 flex items-center px-3 rounded-xl",
                          scheduleConfig.scheduleMode !== "period" && "bg-stone-100 text-stone-400"
                        )}>
                          {scheduleConfig.startDate || <span className="text-stone-400">날짜 선택</span>}
                        </div>
                      </div>
                      <div 
                        className={cn(
                          "cursor-pointer transition-all",
                          scheduleConfig.calendarSelectTarget === "end" && scheduleConfig.scheduleMode === "period" && "ring-2 ring-primary/50 rounded-xl"
                        )}
                        onClick={() => scheduleConfig.scheduleMode === "period" && setScheduleConfig(p => ({ ...p, calendarSelectTarget: "end" }))}
                      >
                        <label className="text-xs text-stone-500 font-semibold mb-1 block">종료일</label>
                        <div className={cn(
                          "ui-field text-sm w-full h-10 flex items-center px-3 rounded-xl",
                          scheduleConfig.scheduleMode !== "period" && "bg-stone-100 text-stone-400"
                        )}>
                          {scheduleConfig.endDate || <span className="text-stone-400">날짜 선택</span>}
                        </div>
                      </div>
                    </div>
                    
                    {/* 캘린더 UI */}
                    <div className={cn(
                      "rounded-2xl p-4 transition-all duration-300 flex-1 flex flex-col",
                      "bg-gradient-to-br from-white/80 to-stone-50/80 backdrop-blur-md",
                      "border border-white/60 shadow-xl shadow-stone-200/50",
                      scheduleConfig.scheduleMode !== "period" && "opacity-50 pointer-events-none"
                    )}>
                      {/* 캘린더 헤더 */}
                      <div className="flex items-center justify-between mb-4">
                        <button
                          type="button"
                          onClick={() => setCalendarViewDate(new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() - 1))}
                          className="p-2 hover:bg-stone-100 rounded-xl transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4 text-stone-600" />
                        </button>
                        <div className="text-sm font-bold text-stone-700">
                          {calendarViewDate.getFullYear()}년 {calendarViewDate.getMonth() + 1}월
                        </div>
                        <button
                          type="button"
                          onClick={() => setCalendarViewDate(new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1))}
                          className="p-2 hover:bg-stone-100 rounded-xl transition-colors"
                        >
                          <ChevronRight className="w-4 h-4 text-stone-600" />
                        </button>
                      </div>
                      
                      {/* 요일 헤더 */}
                      <div className="grid grid-cols-7 gap-1 mb-2">
                        {["일", "월", "화", "수", "목", "금", "토"].map((day, i) => (
                          <div key={day} className={cn(
                            "text-center text-xs font-semibold py-1",
                            i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-stone-400"
                          )}>
                            {day}
                          </div>
                        ))}
                      </div>
                      
                      {/* 날짜 그리드 */}
                      <div className="grid grid-cols-7 gap-1">
                        {getCalendarDays(calendarViewDate.getFullYear(), calendarViewDate.getMonth()).map((day, idx) => {
                          const dateStr = `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.date).padStart(2, "0")}`;
                          const isStart = scheduleConfig.startDate === dateStr;
                          const isEnd = scheduleConfig.endDate === dateStr;
                          const isInRange = scheduleConfig.startDate && scheduleConfig.endDate && 
                            dateStr > scheduleConfig.startDate && dateStr < scheduleConfig.endDate;
                          const dayOfWeek = new Date(day.year, day.month, day.date).getDay();
                          
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleCalendarDateClick(day)}
                              className={cn(
                                "w-full aspect-square flex items-center justify-center text-xs font-medium rounded-xl transition-all duration-200",
                                !day.isCurrentMonth && "text-stone-300",
                                day.isCurrentMonth && dayOfWeek === 0 && "text-red-500",
                                day.isCurrentMonth && dayOfWeek === 6 && "text-blue-500",
                                day.isCurrentMonth && dayOfWeek !== 0 && dayOfWeek !== 6 && "text-stone-700",
                                isStart && "bg-gradient-to-br from-primary to-primary/80 text-white shadow-lg shadow-primary/30 scale-110",
                                isEnd && "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 scale-110",
                                isInRange && "bg-primary/10 text-primary",
                                !isStart && !isEnd && day.isCurrentMonth && "hover:bg-stone-100 hover:scale-105"
                              )}
                            >
                              {day.date}
                            </button>
                          );
                        })}
                      </div>
                      
                      {/* 범례 */}
                      <div className="flex items-center justify-center gap-4 mt-4 text-[10px]">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-md bg-gradient-to-br from-primary to-primary/80" />
                          <span className="text-stone-500">시작일</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600" />
                          <span className="text-stone-500">종료일</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* 오른쪽: 주기 설정 + 시간 설정 */}
                <div className="flex-1 flex flex-col gap-4">
                  {/* 주기 설정 */}
                  <div className={cn(
                    "p-4 rounded-2xl border shadow-lg transition-all duration-300",
                    scheduleConfig.scheduleMode === "cycle" 
                      ? "bg-white/90 backdrop-blur-sm border-primary/30 shadow-primary/10" 
                      : scheduleConfig.scheduleMode === "period"
                        ? "bg-stone-100/50 border-stone-200/60 opacity-60"
                        : "bg-white/80 border-stone-200/60"
                  )}>
                    {/* 체크 옵션 + 라벨 */}
                    <label className="flex items-center gap-3 mb-4 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scheduleConfig.scheduleMode === "cycle"}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setScheduleConfig(p => ({ ...p, scheduleMode: "cycle" }));
                          } else {
                            setScheduleConfig(p => ({ ...p, scheduleMode: "" }));
                          }
                        }}
                        className="w-5 h-5 rounded-md accent-primary"
                      />
                      <span className="text-sm font-bold text-stone-700">주기 설정</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 font-semibold">반복 주기로 수집</span>
                    </label>
                    
                    <div className={cn(
                      "flex flex-col gap-3 transition-all",
                      scheduleConfig.scheduleMode !== "cycle" && "opacity-50 pointer-events-none"
                    )}>
                      {/* 매 월 특정일 */}
                      <div 
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all",
                          scheduleConfig.cycleType === "monthly" 
                            ? "bg-primary/5 border-2 border-primary/30" 
                            : "bg-stone-50 border-2 border-transparent hover:bg-stone-100"
                        )}
                        onClick={() => {
                          if (scheduleConfig.scheduleMode === "cycle") {
                            setScheduleConfig(p => ({ ...p, cycleType: p.cycleType === "monthly" ? "" : "monthly" }));
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={scheduleConfig.cycleType === "monthly"}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-sm text-stone-700 whitespace-nowrap">매 월 특정일</span>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={scheduleConfig.monthlyDay}
                          onChange={(e) => { e.stopPropagation(); setScheduleConfig(p => ({ ...p, monthlyDay: e.target.value })); }}
                          onClick={(e) => e.stopPropagation()}
                          className="ui-field text-sm text-center"
                          style={{ width: "70px" }}
                          disabled={scheduleConfig.cycleType !== "monthly"}
                        />
                        <span className="text-sm text-stone-500 whitespace-nowrap">일 마다 수집</span>
                      </div>
                      
                      {/* 매 주 특정 요일 */}
                      <div 
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all",
                          scheduleConfig.cycleType === "weekly" 
                            ? "bg-primary/5 border-2 border-primary/30" 
                            : "bg-stone-50 border-2 border-transparent hover:bg-stone-100"
                        )}
                        onClick={() => {
                          if (scheduleConfig.scheduleMode === "cycle") {
                            setScheduleConfig(p => ({ ...p, cycleType: p.cycleType === "weekly" ? "" : "weekly" }));
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={scheduleConfig.cycleType === "weekly"}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-sm text-stone-700 whitespace-nowrap">매 주</span>
                        <select
                          value={scheduleConfig.weeklyDay}
                          onChange={(e) => { e.stopPropagation(); setScheduleConfig(p => ({ ...p, weeklyDay: e.target.value })); }}
                          onClick={(e) => e.stopPropagation()}
                          className="ui-field text-sm"
                          style={{ width: "70px" }}
                          disabled={scheduleConfig.cycleType !== "weekly"}
                        >
                          <option value="mon">월</option>
                          <option value="tue">화</option>
                          <option value="wed">수</option>
                          <option value="thu">목</option>
                          <option value="fri">금</option>
                          <option value="sat">토</option>
                          <option value="sun">일</option>
                        </select>
                        <span className="text-sm text-stone-500 whitespace-nowrap">요일 마다 수집</span>
                      </div>
                      
                      {/* N일 간격 */}
                      <div 
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all",
                          scheduleConfig.cycleType === "interval" 
                            ? "bg-primary/5 border-2 border-primary/30" 
                            : "bg-stone-50 border-2 border-transparent hover:bg-stone-100"
                        )}
                        onClick={() => {
                          if (scheduleConfig.scheduleMode === "cycle") {
                            setScheduleConfig(p => ({ ...p, cycleType: p.cycleType === "interval" ? "" : "interval" }));
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={scheduleConfig.cycleType === "interval"}
                          readOnly
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <select
                          value={scheduleConfig.intervalDays}
                          onChange={(e) => { e.stopPropagation(); setScheduleConfig(p => ({ ...p, intervalDays: e.target.value })); }}
                          onClick={(e) => e.stopPropagation()}
                          className="ui-field text-sm"
                          style={{ width: "70px" }}
                          disabled={scheduleConfig.cycleType !== "interval"}
                        >
                          <option value="1">1</option>
                          <option value="5">5</option>
                          <option value="10">10</option>
                          <option value="30">30</option>
                          <option value="90">90</option>
                          <option value="180">180</option>
                        </select>
                        <span className="text-sm text-stone-500 whitespace-nowrap">일 마다 수집</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* 시간 설정 */}
                  <div className="p-4 rounded-2xl bg-white/80 backdrop-blur-sm border border-stone-200/60 shadow-lg">
                    <div className="text-sm font-bold text-stone-700 mb-4 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">⏰</span>
                      시간 설정
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      {/* 표준시 선택 */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-stone-500 font-semibold whitespace-nowrap">표준시</label>
                        <select
                          value={scheduleConfig.timezone}
                          onChange={(e) => setScheduleConfig(p => ({ ...p, timezone: e.target.value }))}
                          className="ui-field text-sm"
                          style={{ width: "120px" }}
                        >
                          <option value="Asia/Tokyo">도쿄 (JST)</option>
                          <option value="Asia/Seoul">서울 (KST)</option>
                          <option value="UTC">UTC</option>
                          <option value="America/New_York">뉴욕 (EST)</option>
                          <option value="Europe/London">런던 (GMT)</option>
                        </select>
                      </div>
                      
                      {/* 시간/분 선택 */}
                      <div className="flex items-center gap-2">
                        <select
                          value={scheduleConfig.hour}
                          onChange={(e) => setScheduleConfig(p => ({ ...p, hour: e.target.value }))}
                          className="ui-field text-lg font-mono text-center"
                          style={{ width: "70px" }}
                        >
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={String(i)}>{String(i).padStart(2, "0")}</option>
                          ))}
                        </select>
                        <span className="text-xl font-bold text-stone-400">:</span>
                        <select
                          value={scheduleConfig.minute}
                          onChange={(e) => setScheduleConfig(p => ({ ...p, minute: e.target.value }))}
                          className="ui-field text-lg font-mono text-center"
                          style={{ width: "70px" }}
                        >
                          {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                            <option key={m} value={String(m)}>{String(m).padStart(2, "0")}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="text-sm text-stone-500">
                        {scheduleConfig.hour}시 {scheduleConfig.minute}분에 실행
                      </div>
                    </div>
                  </div>
                  
                  {/* 현재 설정 미리보기 - 기간 설정 카드 하단과 맞춤 */}
                  <div className={cn(
                    "p-4 rounded-2xl border-2 shadow-lg flex-1 flex flex-col justify-center",
                    scheduleConfig.scheduleMode
                      ? "bg-gradient-to-r from-primary/10 to-emerald-500/10 border-primary/20"
                      : "bg-stone-50/80 border-stone-200/40"
                  )}>
                    <div className={cn(
                      "text-xs font-bold mb-2",
                      scheduleConfig.scheduleMode ? "text-primary" : "text-stone-400"
                    )}>
                      📋 현재 설정
                    </div>
                    <div className={cn(
                      "text-lg font-bold",
                      scheduleConfig.scheduleMode ? "text-stone-800" : "text-stone-400"
                    )}>
                      {scheduleConfig.scheduleMode 
                        ? (buildScheduleSummary() || "설정을 완료해주세요")
                        : "기간 설정 또는 주기 설정을 선택해주세요"
                      }
                    </div>
                    {scheduleConfig.scheduleMode && buildScheduleCron() && (
                      <div className="text-xs text-stone-500 mt-2 font-mono bg-stone-100 px-2 py-1 rounded inline-block">
                        cron: {buildScheduleCron()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            {/* 푸터 */}
            <div className="p-5 border-t border-stone-200/50 bg-white/80 backdrop-blur-sm flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="glass-button px-5 py-2.5 rounded-xl text-sm font-semibold text-stone-700"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  const cron = buildScheduleCron();
                  if (cron && boardDraft) {
                    setBoardDraft({ 
                      ...boardDraft, 
                      schedule_cron: cron,
                      schedule_timezone: scheduleConfig.timezone,
                      schedule_config: {
                        scheduleMode: scheduleConfig.scheduleMode,
                        startDate: scheduleConfig.startDate || undefined,
                        endDate: scheduleConfig.endDate || undefined,
                        cycleType: scheduleConfig.cycleType || undefined,
                        monthlyDay: scheduleConfig.monthlyDay || undefined,
                        weeklyDay: scheduleConfig.weeklyDay || undefined,
                        intervalDays: scheduleConfig.intervalDays || undefined,
                        hour: scheduleConfig.hour || undefined,
                        minute: scheduleConfig.minute || undefined,
                      },
                    });
                  }
                  setIsScheduleModalOpen(false);
                }}
                disabled={!scheduleConfig.scheduleMode || (scheduleConfig.scheduleMode === "cycle" && !scheduleConfig.cycleType)}
                className="px-6 py-2.5 rounded-xl text-sm font-bold bg-stone-900 text-white hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-stone-900/20"
              >
                설정 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



