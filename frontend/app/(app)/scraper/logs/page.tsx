"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FolderOpen, RefreshCw, FileText, Network, HardDrive,
  Save, RotateCcw, Check, AlertCircle, Info, ChevronDown, ChevronUp,
  Settings2, Download, HelpCircle, FolderSearch, AlertTriangle,
  FileWarning, Eye, Wrench, ExternalLink, X, Calendar, Clock,
  Bot, Loader2, ChevronLeft, ChevronRight, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// 타입 정의
// ============================================================

type FolderStructure = "flat" | "by_org" | "by_org_board" | "by_org_board_date" | "by_date_org_board";
type DuplicateHandling = "skip" | "overwrite" | "version";
type FailureAction = "skip" | "log_only" | "stop";

// 파일명 규칙 타입
type DocFileNameRule = "simple" | "board_prefix" | "date_board" | "datetime_board";
type AttachmentFileNameRule = "original" | "date_prefix" | "datetime_prefix";

// 정규 스크래핑용 경로 (스케줄 기반) - 공통 경로 + 파일명 규칙만 분리
interface PathSettings {
  basePath: string;                         // 공통 저장 경로
  folderStructure: FolderStructure;         // 공통 폴더 구조
  docFileNameRule: DocFileNameRule;         // 제목/본문 파일명 규칙
  attachmentFileNameRule: AttachmentFileNameRule;  // 첨부파일 파일명 규칙
}

// 스크래핑 테스트용 경로 (즉시 실행) - 단순 경로만
interface TestPathSettings {
  documentsPath: string;      // 제목/본문 목록 저장 경로
  attachmentsPath: string;    // 첨부파일 저장 경로
}

interface RetrySettings {
  maxRetries: number;
  retryIntervalSec: number;
  useExponentialBackoff: boolean;
  timeoutSec: number;
  failureAction: FailureAction;
}
interface FileManagementSettings {
  maxFileSizeMb: number;
  duplicateHandling: DuplicateHandling;
  allowedExtensions: string[];
  concurrentDownloads: number;
}
interface NetworkSettings {
  skipSslVerification: boolean;
  customUserAgent: string;
  proxyUrl: string;
  autoReferer: boolean;
}
interface StorageSettings {
  warningThresholdGb: number;
  autoCleanupEnabled: boolean;
  autoCleanupDays: number;
  maxStorageGb: number;
}
interface DownloadSettings {
  path: PathSettings;
  testPath: TestPathSettings;
  retry: RetrySettings;
  fileManagement: FileManagementSettings;
  network: NetworkSettings;
  storage: StorageSettings;
  updatedAt: string;
}

// ============================================================
// 옵션 라벨
// ============================================================

const FOLDER_OPTIONS = [
  { value: "flat", label: "단일 폴더" },
  { value: "by_org", label: "{기관ID}/" },
  { value: "by_org_board", label: "{기관ID}/{보드ID}/" },
  { value: "by_org_board_date", label: "{기관ID}/{보드ID}/{YYYY-MM}/" },
  { value: "by_date_org_board", label: "{YYYY-MM}/{기관ID}/{보드ID}/" },
];

// 제목/본문 목록 파일명 규칙
const DOC_FILENAME_OPTIONS = [
  { value: "simple", label: "제목&본문 목록" },
  { value: "board_prefix", label: "보드명_제목&본문 목록" },
  { value: "date_board", label: "[YYYY-MM-DD]_보드명_제목&본문 목록" },
  { value: "datetime_board", label: "[YYYY-MM-DD-HHmmss]_보드명_제목&본문 목록" },
];

// 첨부파일명 규칙 (문서ID 옵션 제외)
const ATTACHMENT_FILENAME_OPTIONS = [
  { value: "original", label: "원본 파일명" },
  { value: "date_prefix", label: "[YYYY-MM-DD]_원본명" },
  { value: "datetime_prefix", label: "[YYYY-MM-DD_HHmmss]_원본명" },
];
const DUPLICATE_OPTIONS = [
  { value: "skip", label: "건너뛰기" },
  { value: "overwrite", label: "덮어쓰기" },
  { value: "version", label: "버전 추가 (_v2)" },
];
const FAILURE_OPTIONS = [
  { value: "skip", label: "건너뛰고 계속" },
  { value: "log_only", label: "로그만 기록" },
  { value: "stop", label: "전체 중단" },
];

// ============================================================
// 에러 관련 타입
// ============================================================

type ErrorType = "timeout" | "http_error" | "parsing" | "network" | "dom_change" | "unknown";

interface ErrorStats {
  last_24h: number;
  last_7d: number;
  pending: number;
  by_type: Record<ErrorType, number>;
  type_labels: Record<ErrorType, string>;
}

interface ErrorLogItem {
  log_id: string;
  board_id: string;
  board_name: string;
  org_id: string;
  org_name: string;
  schedule_id: string | null;
  schedule_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  docs_scraped: number;
  docs_failed: number;
  docs_skipped: number;
  pages_processed: number;
  error_message: string | null;
  error_type: ErrorType;
}

interface LLMProvider {
  id: string;
  name: string;
  configured: boolean;
  models: string[];
}

interface AnalysisResult {
  summary: string;
  possible_causes: string[];
  suggested_actions: string[];
  confidence: "high" | "medium" | "low";
  additional_notes?: string;
}

// ============================================================
// 변경 감지 관련 타입
// ============================================================

type ChangeType = "list_url" | "board_structure" | "download_url" | "pagination" | "selector" | "other";

interface BoardChangeInfo {
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

interface OrgChangeGroup {
  org_id: string;
  org_name: string;
  org_logo?: string;
  boards: BoardChangeInfo[];
  change_count: number;
}

interface ChangeAnalysisResult {
  summary: string;
  impact_assessment: string;
  recommended_changes: string[];
  auto_fix_possible: boolean;
  manual_steps?: string[];
  confidence: "high" | "medium" | "low";
}

// 기본값
const DEFAULT: DownloadSettings = {
  path: {
    basePath: "./data/scraping",
    folderStructure: "by_org_board_date",
    docFileNameRule: "simple",
    attachmentFileNameRule: "original",
  },
  testPath: {
    documentsPath: "./data/test/documents",
    attachmentsPath: "./data/test/attachments",
  },
  retry: { maxRetries: 3, retryIntervalSec: 5, useExponentialBackoff: true, timeoutSec: 60, failureAction: "skip" },
  fileManagement: { maxFileSizeMb: 100, duplicateHandling: "skip", allowedExtensions: [], concurrentDownloads: 2 },
  network: { skipSslVerification: false, customUserAgent: "Mozilla/5.0 EcoMonitorBot/1.0", proxyUrl: "", autoReferer: true },
  storage: { warningThresholdGb: 10, autoCleanupEnabled: false, autoCleanupDays: 365, maxStorageGb: 0 },
  updatedAt: "",
};

// ============================================================
// 메인 컴포넌트
// ============================================================

export default function ScraperSettingsPage() {
  const [settings, setSettings] = useState<DownloadSettings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showBackoffHelp, setShowBackoffHelp] = useState(false);
  const [downloadExpanded, setDownloadExpanded] = useState(true);

