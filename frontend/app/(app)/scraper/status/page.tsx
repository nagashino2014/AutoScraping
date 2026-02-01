"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  BarChart3,
  RefreshCw,
  FileText,
  Paperclip,
  CalendarClock,
  AlertCircle,
  Activity,
  HardDrive,
  TrendingUp,
  PieChart,
  Building2,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Clock,
  Calendar,
  ExternalLink,
  Globe,
  Server,
  Download,
  Filter,
  Layers,
  Table,
  FileWarning,
  Bell,
  BellRing,
  Settings,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from "recharts";

// ============================================================
// 타입 정의
// ============================================================

interface SummaryData {
  total_documents: number;
  total_attachments: number;
  today_documents: number;
  today_attachments: number;
  running_jobs: number;
  error_rate_24h: number;
  total_size_bytes: number;
  last_updated: string;
}

interface TimelineData {
  date: string;
  documents: number;
  attachments: number;
}

interface FileTypeData {
  type: string;
  label: string;
  count: number;
  size_bytes: number;
  percentage: number;
}

interface ScheduleTarget {
  board_id: string;
  board_name: string;
  org_id: string;
  org_name: string;
  org_logo: string | null;
}

interface ScheduleData {
  schedule_id: string;
  name: string;
  cron: string;
  cron_description: string;
  enabled: boolean;
  targets: ScheduleTarget[];
  next_runs: string[];
}

interface BoardStatusItem {
  board_id: string;
  board_name: string;
  org_id: string;
  org_name: string;
  org_logo: string | null;
  collection_mode: "web_scraping" | "api_only" | "hybrid";
  enabled: boolean;
  status: "active" | "running" | "warning" | "error" | "disabled" | "never";
  last_run_at: string | null;
  next_run_at: string | null;
  stats: {
    document_count: number;
    attachment_count: number;
    total_size_bytes: number;
    last_7d_documents: number;
  };
  last_error: string | null;
  schedule_name: string | null;
}

interface RunningJob {
  log_id: string;
  board_id: string;
  board_name: string;
  org_id: string;
  org_name: string;
  org_logo?: string | null;
  schedule_id: string | null;
  started_at: string;
  docs_scraped: number;
  docs_skipped: number;
  docs_failed: number;
  pages_processed: number;
  elapsed_seconds: number;
}

interface ErrorLogItem {
  log_id: string;
  board_id: string;
  board_name: string;
  org_id: string;
  org_name: string;
  org_logo?: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  docs_scraped: number;
  docs_skipped: number;
  docs_failed: number;
  error_message: string | null;
}

interface OrgGroupStats {
  org_id: string;
  org_name: string;
  org_logo: string | null;
  board_count: number;
  active_boards: number;
  error_boards: number;
  total_documents: number;
  total_attachments: number;
  total_size_bytes: number;
  last_7d_documents: number;
  boards: BoardStatusItem[];
}

// 알림 아이템 타입
interface AlertItem {
  id: string;
  type: "error" | "warning" | "info" | "success";
  title: string;
  message: string;
  timestamp: string;
  boardId?: string;
  boardName?: string;
  orgName?: string;
  dismissed: boolean;
}

// 알림 설정 타입
interface AlertSettings {
  enabled: boolean;
  errorRateThreshold: number; // 에러율 임계치 (%)
  inactiveDaysThreshold: number; // 미실행 경고 일수
  showInApp: boolean; // 앱 내 알림 표시
  soundEnabled: boolean; // 알림음
}

// 대시보드 설정 타입
interface DashboardSettings {
  showSummaryCards: boolean;
  showRunningJobs: boolean;
  showTimelineChart: boolean;
  showFileTypeChart: boolean;
  showBoardsTable: boolean;
  showErrorLogs: boolean;
  defaultPeriod: "7d" | "30d" | "90d";
  defaultViewMode: "table" | "group";
  autoRefreshInterval: number; // 초 단위 (0이면 비활성)
}

// 기본 알림 설정
const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  errorRateThreshold: 10,
  inactiveDaysThreshold: 3,
  showInApp: true,
  soundEnabled: false,
};

// 기본 대시보드 설정
const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  showSummaryCards: true,
  showRunningJobs: true,
  showTimelineChart: true,
  showFileTypeChart: true,
  showBoardsTable: true,
  showErrorLogs: true,
  defaultPeriod: "30d",
  defaultViewMode: "table",
  autoRefreshInterval: 10,
};

// ============================================================
// 유틸리티 함수
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatNumber(num: number): string {
  return num.toLocaleString("ko-KR");
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "실행 기록 없음";
  
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}시간 ${minutes}분 ${secs}초`;
  }
  if (minutes > 0) {
    return `${minutes}분 ${secs}초`;
  }
  return `${secs}초`;
}

// ============================================================
// 차트 색상
// ============================================================

const CHART_COLORS = {
  primary: "#16A34A",
  secondary: "#0EA5E9",
  tertiary: "#F59E0B",
  error: "#EF4444",
  gray: "#9CA3AF",
};

const PIE_COLORS = [
  "#16A34A", // 녹색
  "#0EA5E9", // 파랑
  "#F59E0B", // 주황
  "#8B5CF6", // 보라
  "#EF4444", // 빨강
  "#EC4899", // 핑크
  "#14B8A6", // 청록
  "#6366F1", // 인디고
];

// ============================================================
// 컴포넌트: 스켈레톤 UI
// ============================================================

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] rounded ${className}`}
      style={{ animation: "shimmer 1.5s infinite" }}
    />
  );
}

// 요약 카드 스켈레톤
function SummaryCardSkeleton() {
  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="h-3 w-16 mb-2" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
    </div>
  );
}

// 차트 스켈레톤
function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end justify-between h-full gap-2 px-4 pb-8">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            style={{ height: `${30 + Math.random() * 60}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// 파이 차트 스켈레톤
function PieChartSkeleton() {
  return (
    <div className="h-[280px] flex flex-col items-center justify-center gap-4">
      <Skeleton className="w-[170px] h-[170px] rounded-full" />
      <div className="flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-12" />
        ))}
      </div>
    </div>
  );
}

// 테이블 행 스켈레톤
function TableRowSkeleton() {
  return (
    <tr className="border-t border-stone-100">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton className="w-6 h-6 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
      </td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
      <td className="px-4 py-3 text-center"><Skeleton className="h-5 w-16 mx-auto rounded" /></td>
      <td className="px-4 py-3 text-center"><Skeleton className="h-5 w-14 mx-auto rounded-full" /></td>
      <td className="px-4 py-3 text-center"><Skeleton className="h-4 w-16 mx-auto" /></td>
      <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
      <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td>
      <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-14 ml-auto" /></td>
    </tr>
  );
}

// ============================================================
// 컴포넌트: 실시간 실행 모니터링
// ============================================================