  // 에러 관리 상태
  const [errorStats, setErrorStats] = useState<ErrorStats | null>(null);
  const [errorList, setErrorList] = useState<ErrorLogItem[]>([]);
  const [errorTotal, setErrorTotal] = useState(0);
  const [errorPage, setErrorPage] = useState(0);
  const [errorLoading, setErrorLoading] = useState(false);
  const [errorTypeFilter, setErrorTypeFilter] = useState<ErrorType | "">("");
  const [errorSearch, setErrorSearch] = useState("");
  const [selectedError, setSelectedError] = useState<ErrorLogItem | null>(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  
  // LLM 분석 상태
  const [llmProviders, setLlmProviders] = useState<LLMProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // 변경 감지 상태
  const [changeOrgs, setChangeOrgs] = useState<OrgChangeGroup[]>([]);
  const [changeTotalCount, setChangeTotalCount] = useState(0);
  const [changeTypeLabels, setChangeTypeLabels] = useState<Record<string, string>>({});
  const [changeLoading, setChangeLoading] = useState(false);
  const [expandedChangeOrgs, setExpandedChangeOrgs] = useState<string[]>([]);
  const [selectedChange, setSelectedChange] = useState<BoardChangeInfo | null>(null);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeAnalyzing, setChangeAnalyzing] = useState(false);
  const [changeAnalysisResult, setChangeAnalysisResult] = useState<ChangeAnalysisResult | null>(null);
  const [changeAnalysisError, setChangeAnalysisError] = useState<string | null>(null);
  const [changeSelectedProvider, setChangeSelectedProvider] = useState("openai");

  const ERRORS_PER_PAGE = 10;