function RunningJobsMonitor({
  jobs,
  loading,
  onRefresh,
}: {
  jobs: RunningJob[];
  loading: boolean;
  onRefresh: () => void;
}) {
  // 실행 시간 실시간 업데이트를 위한 상태
  const [, setTick] = useState(0);

  useEffect(() => {
    if (jobs.length === 0) return;
    
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [jobs.length]);

  // 실행 중인 작업이 없으면 표시하지 않음
  if (!loading && jobs.length === 0) {
    return null;
  }

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-4 border-b border-white/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Activity className="w-5 h-5 text-blue-600" />
            {jobs.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
            )}
          </div>
          <h3 className="text-base font-bold text-stone-800">실행 중인 작업</h3>
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
            {jobs.length}개
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
          title="새로고침"
        >
          <RefreshCw className={`w-4 h-4 text-stone-500 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 본문 */}
      <div className="p-4 space-y-3">
        {loading ? (
          // 로딩 스켈레톤
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div key={idx} className="bg-white/50 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="w-8 h-8 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-40 mb-1" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-2 w-full rounded-full mb-2" />
                <div className="flex gap-4">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          // 실행 중인 작업 목록
          jobs.map((job) => {
            // 현재 실행 시간 계산
            const currentElapsed = Math.floor(
              (Date.now() - new Date(job.started_at).getTime()) / 1000
            );
            const totalDocs = job.docs_scraped + job.docs_skipped + job.docs_failed;
            
            return (
              <div
                key={job.log_id}
                className="bg-white/50 rounded-xl p-4 border border-white/60 hover:border-blue-200 transition-colors"
              >
                {/* 헤더 */}
                <div className="flex items-center gap-3 mb-3">
                  {job.org_logo ? (
                    <Image
                      src={job.org_logo}
                      alt={job.org_name}
                      width={32}
                      height={32}
                      className="rounded-lg object-contain bg-white"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-stone-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-stone-800 truncate">
                      {job.org_name} - {job.board_name}
                    </div>
                    <div className="text-xs text-stone-500">
                      {job.board_id}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-blue-600">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-medium tabular-nums">
                      {formatElapsedTime(currentElapsed)}
                    </span>
                  </div>
                </div>

                {/* 프로그레스 바 */}
                <div className="relative h-2 bg-stone-200 rounded-full overflow-hidden mb-3">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min((job.pages_processed / Math.max(job.pages_processed + 5, 10)) * 100, 95)}%`,
                      backgroundSize: "20px 20px",
                      backgroundImage: "linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)",
                      animation: "progress-stripes 1s linear infinite",
                    }}
                  />
                </div>

                {/* 통계 */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-stone-500">페이지:</span>
                    <span className="font-medium text-stone-700">{job.pages_processed}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-stone-500">수집:</span>
                    <span className="font-medium text-emerald-600">{job.docs_scraped}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-stone-500">건너뜀:</span>
                    <span className="font-medium text-amber-600">{job.docs_skipped}</span>
                  </div>
                  {job.docs_failed > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-stone-500">실패:</span>
                      <span className="font-medium text-red-600">{job.docs_failed}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================
// 컴포넌트: 요약 통계 카드
// ============================================================

function SummaryCards({ data, loading }: { data: SummaryData | null; loading: boolean }) {
  const cards = [
    {
      label: "총 문서",
      value: data ? formatNumber(data.total_documents) : "-",
      icon: FileText,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
    {
      label: "총 첨부파일",
      value: data ? formatNumber(data.total_attachments) : "-",
      icon: Paperclip,
      color: "text-sky-600",
      bgColor: "bg-sky-50",
    },
    {
      label: "금일 수집",
      value: data ? formatNumber(data.today_documents) : "-",
      icon: CalendarClock,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
    },
    {
      label: "실행 중",
      value: data ? formatNumber(data.running_jobs) : "-",
      icon: Activity,
      color: data && data.running_jobs > 0 ? "text-blue-600" : "text-stone-500",
      bgColor: data && data.running_jobs > 0 ? "bg-blue-50" : "bg-stone-50",
      pulse: data && data.running_jobs > 0,
    },
    {
      label: "24h 에러율",
      value: data ? `${data.error_rate_24h}%` : "-",
      icon: AlertCircle,
      color: data && data.error_rate_24h > 10 ? "text-red-600" : "text-stone-500",
      bgColor: data && data.error_rate_24h > 10 ? "bg-red-50" : "bg-stone-50",
    },
  ];

  // 로딩 중일 때 스켈레톤 표시
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, idx) => (
          <SummaryCardSkeleton key={idx} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((card, idx) => (
        <div
          key={idx}
          className="glass-panel rounded-2xl p-4 transition-all duration-300 hover:shadow-lg"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${card.bgColor} ${card.pulse ? "animate-pulse" : ""}`}>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <div>
              <div className="text-xs text-stone-500 font-medium">{card.label}</div>
              <div className="text-xl font-bold text-stone-800">{card.value}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 컴포넌트: 기간 선택
// ============================================================

type PeriodType = "7d" | "30d" | "90d" | "custom";

function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodType;
  onChange: (v: PeriodType) => void;
}) {
  const options: { value: PeriodType; label: string }[] = [
    { value: "7d", label: "7일" },
    { value: "30d", label: "30일" },
    { value: "90d", label: "90일" },
  ];

  return (
    <div className="flex items-center gap-1 bg-white/60 rounded-xl p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
            value === opt.value
              ? "bg-emerald-600 text-white"
              : "text-stone-600 hover:bg-white/80"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// 컴포넌트: 스케줄 Gantt 차트 (트리뷰 형태)
// ============================================================

// 기관별 그룹화된 스케줄 타입
interface OrgScheduleGroup {
  org_id: string;
  org_name: string;
  org_logo: string | null;
  schedules: ScheduleData[];
}

// Gantt 차트 본체 (재사용 가능)
function GanttChartBody({
  groupedSchedules,
  expandedOrgs,
  onToggleOrg,
  dateRange,
  labelInterval,
  isModal = false,
}: {
  groupedSchedules: OrgScheduleGroup[];
  expandedOrgs: Set<string>;
  onToggleOrg: (orgId: string) => void;
  dateRange: Date[];
  labelInterval: number;
  isModal?: boolean;
}) {
  // 스케줄별 색상
  const colors = [
    "bg-emerald-500",
    "bg-sky-500",
    "bg-amber-500",
    "bg-violet-500",
    "bg-rose-500",
    "bg-teal-500",
    "bg-orange-500",
    "bg-indigo-500",
  ];

  let colorIndex = 0;

  return (
    <div className={isModal ? "min-w-[600px]" : "min-w-[300px]"}>
      {/* 헤더 (날짜) */}
      <div className="flex border-b border-stone-200 sticky top-0 bg-white/80 backdrop-blur-sm z-10">
        <div className={`${isModal ? "w-52" : "w-44"} shrink-0 px-2 py-1.5 text-xs font-medium text-stone-500 border-r border-stone-100`}>
          기관 / 보드
        </div>
        <div className="flex-1 flex">
          {dateRange.map((date, idx) => {
            const isToday = date.toDateString() === new Date().toDateString();
            const showLabel = idx % labelInterval === 0;
            
            return (
              <div
                key={idx}
                className={`flex-1 min-w-[18px] text-center py-1.5 text-[10px] border-r border-stone-50 ${
                  isToday ? "bg-emerald-50 font-medium text-emerald-700" : "text-stone-400"
                }`}
              >
                {showLabel ? (
                  <span>{date.getMonth() + 1}/{date.getDate()}</span>
                ) : (
                  <span className="text-stone-200">·</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 기관별 트리뷰 */}
      {groupedSchedules.map((group) => {
        const isExpanded = expandedOrgs.has(group.org_id);
        const orgColorIdx = colorIndex;
        
        return (
          <div key={group.org_id}>
            {/* 기관 행 (부모 노드) */}
            <div
              className="flex border-b border-stone-100 bg-stone-50/50 cursor-pointer hover:bg-stone-100/50 transition-colors"
              onClick={() => onToggleOrg(group.org_id)}
            >
              <div className={`${isModal ? "w-52" : "w-44"} shrink-0 px-2 py-1.5 border-r border-stone-100 flex items-center gap-1.5`}>
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-stone-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-stone-400 shrink-0" />
                )}
                {group.org_logo ? (
                  <Image
                    src={group.org_logo}
                    alt={group.org_name}
                    width={14}
                    height={14}
                    className="rounded shrink-0"
                  />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                )}
                <span className="text-xs font-medium text-stone-700 truncate">
                  {group.org_name}
                </span>
                <span className="text-[10px] text-stone-400 shrink-0">
                  ({group.schedules.length})
                </span>
              </div>
              
              {/* 기관 행의 날짜 셀 (빈 셀) */}
              <div className="flex-1 flex items-center">
                {dateRange.map((date, idx) => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  return (
                    <div
                      key={idx}
                      className={`flex-1 min-w-[18px] h-7 border-r border-stone-50 ${
                        isToday ? "bg-emerald-50/30" : ""
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* 보드 행들 (자식 노드) */}
            {isExpanded && group.schedules.map((schedule) => {
              const runDates = new Set(
                schedule.next_runs.map((d) => new Date(d).toDateString())
              );
              const currentColor = colors[colorIndex % colors.length];
              colorIndex++;
              
              return (
                <div
                  key={schedule.schedule_id}
                  className="flex border-b border-stone-50 hover:bg-stone-50/50 transition-colors"
                >
                  {/* 보드 이름 (들여쓰기) */}
                  <div className={`${isModal ? "w-52" : "w-44"} shrink-0 px-2 py-1.5 border-r border-stone-100 pl-6`}>
                    <div className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${currentColor} shrink-0`} />
                      <span className="text-[11px] text-stone-600 truncate" title={schedule.targets[0]?.board_name}>
                        {schedule.targets[0]?.board_name || schedule.name}
                      </span>
                    </div>
                    <div className="text-[9px] text-stone-400 pl-3 truncate">
                      {schedule.cron_description}
                    </div>
                  </div>
                  
                  {/* 날짜 셀들 */}
                  <div className="flex-1 flex items-center">
                    {dateRange.map((date, idx) => {
                      const hasRun = runDates.has(date.toDateString());
                      const isToday = date.toDateString() === new Date().toDateString();
                      
                      return (
                        <div
                          key={idx}
                          className={`flex-1 min-w-[18px] h-7 flex items-center justify-center border-r border-stone-50 ${
                            isToday ? "bg-emerald-50/50" : ""
                          }`}
                        >
                          {hasRun && (
                            <div
                              className={`w-2.5 h-2.5 rounded-full ${currentColor} shadow-sm`}
                              title={`${schedule.targets[0]?.board_name}: ${date.toLocaleDateString("ko-KR")}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Gantt 차트 전체 보기 모달
function GanttChartModal({
  isOpen,
  onClose,
  groupedSchedules,
  period,
}: {
  isOpen: boolean;
  onClose: () => void;
  groupedSchedules: OrgScheduleGroup[];
  period: "7d" | "30d" | "90d";
}) {
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const labelInterval = period === "7d" ? 1 : period === "30d" ? 5 : 10;
  
  const dateRange = useMemo(() => {
    const dates: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  }, [days]);

  // 모달 열릴 때 모든 기관 펼치기
  useEffect(() => {
    if (isOpen) {
      setExpandedOrgs(new Set(groupedSchedules.map((g) => g.org_id)));
    }
  }, [isOpen, groupedSchedules]);

  const handleToggleOrg = (orgId: string) => {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedOrgs(new Set(groupedSchedules.map((g) => g.org_id)));
  };

  const handleCollapseAll = () => {
    setExpandedOrgs(new Set());
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 백드롭 */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 모달 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-600" />
            <h2 className="font-bold text-stone-800">보드별 스케줄 전체 보기</h2>
            <span className="text-sm text-stone-500">
              ({period === "7d" ? "7일" : period === "30d" ? "30일" : "90일"})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExpandAll}
              className="px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded transition-colors"
            >
              모두 펼치기
            </button>
            <button
              onClick={handleCollapseAll}
              className="px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded transition-colors"
            >
              모두 접기
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-stone-500" />
            </button>
          </div>
        </div>
        
        {/* 차트 본체 */}
        <div className="flex-1 overflow-auto p-4">
          <GanttChartBody
            groupedSchedules={groupedSchedules}
            expandedOrgs={expandedOrgs}
            onToggleOrg={handleToggleOrg}
            dateRange={dateRange}
            labelInterval={labelInterval}
            isModal={true}
          />
        </div>
        
        {/* 푸터 */}
        <div className="p-4 border-t border-stone-200 bg-stone-50/50">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stone-500">
              총 {groupedSchedules.length}개 기관, {groupedSchedules.reduce((sum, g) => sum + g.schedules.length, 0)}개 스케줄
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-sm font-medium transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleGanttChart({
  schedules,
  loading,
  period,
  onOpenFullView,
}: {
  schedules: ScheduleData[];
  loading: boolean;
  period: "7d" | "30d" | "90d";
  onOpenFullView?: () => void;
}) {
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  
  // 날짜 범위 생성
  const dateRange = useMemo(() => {
    const dates: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  }, [days]);
  
  // 레이블 표시 간격 계산
  const labelInterval = period === "7d" ? 1 : period === "30d" ? 5 : 10;
  
  // 기관별 그룹화
  const groupedSchedules = useMemo(() => {
    const enabledSchedules = schedules.filter((s) => s.enabled);
    const groups = new Map<string, OrgScheduleGroup>();
    
    enabledSchedules.forEach((schedule) => {
      const target = schedule.targets[0];
      if (!target) return;
      
      const orgId = target.org_id || "unknown";
      
      if (!groups.has(orgId)) {
        groups.set(orgId, {
          org_id: orgId,
          org_name: target.org_name || "알 수 없음",
          org_logo: target.org_logo,
          schedules: [],
        });
      }
      groups.get(orgId)!.schedules.push(schedule);
    });
    
    return Array.from(groups.values());
  }, [schedules]);

  // 첫 로드 시 첫 번째 기관 펼치기
  useEffect(() => {
    if (groupedSchedules.length > 0 && expandedOrgs.size === 0) {
      setExpandedOrgs(new Set([groupedSchedules[0].org_id]));
    }
  }, [groupedSchedules]);

  const handleToggleOrg = (orgId: string) => {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Skeleton className="w-full h-[250px]" />
      </div>
    );
  }
  
  if (schedules.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-stone-400 text-sm">
        등록된 스케줄이 없습니다
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 전체 보기 버튼 */}
      {onOpenFullView && (
        <div className="flex justify-end mb-1">
          <button
            onClick={onOpenFullView}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
          >
            <Layers className="w-3 h-3" />
            전체 보기
          </button>
        </div>
      )}
      
      {/* Gantt 차트 */}
      <div className="flex-1 overflow-auto">
        <GanttChartBody
          groupedSchedules={groupedSchedules}
          expandedOrgs={expandedOrgs}
          onToggleOrg={handleToggleOrg}
          dateRange={dateRange}
          labelInterval={labelInterval}
        />
      </div>
    </div>
  );
}

// ============================================================
// 컴포넌트: 타임라인 차트
// ============================================================

function TimelineChart({
  data,
  loading,
  period = "30d",
}: {
  data: TimelineData[];
  loading: boolean;
  period?: "7d" | "30d" | "90d";
}) {
  if (loading) {
    return <ChartSkeleton height={250} />;
  }

  if (data.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-stone-500">
        데이터가 없습니다
      </div>
    );
  }

  // x축 레이블 간격 계산
  const tickInterval = period === "7d" ? 0 : period === "30d" ? 4 : 9;

  // 차트 데이터에 누적합 계산 (애니메이션용)
  const chartData = data.map((item, idx) => ({
    ...item,
    total: item.documents + item.attachments,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorDocuments" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
            <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="colorAttachments" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.3} />
            <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 10, fill: "#78716c" }}
          axisLine={{ stroke: "#d6d3d1" }}
          tickLine={false}
          interval={tickInterval}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#78716c" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #e7e5e4",
            borderRadius: "12px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.1)",
            padding: "12px 16px",
          }}
          formatter={(value: number, name: string) => [
            formatNumber(value),
            name === "documents" ? "📄 문서" : "📎 첨부파일",
          ]}
          labelFormatter={(label) => {
            const date = new Date(label as string);
            return date.toLocaleDateString("ko-KR", { 
              year: "numeric", 
              month: "long", 
              day: "numeric",
              weekday: "short"
            });
          }}
        />
        <Area
          type="monotone"
          dataKey="documents"
          stroke={CHART_COLORS.primary}
          strokeWidth={2.5}
          fill="url(#colorDocuments)"
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="attachments"
          stroke={CHART_COLORS.secondary}
          strokeWidth={2.5}
          fill="url(#colorAttachments)"
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ============================================================
// 컴포넌트: 파일 형식 파이 차트
// ============================================================

function FileTypePieChart({
  data,
  loading,
}: {
  data: FileTypeData[];
  loading: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (loading) {
    return <PieChartSkeleton />;
  }

  if (data.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-stone-500">
        데이터가 없습니다
      </div>
    );
  }

  // 상위 6개만 표시, 나머지는 "기타"로 합침
  const topData = data.slice(0, 6);
  const othersCount = data.slice(6).reduce((sum, item) => sum + item.count, 0);
  const othersSize = data.slice(6).reduce((sum, item) => sum + item.size_bytes, 0);
  const chartData = othersCount > 0
    ? [...topData, { type: "others", label: "기타", count: othersCount, percentage: 0, size_bytes: othersSize }]
    : topData;

  const totalCount = chartData.reduce((sum, item) => sum + item.count, 0);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RechartsPieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="45%"
          innerRadius={50}
          outerRadius={activeIndex !== null ? 90 : 85}
          paddingAngle={2}
          dataKey="count"
          nameKey="label"
          animationBegin={0}
          animationDuration={800}
          animationEasing="ease-out"
          onMouseEnter={(_, index) => setActiveIndex(index)}
          onMouseLeave={() => setActiveIndex(null)}
        >
          {chartData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={PIE_COLORS[index % PIE_COLORS.length]}
              opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
              style={{
                filter: activeIndex === index ? "drop-shadow(0 4px 8px rgba(0,0,0,0.15))" : "none",
                transition: "all 0.2s ease",
                cursor: "pointer",
              }}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #e7e5e4",
            borderRadius: "12px",
            padding: "10px 14px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.1)",
          }}
          formatter={(value: number, name: string, props: { payload: FileTypeData }) => {
            const percent = totalCount > 0 ? ((value / totalCount) * 100).toFixed(1) : 0;
            const size = props.payload?.size_bytes || 0;
            return [
              <div key="tooltip" className="space-y-1">
                <div className="font-medium">{formatNumber(value)}개 ({percent}%)</div>
                <div className="text-stone-500 text-xs">{formatBytes(size)}</div>
              </div>,
              name
            ];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px" }}
          formatter={(value: string, entry: { payload?: { count?: number } }) => {
            const count = entry.payload?.count || 0;
            const percent = totalCount > 0 ? ((count / totalCount) * 100).toFixed(0) : 0;
            return (
              <span className="text-stone-600">
                {value} <span className="text-stone-400">({percent}%)</span>
              </span>
            );
          }}
        />
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}

// ============================================================
// 컴포넌트: 보드 상세 모달
// ============================================================

// 보드 상세 통계 타입
interface BoardDetailStats {
  timeline: { date: string; documents: number }[];
  fileTypes: { type: string; label: string; count: number; size_bytes: number; percentage: number }[];
  logs: {
    log_id: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    docs_scraped: number;
    docs_skipped: number;
    docs_failed: number;
    pages_processed: number;
    error_message: string | null;
  }[];
  totals: { total_documents: number; total_attachments: number; total_size_bytes: number };
  stats: { total_runs: number; success_rate: number; total_scraped: number; total_failed: number };
}

function BoardDetailModal({
  board,
  onClose,
}: {
  board: BoardStatusItem | null;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "stats" | "logs">("overview");
  const [detailStats, setDetailStats] = useState<BoardDetailStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // 상세 통계 로드
  useEffect(() => {
    if (!board || activeTab === "overview") return;
    
    const fetchStats = async () => {
      setLoadingStats(true);
      try {
        const res = await fetch(`/api/scraper/status/boards/${board.board_id}/stats`);
        const json = await res.json();
        if (json.success) {
          setDetailStats(json.data);
        }
      } catch (error) {
        console.error("Board stats fetch error:", error);
      } finally {
        setLoadingStats(false);
      }
    };
    
    fetchStats();
  }, [board, activeTab]);

  if (!board) return null;

  const statusConfig: Record<
    BoardStatusItem["status"],
    { label: string; color: string; bgColor: string; dotColor: string }
  > = {
    active: { label: "정상", color: "text-emerald-700", bgColor: "bg-emerald-50", dotColor: "bg-emerald-500" },
    running: { label: "실행 중", color: "text-blue-700", bgColor: "bg-blue-50", dotColor: "bg-blue-500" },
    warning: { label: "경고", color: "text-amber-700", bgColor: "bg-amber-50", dotColor: "bg-amber-500" },
    error: { label: "에러", color: "text-red-700", bgColor: "bg-red-50", dotColor: "bg-red-500" },
    disabled: { label: "비활성", color: "text-stone-500", bgColor: "bg-stone-100", dotColor: "bg-stone-400" },
    never: { label: "미실행", color: "text-stone-500", bgColor: "bg-stone-100", dotColor: "bg-stone-400" },
  };

  const modeConfig: Record<string, { label: string; icon: typeof Globe; color: string }> = {
    web_scraping: { label: "웹 스크래핑", icon: Globe, color: "text-sky-600" },
    api_only: { label: "API", icon: Server, color: "text-violet-600" },
    hybrid: { label: "하이브리드", icon: Globe, color: "text-amber-600" },
  };

  const status = statusConfig[board.status];
  const mode = modeConfig[board.collection_mode] || modeConfig.web_scraping;
  const ModeIcon = mode.icon;

  // 탭 정의
  const tabs = [
    { id: "overview" as const, label: "개요", icon: BarChart3 },
    { id: "stats" as const, label: "상세 통계", icon: TrendingUp },
    { id: "logs" as const, label: "실행 로그", icon: Activity },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {board.org_logo ? (
              <Image
                src={board.org_logo}
                alt={board.org_name}
                width={40}
                height={40}
                className="rounded-lg object-contain bg-white border border-stone-100"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-stone-400" />
              </div>
            )}
            <div>
              <h3 className="font-bold text-stone-800">{board.board_name}</h3>
              <p className="text-xs text-stone-500">{board.org_name} · {board.board_id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-stone-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div className="px-6 pt-3 border-b border-stone-100 shrink-0">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id
                    ? "text-emerald-700 bg-emerald-50 border-b-2 border-emerald-500"
                    : "text-stone-500 hover:text-stone-700 hover:bg-stone-50"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 본문 (스크롤 가능) */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {activeTab === "overview" && (
            <>
              {/* 상태 및 모드 */}
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status.color} ${status.bgColor}`}
                >
                  <span className={`w-2 h-2 rounded-full ${status.dotColor}`} />
                  {status.label}
                </span>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-stone-100 ${mode.color}`}>
                  <ModeIcon className="w-4 h-4" />
                  {mode.label}
                </span>
              </div>

              {/* 통계 카드 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-stone-50 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-stone-800">{formatNumber(board.stats.document_count)}</div>
                  <div className="text-xs text-stone-500">총 문서</div>
                </div>
                <div className="bg-stone-50 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-stone-800">{formatNumber(board.stats.attachment_count)}</div>
                  <div className="text-xs text-stone-500">총 첨부</div>
                </div>
                <div className="bg-stone-50 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-stone-800">{formatBytes(board.stats.total_size_bytes)}</div>
                  <div className="text-xs text-stone-500">총 용량</div>
                </div>
              </div>

              {/* 상세 정보 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-500 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    마지막 실행
                  </span>
                  <span className="text-sm font-medium text-stone-700">
                    {board.last_run_at
                      ? new Date(board.last_run_at).toLocaleString("ko-KR")
                      : "실행 기록 없음"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-500 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    다음 실행 예정
                  </span>
                  <span className="text-sm font-medium text-stone-700">
                    {board.next_run_at
                      ? new Date(board.next_run_at).toLocaleString("ko-KR")
                      : "예정 없음"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-500 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    최근 7일 수집
                  </span>
                  <span className="text-sm font-medium text-stone-700">
                    {formatNumber(board.stats.last_7d_documents)}개
                  </span>
                </div>
                {board.schedule_name && (
                  <div className="flex items-center justify-between py-2 border-b border-stone-100">
                    <span className="text-sm text-stone-500 flex items-center gap-2">
                      <CalendarClock className="w-4 h-4" />
                      스케줄
                    </span>
                    <span className="text-sm font-medium text-stone-700">
                      {board.schedule_name}
                    </span>
                  </div>
                )}
              </div>

              {/* 에러 메시지 */}
              {board.last_error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm mb-1">
                    <AlertCircle className="w-4 h-4" />
                    마지막 에러
                  </div>
                  <p className="text-sm text-red-600">{board.last_error}</p>
                </div>
              )}
            </>
          )}

          {activeTab === "stats" && (
            <>
              {loadingStats ? (
                <div className="space-y-4">
                  <Skeleton className="h-6 w-32" />
                  <ChartSkeleton height={200} />
                  <Skeleton className="h-6 w-32 mt-6" />
                  <div className="grid grid-cols-4 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                  </div>
                </div>
              ) : detailStats ? (
                <>
                  {/* 성공률 통계 */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-emerald-50 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-emerald-700">{detailStats.stats.success_rate}%</div>
                      <div className="text-xs text-emerald-600">성공률</div>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-blue-700">{detailStats.stats.total_runs}</div>
                      <div className="text-xs text-blue-600">총 실행</div>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-amber-700">{formatNumber(detailStats.stats.total_scraped)}</div>
                      <div className="text-xs text-amber-600">수집 성공</div>
                    </div>
                    <div className="bg-red-50 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-red-700">{formatNumber(detailStats.stats.total_failed)}</div>
                      <div className="text-xs text-red-600">수집 실패</div>
                    </div>
                  </div>

                  {/* 일별 수집 차트 */}
                  <div>
                    <h4 className="text-sm font-medium text-stone-700 mb-3">최근 30일 수집 추이</h4>
                    {detailStats.timeline.length > 0 ? (
                      <div className="h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={detailStats.timeline}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 10, fill: "#78716C" }}
                              tickFormatter={(v) => new Date(v).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                            />
                            <YAxis tick={{ fontSize: 10, fill: "#78716C" }} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "white",
                                borderRadius: 12,
                                border: "1px solid #E7E5E4",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                              }}
                              labelFormatter={(v) => new Date(v).toLocaleDateString("ko-KR")}
                              formatter={(value: number) => [value, "문서"]}
                            />
                            <Bar
                              dataKey="documents"
                              fill="#16A34A"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[180px] flex items-center justify-center text-stone-400 text-sm">
                        데이터가 없습니다
                      </div>
                    )}
                  </div>

                  {/* 파일 유형별 분포 */}
                  <div>
                    <h4 className="text-sm font-medium text-stone-700 mb-3">파일 유형별 분포</h4>
                    {detailStats.fileTypes.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {detailStats.fileTypes.slice(0, 6).map((ft, idx) => (
                          <div key={ft.type} className="flex items-center justify-between bg-stone-50 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                              />
                              <span className="text-sm font-medium text-stone-700">{ft.label}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold text-stone-800">{ft.count}개</span>
                              <span className="text-xs text-stone-500 ml-1">({ft.percentage}%)</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-20 flex items-center justify-center text-stone-400 text-sm">
                        첨부파일이 없습니다
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-40 flex items-center justify-center text-stone-400">
                  통계를 불러올 수 없습니다
                </div>
              )}
            </>
          )}

          {activeTab === "logs" && (
            <>
              {loadingStats ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-3 border-b border-stone-100">
                      <Skeleton className="w-5 h-5 rounded-full" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-40 mb-1" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              ) : detailStats && detailStats.logs.length > 0 ? (
                <div className="space-y-2">
                  {detailStats.logs.map((log) => {
                    const logStatus = {
                      completed: { label: "완료", color: "text-emerald-600", bg: "bg-emerald-100", icon: "✓" },
                      running: { label: "실행 중", color: "text-blue-600", bg: "bg-blue-100", icon: "●" },
                      failed: { label: "실패", color: "text-red-600", bg: "bg-red-100", icon: "✗" },
                    }[log.status] || { label: log.status, color: "text-stone-600", bg: "bg-stone-100", icon: "?" };
                    
                    const duration = log.finished_at
                      ? Math.floor((new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                      : null;
                    
                    return (
                      <div
                        key={log.log_id}
                        className="flex items-start gap-3 py-3 border-b border-stone-100 last:border-0"
                      >
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${logStatus.bg} ${logStatus.color}`}
                        >
                          {logStatus.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            <span className={`font-medium ${logStatus.color}`}>{logStatus.label}</span>
                            <span className="text-stone-400">·</span>
                            <span className="text-stone-500">
                              {new Date(log.started_at).toLocaleString("ko-KR")}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-stone-500">
                            <span>수집: <span className="font-medium text-emerald-600">{log.docs_scraped}</span></span>
                            <span>건너뜀: <span className="font-medium text-amber-600">{log.docs_skipped}</span></span>
                            <span>실패: <span className="font-medium text-red-600">{log.docs_failed}</span></span>
                            <span>페이지: <span className="font-medium text-stone-700">{log.pages_processed}</span></span>
                            {duration !== null && (
                              <span>소요: <span className="font-medium text-stone-700">{formatElapsedTime(duration)}</span></span>
                            )}
                          </div>
                          {log.error_message && (
                            <div className="mt-2 text-xs text-red-500 bg-red-50 rounded px-2 py-1">
                              {log.error_message}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-40 flex items-center justify-center text-stone-400">
                  실행 로그가 없습니다
                </div>
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
          >
            닫기
          </button>
          <a
            href={`/scraper/targets?board=${board.board_id}`}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            보드 설정
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 컴포넌트: 보드 상태 테이블
// ============================================================

function BoardStatusTable({
  boards,
  loading,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  onBoardClick,
}: {
  boards: BoardStatusItem[];
  loading: boolean;
  filter: string;
  onFilterChange: (v: string) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onBoardClick: (board: BoardStatusItem) => void;
}) {
  const statusConfig: Record<
    BoardStatusItem["status"],
    { label: string; color: string; bgColor: string; dotColor: string }
  > = {
    active: { label: "정상", color: "text-emerald-700", bgColor: "bg-emerald-50", dotColor: "bg-emerald-500" },
    running: { label: "실행 중", color: "text-blue-700", bgColor: "bg-blue-50", dotColor: "bg-blue-500" },
    warning: { label: "경고", color: "text-amber-700", bgColor: "bg-amber-50", dotColor: "bg-amber-500" },
    error: { label: "에러", color: "text-red-700", bgColor: "bg-red-50", dotColor: "bg-red-500" },
    disabled: { label: "비활성", color: "text-stone-500", bgColor: "bg-stone-100", dotColor: "bg-stone-400" },
    never: { label: "미실행", color: "text-stone-500", bgColor: "bg-stone-100", dotColor: "bg-stone-400" },
  };

  const modeConfig: Record<string, { label: string; color: string; bgColor: string }> = {
    web_scraping: { label: "웹 스크래핑", color: "text-sky-700", bgColor: "bg-sky-50" },
    api_only: { label: "API", color: "text-violet-700", bgColor: "bg-violet-50" },
    hybrid: { label: "하이브리드", color: "text-amber-700", bgColor: "bg-amber-50" },
  };

  // 필터링
  const filteredBoards = boards.filter((board) => {
    const matchesFilter = filter === "all" || board.status === filter;
    const matchesSearch =
      searchQuery === "" ||
      board.board_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      board.org_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      board.board_id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* 헤더 */}
      <div className="p-4 border-b border-white/30 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-stone-800">보드별 현황</h3>
          <span className="text-xs text-stone-500">({filteredBoards.length}개)</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 검색 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm bg-white/60 border border-white/70 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
          {/* 필터 */}
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm bg-white/60 border border-white/70 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 cursor-pointer"
            >
              <option value="all">전체 상태</option>
              <option value="active">정상</option>
              <option value="running">실행 중</option>
              <option value="warning">경고</option>
              <option value="error">에러</option>
              <option value="disabled">비활성</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-stone-50/50">
              <th className="px-4 py-3 text-left font-semibold text-stone-600">기관</th>
              <th className="px-4 py-3 text-left font-semibold text-stone-600">보드</th>
              <th className="px-4 py-3 text-center font-semibold text-stone-600">모드</th>
              <th className="px-4 py-3 text-center font-semibold text-stone-600">상태</th>
              <th className="px-4 py-3 text-center font-semibold text-stone-600">마지막 실행</th>
              <th className="px-4 py-3 text-right font-semibold text-stone-600">문서</th>
              <th className="px-4 py-3 text-right font-semibold text-stone-600">첨부</th>
              <th className="px-4 py-3 text-right font-semibold text-stone-600">용량</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // 스켈레톤 로딩 행들 표시
              Array.from({ length: 5 }).map((_, idx) => (
                <TableRowSkeleton key={idx} />
              ))
            ) : filteredBoards.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-stone-500">
                  검색 결과가 없습니다
                </td>
              </tr>
            ) : (
              filteredBoards.map((board) => {
                const status = statusConfig[board.status];
                const mode = modeConfig[board.collection_mode] || modeConfig.web_scraping;
                return (
                  <tr
                    key={board.board_id}
                    className="border-t border-stone-100 hover:bg-white/50 transition-colors cursor-pointer"
                    onClick={() => onBoardClick(board)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {board.org_logo ? (
                          <Image
                            src={board.org_logo}
                            alt={board.org_name}
                            width={24}
                            height={24}
                            className="rounded object-contain bg-white"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded bg-stone-100 flex items-center justify-center">
                            <Building2 className="w-3 h-3 text-stone-400" />
                          </div>
                        )}
                        <span className="font-medium text-stone-700">{board.org_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <span className="text-stone-800">{board.board_name}</span>
                        <span className="text-stone-400 text-xs ml-1">({board.board_id})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${mode.color} ${mode.bgColor}`}>
                        {mode.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${status.color} ${status.bgColor}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${status.dotColor} ${
                            board.status === "running" ? "animate-pulse" : ""
                          }`}
                        />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-stone-600">
                      {formatRelativeTime(board.last_run_at)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-stone-800">
                      {formatNumber(board.stats.document_count)}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-600">
                      {formatNumber(board.stats.attachment_count)}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-600">
                      {formatBytes(board.stats.total_size_bytes)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// 컴포넌트: 기관별 그룹 뷰
// ============================================================

function OrgGroupView({
  boards,
  loading,
  onBoardClick,
}: {
  boards: BoardStatusItem[];
  loading: boolean;
  onBoardClick: (board: BoardStatusItem) => void;
}) {
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  // 기관별로 그룹핑
  const orgGroups: OrgGroupStats[] = useMemo(() => {
    const groupMap = new Map<string, OrgGroupStats>();
    
    boards.forEach((board) => {
      if (!groupMap.has(board.org_id)) {
        groupMap.set(board.org_id, {
          org_id: board.org_id,
          org_name: board.org_name,
          org_logo: board.org_logo,
          board_count: 0,
          active_boards: 0,
          error_boards: 0,
          total_documents: 0,
          total_attachments: 0,
          total_size_bytes: 0,
          last_7d_documents: 0,
          boards: [],
        });
      }
      
      const group = groupMap.get(board.org_id)!;
      group.board_count++;
      if (board.status === "active" || board.status === "running") {
        group.active_boards++;
      }
      if (board.status === "error" || board.status === "warning") {
        group.error_boards++;
      }
      group.total_documents += board.stats.document_count;
      group.total_attachments += board.stats.attachment_count;
      group.total_size_bytes += board.stats.total_size_bytes;
      group.last_7d_documents += board.stats.last_7d_documents;
      group.boards.push(board);
    });
    
    return Array.from(groupMap.values()).sort((a, b) => b.total_documents - a.total_documents);
  }, [boards]);

  const toggleOrg = (orgId: string) => {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-panel rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="flex-1">
                <Skeleton className="h-5 w-40 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex gap-4">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orgGroups.map((org) => {
        const isExpanded = expandedOrgs.has(org.org_id);
        
        return (
          <div
            key={org.org_id}
            className="glass-panel rounded-2xl overflow-hidden"
          >
            {/* 기관 헤더 */}
            <button
              onClick={() => toggleOrg(org.org_id)}
              className="w-full px-5 py-4 flex items-center gap-4 hover:bg-white/30 transition-colors"
            >
              {/* 로고 */}
              {org.org_logo ? (
                <Image
                  src={org.org_logo}
                  alt={org.org_name}
                  width={40}
                  height={40}
                  className="rounded-lg object-contain bg-white border border-stone-100"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-stone-400" />
                </div>
              )}

              {/* 기관명 및 보드 수 */}
              <div className="flex-1 text-left">
                <div className="font-bold text-stone-800">{org.org_name}</div>
                <div className="text-xs text-stone-500">
                  보드 {org.board_count}개
                  {org.error_boards > 0 && (
                    <span className="text-red-500 ml-2">· 에러 {org.error_boards}개</span>
                  )}
                </div>
              </div>

              {/* 통계 */}
              <div className="hidden md:flex items-center gap-6 text-sm">
                <div className="text-center">
                  <div className="font-bold text-stone-800">{formatNumber(org.total_documents)}</div>
                  <div className="text-xs text-stone-500">문서</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-stone-800">{formatNumber(org.total_attachments)}</div>
                  <div className="text-xs text-stone-500">첨부</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-stone-800">{formatBytes(org.total_size_bytes)}</div>
                  <div className="text-xs text-stone-500">용량</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-emerald-600">+{formatNumber(org.last_7d_documents)}</div>
                  <div className="text-xs text-stone-500">7일</div>
                </div>
              </div>

              {/* 화살표 */}
              <ChevronRight
                className={`w-5 h-5 text-stone-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              />
            </button>

            {/* 보드 목록 (확장 시) */}
            {isExpanded && (
              <div className="border-t border-stone-100 bg-white/30">
                {org.boards.map((board) => {
                  const statusConfig: Record<string, { color: string; bgColor: string; dotColor: string }> = {
                    active: { color: "text-emerald-700", bgColor: "bg-emerald-50", dotColor: "bg-emerald-500" },
                    running: { color: "text-blue-700", bgColor: "bg-blue-50", dotColor: "bg-blue-500" },
                    warning: { color: "text-amber-700", bgColor: "bg-amber-50", dotColor: "bg-amber-500" },
                    error: { color: "text-red-700", bgColor: "bg-red-50", dotColor: "bg-red-500" },
                    disabled: { color: "text-stone-500", bgColor: "bg-stone-100", dotColor: "bg-stone-400" },
                    never: { color: "text-stone-500", bgColor: "bg-stone-100", dotColor: "bg-stone-400" },
                  };
                  const status = statusConfig[board.status] || statusConfig.never;

                  return (
                    <button
                      key={board.board_id}
                      onClick={() => onBoardClick(board)}
                      className="w-full px-5 py-3 flex items-center gap-4 hover:bg-white/50 transition-colors border-b border-stone-50 last:border-0"
                    >
                      {/* 상태 표시 */}
                      <span className={`w-2 h-2 rounded-full ${status.dotColor}`} />

                      {/* 보드명 */}
                      <div className="flex-1 text-left">
                        <span className="text-sm font-medium text-stone-700">{board.board_name}</span>
                        <span className="text-xs text-stone-400 ml-1">({board.board_id})</span>
                      </div>

                      {/* 통계 */}
                      <div className="flex items-center gap-4 text-xs text-stone-500">
                        <span>{formatNumber(board.stats.document_count)} 문서</span>
                        <span>{formatRelativeTime(board.last_run_at)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 컴포넌트: 에러 로그 조회
// ============================================================

function ErrorLogsPanel({
  logs,
  loading,
  onRefresh,
}: {
  logs: ErrorLogItem[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [filterStatus, setFilterStatus] = useState<"all" | "failed" | "warning">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // 상태 필터
      if (filterStatus === "failed" && log.status !== "failed") return false;
      if (filterStatus === "warning" && log.docs_failed === 0) return false;
      
      // 검색어 필터
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          log.board_name.toLowerCase().includes(q) ||
          log.org_name.toLowerCase().includes(q) ||
          log.board_id.toLowerCase().includes(q) ||
          (log.error_message && log.error_message.toLowerCase().includes(q))
        );
      }
      
      return true;
    });
  }, [logs, filterStatus, searchQuery]);

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-4 border-b border-white/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileWarning className="w-5 h-5 text-red-500" />
          <h3 className="text-base font-bold text-stone-800">에러 로그</h3>
          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full">
            {logs.filter((l) => l.status === "failed" || l.docs_failed > 0).length}건
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
          title="새로고침"
        >
          <RefreshCw className={`w-4 h-4 text-stone-500 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 필터 */}
      <div className="px-5 py-3 border-b border-white/20 flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {[
            { value: "all" as const, label: "전체" },
            { value: "failed" as const, label: "실패" },
            { value: "warning" as const, label: "부분 실패" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilterStatus(opt.value)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                filterStatus === opt.value
                  ? "bg-red-100 text-red-700"
                  : "text-stone-500 hover:bg-stone-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="보드명, 기관명, 에러 메시지 검색..."
            className="w-full pl-9 pr-4 py-1.5 text-sm bg-white/50 rounded-lg border border-white/60 focus:outline-none focus:ring-2 focus:ring-red-200"
          />
        </div>
      </div>

      {/* 로그 목록 */}
      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 py-3 border-b border-stone-100">
                <Skeleton className="w-8 h-8 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-48 mb-2" />
                  <Skeleton className="h-3 w-full mb-1" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-stone-400">
            <FileWarning className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>에러 로그가 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {filteredLogs.map((log) => (
              <div key={log.log_id} className="px-5 py-4 hover:bg-white/30 transition-colors">
                <div className="flex items-start gap-3">
                  {/* 기관 로고 */}
                  {log.org_logo ? (
                    <Image
                      src={log.org_logo}
                      alt={log.org_name}
                      width={32}
                      height={32}
                      className="rounded-lg object-contain bg-white border border-stone-100"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-stone-400" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {/* 헤더 */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-stone-800">{log.board_name}</span>
                      <span className="text-xs text-stone-400">({log.org_name})</span>
                      <span
                        className={`ml-auto px-2 py-0.5 text-xs font-medium rounded ${
                          log.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {log.status === "failed" ? "실패" : `부분 실패 (${log.docs_failed}건)`}
                      </span>
                    </div>

                    {/* 에러 메시지 */}
                    {log.error_message && (
                      <div className="text-sm text-red-600 bg-red-50 rounded px-2 py-1 mb-2">
                        {log.error_message}
                      </div>
                    )}

                    {/* 통계 */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                      <span>
                        {new Date(log.started_at).toLocaleString("ko-KR")}
                      </span>
                      <span>수집: {log.docs_scraped}</span>
                      <span>건너뜀: {log.docs_skipped}</span>
                      <span className="text-red-500">실패: {log.docs_failed}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 컴포넌트: 데이터 내보내기 버튼
// ============================================================

function ExportButton({
  boards,
  summary,
}: {
  boards: BoardStatusItem[];
  summary: SummaryData | null;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const exportToCSV = () => {
    setIsExporting(true);
    try {
      // CSV 헤더
      const headers = [
        "기관명",
        "보드명",
        "보드ID",
        "모드",
        "상태",
        "문서 수",
        "첨부파일 수",
        "용량(bytes)",
        "최근 7일 수집",
        "마지막 실행",
        "다음 실행",
        "스케줄",
        "에러",
      ];

      // CSV 데이터 생성
      const rows = boards.map((b) => [
        b.org_name,
        b.board_name,
        b.board_id,
        b.collection_mode === "web_scraping" ? "웹 스크래핑" : b.collection_mode === "api_only" ? "API" : "하이브리드",
        b.status,
        b.stats.document_count,
        b.stats.attachment_count,
        b.stats.total_size_bytes,
        b.stats.last_7d_documents,
        b.last_run_at || "",
        b.next_run_at || "",
        b.schedule_name || "",
        b.last_error || "",
      ]);

      // BOM 추가 (Excel에서 한글 인식)
      const BOM = "\uFEFF";
      const csvContent = BOM + [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");

      // 다운로드
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scraper-status-${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
      setShowMenu(false);
    }
  };

  const exportToJSON = () => {
    setIsExporting(true);
    try {
      const data = {
        exported_at: new Date().toISOString(),
        summary: summary,
        boards: boards.map((b) => ({
          org_id: b.org_id,
          org_name: b.org_name,
          board_id: b.board_id,
          board_name: b.board_name,
          collection_mode: b.collection_mode,
          status: b.status,
          stats: b.stats,
          last_run_at: b.last_run_at,
          next_run_at: b.next_run_at,
          schedule_name: b.schedule_name,
          last_error: b.last_error,
        })),
      };

      const jsonContent = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonContent], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scraper-status-${new Date().toISOString().split("T")[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
      setShowMenu(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={isExporting}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-800 glass-button rounded-xl disabled:opacity-50"
      >
        <Download className={`w-4 h-4 ${isExporting ? "animate-bounce" : ""}`} />
        내보내기
        <ChevronDown className="w-4 h-4" />
      </button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-stone-200 py-1 min-w-[140px]">
            <button
              onClick={exportToCSV}
              className="w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              CSV로 내보내기
            </button>
            <button
              onClick={exportToJSON}
              className="w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
            >
              <BarChart3 className="w-4 h-4" />
              JSON으로 내보내기
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// 컴포넌트: 알림 패널
// ============================================================

function AlertsPanel({
  alerts,
  settings,
  onDismiss,
  onDismissAll,
  onSettingsClick,
}: {
  alerts: AlertItem[];
  settings: AlertSettings;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onSettingsClick: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const activeAlerts = alerts.filter((a) => !a.dismissed);
  const hasAlerts = activeAlerts.length > 0;
  
  if (!settings.enabled || !settings.showInApp) {
    return null;
  }

  const alertConfig = {
    error: { icon: XCircle, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
    warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
    info: { icon: Info, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" },
    success: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
  };

  return (
    <div className="relative">
      {/* 알림 버튼 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`relative p-2 rounded-xl transition-colors ${
          hasAlerts ? "bg-red-50 hover:bg-red-100" : "hover:bg-white/50"
        }`}
      >
        {hasAlerts ? (
          <BellRing className="w-5 h-5 text-red-600" />
        ) : (
          <Bell className="w-5 h-5 text-stone-500" />
        )}
        {hasAlerts && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {activeAlerts.length > 9 ? "9+" : activeAlerts.length}
          </span>
        )}
      </button>

      {/* 알림 드롭다운 */}
      {isExpanded && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsExpanded(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-20 w-96 bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden">
            {/* 헤더 */}
            <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-stone-600" />
                <span className="font-medium text-stone-800">알림</span>
                {hasAlerts && (
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded">
                    {activeAlerts.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {hasAlerts && (
                  <button
                    onClick={onDismissAll}
                    className="px-2 py-1 text-xs text-stone-500 hover:text-stone-700 hover:bg-stone-50 rounded"
                  >
                    모두 지우기
                  </button>
                )}
                <button
                  onClick={onSettingsClick}
                  className="p-1 hover:bg-stone-50 rounded"
                  title="알림 설정"
                >
                  <Settings className="w-4 h-4 text-stone-400" />
                </button>
              </div>
            </div>

            {/* 알림 목록 */}
            <div className="max-h-80 overflow-y-auto">
              {activeAlerts.length === 0 ? (
                <div className="py-8 text-center text-stone-400">
                  <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">새로운 알림이 없습니다</p>
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {activeAlerts.map((alert) => {
                    const config = alertConfig[alert.type];
                    const Icon = config.icon;
                    
                    return (
                      <div
                        key={alert.id}
                        className={`px-4 py-3 ${config.bg} border-l-4 ${config.border}`}
                      >
                        <div className="flex items-start gap-3">
                          <Icon className={`w-5 h-5 mt-0.5 ${config.color}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-medium text-sm text-stone-800">
                                {alert.title}
                              </div>
                              <button
                                onClick={() => onDismiss(alert.id)}
                                className="p-0.5 hover:bg-white/50 rounded"
                              >
                                <X className="w-4 h-4 text-stone-400" />
                              </button>
                            </div>
                            <p className="text-xs text-stone-600 mt-0.5">
                              {alert.message}
                            </p>
                            {alert.boardName && (
                              <p className="text-xs text-stone-500 mt-1">
                                {alert.orgName} · {alert.boardName}
                              </p>
                            )}
                            <p className="text-xs text-stone-400 mt-1">
                              {formatRelativeTime(alert.timestamp)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// 컴포넌트: 알림 설정 모달
// ============================================================

function AlertSettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: AlertSettings;
  onSave: (settings: AlertSettings) => void;
  onClose: () => void;
}) {
  const [localSettings, setLocalSettings] = useState(settings);

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-stone-800">알림 설정</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-stone-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-5">
          {/* 알림 활성화 */}
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">알림 활성화</span>
            <button
              onClick={() => setLocalSettings({ ...localSettings, enabled: !localSettings.enabled })}
              className={`w-11 h-6 rounded-full transition-colors ${
                localSettings.enabled ? "bg-emerald-500" : "bg-stone-300"
              }`}
            >
              <span
                className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  localSettings.enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>

          {/* 앱 내 알림 표시 */}
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">앱 내 알림 표시</span>
            <button
              onClick={() => setLocalSettings({ ...localSettings, showInApp: !localSettings.showInApp })}
              className={`w-11 h-6 rounded-full transition-colors ${
                localSettings.showInApp ? "bg-emerald-500" : "bg-stone-300"
              }`}
            >
              <span
                className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  localSettings.showInApp ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>

          {/* 에러율 임계치 */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">
              에러율 경고 임계치
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="50"
                value={localSettings.errorRateThreshold}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, errorRateThreshold: Number(e.target.value) })
                }
                className="flex-1 h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-sm font-medium text-stone-800 w-12 text-right">
                {localSettings.errorRateThreshold}%
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-1">
              24시간 에러율이 이 값을 초과하면 경고를 표시합니다
            </p>
          </div>

          {/* 미실행 경고 일수 */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">
              미실행 경고 일수
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="14"
                value={localSettings.inactiveDaysThreshold}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, inactiveDaysThreshold: Number(e.target.value) })
                }
                className="flex-1 h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-sm font-medium text-stone-800 w-12 text-right">
                {localSettings.inactiveDaysThreshold}일
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-1">
              이 기간 동안 실행되지 않은 보드에 대해 경고를 표시합니다
            </p>
          </div>

          {/* 알림음 */}
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">알림음</span>
            <button
              onClick={() => setLocalSettings({ ...localSettings, soundEnabled: !localSettings.soundEnabled })}
              className={`w-11 h-6 rounded-full transition-colors ${
                localSettings.soundEnabled ? "bg-emerald-500" : "bg-stone-300"
              }`}
            >
              <span
                className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  localSettings.soundEnabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 컴포넌트: 대시보드 설정 모달
// ============================================================

function DashboardSettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: DashboardSettings;
  onSave: (settings: DashboardSettings) => void;
  onClose: () => void;
}) {
  const [localSettings, setLocalSettings] = useState(settings);

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const toggleWidget = (key: keyof DashboardSettings) => {
    setLocalSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const widgets = [
    { key: "showSummaryCards" as const, label: "요약 통계 카드", icon: BarChart3 },
    { key: "showRunningJobs" as const, label: "실행 중 작업", icon: Activity },
    { key: "showTimelineChart" as const, label: "수집 추이 차트", icon: TrendingUp },
    { key: "showFileTypeChart" as const, label: "파일 유형 차트", icon: PieChart },
    { key: "showBoardsTable" as const, label: "보드별 현황", icon: Table },
    { key: "showErrorLogs" as const, label: "에러 로그", icon: FileWarning },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-stone-800">대시보드 설정</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-stone-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-6">
          {/* 위젯 표시 설정 */}
          <div>
            <h4 className="text-sm font-bold text-stone-800 mb-3">위젯 표시</h4>
            <div className="grid grid-cols-2 gap-2">
              {widgets.map((widget) => {
                const isVisible = localSettings[widget.key];
                const Icon = widget.icon;
                
                return (
                  <button
                    key={widget.key}
                    onClick={() => toggleWidget(widget.key)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                      isVisible
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-stone-200 bg-stone-50 text-stone-500"
                    }`}
                  >
                    {isVisible ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{widget.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 기본 설정 */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-stone-800">기본 설정</h4>

            {/* 기본 기간 */}
            <div>
              <label className="block text-sm text-stone-600 mb-1.5">기본 조회 기간</label>
              <div className="flex gap-1">
                {([
                  { value: "7d" as const, label: "7일" },
                  { value: "30d" as const, label: "30일" },
                  { value: "90d" as const, label: "90일" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setLocalSettings({ ...localSettings, defaultPeriod: opt.value })}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                      localSettings.defaultPeriod === opt.value
                        ? "bg-emerald-500 text-white"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 기본 뷰 모드 */}
            <div>
              <label className="block text-sm text-stone-600 mb-1.5">기본 뷰 모드</label>
              <div className="flex gap-1">
                {([
                  { value: "table" as const, label: "테이블", icon: Table },
                  { value: "group" as const, label: "기관별", icon: Building2 },
                ]).map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setLocalSettings({ ...localSettings, defaultViewMode: opt.value })}
                      className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                        localSettings.defaultViewMode === opt.value
                          ? "bg-emerald-500 text-white"
                          : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 자동 새로고침 */}
            <div>
              <label className="block text-sm text-stone-600 mb-1.5">
                자동 새로고침 간격
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="5"
                  value={localSettings.autoRefreshInterval}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, autoRefreshInterval: Number(e.target.value) })
                  }
                  className="flex-1 h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <span className="text-sm font-medium text-stone-800 w-16 text-right">
                  {localSettings.autoRefreshInterval === 0
                    ? "비활성"
                    : `${localSettings.autoRefreshInterval}초`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-stone-100 flex justify-between">
          <button
            onClick={() => setLocalSettings(DEFAULT_DASHBOARD_SETTINGS)}
            className="px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-xl transition-colors"
          >
            기본값 복원
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 메인 컴포넌트
// ============================================================

export default function ScraperStatusPage() {
  // 상태
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineData[]>([]);
  const [fileTypeData, setFileTypeData] = useState<FileTypeData[]>([]);
  const [boardsData, setBoardsData] = useState<BoardStatusItem[]>([]);
  const [runningJobs, setRunningJobs] = useState<RunningJob[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  
  const [period, setPeriod] = useState<PeriodType>("30d");
  const [boardFilter, setBoardFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "group">("table");
  
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [loadingFileTypes, setLoadingFileTypes] = useState(true);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [loadingRunning, setLoadingRunning] = useState(true);
  const [loadingErrors, setLoadingErrors] = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  
  // 스케줄 데이터
  const [schedulesData, setSchedulesData] = useState<ScheduleData[]>([]);
  
  // 모달 상태
  const [selectedBoard, setSelectedBoard] = useState<BoardStatusItem | null>(null);
  const [showGanttModal, setShowGanttModal] = useState(false);
  
  // 알림 및 설정 상태
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("scraper-alert-settings");
      return saved ? JSON.parse(saved) : DEFAULT_ALERT_SETTINGS;
    }
    return DEFAULT_ALERT_SETTINGS;
  });
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("scraper-dashboard-settings");
      return saved ? JSON.parse(saved) : DEFAULT_DASHBOARD_SETTINGS;
    }
    return DEFAULT_DASHBOARD_SETTINGS;
  });
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [showDashboardSettings, setShowDashboardSettings] = useState(false);

  // 데이터 로드 함수
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/status/summary");
      const json = await res.json();
      if (json.success) {
        setSummaryData(json.data);
      }
    } catch (error) {
      console.error("Summary fetch error:", error);
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const fetchTimeline = useCallback(async () => {
    setLoadingTimeline(true);
    try {
      const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      
      const res = await fetch(
        `/api/scraper/status/chart/timeline?start=${startDate}&end=${endDate}&group=day`
      );
      const json = await res.json();
      if (json.success) {
        setTimelineData(json.data);
      }
    } catch (error) {
      console.error("Timeline fetch error:", error);
    } finally {
      setLoadingTimeline(false);
    }
  }, [period]);

  const fetchFileTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/status/chart/file-types");
      const json = await res.json();
      if (json.success) {
        setFileTypeData(json.data);
      }
    } catch (error) {
      console.error("File types fetch error:", error);
    } finally {
      setLoadingFileTypes(false);
    }
  }, []);

  const fetchBoards = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/status/boards");
      const json = await res.json();
      if (json.success) {
        setBoardsData(json.boards);
      }
    } catch (error) {
      console.error("Boards fetch error:", error);
    } finally {
      setLoadingBoards(false);
    }
  }, []);

  const fetchRunningJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/status/running");
      const json = await res.json();
      if (json.success) {
        setRunningJobs(json.jobs);
      }
    } catch (error) {
      console.error("Running jobs fetch error:", error);
    } finally {
      setLoadingRunning(false);
    }
  }, []);

  const fetchErrorLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/status/errors?days=7&limit=100");
      const json = await res.json();
      if (json.success) {
        setErrorLogs(json.logs);
      }
    } catch (error) {
      console.error("Error logs fetch error:", error);
    } finally {
      setLoadingErrors(false);
    }
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/scraper/status/schedules");
      const json = await res.json();
      if (json.success) {
        setSchedulesData(json.schedules);
      }
    } catch (error) {
      console.error("Schedules fetch error:", error);
    } finally {
      setLoadingSchedules(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    fetchSummary();
    fetchFileTypes();
    fetchBoards();
    fetchRunningJobs();
    fetchErrorLogs();
    fetchSchedules();
  }, [fetchSummary, fetchFileTypes, fetchBoards, fetchErrorLogs, fetchSchedules]);

  // 기간 변경 시 타임라인 갱신
  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  // 새로고침 핸들러
  const handleRefresh = () => {
    setLoadingSummary(true);
    setLoadingTimeline(true);
    setLoadingFileTypes(true);
    setLoadingBoards(true);
    setLoadingRunning(true);
    setLoadingErrors(true);
    
    fetchSummary();
    fetchTimeline();
    fetchFileTypes();
    fetchBoards();
    fetchRunningJobs();
    fetchErrorLogs();
  };

  // Running Jobs만 새로고침
  const handleRefreshRunning = () => {
    setLoadingRunning(true);
    fetchRunningJobs();
  };

  // Error Logs만 새로고침
  const handleRefreshErrors = () => {
    setLoadingErrors(true);
    fetchErrorLogs();
  };

  // Gantt 모달용 그룹화된 스케줄 데이터
  const groupedSchedulesForModal = useMemo(() => {
    const enabledSchedules = schedulesData.filter((s) => s.enabled);
    const groups = new Map<string, OrgScheduleGroup>();
    
    enabledSchedules.forEach((schedule) => {
      const target = schedule.targets[0];
      if (!target) return;
      
      const orgId = target.org_id || "unknown";
      
      if (!groups.has(orgId)) {
        groups.set(orgId, {
          org_id: orgId,
          org_name: target.org_name || "알 수 없음",
          org_logo: target.org_logo,
          schedules: [],
        });
      }
      groups.get(orgId)!.schedules.push(schedule);
    });
    
    return Array.from(groups.values());
  }, [schedulesData]);

  // 알림 생성 로직
  useEffect(() => {
    if (!alertSettings.enabled) return;
    
    const newAlerts: AlertItem[] = [];
    
    // 에러율 경고
    if (summaryData && summaryData.error_rate_24h > alertSettings.errorRateThreshold) {
      newAlerts.push({
        id: `error-rate-${Date.now()}`,
        type: "error",
        title: "높은 에러율 감지",
        message: `24시간 에러율이 ${summaryData.error_rate_24h}%입니다. (임계치: ${alertSettings.errorRateThreshold}%)`,
        timestamp: new Date().toISOString(),
        dismissed: false,
      });
    }
    
    // 장기 미실행 보드 경고
    const inactiveThreshold = alertSettings.inactiveDaysThreshold * 24 * 60 * 60 * 1000;
    boardsData.forEach((board) => {
      if (board.enabled && board.last_run_at) {
        const lastRun = new Date(board.last_run_at).getTime();
        const now = Date.now();
        if (now - lastRun > inactiveThreshold) {
          const daysInactive = Math.floor((now - lastRun) / (24 * 60 * 60 * 1000));
          newAlerts.push({
            id: `inactive-${board.board_id}`,
            type: "warning",
            title: "장기 미실행 보드",
            message: `${daysInactive}일 동안 실행되지 않았습니다.`,
            timestamp: new Date().toISOString(),
            boardId: board.board_id,
            boardName: board.board_name,
            orgName: board.org_name,
            dismissed: false,
          });
        }
      }
    });
    
    // 에러 상태 보드 경고
    boardsData.forEach((board) => {
      if (board.status === "error" && board.last_error) {
        newAlerts.push({
          id: `board-error-${board.board_id}`,
          type: "error",
          title: "보드 에러",
          message: board.last_error.substring(0, 100),
          timestamp: new Date().toISOString(),
          boardId: board.board_id,
          boardName: board.board_name,
          orgName: board.org_name,
          dismissed: false,
        });
      }
    });
    
    // 기존 dismissed 상태 유지하면서 알림 업데이트
    setAlerts((prev) => {
      const dismissedIds = new Set(prev.filter((a) => a.dismissed).map((a) => a.id));
      return newAlerts.map((alert) => ({
        ...alert,
        dismissed: dismissedIds.has(alert.id),
      }));
    });
  }, [summaryData, boardsData, alertSettings]);

  // 알림 dismiss
  const handleDismissAlert = (id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, dismissed: true } : a))
    );
  };

  const handleDismissAllAlerts = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, dismissed: true })));
  };

  // 설정 저장
  const handleSaveAlertSettings = (settings: AlertSettings) => {
    setAlertSettings(settings);
    if (typeof window !== "undefined") {
      localStorage.setItem("scraper-alert-settings", JSON.stringify(settings));
    }
  };

  const handleSaveDashboardSettings = (settings: DashboardSettings) => {
    setDashboardSettings(settings);
    setPeriod(settings.defaultPeriod);
    setViewMode(settings.defaultViewMode);
    if (typeof window !== "undefined") {
      localStorage.setItem("scraper-dashboard-settings", JSON.stringify(settings));
    }
  };

  // 자동 새로고침 간격 적용
  useEffect(() => {
    if (dashboardSettings.autoRefreshInterval === 0) return;
    
    const interval = setInterval(() => {
      fetchSummary();
      fetchRunningJobs();
    }, dashboardSettings.autoRefreshInterval * 1000);
    
    return () => clearInterval(interval);
  }, [dashboardSettings.autoRefreshInterval, fetchSummary, fetchRunningJobs]);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-stone-800">수집 현황</h1>
            <p className="text-sm text-stone-500">스크래핑 작업 모니터링 및 통계</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 알림 패널 */}
          <AlertsPanel
            alerts={alerts}
            settings={alertSettings}
            onDismiss={handleDismissAlert}
            onDismissAll={handleDismissAllAlerts}
            onSettingsClick={() => setShowAlertSettings(true)}
          />
          
          {/* 대시보드 설정 버튼 */}
          <button
            onClick={() => setShowDashboardSettings(true)}
            className="p-2 hover:bg-white/50 rounded-xl transition-colors"
            title="대시보드 설정"
          >
            <Settings className="w-5 h-5 text-stone-500" />
          </button>
          
          <ExportButton boards={boardsData} summary={summaryData} />
          <button
            onClick={handleRefresh}
            className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-stone-600 hover:text-stone-800"
          >
            <RefreshCw className="w-4 h-4" />
            새로고침
          </button>
        </div>
      </div>

      {/* 요약 통계 카드 */}
      {dashboardSettings.showSummaryCards && (
        <SummaryCards data={summaryData} loading={loadingSummary} />
      )}

      {/* 실시간 실행 모니터링 (실행 중인 작업이 있을 때만 표시) */}
      {dashboardSettings.showRunningJobs && (
        <RunningJobsMonitor
          jobs={runningJobs}
          loading={loadingRunning}
          onRefresh={handleRefreshRunning}
        />
      )}

      {/* 차트 영역 */}
      {(dashboardSettings.showTimelineChart || dashboardSettings.showFileTypeChart) && (
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        {/* 수집 스케쥴 및 기간별 추이 (10칸 중 8칸) */}
        <div className="lg:col-span-8 glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-stone-800">수집 스케쥴 및 기간별 추이</h3>
            </div>
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
          
          {/* 양분 레이아웃: Gantt 차트 (55%) | 타임라인 차트 (45%) */}
          <div className="grid grid-cols-1 lg:grid-cols-11 gap-4">
            {/* 왼쪽: 스케줄 Gantt 차트 (55% = 6/11) */}
            <div className="lg:col-span-6 border-r border-stone-100 pr-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-stone-500" />
                <span className="text-xs font-medium text-stone-600">보드별 스케줄</span>
              </div>
              <div className="h-[280px]">
                <ScheduleGanttChart
                  schedules={schedulesData}
                  loading={loadingSchedules}
                  period={period}
                  onOpenFullView={() => setShowGanttModal(true)}
                />
              </div>
            </div>
            
            {/* 오른쪽: 기간별 수집 추이 (45% = 5/11) */}
            <div className="lg:col-span-5 pl-2">
              <div className="flex items-center gap-4 mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-stone-500" />
                  <span className="text-xs font-medium text-stone-600">수집 추이</span>
                </div>
                <div className="flex items-center gap-3 ml-auto">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[10px] text-stone-500">문서</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-sky-500" />
                    <span className="text-[10px] text-stone-500">첨부</span>
                  </div>
                </div>
              </div>
              <TimelineChart data={timelineData} loading={loadingTimeline} period={period} />
            </div>
          </div>
        </div>

        {/* 파일 형식 파이 차트 (10칸 중 2칸) */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-base font-bold text-stone-800">파일 형식 분포</h3>
          </div>
          <FileTypePieChart data={fileTypeData} loading={loadingFileTypes} />
          {/* 총 용량 표시 */}
          {fileTypeData.length > 0 && (
            <div className="mt-2 text-center">
              <div className="flex items-center justify-center gap-1.5 text-stone-500">
                <HardDrive className="w-4 h-4" />
                <span className="text-sm">
                  총 {formatBytes(fileTypeData.reduce((sum, f) => sum + f.size_bytes, 0))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* 보드별 현황 섹션 */}
      {dashboardSettings.showBoardsTable && (
      <div className="space-y-4">
        {/* 뷰 모드 토글 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 p-1 bg-white/50 rounded-lg">
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === "table"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              <Table className="w-4 h-4" />
              테이블
            </button>
            <button
              onClick={() => setViewMode("group")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === "group"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              <Building2 className="w-4 h-4" />
              기관별
            </button>
          </div>
        </div>

        {/* 테이블 뷰 또는 기관별 그룹 뷰 */}
        {viewMode === "table" ? (
          <BoardStatusTable
            boards={boardsData}
            loading={loadingBoards}
            filter={boardFilter}
            onFilterChange={setBoardFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onBoardClick={setSelectedBoard}
          />
        ) : (
          <OrgGroupView
            boards={boardsData}
            loading={loadingBoards}
            onBoardClick={setSelectedBoard}
          />
        )}
      </div>
      )}

      {/* 에러 로그 패널 */}
      {dashboardSettings.showErrorLogs && (
        <ErrorLogsPanel
          logs={errorLogs}
          loading={loadingErrors}
          onRefresh={handleRefreshErrors}
        />
      )}

      {/* 보드 상세 모달 */}
      {selectedBoard && (
        <BoardDetailModal
          board={selectedBoard}
          onClose={() => setSelectedBoard(null)}
        />
      )}

      {/* Gantt 차트 전체 보기 모달 */}
      <GanttChartModal
        isOpen={showGanttModal}
        onClose={() => setShowGanttModal(false)}
        groupedSchedules={groupedSchedulesForModal}
        period={period}
      />

      {/* 알림 설정 모달 */}
      {showAlertSettings && (
        <AlertSettingsModal
          settings={alertSettings}
          onSave={handleSaveAlertSettings}
          onClose={() => setShowAlertSettings(false)}
        />
      )}

      {/* 대시보드 설정 모달 */}
      {showDashboardSettings && (
        <DashboardSettingsModal
          settings={dashboardSettings}
          onSave={handleSaveDashboardSettings}
          onClose={() => setShowDashboardSettings(false)}
        />
      )}
    </div>
  );
}