  // 에러 통계 로드
  const loadErrorStats = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/logs/errors?mode=stats");
      const data = await res.json();
      if (!data.error) {
        setErrorStats(data);
      }
    } catch (err) {
      console.error("Failed to load error stats:", err);
    }
  }, []);

  // 에러 목록 로드
  const loadErrorList = useCallback(async (page: number = 0) => {
    setErrorLoading(true);
    try {
      const params = new URLSearchParams({
        mode: "list",
        limit: String(ERRORS_PER_PAGE),
        offset: String(page * ERRORS_PER_PAGE),
      });
      if (errorTypeFilter) params.append("errorType", errorTypeFilter);
      
      const res = await fetch(`/api/scraper/logs/errors?${params}`);
      const data = await res.json();
      if (!data.error) {
        setErrorList(data.items || []);
        setErrorTotal(data.total || 0);
      }
    } catch (err) {
      console.error("Failed to load error list:", err);
    } finally {
      setErrorLoading(false);
    }
  }, [errorTypeFilter]);

  // LLM 제공자 목록 로드
  const loadLLMProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/logs/analyze");
      const data = await res.json();
      if (data.providers) {
        setLlmProviders(data.providers);
        // 설정된 제공자 중 첫 번째를 기본값으로
        const configured = data.providers.find((p: LLMProvider) => p.configured);
        if (configured) setSelectedProvider(configured.id);
      }
    } catch (err) {
      console.error("Failed to load LLM providers:", err);
    }
  }, []);

  // 변경 감지 목록 로드
  const loadChangeData = useCallback(async () => {
    setChangeLoading(true);
    try {
      const res = await fetch("/api/scraper/config/changes");
      const data = await res.json();
      if (!data.error) {
        setChangeOrgs(data.organizations || []);
        setChangeTotalCount(data.total_changes || 0);
        setChangeTypeLabels(data.type_labels || {});
        
        // 변경 감지된 기관 자동 펼치기
        const orgsWithChanges = (data.organizations || [])
          .filter((org: OrgChangeGroup) => org.change_count > 0)
          .map((org: OrgChangeGroup) => org.org_id);
        setExpandedChangeOrgs(orgsWithChanges);
      }
    } catch (err) {
      console.error("Failed to load change data:", err);
    } finally {
      setChangeLoading(false);
    }
  }, []);

  // 변경 감지 기관 펼치기/접기
  const toggleChangeOrg = (orgId: string) => {
    setExpandedChangeOrgs((prev) =>
      prev.includes(orgId)
        ? prev.filter((id) => id !== orgId)
        : [...prev, orgId]
    );
  };

  // 변경 사항 LLM 분석
  const runChangeAnalysis = async () => {
    if (!selectedChange || !selectedChange.change_details) return;
    
    setChangeAnalyzing(true);
    setChangeAnalysisResult(null);
    setChangeAnalysisError(null);
    
    try {
      const res = await fetch("/api/scraper/config/changes/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId: selectedChange.board_id,
          changeDetails: selectedChange.change_details,
          changeType: selectedChange.change_type,
          provider: changeSelectedProvider,
        }),
      });
      const data = await res.json();
      
      if (data.error) {
        setChangeAnalysisError(data.error);
      } else if (data.analysis) {
        setChangeAnalysisResult(data.analysis);
      }
    } catch (err: any) {
      setChangeAnalysisError(err.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setChangeAnalyzing(false);
    }
  };

  // LLM 분석 실행
  const runAnalysis = async () => {
    if (!selectedError) return;
    
    setAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisError(null);
    
    try {
      const res = await fetch("/api/scraper/logs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: selectedError.log_id,
          provider: selectedProvider,
        }),
      });
      const data = await res.json();
      
      if (data.error) {
        setAnalysisError(data.error);
      } else if (data.analysis) {
        setAnalysisResult(data.analysis);
      }
    } catch (err: any) {
      setAnalysisError(err.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    fetch("/api/scraper/settings/download")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setSettings(d); })
      .finally(() => setLoading(false));
    
    // 에러 데이터 로드
    loadErrorStats();
    loadErrorList(0);
    loadLLMProviders();
    
    // 변경 감지 데이터 로드
    loadChangeData();
  }, [loadErrorStats, loadErrorList, loadLLMProviders, loadChangeData]);

  // 필터 변경 시 목록 새로고침
  useEffect(() => {
    setErrorPage(0);
    loadErrorList(0);
  }, [errorTypeFilter, loadErrorList]);

  const save = async () => {
    setSaving(true); setMsg(null);
    const res = await fetch("/api/scraper/settings/download", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
    });
    const d = await res.json();
    if (res.ok && d.ok) { setMsg({ type: "ok", text: "저장 완료" }); setSettings(d.settings); }
    else setMsg({ type: "err", text: d.error || "저장 실패" });
    setSaving(false);
  };

  const reset = async () => {
    if (!confirm("모든 설정을 초기화하시겠습니까?")) return;
    setSaving(true);
    const res = await fetch("/api/scraper/settings/download", { method: "DELETE" });
    const d = await res.json();
    if (res.ok) { setMsg({ type: "ok", text: "초기화 완료" }); setSettings(d.settings); }
    setSaving(false);
  };

  // 정규 스크래핑 경로 설정
  const setPath = (f: keyof PathSettings, v: string) => 
    setSettings((p) => ({ ...p, path: { ...p.path, [f]: v } }));
  
  // 테스트 스크래핑 경로 설정 (단순 경로만)
  const setTestDocPath = (v: string) => 
    setSettings((p) => ({ ...p, testPath: { ...p.testPath, documentsPath: v } }));
  const setTestAttPath = (v: string) => 
    setSettings((p) => ({ ...p, testPath: { ...p.testPath, attachmentsPath: v } }));

  const setRetry = (f: keyof RetrySettings, v: number | boolean | string) => setSettings((p) => ({ ...p, retry: { ...p.retry, [f]: v } }));
  const setFile = (f: keyof FileManagementSettings, v: number | string | string[]) => setSettings((p) => ({ ...p, fileManagement: { ...p.fileManagement, [f]: v } }));
  const setNet = (f: keyof NetworkSettings, v: boolean | string) => setSettings((p) => ({ ...p, network: { ...p.network, [f]: v } }));
  const setStor = (f: keyof StorageSettings, v: number | boolean) => setSettings((p) => ({ ...p, storage: { ...p.storage, [f]: v } }));

  if (loading) return <div className="glass-panel p-6 rounded-3xl"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />로딩중...</div>;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-bold text-stone-800">설정/에러 수정</h1>
              <p className="text-xs text-stone-500">다운로드 설정, 로그 분석, 구조 변경 감지</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 hover:bg-stone-100 disabled:opacity-50 flex items-center gap-1">
              <RotateCcw className="w-4 h-4" />초기화
            </button>
            <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}저장
            </button>
          </div>
        </div>
        {msg && (
          <div className={cn("mt-4 px-4 py-2 rounded-xl flex items-center gap-2 text-sm", msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
            {msg.type === "ok" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{msg.text}
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* 메인 컨텐츠 - 6:4 비율 레이아웃 */}
      {/* ================================================================ */}
      <div className="grid xl:grid-cols-[6fr_4fr] gap-6">
        {/* ======== 왼쪽: 다운로드 관리 옵션 ======== */}
        <div className="glass-panel rounded-2xl overflow-hidden h-fit">
          <button
            onClick={() => setDownloadExpanded(!downloadExpanded)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-stone-50/50"
          >
            <div className="flex items-center gap-3">
              <span className="font-bold text-stone-800">다운로드 관리 옵션</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white bg-blue-500">6개 카테고리</span>
            </div>
            {downloadExpanded ? <ChevronUp className="w-5 h-5 text-stone-400" /> : <ChevronDown className="w-5 h-5 text-stone-400" />}
          </button>

          {downloadExpanded && (
            <div className="px-5 pb-5 border-t border-stone-100">
              <div className="grid grid-cols-2 gap-4 pt-5">
                {/* -------- 1. 저장 경로 관리 (정규 스크래핑용) -------- */}
                <div className="space-y-3 p-3 rounded-xl bg-stone-50/80 border border-stone-200/60">
                  <div className="flex items-center gap-2 text-stone-700 font-semibold text-xs">
                    <FolderOpen className="w-3.5 h-3.5 text-primary" />
                    저장 경로 관리
                    <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-primary text-white">필수</span>
                    <span className="text-[9px] text-stone-400 font-normal">(정규 스크래핑)</span>
                  </div>

                  {/* 공통 저장 경로 */}
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-600 mb-1">
                      저장 경로 <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        value={settings.path.basePath}
                        onChange={(e) => setPath("basePath", e.target.value)}
                        className="flex-1 input-field text-xs py-1.5"
                        placeholder="C:\path\to\scraping 또는 ./relative/path"
                      />
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/system/folder-picker", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ 
                                title: "정규 스크래핑 저장 경로 선택",
                                initialPath: settings.path.basePath 
                              }),
                            });
                            const data = await res.json();
                            if (data.success && data.path) {
                              setPath("basePath", data.path);
                            }
                          } catch (err) {
                            console.error("폴더 선택 실패:", err);
                          }
                        }}
                        className="px-2 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-[10px] flex items-center gap-1 transition-colors"
                        title="탐색기에서 폴더 선택"
                      >
                        <FolderSearch className="w-3 h-3" />
                        찾기
                      </button>
                    </div>
                    <p className="text-[9px] text-stone-400 mt-1">탐색기 버튼을 클릭하여 폴더를 선택하세요</p>
                  </div>

                  {/* 폴더 구조 규칙 */}
                  <FieldCompact label="폴더 구조 규칙">
                    <select value={settings.path.folderStructure} onChange={(e) => setPath("folderStructure", e.target.value)} className="input-field text-[10px] py-1.5">
                      {FOLDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </FieldCompact>

                  {/* 파일명 규칙 (분리) */}
                  <div className="grid grid-cols-2 gap-2">
                    <FieldCompact label="📄 제목/본문 파일명 규칙">
                      <select value={settings.path.docFileNameRule} onChange={(e) => setPath("docFileNameRule", e.target.value)} className="input-field text-[9px] py-1.5">
                        {DOC_FILENAME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </FieldCompact>
                    <FieldCompact label="📎 첨부파일명 규칙">
                      <select value={settings.path.attachmentFileNameRule} onChange={(e) => setPath("attachmentFileNameRule", e.target.value)} className="input-field text-[9px] py-1.5">
                        {ATTACHMENT_FILENAME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </FieldCompact>
                  </div>
                </div>

                {/* -------- 2. 다운로드 실패 대처 -------- */}
                <div className="space-y-3 p-3 rounded-xl bg-stone-50/80 border border-stone-200/60">
                  <div className="flex items-center gap-2 text-stone-700 font-semibold text-xs">
                    <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
                    다운로드 실패 대처
                    <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500 text-white">권장</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <FieldCompact label="재시도 횟수">
                      <input type="number" min={0} max={10} value={settings.retry.maxRetries} onChange={(e) => setRetry("maxRetries", +e.target.value)} className="input-field text-xs py-1.5" />
                    </FieldCompact>
                    <FieldCompact label="재시도 간격 (초)">
                      <input type="number" min={1} value={settings.retry.retryIntervalSec} onChange={(e) => setRetry("retryIntervalSec", +e.target.value)} className="input-field text-xs py-1.5" />
                    </FieldCompact>
                  </div>

                  {/* Exponential Backoff with Help */}
                  <div className="relative">
                    <label className="flex items-center gap-1.5 text-xs text-stone-700 cursor-pointer">
                      <input type="checkbox" checked={settings.retry.useExponentialBackoff} onChange={(e) => setRetry("useExponentialBackoff", e.target.checked)} className="w-3.5 h-3.5 rounded" />
                      Exponential Backoff
                      <button
                        type="button"
                        onClick={() => setShowBackoffHelp(!showBackoffHelp)}
                        className="w-3.5 h-3.5 rounded-full bg-stone-300 hover:bg-stone-400 text-white flex items-center justify-center text-[8px] font-bold"
                      >
                        ?
                      </button>
                    </label>
                    {showBackoffHelp && (
                      <div className="absolute left-0 top-full mt-2 z-10 w-64 p-2.5 rounded-lg bg-stone-800 text-white text-[10px] shadow-lg">
                        <div className="font-semibold mb-1">Exponential Backoff란?</div>
                        <p className="text-stone-300 leading-relaxed">
                          재시도 간격을 점진적으로 늘리는 알고리즘입니다.<br />
                          예: 5초 → 10초 → 20초 → 40초...<br /><br />
                          서버 과부하 방지에 효과적이며, 일시적 오류 복구율을 높여줍니다.
                        </p>
                        <div className="absolute -top-2 left-8 w-0 h-0 border-l-6 border-r-6 border-b-6 border-transparent border-b-stone-800"></div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <FieldCompact label="타임아웃 (초)">
                      <input type="number" min={10} max={300} value={settings.retry.timeoutSec} onChange={(e) => setRetry("timeoutSec", +e.target.value)} className="input-field text-xs py-1.5" />
                    </FieldCompact>
                    <FieldCompact label="실패 시 동작">
                      <select value={settings.retry.failureAction} onChange={(e) => setRetry("failureAction", e.target.value)} className="input-field text-[10px] py-1.5">
                        {FAILURE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </FieldCompact>
                  </div>
                </div>

                {/* -------- 3. 파일 관리 -------- */}
                <div className="space-y-3 p-3 rounded-xl bg-stone-50/80 border border-stone-200/60">
                  <div className="flex items-center gap-2 text-stone-700 font-semibold text-xs">
                    <FileText className="w-3.5 h-3.5 text-emerald-500" />
                    파일 관리
                    <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500 text-white">권장</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <FieldCompact label="최대 파일 크기 (MB)" hint="0=무제한">
                      <input type="number" min={0} value={settings.fileManagement.maxFileSizeMb} onChange={(e) => setFile("maxFileSizeMb", +e.target.value)} className="input-field text-xs py-1.5" />
                    </FieldCompact>
                    <FieldCompact label="동시 다운로드 수">
                      <input type="number" min={1} max={10} value={settings.fileManagement.concurrentDownloads} onChange={(e) => setFile("concurrentDownloads", +e.target.value)} className="input-field text-xs py-1.5" />
                    </FieldCompact>
                  </div>

                  <FieldCompact label="중복 파일 처리">
                    <select value={settings.fileManagement.duplicateHandling} onChange={(e) => setFile("duplicateHandling", e.target.value)} className="input-field text-[10px] py-1.5">
                      {DUPLICATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </FieldCompact>

                  <FieldCompact label="허용 확장자" hint="쉼표 구분">
                    <input value={settings.fileManagement.allowedExtensions.join(", ")} onChange={(e) => setFile("allowedExtensions", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} className="input-field text-xs py-1.5" placeholder="hwp, pdf, doc" />
                  </FieldCompact>
                </div>

                {/* -------- 4. 네트워크/보안 -------- */}
                <div className="space-y-3 p-3 rounded-xl bg-stone-50/80 border border-stone-200/60">
                  <div className="flex items-center gap-2 text-stone-700 font-semibold text-xs">
                    <Network className="w-3.5 h-3.5 text-purple-500" />
                    네트워크/보안
                    <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-stone-400 text-white">선택</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] text-stone-700 cursor-pointer">
                      <input type="checkbox" checked={settings.network.skipSslVerification} onChange={(e) => setNet("skipSslVerification", e.target.checked)} className="w-3.5 h-3.5 rounded" />
                      SSL 검증 우회 <span className="text-orange-500 text-[9px]">(보안 주의)</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-stone-700 cursor-pointer">
                      <input type="checkbox" checked={settings.network.autoReferer} onChange={(e) => setNet("autoReferer", e.target.checked)} className="w-3.5 h-3.5 rounded" />
                      Referer 헤더 자동 설정
                    </label>
                  </div>

                  <FieldCompact label="User-Agent">
                    <input value={settings.network.customUserAgent} onChange={(e) => setNet("customUserAgent", e.target.value)} className="input-field font-mono text-[9px] py-1.5" />
                  </FieldCompact>

                  <FieldCompact label="프록시 URL" hint="비워두면 사용 안 함">
                    <input value={settings.network.proxyUrl} onChange={(e) => setNet("proxyUrl", e.target.value)} className="input-field text-xs py-1.5" placeholder="http://proxy:8080" />
                  </FieldCompact>
                </div>

                {/* -------- 5. 저장 공간 관리 -------- */}
                <div className="space-y-3 p-3 rounded-xl bg-stone-50/80 border border-stone-200/60">
                  <div className="flex items-center gap-2 text-stone-700 font-semibold text-xs">
                    <HardDrive className="w-3.5 h-3.5 text-amber-500" />
                    저장 공간 관리
                    <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-stone-400 text-white">선택</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <FieldCompact label="경고 임계값 (GB)" hint="0=비활성">
                      <input type="number" min={0} value={settings.storage.warningThresholdGb} onChange={(e) => setStor("warningThresholdGb", +e.target.value)} className="input-field text-xs py-1.5" />
                    </FieldCompact>
                    <FieldCompact label="용량 제한 (GB)" hint="0=무제한">
                      <input type="number" min={0} value={settings.storage.maxStorageGb} onChange={(e) => setStor("maxStorageGb", +e.target.value)} className="input-field text-xs py-1.5" />
                    </FieldCompact>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-stone-200">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-700 cursor-pointer">
                      <input type="checkbox" checked={settings.storage.autoCleanupEnabled} onChange={(e) => setStor("autoCleanupEnabled", e.target.checked)} className="w-3.5 h-3.5 rounded" />
                      자동 정리 <span className="text-orange-500 text-[9px]">(파일 삭제 주의)</span>
                    </label>
                    {settings.storage.autoCleanupEnabled && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input type="number" min={30} value={settings.storage.autoCleanupDays} onChange={(e) => setStor("autoCleanupDays", +e.target.value)} className="input-field w-16 text-xs py-1" />
                        <span className="text-[10px] text-stone-500">일 이상된 파일 삭제</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* -------- 6. 스크래핑 테스트 저장 경로 관리 -------- */}
                <div className="space-y-3 p-3 rounded-xl bg-blue-50/80 border border-blue-200/60">
                  <div className="flex items-center gap-2 text-stone-700 font-semibold text-xs">
                    <FolderOpen className="w-3.5 h-3.5 text-blue-500" />
                    스크래핑 테스트 저장 경로
                    <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500 text-white">권장</span>
                    <span className="text-[9px] text-stone-400 font-normal">(즉시 실행)</span>
                  </div>

                  {/* 1행: 제목/본문 목록 저장 경로 */}
                  <div className="p-2 rounded-lg bg-white border border-blue-200">
                    <label className="block text-[10px] font-semibold text-stone-600 mb-1.5">
                      📄 제목/본문 목록 저장 경로
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        value={settings.testPath.documentsPath}
                        onChange={(e) => setTestDocPath(e.target.value)}
                        className="flex-1 input-field text-xs py-1.5"
                        placeholder="C:\path\to\documents"
                      />
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/system/folder-picker", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ 
                                title: "제목/본문 목록 저장 경로 선택",
                                initialPath: settings.testPath.documentsPath 
                              }),
                            });
                            const data = await res.json();
                            if (data.success && data.path) {
                              setTestDocPath(data.path);
                            }
                          } catch (err) {
                            console.error("폴더 선택 실패:", err);
                          }
                        }}
                        className="px-2 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 font-semibold text-[10px] flex items-center gap-1 transition-colors"
                        title="탐색기에서 폴더 선택"
                      >
                        <FolderSearch className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[9px] text-stone-400 mt-1">탐색기 버튼을 클릭하여 폴더를 선택하세요</p>
                  </div>

                  {/* 2행: 첨부파일 저장 경로 */}
                  <div className="p-2 rounded-lg bg-white border border-blue-200">
                    <label className="block text-[10px] font-semibold text-stone-600 mb-1.5">
                      📎 첨부파일 저장 경로
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        value={settings.testPath.attachmentsPath}
                        onChange={(e) => setTestAttPath(e.target.value)}
                        className="flex-1 input-field text-xs py-1.5"
                        placeholder="C:\path\to\attachments"
                      />
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/system/folder-picker", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ 
                                title: "첨부파일 저장 경로 선택",
                                initialPath: settings.testPath.attachmentsPath 
                              }),
                            });
                            const data = await res.json();
                            if (data.success && data.path) {
                              setTestAttPath(data.path);
                            }
                          } catch (err) {
                            console.error("폴더 선택 실패:", err);
                          }
                        }}
                        className="px-2 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 font-semibold text-[10px] flex items-center gap-1 transition-colors"
                        title="탐색기에서 폴더 선택"
                      >
                        <FolderSearch className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[9px] text-stone-400 mt-1">탐색기 버튼을 클릭하여 폴더를 선택하세요</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ======== 오른쪽: 로그 분석 + 변경 감지 ======== */}
        <div className="space-y-6">
          {/* ================================================================ */}
          {/* 로그 분석 및 에러 관리 */}
          {/* ================================================================ */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-stone-100">
              <span className="font-bold text-stone-800 text-sm">로그 분석 및 에러 관리</span>
              {errorStats && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white bg-red-500">
                  {errorStats.last_24h > 0 ? `${errorStats.last_24h}건 발생` : "정상"}
                </span>
              )}
              <button
                onClick={() => { loadErrorStats(); loadErrorList(errorPage); }}
                className="ml-auto p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
                title="새로고침"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* 에러 통계 + 유형별 분석 */}
              <div className="grid grid-cols-2 gap-3">
                {/* 에러 통계 */}
                <div className="p-3 rounded-lg bg-red-50/50 border border-red-100">
                  <div className="flex items-center gap-1.5 text-red-700 font-semibold text-xs mb-2">
                    <FileWarning className="w-3.5 h-3.5" />
                    에러 통계
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-stone-500">24시간</span>
                      <span className={cn("font-bold", errorStats?.last_24h ? "text-red-600" : "text-stone-400")}>
                        {errorStats?.last_24h ?? "-"}건
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">7일</span>
                      <span className={cn("font-bold", errorStats?.last_7d ? "text-red-600" : "text-stone-400")}>
                        {errorStats?.last_7d ?? "-"}건
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">대기 중</span>
                      <span className={cn("font-bold", errorStats?.pending ? "text-orange-600" : "text-stone-400")}>
                        {errorStats?.pending ?? "-"}건
                      </span>
                    </div>
                  </div>
                </div>

                {/* 에러 유형별 분석 */}
                <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-100">
                  <div className="flex items-center gap-1.5 text-amber-700 font-semibold text-xs mb-2">
                    <Eye className="w-3.5 h-3.5" />
                    유형별 분석 (7일)
                  </div>
                  <div className="space-y-1 text-[10px]">
                    {errorStats?.by_type ? (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-stone-500">타임아웃</span>
                          <span className={cn("px-1.5 py-0.5 rounded", errorStats.by_type.timeout > 0 ? "bg-red-100 text-red-700" : "bg-stone-200 text-stone-500")}>
                            {errorStats.by_type.timeout}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-stone-500">HTTP 오류</span>
                          <span className={cn("px-1.5 py-0.5 rounded", errorStats.by_type.http_error > 0 ? "bg-red-100 text-red-700" : "bg-stone-200 text-stone-500")}>
                            {errorStats.by_type.http_error}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-stone-500">파싱 실패</span>
                          <span className={cn("px-1.5 py-0.5 rounded", errorStats.by_type.parsing > 0 ? "bg-red-100 text-red-700" : "bg-stone-200 text-stone-500")}>
                            {errorStats.by_type.parsing}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-stone-500">네트워크</span>
                          <span className={cn("px-1.5 py-0.5 rounded", errorStats.by_type.network > 0 ? "bg-red-100 text-red-700" : "bg-stone-200 text-stone-500")}>
                            {errorStats.by_type.network}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="text-stone-400 text-center py-2">로딩 중...</div>
                    )}
                  </div>
                </div>
              </div>

              {/* 에러 목록 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-stone-700 font-semibold text-xs">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    에러 목록
                    <span className="px-1.5 py-0.5 rounded-full bg-stone-200 text-stone-600 text-[10px] font-bold">
                      {errorTotal}건
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 유형 필터 */}
                    <select
                      value={errorTypeFilter}
                      onChange={(e) => setErrorTypeFilter(e.target.value as ErrorType | "")}
                      className="text-[10px] py-1 px-2 rounded border border-stone-200 bg-white"
                    >
                      <option value="">전체 유형</option>
                      <option value="timeout">타임아웃</option>
                      <option value="http_error">HTTP 오류</option>
                      <option value="parsing">파싱 실패</option>
                      <option value="network">네트워크</option>
                      <option value="dom_change">DOM 변경</option>
                      <option value="unknown">기타</option>
                    </select>
                  </div>
                </div>

                {/* 에러 테이블 */}
                <div className="rounded-lg border border-stone-200 overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead className="bg-stone-50 border-b border-stone-200">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold text-stone-600">보드명</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-stone-600">기관</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-stone-600">스케줄</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-stone-600">발생일시</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-stone-600">에러 종류</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errorLoading ? (
                        <tr>
                          <td colSpan={5} className="px-2 py-6 text-center text-stone-400">
                            <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />
                            로딩 중...
                          </td>
                        </tr>
                      ) : errorList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-2 py-6 text-center text-stone-400">
                            <Check className="w-4 h-4 mx-auto mb-1 text-green-500" />
                            에러가 없습니다
                          </td>
                        </tr>
                      ) : (
                        errorList.map((item) => (
                          <tr
                            key={item.log_id}
                            onClick={() => {
                              setSelectedError(item);
                              setShowErrorModal(true);
                              setAnalysisResult(null);
                              setAnalysisError(null);
                            }}
                            className="border-b border-stone-100 hover:bg-red-50/30 cursor-pointer transition-colors"
                          >
                            <td className="px-2 py-1.5 font-medium text-stone-700">{item.board_name}</td>
                            <td className="px-2 py-1.5 text-stone-500">{item.org_name}</td>
                            <td className="px-2 py-1.5 text-stone-500">{item.schedule_name}</td>
                            <td className="px-2 py-1.5 text-stone-500">
                              {new Date(item.started_at).toLocaleString("ko-KR", {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td className="px-2 py-1.5">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-semibold",
                                item.error_type === "timeout" && "bg-amber-100 text-amber-700",
                                item.error_type === "http_error" && "bg-red-100 text-red-700",
                                item.error_type === "parsing" && "bg-purple-100 text-purple-700",
                                item.error_type === "network" && "bg-blue-100 text-blue-700",
                                item.error_type === "dom_change" && "bg-orange-100 text-orange-700",
                                item.error_type === "unknown" && "bg-stone-100 text-stone-600",
                              )}>
                                {errorStats?.type_labels?.[item.error_type] || item.error_type}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>

                  {/* 페이지네이션 */}
                  {errorTotal > ERRORS_PER_PAGE && (
                    <div className="px-2 py-1.5 bg-stone-50 border-t border-stone-200 flex items-center justify-between">
                      <span className="text-[10px] text-stone-500">
                        {errorPage * ERRORS_PER_PAGE + 1}-{Math.min((errorPage + 1) * ERRORS_PER_PAGE, errorTotal)} / {errorTotal}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setErrorPage((p) => Math.max(0, p - 1)); loadErrorList(Math.max(0, errorPage - 1)); }}
                          disabled={errorPage === 0}
                          className="p-1 rounded hover:bg-stone-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => { setErrorPage((p) => p + 1); loadErrorList(errorPage + 1); }}
                          disabled={(errorPage + 1) * ERRORS_PER_PAGE >= errorTotal}
                          className="p-1 rounded hover:bg-stone-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 에러 상세 모달 */}
          {showErrorModal && selectedError && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[1000px] max-h-[95vh] flex flex-col">
                {/* 모달 헤더 */}
                <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-stone-800">에러 상세 정보</h3>
                      <p className="text-xs text-stone-500">{selectedError.board_name} ({selectedError.org_name})</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowErrorModal(false)}
                    className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* 모달 내용 */}
                <div className="flex-1 overflow-auto p-5 space-y-4">
                  {/* 기본 정보 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-stone-500 w-20">보드</span>
                        <span className="font-semibold text-stone-700">{selectedError.board_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-stone-500 w-20">기관</span>
                        <span className="font-semibold text-stone-700">{selectedError.org_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-stone-500 w-20">스케줄</span>
                        <span className="font-semibold text-stone-700">{selectedError.schedule_name}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-stone-500 w-20">발생일시</span>
                        <span className="font-semibold text-stone-700">
                          {new Date(selectedError.started_at).toLocaleString("ko-KR")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-stone-500 w-20">에러 종류</span>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-semibold",
                          selectedError.error_type === "timeout" && "bg-amber-100 text-amber-700",
                          selectedError.error_type === "http_error" && "bg-red-100 text-red-700",
                          selectedError.error_type === "parsing" && "bg-purple-100 text-purple-700",
                          selectedError.error_type === "network" && "bg-blue-100 text-blue-700",
                          selectedError.error_type === "dom_change" && "bg-orange-100 text-orange-700",
                          selectedError.error_type === "unknown" && "bg-stone-100 text-stone-600",
                        )}>
                          {errorStats?.type_labels?.[selectedError.error_type] || selectedError.error_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-stone-500 w-20">상태</span>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-semibold",
                          selectedError.status === "failed" && "bg-red-100 text-red-700",
                          selectedError.status === "partial" && "bg-amber-100 text-amber-700",
                        )}>
                          {selectedError.status === "failed" ? "실패" : "부분 실패"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 수집 통계 */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="p-2 rounded-lg bg-stone-50 text-center">
                      <div className="text-lg font-bold text-stone-700">{selectedError.docs_scraped}</div>
                      <div className="text-[10px] text-stone-500">수집 성공</div>
                    </div>
                    <div className="p-2 rounded-lg bg-red-50 text-center">
                      <div className="text-lg font-bold text-red-600">{selectedError.docs_failed}</div>
                      <div className="text-[10px] text-stone-500">수집 실패</div>
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50 text-center">
                      <div className="text-lg font-bold text-amber-600">{selectedError.docs_skipped}</div>
                      <div className="text-[10px] text-stone-500">건너뜀</div>
                    </div>
                    <div className="p-2 rounded-lg bg-blue-50 text-center">
                      <div className="text-lg font-bold text-blue-600">{selectedError.pages_processed}</div>
                      <div className="text-[10px] text-stone-500">처리 페이지</div>
                    </div>
                  </div>

                  {/* 에러 로그 + LLM 분석 */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* 왼쪽: 상세 에러 로그 */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                        <FileText className="w-3.5 h-3.5 text-red-500" />
                        상세 에러 로그
                      </div>
                      <div className="p-3 rounded-lg bg-stone-900 text-green-400 font-mono text-[10px] h-[260px] overflow-auto">
                        {selectedError.error_message || "에러 메시지가 없습니다."}
                      </div>
                    </div>

                    {/* 오른쪽: LLM 분석 */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                        <Bot className="w-3.5 h-3.5 text-primary" />
                        AI 에러 분석
                      </div>
                      
                      {/* LLM 선택 + 분석 버튼 */}
                      <div className="flex gap-2">
                        <select
                          value={selectedProvider}
                          onChange={(e) => setSelectedProvider(e.target.value)}
                          className="flex-1 text-xs py-1.5 px-2 rounded-lg border border-stone-200 bg-white"
                        >
                          {llmProviders.map((p) => (
                            <option key={p.id} value={p.id} disabled={!p.configured}>
                              {p.name} {!p.configured && "(미설정)"}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={runAnalysis}
                          disabled={analyzing || !llmProviders.find((p) => p.id === selectedProvider)?.configured}
                          className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {analyzing ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              분석 중...
                            </>
                          ) : (
                            <>
                              <Bot className="w-3.5 h-3.5" />
                              에러 로그 분석
                            </>
                          )}
                        </button>
                      </div>

                      {/* 분석 결과 */}
                      <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 h-[244px] overflow-auto">
                        {analysisError ? (
                          <div className="text-red-600 text-xs">
                            <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                            {analysisError}
                          </div>
                        ) : analysisResult ? (
                          <div className="space-y-2 text-xs">
                            <div>
                              <span className="font-semibold text-stone-700">요약: </span>
                              <span className="text-stone-600">{analysisResult.summary}</span>
                            </div>
                            {analysisResult.possible_causes.length > 0 && (
                              <div>
                                <span className="font-semibold text-stone-700">가능한 원인:</span>
                                <ul className="list-disc list-inside text-stone-600 mt-0.5">
                                  {analysisResult.possible_causes.map((cause, i) => (
                                    <li key={i}>{cause}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {analysisResult.suggested_actions.length > 0 && (
                              <div>
                                <span className="font-semibold text-stone-700">권장 조치:</span>
                                <ul className="list-disc list-inside text-stone-600 mt-0.5">
                                  {analysisResult.suggested_actions.map((action, i) => (
                                    <li key={i}>{action}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-stone-700">신뢰도:</span>
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-bold",
                                analysisResult.confidence === "high" && "bg-green-100 text-green-700",
                                analysisResult.confidence === "medium" && "bg-amber-100 text-amber-700",
                                analysisResult.confidence === "low" && "bg-red-100 text-red-700",
                              )}>
                                {analysisResult.confidence === "high" ? "높음" : analysisResult.confidence === "medium" ? "보통" : "낮음"}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-stone-400">
                            <Bot className="w-6 h-6 mb-1 opacity-50" />
                            <p className="text-[10px]">'에러 로그 분석' 버튼을 클릭하세요</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 모달 푸터 */}
                <div className="px-5 py-3 border-t border-stone-100 flex justify-end gap-2">
                  <button
                    onClick={() => setShowErrorModal(false)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100"
                  >
                    닫기
                  </button>
                  <a
                    href={`/scraper/targets?board=${selectedError.board_id}`}
                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 flex items-center gap-1.5"
                  >
                    <Wrench className="w-4 h-4" />
                    보드 설정 수정
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* 변경 감지 / Config 수정 */}
          {/* ================================================================ */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-stone-100">
              <span className="font-bold text-stone-800 text-sm">변경 감지 / Config 수정</span>
              {changeTotalCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white bg-red-500">
                  {changeTotalCount}건 감지
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white bg-green-500">정상</span>
              )}
            </div>
            <div className="p-4 space-y-4">
              {/* 자동 감지 설정 */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-stone-700 font-semibold text-xs">
                  <Settings2 className="w-3.5 h-3.5 text-violet-500" />
                  사이트 구조 변경 자동 감지
                </div>
                <div className="space-y-2 p-3 rounded-lg bg-violet-50/50 border border-violet-100">
                  <label className="flex items-center gap-1.5 text-[11px] text-stone-600 cursor-pointer">
                    <input type="checkbox" disabled className="w-3.5 h-3.5 rounded" />
                    자동 감지 활성화
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <FieldCompact label="감지 주기">
                      <select disabled className="input-field text-[10px] py-1.5">
                        <option>매일</option>
                        <option>매주</option>
                        <option>스크래핑 시마다</option>
                      </select>
                    </FieldCompact>
                    <FieldCompact label="알림 방식">
                      <select disabled className="input-field text-[10px] py-1.5">
                        <option>화면 알림</option>
                        <option>이메일</option>
                      </select>
                    </FieldCompact>
                  </div>
                </div>
              </div>

              {/* 감지된 변경사항 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-stone-700 font-semibold text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    감지된 구조 변경사항
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
                      changeTotalCount > 0 ? "bg-red-100 text-red-700" : "bg-stone-200 text-stone-500"
                    )}>
                      {changeTotalCount}건
                    </span>
                    <button
                      onClick={loadChangeData}
                      className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-600"
                      title="새로고침"
                    >
                      <RefreshCw className={cn("w-3 h-3", changeLoading && "animate-spin")} />
                    </button>
                  </div>
                </div>

                {/* 기관/보드 목록 */}
                <div className="rounded-lg border border-stone-200 overflow-hidden max-h-[200px] overflow-y-auto">
                  {changeLoading ? (
                    <div className="p-4 text-center text-stone-400">
                      <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />
                      <span className="text-[10px]">로딩 중...</span>
                    </div>
                  ) : changeOrgs.length === 0 ? (
                    <div className="p-4 text-center text-stone-400">
                      <Eye className="w-5 h-5 mx-auto mb-1 opacity-50" />
                      <p className="text-[10px]">등록된 기관이 없습니다</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-stone-100">
                      {changeOrgs.map((org) => (
                        <div key={org.org_id}>
                          {/* 기관 행 */}
                          <div
                            onClick={() => toggleChangeOrg(org.org_id)}
                            className={cn(
                              "flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors",
                              expandedChangeOrgs.includes(org.org_id) ? "bg-stone-100" : "hover:bg-stone-50"
                            )}
                          >
                            {/* 기관 아이콘 */}
                            {org.org_logo ? (
                              <img
                                src={org.org_logo}
                                alt={org.org_name}
                                className="w-4 h-4 rounded object-contain"
                              />
                            ) : (
                              <div className="w-4 h-4 rounded bg-stone-200 flex items-center justify-center">
                                <span className="text-[8px] text-stone-500">
                                  {org.org_name.charAt(0)}
                                </span>
                              </div>
                            )}
                            <span className="flex-1 flex items-center gap-1 min-w-0">
                              <span className="text-[10px] font-semibold text-stone-700 truncate">
                                {org.org_name}
                              </span>
                              {org.change_count > 0 && (
                                <AlertTriangle
                                  className="w-3.5 h-3.5 text-red-500 shrink-0 drop-shadow-[0_0_6px_rgba(239,68,68,0.35)]"
                                  title="구조 변경 감지됨"
                                />
                              )}
                            </span>
                            {org.change_count > 0 && (
                              <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-red-100 text-red-600">
                                {org.change_count}
                              </span>
                            )}
                            <ChevronDown className={cn(
                              "w-3 h-3 text-stone-400 transition-transform",
                              expandedChangeOrgs.includes(org.org_id) && "rotate-180"
                            )} />
                          </div>

                          {/* 보드 목록 */}
                          {expandedChangeOrgs.includes(org.org_id) && (
                            <div className="bg-stone-50/50">
                              {org.boards.map((board) => (
                                <div
                                  key={board.board_id}
                                  onClick={() => {
                                    if (board.has_change) {
                                      setSelectedChange(board);
                                      setShowChangeModal(true);
                                      setChangeAnalysisResult(null);
                                      setChangeAnalysisError(null);
                                    }
                                  }}
                                  className={cn(
                                    "grid grid-cols-[auto_1fr_45px_45px_80px] items-center gap-1.5 px-2 py-1 ml-4 border-l-2 transition-colors",
                                    board.has_change
                                      ? "border-red-300 hover:bg-red-50/50 cursor-pointer"
                                      : "border-green-300"
                                  )}
                                >
                                  {/* 상태 표시등 (라이팅 효과) */}
                                  <div className={cn(
                                    "w-2 h-2 rounded-full shrink-0",
                                    board.has_change
                                      ? "bg-red-500 shadow-[0_0_6px_2px_rgba(239,68,68,0.5)] animate-pulse"
                                      : "bg-green-500 shadow-[0_0_4px_1px_rgba(34,197,94,0.4)]"
                                  )} />
                                  
                                  {/* 보드명 */}
                                  <span className={cn(
                                    "text-[10px] truncate",
                                    board.has_change ? "text-red-700 font-semibold" : "text-stone-700 font-medium"
                                  )}>
                                    {board.board_name}
                                  </span>
                                  
                                  {/* 모드 */}
                                  <span className={cn(
                                    "px-1 py-0.5 rounded text-[7px] font-semibold text-center",
                                    board.access_mode === "api" && "bg-blue-100 text-blue-600",
                                    board.access_mode === "web" && "bg-emerald-100 text-emerald-600",
                                    board.access_mode === "hybrid" && "bg-purple-100 text-purple-600",
                                    !["api", "web", "hybrid"].includes(board.access_mode) && "bg-emerald-100 text-emerald-600"
                                  )}>
                                    {board.access_mode === "api" ? "API" : board.access_mode === "hybrid" ? "혼합" : "웹"}
                                  </span>
                                  
                                  {/* 감지일 */}
                                  <span className="text-[8px] text-stone-400 text-center">
                                    {board.has_change && board.detected_at 
                                      ? new Date(board.detected_at).toLocaleDateString("ko-KR", {
                                          month: "2-digit",
                                          day: "2-digit",
                                        }) 
                                      : "-"}
                                  </span>
                                  
                                  {/* 변경 사항 */}
                                  {board.has_change ? (
                                    <span className="px-1 py-0.5 rounded text-[7px] font-semibold bg-red-100 text-red-600 truncate text-center">
                                      {board.change_type ? changeTypeLabels[board.change_type] || board.change_type : "-"}
                                    </span>
                                  ) : (
                                    <span className="text-[8px] text-stone-300 text-center">-</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Config 수정 버튼 */}
              <div className="flex gap-2">
                <a
                  href="/scraper/targets"
                  className="flex-1 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  보드 설정 마법사
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  disabled
                  className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-400 font-semibold text-xs flex items-center justify-center gap-1.5"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  API 설정 수정
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 변경 감지 상세 모달 */}
      {showChangeModal && selectedChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[1000px] max-h-[95vh] flex flex-col">
            {/* 모달 헤더 */}
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-800">구조 변경 상세 정보</h3>
                  <p className="text-xs text-stone-500">{selectedChange.board_name} ({selectedChange.org_name})</p>
                </div>
              </div>
              <button
                onClick={() => setShowChangeModal(false)}
                className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 모달 내용 */}
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500 w-20">보드</span>
                    <span className="font-semibold text-stone-700">{selectedChange.board_name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500 w-20">기관</span>
                    <span className="font-semibold text-stone-700">{selectedChange.org_name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500 w-20">수집 모드</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-semibold",
                      selectedChange.access_mode === "api" && "bg-blue-100 text-blue-700",
                      selectedChange.access_mode === "web" && "bg-emerald-100 text-emerald-700",
                      selectedChange.access_mode === "hybrid" && "bg-purple-100 text-purple-700"
                    )}>
                      {selectedChange.access_mode === "api" ? "API" : selectedChange.access_mode === "hybrid" ? "하이브리드" : "웹 스크래핑"}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500 w-20">감지일시</span>
                    <span className="font-semibold text-stone-700">
                      {selectedChange.detected_at ? new Date(selectedChange.detected_at).toLocaleString("ko-KR") : "-"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500 w-20">변경 유형</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                      {selectedChange.change_type ? changeTypeLabels[selectedChange.change_type] || selectedChange.change_type : "-"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500 w-20">상태</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      변경 감지됨
                    </span>
                  </div>
                </div>
              </div>

              {/* 변경 사항 + LLM 분석 */}
              <div className="grid grid-cols-2 gap-4">
                {/* 왼쪽: 변경 사항 상세 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                    <FileText className="w-3.5 h-3.5 text-amber-500" />
                    변경 사항 상세
                  </div>
                  <div className="p-3 rounded-lg bg-stone-900 text-amber-400 font-mono text-[10px] h-[260px] overflow-auto whitespace-pre-wrap">
                    {selectedChange.change_details || "변경 사항 상세 정보가 없습니다."}
                  </div>
                </div>

                {/* 오른쪽: LLM 분석 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                    AI 변경 사항 분석
                  </div>
                  
                  {/* LLM 선택 + 분석 버튼 */}
                  <div className="flex gap-2">
                    <select
                      value={changeSelectedProvider}
                      onChange={(e) => setChangeSelectedProvider(e.target.value)}
                      className="flex-1 text-xs py-1.5 px-2 rounded-lg border border-stone-200 bg-white"
                    >
                      {llmProviders.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.configured}>
                          {p.name} {!p.configured && "(미설정)"}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={runChangeAnalysis}
                      disabled={changeAnalyzing || !llmProviders.find((p) => p.id === changeSelectedProvider)?.configured}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {changeAnalyzing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          분석 중...
                        </>
                      ) : (
                        <>
                          <Bot className="w-3.5 h-3.5" />
                          변경 사항 분석
                        </>
                      )}
                    </button>
                  </div>

                  {/* 분석 결과 */}
                  <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 h-[220px] overflow-auto">
                    {changeAnalysisError ? (
                      <div className="text-red-600 text-xs">
                        <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                        {changeAnalysisError}
                      </div>
                    ) : changeAnalysisResult ? (
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="font-semibold text-stone-700">요약: </span>
                          <span className="text-stone-600">{changeAnalysisResult.summary}</span>
                        </div>
                        {changeAnalysisResult.impact_assessment && (
                          <div>
                            <span className="font-semibold text-stone-700">영향 평가:</span>
                            <p className="text-stone-600 mt-0.5">{changeAnalysisResult.impact_assessment}</p>
                          </div>
                        )}
                        {changeAnalysisResult.recommended_changes.length > 0 && (
                          <div>
                            <span className="font-semibold text-stone-700">권장 변경:</span>
                            <ul className="list-disc list-inside text-stone-600 mt-0.5">
                              {changeAnalysisResult.recommended_changes.map((change, i) => (
                                <li key={i}>{change}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {changeAnalysisResult.manual_steps && changeAnalysisResult.manual_steps.length > 0 && (
                          <div>
                            <span className="font-semibold text-stone-700">수동 조치 단계:</span>
                            <ol className="list-decimal list-inside text-stone-600 mt-0.5">
                              {changeAnalysisResult.manual_steps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-stone-700">자동 수정:</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-bold",
                              changeAnalysisResult.auto_fix_possible ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                              {changeAnalysisResult.auto_fix_possible ? "가능" : "불가"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-stone-700">신뢰도:</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-bold",
                              changeAnalysisResult.confidence === "high" && "bg-green-100 text-green-700",
                              changeAnalysisResult.confidence === "medium" && "bg-amber-100 text-amber-700",
                              changeAnalysisResult.confidence === "low" && "bg-red-100 text-red-700",
                            )}>
                              {changeAnalysisResult.confidence === "high" ? "높음" : changeAnalysisResult.confidence === "medium" ? "보통" : "낮음"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-stone-400">
                        <Bot className="w-6 h-6 mb-1 opacity-50" />
                        <p className="text-[10px]">'변경 사항 분석' 버튼을 클릭하세요</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 모달 푸터 */}
            <div className="px-5 py-3 border-t border-stone-100 flex justify-end gap-2">
              <button
                onClick={() => setShowChangeModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100"
              >
                닫기
              </button>
              <a
                href={`/scraper/targets?board=${selectedChange.board_id}`}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 flex items-center gap-1.5"
              >
                <Wrench className="w-4 h-4" />
                보드 설정 수정
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 도움말 */}
      <div className="glass-panel p-4 rounded-2xl flex items-start gap-3">
        <Info className="w-5 h-5 text-primary mt-0.5" />
        <div className="text-sm text-stone-600">
          <p className="font-semibold mb-1">페이지 안내</p>
          <ul className="list-disc list-inside text-xs space-y-0.5">
            <li><b>저장 경로 관리</b>: 정규 스크래핑(스케줄 기반) 시 제목/본문 및 첨부파일 저장 경로</li>
            <li><b>스크래핑 테스트 저장 경로</b>: 즉시 실행(테스트) 시 사용되는 별도 저장 경로</li>
            <li><b>다운로드 관리</b>: 재시도 정책, 파일 관리, 네트워크 설정</li>
            <li><b>로그 분석</b>: 에러 통계 및 유형별 분석, 빠른 복구 작업</li>
            <li><b>변경 감지</b>: 대상 사이트 구조 변경 자동 감지 및 config 수정</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// 필드 컴포넌트
function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-stone-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-0.5 text-[10px] text-stone-400">{hint}</p>}
    </div>
  );
}

// 컴팩트 필드 컴포넌트 (2열 레이아웃용)
function FieldCompact({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-stone-600 mb-0.5">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[9px] text-stone-400">{hint}</p>}
    </div>
  );
}
