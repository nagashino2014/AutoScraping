"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Clock,
  FileText,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Trash2,
  X,
  Download,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";

type ScheduleBackoff = "exponential" | "fixed";
type ScheduleRetryPolicy = { max: number; backoff: ScheduleBackoff; base_sec: number };
type ScheduleConcurrency = { global: number; per_org: number };
type ScheduleRateLimit = { rps: number; burst: number };

type OrganizationType = "국가기관" | "유관기관" | "협회 및 학회";

type ScraperSchedule = {
  schedule_id: string;
  name: string;
  org_ids: string[];
  targets: string[];
  cron: string;
  timezone: string;
  max_runtime_sec: number;
  concurrency: ScheduleConcurrency;
  retry_policy: ScheduleRetryPolicy;
  rate_limit: ScheduleRateLimit;
  enabled: boolean;
};

type ScraperRunStatus = "success" | "failed" | "running";
type ScraperRun = {
  run_id: string;
  schedule_id: string;
  triggered_by: "manual" | "cron";
  started_at: string;
  finished_at?: string;
  status: ScraperRunStatus;
  summary?: string;
  metrics?: {
    new_records?: number;
    skipped_duplicates?: number;
    failed_records?: number;
    duration_ms?: number;
  };
};

type Organization = {
  org_id: string;
  org_name: string;
  status: "active" | "inactive";
  org_type?: OrganizationType;
  logo_path?: string;
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

type BoardMode = "web_scraping" | "api" | "hybrid";
type BoardAccessMode = "api" | "static_html" | "dynamic_js" | "login_required";

type Board = {
  board_id: string;
  org_id: string;
  board_name: string;
  enabled: boolean;
  schedule_cron?: string;
  schedule_timezone?: string;
  schedule_config?: ScheduleConfig;
  board_mode?: BoardMode;
  access_mode?: BoardAccessMode;
};

// 시간대 옵션
const TIMEZONE_OPTIONS = [
  { value: "Asia/Seoul", label: "KST (한국 표준시)" },
  { value: "Asia/Tokyo", label: "JST (일본 표준시)" },
  { value: "UTC", label: "UTC (협정 세계시)" },
  { value: "America/New_York", label: "EST (미국 동부)" },
  { value: "America/Los_Angeles", label: "PST (미국 서부)" },
  { value: "Europe/London", label: "GMT (영국)" },
  { value: "Europe/Paris", label: "CET (중앙유럽)" },
];

async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(text ? "non_json_response" : "invalid_response");
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = data?.error ? String(data.error) : "request_failed";
    throw new Error(msg);
  }
  return data as T;
}

function HelpTip({
  tipKey,
  openKey,
  setOpenKey,
  title,
  body,
}: {
  tipKey: string;
  openKey: string | null;
  setOpenKey: (v: string | null) => void;
  title: string;
  body: string;
}) {
  const open = openKey === tipKey;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpenKey(open ? null : tipKey)}
        className={cn(
          "w-6 h-6 rounded-full border flex items-center justify-center transition-all",
          "bg-white/50 border-white/70 text-stone-700 hover:bg-white/80",
          open && "ring-2 ring-primary/15 border-primary/40"
        )}
        aria-label={`${title} 도움말`}
      >
        <span className="text-xs font-extrabold">?</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[320px] z-50 p-4 rounded-2xl glass-panel border border-white/70 shadow-2xl shadow-stone-900/10">
          <div className="text-sm font-extrabold text-stone-800">{title}</div>
          <div className="mt-2 text-xs text-stone-600 leading-relaxed whitespace-pre-line">{body}</div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setOpenKey(null)}
              className="glass-button px-3 py-2 rounded-xl text-xs font-extrabold text-stone-700"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDt(iso?: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { hour12: false });
}

function parseCron5(cron: string) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  return { min, hour, dom, mon, dow };
}

// schedule_config와 cron을 기반으로 다음 실행 시간 계산
function nextRunTimeFromSchedule(
  cron: string,
  config?: ScheduleConfig,
  now = new Date()
): { date: Date | null; message?: string } {
  const c = parseCron5(cron);
  if (!c) return { date: null, message: "알 수 없는 cron 형식" };

  // 시간/분 파싱
  if (!/^\d{1,2}$/.test(c.min) || !/^\d{1,2}$/.test(c.hour)) {
    return { date: null, message: "알 수 없는 시간 형식" };
  }
  const m = Number(c.min);
  const h = Number(c.hour);
  if (m < 0 || m > 59 || h < 0 || h > 23) {
    return { date: null, message: "유효하지 않은 시간" };
  }

  const todayStr = now.toISOString().split("T")[0];

  // 기간 설정 확인
  if (config?.scheduleMode === "period") {
    const startDate = config.startDate;
    const endDate = config.endDate;

    // 종료일이 지났으면 실행 기간 종료
    if (endDate && todayStr > endDate) {
      return { date: null, message: "실행 기간 종료" };
    }

    // 시작일 이전이면 시작일의 해당 시각을 반환
    if (startDate && todayStr < startDate) {
      const startDateTime = new Date(startDate);
      startDateTime.setHours(h, m, 0, 0);
      return { date: startDateTime };
    }
  }

  // 주기 설정 확인 (매월 특정일, 매주 특정 요일, N일마다)
  if (config?.scheduleMode === "cycle" && config.cycleType) {
    // 매월 특정일
    if (config.cycleType === "monthly" && c.dom !== "*") {
      const dayOfMonth = Number(c.dom);
      if (!isNaN(dayOfMonth)) {
        const candidate = new Date(now);
        candidate.setDate(dayOfMonth);
        candidate.setHours(h, m, 0, 0);
        
        // 이번 달의 해당 일이 지났으면 다음 달로
        if (candidate.getTime() <= now.getTime()) {
          candidate.setMonth(candidate.getMonth() + 1);
          candidate.setDate(dayOfMonth);
        }
        return { date: candidate };
      }
    }

    // 매주 특정 요일
    if (config.cycleType === "weekly" && c.dow !== "*") {
      const targetDow = Number(c.dow); // 0=일, 1=월, ...
      if (!isNaN(targetDow) && targetDow >= 0 && targetDow <= 6) {
        const candidate = new Date(now);
        candidate.setHours(h, m, 0, 0);
        
        const currentDow = candidate.getDay();
        let daysUntil = targetDow - currentDow;
        
        // 같은 요일인 경우 시간 확인
        if (daysUntil === 0 && candidate.getTime() <= now.getTime()) {
          daysUntil = 7;
        } else if (daysUntil < 0) {
          daysUntil += 7;
        }
        
        candidate.setDate(candidate.getDate() + daysUntil);
        return { date: candidate };
      }
    }

    // N일마다 (*/N 형식)
    if (config.cycleType === "interval" && c.dom.startsWith("*/")) {
      const intervalDays = Number(c.dom.substring(2));
      if (!isNaN(intervalDays) && intervalDays > 0) {
        const candidate = new Date(now);
        candidate.setHours(h, m, 0, 0);
        
        // 오늘 해당 시각이 지났으면 interval 만큼 추가
        if (candidate.getTime() <= now.getTime()) {
          candidate.setDate(candidate.getDate() + intervalDays);
        }
        return { date: candidate };
      }
    }
  }

  // 기본: 매일 실행 (m h * * *)
  if (c.dom === "*" && c.mon === "*" && c.dow === "*") {
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(h, m, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    
    // 기간 설정이 있으면 종료일 확인
    if (config?.scheduleMode === "period" && config.endDate) {
      const candidateStr = candidate.toISOString().split("T")[0];
      if (candidateStr > config.endDate) {
        return { date: null, message: "실행 기간 종료" };
      }
    }
    
    return { date: candidate };
  }

  // cron 패턴은 있지만 schedule_config가 없는 경우의 fallback 처리
  // 매월 특정일 (schedule_config 없이 cron만 있는 경우)
  if (c.dom !== "*" && c.dow === "*" && !c.dom.startsWith("*/")) {
    const dayOfMonth = Number(c.dom);
    if (!isNaN(dayOfMonth)) {
      const candidate = new Date(now);
      candidate.setDate(dayOfMonth);
      candidate.setHours(h, m, 0, 0);
      
      if (candidate.getTime() <= now.getTime()) {
        candidate.setMonth(candidate.getMonth() + 1);
        candidate.setDate(dayOfMonth);
      }
      return { date: candidate };
    }
  }

  // 매주 특정 요일 (schedule_config 없이 cron만 있는 경우)
  if (c.dom === "*" && c.dow !== "*") {
    const targetDow = Number(c.dow);
    if (!isNaN(targetDow) && targetDow >= 0 && targetDow <= 6) {
      const candidate = new Date(now);
      candidate.setHours(h, m, 0, 0);
      
      const currentDow = candidate.getDay();
      let daysUntil = targetDow - currentDow;
      
      if (daysUntil === 0 && candidate.getTime() <= now.getTime()) {
        daysUntil = 7;
      } else if (daysUntil < 0) {
        daysUntil += 7;
      }
      
      candidate.setDate(candidate.getDate() + daysUntil);
      return { date: candidate };
    }
  }

  // N일마다 (schedule_config 없이 cron만 있는 경우)
  if (c.dom.startsWith("*/") && c.dow === "*") {
    const intervalDays = Number(c.dom.substring(2));
    if (!isNaN(intervalDays) && intervalDays > 0) {
      const candidate = new Date(now);
      candidate.setHours(h, m, 0, 0);
      
      if (candidate.getTime() <= now.getTime()) {
        candidate.setDate(candidate.getDate() + intervalDays);
      }
      return { date: candidate };
    }
  }

  return { date: null, message: "미계산" };
}

// cron 표현식을 실행 주기 텍스트로 변환
function cronToSummary(cron: string, timezone: string): string {
  const c = parseCron5(cron);
  if (!c) return "알 수 없는 형식";
  
  const tzMap: Record<string, string> = {
    "Asia/Seoul": "KST",
    "Asia/Tokyo": "JST",
    "UTC": "UTC",
    "America/New_York": "EST",
    "America/Los_Angeles": "PST",
    "Europe/London": "GMT",
    "Europe/Paris": "CET",
  };
  const tzStr = tzMap[timezone] || timezone;
  
  const h = c.hour.padStart(2, "0");
  const m = c.min.padStart(2, "0");
  const timeStr = `${h}:${m}`;
  
  // 매일 실행 (m h * * *)
  if (c.dom === "*" && c.mon === "*" && c.dow === "*") {
    return `매일 ${timeStr} (${tzStr})`;
  }
  
  // 매월 특정일 (m h D * *)
  if (c.dom !== "*" && c.mon === "*" && c.dow === "*") {
    return `매월 ${c.dom}일 ${timeStr} (${tzStr})`;
  }
  
  // 매주 특정 요일 (m h * * DOW)
  if (c.dom === "*" && c.mon === "*" && c.dow !== "*") {
    const dayMap: Record<string, string> = { "0": "일", "1": "월", "2": "화", "3": "수", "4": "목", "5": "금", "6": "토" };
    const dayStr = dayMap[c.dow] || c.dow;
    return `매주 ${dayStr}요일 ${timeStr} (${tzStr})`;
  }
  
  // N일마다 (m h */N * *)
  if (c.dom.startsWith("*/") && c.mon === "*" && c.dow === "*") {
    const interval = c.dom.slice(2);
    return `${interval}일마다 ${timeStr} (${tzStr})`;
  }
  
  return `${cron} (${tzStr})`;
}

export default function ScraperSchedulePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [schedules, setSchedules] = useState<ScraperSchedule[]>([]);
  const [runs, setRuns] = useState<ScraperRun[]>([]);

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [helpOpenKey, setHelpOpenKey] = useState<string | null>(null);

  // 즉시 실행 관련 상태
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    success: boolean;
    boardId: string;
    boardName: string;
    articlesCount: number;
    attachmentsCount: number;
    jsonPath?: string;
    xlsxPath?: string;
    attachmentDir: string;
    downloadedFiles: string[];
    // API 모드 추가 필드
    dataCount?: number;
    saveDir?: string;
  } | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  // 진행 상황 모달 상태
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressPhase, setProgressPhase] = useState<string>("init");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressLogs, setProgressLogs] = useState<string[]>([]);

  // 선택된 보드 정보
  const selectedBoard = useMemo(
    () => boards.find((b) => b.board_id === selectedBoardId) ?? null,
    [boards, selectedBoardId]
  );

  // 선택된 보드의 스케줄 (sched_{board_id} 형태)
  const selectedSchedule = useMemo(() => {
    if (!selectedBoardId) return null;
    const scheduleId = `sched_${selectedBoardId}`;
    return schedules.find((s) => s.schedule_id === scheduleId) ?? null;
  }, [schedules, selectedBoardId]);

  // 수정용 draft
  const [draft, setDraft] = useState<ScraperSchedule | null>(null);

  // 기관별 보드 그룹
  const boardsByOrg = useMemo(() => {
    const groups = new Map<string, Board[]>();
    for (const b of boards) {
      const arr = groups.get(b.org_id) ?? [];
      arr.push(b);
      groups.set(b.org_id, arr);
    }
    for (const [k, arr] of groups) {
      arr.sort((a, b) => a.board_name.localeCompare(b.board_name, "ko"));
      groups.set(k, arr);
    }
    return groups;
  }, [boards]);

  // 선택된 기관의 보드 목록
  const boardsForSelectedOrg = useMemo(() => {
    if (!selectedOrgId) return [];
    return boardsByOrg.get(selectedOrgId) ?? [];
  }, [boardsByOrg, selectedOrgId]);

  // 실행 내역 (선택된 스케줄)
  const runsForSelected = useMemo(() => {
    if (!selectedSchedule) return [];
    return runs.filter((r) => r.schedule_id === selectedSchedule.schedule_id);
  }, [runs, selectedSchedule]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const schedRes = await jsonFetch<{ schedules: ScraperSchedule[] }>("/api/scraper/schedule", {
        method: "GET",
      });
      setSchedules(schedRes.schedules ?? []);

      const runsRes = await jsonFetch<{ runs: ScraperRun[] }>("/api/scraper/schedule/runs?limit=200", {
        method: "GET",
      });
      setRuns(runsRes.runs);

      const orgRes = await jsonFetch<{ orgs: Organization[] }>("/api/scraper/targets/orgs", {
        method: "GET",
      });
      setOrgs(orgRes.orgs);

      const boardRes = await jsonFetch<{ boards: Board[] }>("/api/scraper/targets/boards", {
        method: "GET",
      });
      setBoards(boardRes.boards);
    } catch (e: any) {
      setError(e?.message ?? "load_failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  // 선택된 보드 변경 시 draft 업데이트
  useEffect(() => {
    if (selectedSchedule) {
      setDraft({ ...selectedSchedule });
    } else if (selectedBoard) {
      // 스케줄이 없으면 기본값으로 생성
      setDraft({
        schedule_id: `sched_${selectedBoard.board_id}`,
        name: selectedBoard.board_name,
        org_ids: [selectedBoard.org_id],
        targets: [selectedBoard.board_id],
        cron: selectedBoard.schedule_cron || "0 9 * * *",
        timezone: selectedBoard.schedule_timezone || "Asia/Seoul",
        max_runtime_sec: 1800,
        concurrency: { global: 2, per_org: 1 },
        retry_policy: { max: 3, backoff: "exponential", base_sec: 30 },
        rate_limit: { rps: 0.2, burst: 1 },
        enabled: selectedBoard.enabled,
      });
    } else {
      setDraft(null);
    }
    setIsEditing(false);
    setInlineError(null);
  }, [selectedSchedule, selectedBoard]);

  const cancelEdit = () => {
    setIsEditing(false);
    if (selectedSchedule) {
      setDraft({ ...selectedSchedule });
    }
    setInlineError(null);
  };

  const save = async () => {
    if (!draft || !selectedBoard) return;

    setLoading(true);
    setError(null);
    setInlineError(null);
    try {
      if (selectedSchedule) {
        // 기존 스케줄 업데이트
        await jsonFetch<{ schedule: ScraperSchedule }>(
          `/api/scraper/schedule/${encodeURIComponent(draft.schedule_id)}`,
          { method: "PUT", body: JSON.stringify(draft) }
        );
      } else {
        // 새 스케줄 생성
        await jsonFetch<{ schedule: ScraperSchedule }>("/api/scraper/schedule", {
          method: "POST",
          body: JSON.stringify(draft),
        });
      }
      await loadAll();
      setIsEditing(false);
    } catch (e: any) {
      const m = e?.message ?? "save_failed";
      setError(m);
      setInlineError(m);
    } finally {
      setLoading(false);
    }
  };

  const del = async () => {
    if (!selectedSchedule) return;
    if (!confirm(`스케줄을 삭제할까요? 실행 내역도 함께 삭제됩니다.`)) return;
    setLoading(true);
    setError(null);
    try {
      await jsonFetch(`/api/scraper/schedule/${encodeURIComponent(selectedSchedule.schedule_id)}`, {
        method: "DELETE",
      });
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? "delete_failed");
    } finally {
      setLoading(false);
    }
  };

  const runNow = async () => {
    if (!selectedBoard) return;
    
    // 보드 모드 판별 (api, web_scraping, hybrid)
    const boardMode = selectedBoard.board_mode || (selectedBoard.access_mode === "api" ? "api" : "web_scraping");
    const isApiMode = boardMode === "api";
    
    // 진행 상황 모달 초기화 및 표시
    setIsExecuting(true);
    setError(null);
    setExecutionResult(null);
    setProgressPhase("init");
    setProgressPercent(0);
    setProgressMessage(isApiMode ? "API 스크래핑 준비 중..." : "스크래핑 준비 중...");
    setProgressLogs([]);
    setShowProgressModal(true);
    
    try {
      // 보드 모드에 따라 다른 엔드포인트 호출
      const streamUrl = isApiMode
        ? `/api/scraper/execute/instant/api/stream?board_id=${encodeURIComponent(selectedBoard.board_id)}`
        : `/api/scraper/execute/instant/stream?board_id=${encodeURIComponent(selectedBoard.board_id)}`;
      
      const eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "progress") {
            setProgressPhase(data.phase || "init");
            setProgressPercent(data.progress || 0);
            setProgressMessage(data.message || "");
          } else if (data.type === "log") {
            setProgressLogs((prev) => [...prev, data.message || ""]);
          } else if (data.type === "complete") {
            eventSource.close();
            setIsExecuting(false);
            // API 모드의 경우 결과 구조가 약간 다름
            const resultData = isApiMode ? {
              ...data.data,
              // API 모드는 attachmentDir 대신 saveDir 사용
              attachmentDir: data.data?.saveDir || "",
              articlesCount: data.data?.dataCount || 0,
              attachmentsCount: 0,
            } : data.data;
            setExecutionResult(resultData);
            
            // 잠시 후 결과 모달로 전환
            setTimeout(() => {
              setShowProgressModal(false);
              setShowResultModal(true);
            }, 1500);
          } else if (data.type === "error") {
            eventSource.close();
            setIsExecuting(false);
            setError(data.message || "실행 중 오류 발생");
            setProgressMessage(`오류: ${data.message}`);
            setProgressPhase("error");
          }
        } catch (err) {
          console.error("SSE parse error:", err);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setIsExecuting(false);
        setError("연결이 끊어졌습니다.");
        setProgressPhase("error");
        setProgressMessage("연결이 끊어졌습니다.");
      };
    } catch (e: any) {
      setIsExecuting(false);
      setError(e?.message ?? "run_failed");
      setShowProgressModal(false);
    }
  };

  // 테스트 데이터 삭제
  const cleanupTestData = async () => {
    if (!executionResult) return;
    
    // 보드 모드 판별
    const boardMode = selectedBoard?.board_mode || (selectedBoard?.access_mode === "api" ? "api" : "web_scraping");
    const isApiMode = boardMode === "api";
    
    const confirmMessage = isApiMode
      ? "API 테스트 결과 파일들을 삭제하시겠습니까?\n- XLSX 파일\n- JSON 파일"
      : "스크래핑 테스트 결과 파일들을 삭제하시겠습니까?\n- XLSX 파일\n- 다운로드된 첨부파일";
    
    if (!confirm(confirmMessage)) return;
    
    setLoading(true);
    try {
      // 보드 모드에 따라 다른 엔드포인트 호출
      const deleteUrl = isApiMode
        ? "/api/scraper/execute/instant/api"
        : "/api/scraper/execute/instant";
      
      const result = await jsonFetch<{ success: boolean; deleted: string[]; errors: string[] }>(
        deleteUrl,
        {
          method: "DELETE",
          body: JSON.stringify({
            jsonPath: executionResult.jsonPath,
            xlsxPath: executionResult.xlsxPath,
            attachmentDir: executionResult.attachmentDir || executionResult.saveDir,
          }),
        }
      );
      
      if (result.success) {
        alert(`삭제 완료: ${result.deleted.length}개 파일 삭제됨`);
        setExecutionResult(null);
        setShowResultModal(false);
      } else {
        alert(`일부 삭제 실패:\n${result.errors.join("\n")}`);
      }
    } catch (e: any) {
      setError(e?.message ?? "cleanup_failed");
    } finally {
      setLoading(false);
    }
  };

  // 기관별 스케줄 존재 여부 확인
  const getScheduleForBoard = (boardId: string) => {
    const scheduleId = `sched_${boardId}`;
    return schedules.find((s) => s.schedule_id === scheduleId);
  };

  return (
    <div className="flex flex-col gap-6 relative min-h-full pb-6">
      {/* Header */}
      <section className="glass-panel p-6 rounded-3xl relative overflow-hidden">
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-stone-800 mb-1">
              스케줄링 설정
            </h1>
            <p className="text-stone-600 text-sm">
              보드별 스케줄 설정을 확인하고 실행 정책을 관리합니다. 스케줄은 보드 설정 마법사에서 자동 생성됩니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (!confirm("테스트 폴더(Test/Attachment)의 모든 파일을 삭제하시겠습니까?")) return;
                try {
                  const res = await fetch("/api/scraper/execute/test", { method: "DELETE" });
                  const data = await res.json();
                  if (data.success) {
                    alert(`삭제 완료: ${data.deletedCount}개 파일 삭제됨`);
                  } else {
                    alert(`삭제 실패: ${data.error || "알 수 없는 오류"}`);
                  }
                } catch (err) {
                  alert("삭제 중 오류가 발생했습니다.");
                }
              }}
              className="glass-button px-4 py-2.5 rounded-xl text-sm font-semibold text-red-700 flex items-center gap-2 hover:bg-red-50"
              disabled={loading}
            >
              <Trash2 className="w-4 h-4" />
              테스트 파일 삭제
            </button>
            <button
              onClick={() => void loadAll()}
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
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[6fr_4fr] gap-6">
        {/* Left: 기관/보드별 스케줄 목록 */}
        <section className="glass-panel p-5 rounded-3xl flex flex-col gap-4 min-h-[calc(100vh-200px)]">
          <div className="text-sm font-extrabold text-stone-800">기관/보드별 스케줄 목록</div>
          
          <div className="flex flex-1 min-h-0 gap-4">
            {/* 대상 기관 */}
            <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2">
              {(() => {
                const groups: { label: OrganizationType; items: Organization[] }[] = [
                  { label: "국가기관", items: [] },
                  { label: "유관기관", items: [] },
                  { label: "협회 및 학회", items: [] },
                ];
                for (const o of orgs) {
                  const t = o.org_type ?? "유관기관";
                  const g = groups.find((x) => x.label === t) ?? groups[1];
                  g.items.push(o);
                }
                for (const g of groups) {
                  g.items.sort((a, b) => a.org_name.localeCompare(b.org_name, "ko"));
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {g.items.map((o) => {
                          const isSelected = o.org_id === selectedOrgId;
                          const orgBoards = boardsByOrg.get(o.org_id) ?? [];
                          const scheduledCount = orgBoards.filter((b) => getScheduleForBoard(b.board_id)).length;
                          return (
                            <button
                              key={o.org_id}
                              type="button"
                              onClick={() => {
                                setSelectedOrgId(o.org_id);
                                setSelectedBoardId(null);
                              }}
                              className={cn(
                                "text-left rounded-2xl border transition-all overflow-hidden",
                                "bg-white/40 border-white/60 hover:bg-white/60",
                                "shadow-sm hover:shadow-xl hover:-translate-y-0.5",
                                isSelected && "bg-white/80 border-primary/40 ring-2 ring-primary/15 shadow-lg"
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
                                    <div className="w-5 h-5 rounded-full bg-stone-200" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-extrabold text-stone-800 truncate">
                                    {o.org_name}
                                  </div>
                                  <div className="text-xs text-stone-500 mt-1 font-bold">
                                    {scheduledCount}/{orgBoards.length} 스케줄
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 세로 구분선 */}
            <div className="w-px bg-stone-200/60 shrink-0" />

            {/* 대상 보드 */}
            <div className="w-[200px] shrink-0 flex flex-col gap-3 overflow-hidden">
              <div className="text-xs font-bold text-stone-600">대상 보드</div>
              <div className="flex-1 overflow-y-auto pr-1">
                {!selectedOrgId ? (
                  <div className="p-4 rounded-xl bg-white/30 border border-white/50 text-xs text-stone-500 text-center">
                    기관을 먼저 선택하세요
                  </div>
                ) : boardsForSelectedOrg.length === 0 ? (
                  <div className="p-4 rounded-xl bg-white/30 border border-white/50 text-xs text-stone-500 text-center">
                    등록된 보드가 없습니다
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {boardsForSelectedOrg.map((b) => {
                      const isSelected = b.board_id === selectedBoardId;
                      const hasSchedule = !!getScheduleForBoard(b.board_id);
                      return (
                        <button
                          key={b.board_id}
                          type="button"
                          onClick={() => setSelectedBoardId(b.board_id)}
                          className={cn(
                            "w-full text-left p-3 rounded-xl border transition-all",
                            "bg-white/40 border-white/60 hover:bg-white/60",
                            isSelected && "bg-white/80 border-primary/40 ring-2 ring-primary/15"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-stone-800 truncate">{b.board_name}</div>
                              {b.schedule_cron && (
                                <div className="mt-1 text-[10px] font-semibold text-primary truncate">
                                  {cronToSummary(b.schedule_cron, b.schedule_timezone || "Asia/Seoul")}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {hasSchedule ? (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                  설정됨
                                </span>
                              ) : b.schedule_cron ? (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                  미적용
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">
                                  미설정
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Right: 스케줄 상세 */}
        <section className="glass-panel p-5 rounded-3xl flex flex-col gap-4 min-h-[calc(100vh-200px)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-extrabold text-stone-800">스케줄 상세</div>
              <div className="text-xs text-stone-500 mt-1">
                {selectedBoard ? selectedBoard.board_name : "보드를 선택하세요"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedSchedule && (
                <button
                  onClick={del}
                  className="glass-button px-3 py-2 rounded-xl text-xs font-semibold text-red-700 flex items-center gap-1.5"
                  disabled={loading}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  삭제
                </button>
              )}
              {selectedBoard && !isEditing ? (
                <>
                  {selectedBoard.schedule_cron && (
                    <button
                      onClick={runNow}
                      className={cn(
                        "flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white px-3 py-2 rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-95 text-xs font-semibold",
                        isExecuting && "opacity-70 cursor-wait"
                      )}
                      disabled={loading || isExecuting}
                    >
                      {isExecuting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          실행 중...
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          즉시 실행
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/20"
                    disabled={loading || isExecuting}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    수정
                  </button>
                </>
              ) : isEditing ? (
                <>
                  <button
                    onClick={cancelEdit}
                    className="glass-button px-3 py-2 rounded-xl text-xs font-semibold text-stone-700"
                    disabled={loading}
                  >
                    취소
                  </button>
                  <button
                    onClick={save}
                    className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/20"
                    disabled={loading}
                  >
                    <Save className="w-3.5 h-3.5" />
                    저장
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {inlineError && (
            <div className="text-sm text-red-700 bg-red-50/60 border border-red-200 rounded-xl px-3 py-2">
              {inlineError}
            </div>
          )}

          {!selectedBoard || !draft ? (
            <div className="flex-1 flex items-center justify-center text-stone-500 text-sm">
              왼쪽에서 보드를 선택하세요
            </div>
          ) : (
            <div className="flex flex-col gap-4 overflow-y-auto flex-1">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-stone-600">보드 ID</label>
                  <input
                    value={selectedBoard.board_id}
                    disabled
                    className="ui-field opacity-70 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-stone-600">보드명</label>
                  <input
                    value={selectedBoard.board_name}
                    disabled
                    className="ui-field opacity-70 text-sm"
                  />
                </div>
              </div>

              {/* 스케줄 정보 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-stone-600">실행 주기</label>
                  <input
                    value={selectedBoard.schedule_cron ? cronToSummary(selectedBoard.schedule_cron, selectedBoard.schedule_timezone || "Asia/Seoul") : "미설정"}
                    disabled
                    className="ui-field opacity-70 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-stone-600">스케줄 Cron</label>
                  <input
                    value={selectedBoard.schedule_cron || "미설정"}
                    disabled
                    className="ui-field opacity-70 text-sm font-mono"
                  />
                </div>
              </div>

              {/* 실행 기간 (기간 설정이 있는 경우) */}
              {selectedBoard.schedule_config?.scheduleMode === "period" && (selectedBoard.schedule_config?.startDate || selectedBoard.schedule_config?.endDate) && (
                <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200/50">
                  <div className="text-xs font-bold text-amber-800 mb-2">📅 실행 기간</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-amber-600">시작일</label>
                      <div className="text-xs font-semibold text-amber-900">
                        {selectedBoard.schedule_config?.startDate || "미설정"}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-amber-600">종료일</label>
                      <div className="text-xs font-semibold text-amber-900">
                        {selectedBoard.schedule_config?.endDate || "미설정"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 시간대 및 최대 실행 시간 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-stone-600">시간대</label>
                  <select
                    value={draft.timezone}
                    onChange={(e) => setDraft((p) => (p ? { ...p, timezone: e.target.value } : p))}
                    disabled={!isEditing}
                    className={cn("ui-field text-sm", !isEditing && "opacity-70")}
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-stone-600">최대 실행 시간(초)</label>
                  <input
                    type="number"
                    value={draft.max_runtime_sec}
                    onChange={(e) => setDraft((p) => (p ? { ...p, max_runtime_sec: Number(e.target.value) } : p))}
                    disabled={!isEditing}
                    className={cn("ui-field text-sm", !isEditing && "opacity-70")}
                  />
                </div>
              </div>

              {/* 다음 실행 시간 */}
              {selectedBoard.schedule_cron && (() => {
                const result = nextRunTimeFromSchedule(
                  selectedBoard.schedule_cron,
                  selectedBoard.schedule_config
                );
                const displayText = result.date
                  ? result.date.toLocaleString("ko-KR", { hour12: false })
                  : result.message || "미계산";
                const isEnded = result.message === "실행 기간 종료";
                
                return (
                  <div className={cn(
                    "p-3 rounded-xl border",
                    isEnded 
                      ? "bg-stone-100/50 border-stone-200/50" 
                      : "bg-primary/5 border-primary/20"
                  )}>
                    <div className={cn(
                      "flex items-center gap-2 text-xs font-semibold",
                      isEnded ? "text-stone-500" : "text-primary"
                    )}>
                      <Clock className="w-4 h-4" />
                      다음 실행: {displayText}
                    </div>
                  </div>
                );
              })()}

              {/* 실행 정책 */}
              <div className="p-3 rounded-xl bg-white/40 border border-white/60">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="text-xs font-extrabold text-stone-800">실행 정책</div>
                  <HelpTip
                    tipKey="exec_policy"
                    openKey={helpOpenKey}
                    setOpenKey={setHelpOpenKey}
                    title="실행 정책"
                    body="동시성: 동시에 처리할 작업 수\n재시도: 일시 장애 시 재시도 횟수/방식\n백오프: 재시도 사이의 대기 시간 증가 방식"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-stone-500">전체 동시성</label>
                    <input
                      type="number"
                      value={draft.concurrency.global}
                      onChange={(e) =>
                        setDraft((p) =>
                          p ? { ...p, concurrency: { ...p.concurrency, global: Number(e.target.value) } } : p
                        )
                      }
                      disabled={!isEditing}
                      className={cn("ui-field text-xs", !isEditing && "opacity-70")}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-stone-500">기관별 동시성</label>
                    <input
                      type="number"
                      value={draft.concurrency.per_org}
                      onChange={(e) =>
                        setDraft((p) =>
                          p ? { ...p, concurrency: { ...p.concurrency, per_org: Number(e.target.value) } } : p
                        )
                      }
                      disabled={!isEditing}
                      className={cn("ui-field text-xs", !isEditing && "opacity-70")}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-stone-500">재시도 횟수</label>
                    <input
                      type="number"
                      value={draft.retry_policy.max}
                      onChange={(e) =>
                        setDraft((p) =>
                          p ? { ...p, retry_policy: { ...p.retry_policy, max: Number(e.target.value) } } : p
                        )
                      }
                      disabled={!isEditing}
                      className={cn("ui-field text-xs", !isEditing && "opacity-70")}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-stone-500">백오프 방식</label>
                    <select
                      value={draft.retry_policy.backoff}
                      onChange={(e) =>
                        setDraft((p) =>
                          p ? { ...p, retry_policy: { ...p.retry_policy, backoff: e.target.value as ScheduleBackoff } } : p
                        )
                      }
                      disabled={!isEditing}
                      className={cn("ui-field text-xs", !isEditing && "opacity-70")}
                    >
                      <option value="exponential">지수형</option>
                      <option value="fixed">고정형</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 col-span-2">
                    <label className="text-[10px] font-bold text-stone-500">기본 대기(초)</label>
                    <input
                      type="number"
                      value={draft.retry_policy.base_sec}
                      onChange={(e) =>
                        setDraft((p) =>
                          p ? { ...p, retry_policy: { ...p.retry_policy, base_sec: Number(e.target.value) } } : p
                        )
                      }
                      disabled={!isEditing}
                      className={cn("ui-field text-xs", !isEditing && "opacity-70")}
                    />
                  </div>
                </div>
              </div>

              {/* 요청 제한 */}
              <div className="p-3 rounded-xl bg-white/40 border border-white/60">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="text-xs font-extrabold text-stone-800">요청 제한</div>
                  <HelpTip
                    tipKey="rate_limit"
                    openKey={helpOpenKey}
                    setOpenKey={setHelpOpenKey}
                    title="요청 제한"
                    body="RPS: 초당 요청 수 제한\nBurst: 짧은 순간 허용 최대 연속 요청"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-stone-500">초당 요청 수(RPS)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={draft.rate_limit.rps}
                      onChange={(e) =>
                        setDraft((p) =>
                          p ? { ...p, rate_limit: { ...p.rate_limit, rps: Number(e.target.value) } } : p
                        )
                      }
                      disabled={!isEditing}
                      className={cn("ui-field text-xs", !isEditing && "opacity-70")}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-stone-500">버스트</label>
                    <input
                      type="number"
                      value={draft.rate_limit.burst}
                      onChange={(e) =>
                        setDraft((p) =>
                          p ? { ...p, rate_limit: { ...p.rate_limit, burst: Number(e.target.value) } } : p
                        )
                      }
                      disabled={!isEditing}
                      className={cn("ui-field text-xs", !isEditing && "opacity-70")}
                    />
                  </div>
                </div>
              </div>

              {/* 활성 여부 */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-white/60">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                      draft.enabled ? "bg-primary border-primary text-white" : "border-stone-300"
                    )}
                  >
                    {draft.enabled && <Check className="w-3 h-3" />}
                  </div>
                  <span className="text-xs font-bold text-stone-700">스케줄 활성화</span>
                </div>
                <button
                  onClick={() => setDraft((p) => (p ? { ...p, enabled: !p.enabled } : p))}
                  disabled={!isEditing}
                  className={cn(
                    "glass-button px-3 py-1.5 rounded-lg text-xs font-semibold",
                    !isEditing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {draft.enabled ? "비활성화" : "활성화"}
                </button>
              </div>

              {/* 최근 실행 내역 */}
              <div className="border-t border-stone-200/70 pt-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="text-xs font-extrabold text-stone-800">최근 실행 내역</div>
                  <div className="text-[10px] text-stone-500 font-semibold">{runsForSelected.length}건</div>
                </div>
                {runsForSelected.length === 0 ? (
                  <div className="p-3 rounded-xl bg-white/30 border border-white/50 text-xs text-stone-500 text-center">
                    실행 내역이 없습니다
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {runsForSelected.slice(0, 5).map((r) => (
                      <div
                        key={r.run_id}
                        className="p-2.5 rounded-xl bg-white/40 border border-white/60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                                r.status === "success" && "bg-emerald-100 text-emerald-700",
                                r.status === "failed" && "bg-red-100 text-red-700",
                                r.status === "running" && "bg-amber-100 text-amber-700"
                              )}
                            >
                              {r.status}
                            </span>
                            <span className="text-[10px] text-stone-500 font-semibold">
                              {formatDt(r.started_at)}
                            </span>
                          </div>
                          <span className="text-[10px] text-stone-400 font-semibold">
                            {typeof r.metrics?.duration_ms === "number" ? `${Math.round(r.metrics.duration_ms / 1000)}s` : "-"}
                          </span>
                        </div>
                        {r.summary && (
                          <div className="mt-1 text-[10px] text-stone-500 truncate">{r.summary}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 진행 상황 모달 */}
      {showProgressModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="w-full max-w-2xl mx-4 overflow-hidden rounded-3xl shadow-2xl">
            {/* 배경 그라데이션 효과 */}
            <div className="relative">
              {/* 글래스 배경 */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/90 via-white/80 to-white/70 backdrop-blur-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5" />
              
              {/* 3D 입체 테두리 효과 */}
              <div className="absolute inset-0 rounded-3xl border border-white/60 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),inset_0_-1px_1px_rgba(0,0,0,0.05)]" />
              
              <div className="relative p-6">
                {/* 헤더 */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="relative">
                    {/* 회전하는 외곽 링 */}
                    <div className={cn(
                      "absolute -inset-1 rounded-2xl opacity-75",
                      isExecuting && progressPhase !== "error" 
                        ? "animate-spin-slow bg-gradient-to-r from-primary via-blue-500 to-emerald-500"
                        : progressPhase === "error"
                        ? "bg-red-500"
                        : "bg-emerald-500"
                    )} style={{ animationDuration: "3s" }} />
                    {/* 아이콘 배경 */}
                    <div className={cn(
                      "relative w-14 h-14 rounded-xl flex items-center justify-center shadow-lg",
                      progressPhase === "error"
                        ? "bg-gradient-to-br from-red-500 to-red-600"
                        : progressPhase === "done"
                        ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
                        : "bg-gradient-to-br from-primary to-blue-600"
                    )}>
                      {progressPhase === "error" ? (
                        <X className="w-7 h-7 text-white" />
                      ) : progressPhase === "done" ? (
                        <Check className="w-7 h-7 text-white" />
                      ) : (
                        <Loader2 className="w-7 h-7 text-white animate-spin" />
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-stone-800">
                      {progressPhase === "done" 
                        ? (selectedBoard?.board_mode === "api" ? "API 수집 완료!" : "스크래핑 완료!")
                        : progressPhase === "error" 
                        ? "오류 발생" 
                        : (selectedBoard?.board_mode === "api" ? "API 수집 진행 중" : "스크래핑 진행 중")}
                    </h3>
                    <p className="text-sm text-stone-500 font-medium">
                      {selectedBoard?.board_name || ""} {selectedBoard?.board_mode === "api" && "(API 모드)"}
                    </p>
                  </div>
                </div>

                {/* 진행률 바 컨테이너 */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-stone-600 uppercase tracking-wider">
                      {progressPhase === "init" && "준비 중"}
                      {progressPhase === "list" && "목록 수집"}
                      {progressPhase === "detail" && "게시글 처리"}
                      {progressPhase === "save" && "파일 저장"}
                      {progressPhase === "attachment" && "첨부파일 다운로드"}
                      {progressPhase === "api_collect" && "API 데이터 수집"}
                      {progressPhase === "filter" && "데이터 필터링"}
                      {progressPhase === "done" && "완료"}
                      {progressPhase === "error" && "오류"}
                    </span>
                    <span className="text-sm font-extrabold text-primary">{progressPercent}%</span>
                  </div>
                  
                  {/* 3D 진행률 바 */}
                  <div className="relative h-4 rounded-full overflow-hidden">
                    {/* 배경 */}
                    <div className="absolute inset-0 bg-stone-200/80 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]" />
                    
                    {/* 진행률 */}
                    <div 
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out",
                        progressPhase === "error" 
                          ? "bg-gradient-to-r from-red-500 to-red-400"
                          : "bg-gradient-to-r from-primary via-blue-500 to-emerald-500"
                      )}
                      style={{ width: `${progressPercent}%` }}
                    >
                      {/* 광택 효과 */}
                      <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
                      {/* 애니메이션 줄무늬 */}
                      {isExecuting && progressPhase !== "done" && progressPhase !== "error" && (
                        <div 
                          className="absolute inset-0 opacity-30"
                          style={{
                            backgroundImage: "linear-gradient(45deg, rgba(255,255,255,0.2) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.2) 75%, transparent 75%, transparent)",
                            backgroundSize: "20px 20px",
                            animation: "progress-stripes 1s linear infinite",
                          }}
                        />
                      )}
                    </div>
                    
                    {/* 상단 광택 */}
                    <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent rounded-t-full" />
                  </div>
                  
                  {/* 현재 작업 메시지 */}
                  <div className="mt-3 flex items-center gap-2">
                    {isExecuting && progressPhase !== "done" && progressPhase !== "error" && (
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    )}
                    <span className="text-sm font-semibold text-stone-600">{progressMessage}</span>
                  </div>
                </div>

                {/* 로그 디스플레이 */}
                <div className="relative rounded-2xl overflow-hidden">
                  {/* 글래스 배경 */}
                  <div className="absolute inset-0 bg-gradient-to-br from-stone-900/95 to-stone-800/95 backdrop-blur-sm" />
                  <div className="absolute inset-0 rounded-2xl border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]" />
                  
                  <div className="relative p-4 h-64 overflow-y-auto font-mono text-xs leading-relaxed custom-scrollbar">
                    {progressLogs.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-stone-500">
                        <span>로그 대기 중...</span>
                      </div>
                    ) : (
                      progressLogs.map((log, idx) => (
                        <div 
                          key={idx} 
                          className={cn(
                            "py-0.5",
                            log.includes("✅") || log.includes("✓") || log.includes("🎉") 
                              ? "text-emerald-400" 
                              : log.includes("⚠️") || log.includes("✗")
                              ? "text-amber-400"
                              : log.includes("📰") || log.includes("📎") || log.includes("💾")
                              ? "text-blue-400"
                              : log.startsWith("═")
                              ? "text-stone-500"
                              : "text-stone-300"
                          )}
                        >
                          {log || "\u00A0"}
                        </div>
                      ))
                    )}
                    {/* 스크롤 하단으로 자동 이동을 위한 앵커 */}
                    <div ref={(el) => el?.scrollIntoView({ behavior: "smooth" })} />
                  </div>
                </div>

                {/* 하단 버튼 (완료/오류 시에만 표시) */}
                {(progressPhase === "done" || progressPhase === "error") && (
                  <div className="mt-6 flex justify-end gap-3">
                    {progressPhase === "error" && (
                      <button
                        onClick={() => setShowProgressModal(false)}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-stone-700 hover:bg-stone-100 transition-colors"
                      >
                        닫기
                      </button>
                    )}
                    {progressPhase === "done" && executionResult && (
                      <button
                        onClick={() => {
                          setShowProgressModal(false);
                          setShowResultModal(true);
                        }}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary to-blue-600 text-white shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-all active:scale-95"
                      >
                        결과 확인
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 즉시 실행 결과 모달 */}
      {showResultModal && executionResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-3xl mx-4 glass-panel rounded-3xl shadow-2xl max-h-[90vh] flex flex-col">
            {/* 헤더 */}
            <div className="p-5 border-b border-stone-200/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center",
                  executionResult.success
                    ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
                    : "bg-gradient-to-br from-red-500 to-red-600"
                )}>
                  {executionResult.success ? (
                    <Check className="w-5 h-5 text-white" />
                  ) : (
                    <X className="w-5 h-5 text-white" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-stone-800">
                    {executionResult.success ? "스크래핑 완료" : "스크래핑 실패"}
                  </h3>
                  <p className="text-xs text-stone-500">{executionResult.boardName}</p>
                </div>
              </div>
              <button
                onClick={() => setShowResultModal(false)}
                className="w-8 h-8 rounded-xl hover:bg-stone-100 flex items-center justify-center"
              >
                <X className="w-4 h-4 text-stone-500" />
              </button>
            </div>

            {/* 요약 */}
            <div className="p-5 border-b border-stone-200/50">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100">
                  <div className="text-2xl font-extrabold text-blue-700">{executionResult.articlesCount ?? executionResult.dataCount ?? 0}</div>
                  <div className="text-xs font-semibold text-blue-600">수집 항목</div>
                </div>
                <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100">
                  <div className="text-2xl font-extrabold text-emerald-700">{executionResult.attachmentsCount ?? 0}</div>
                  <div className="text-xs font-semibold text-emerald-600">다운로드 첨부파일</div>
                </div>
                <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-100">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-amber-600" />
                    <div className="text-xs font-semibold text-amber-700">데이터 저장</div>
                  </div>
                  <div className="text-[10px] text-amber-600 mt-1 truncate" title={executionResult.jsonPath || executionResult.xlsxPath || ""}>
                    {(executionResult.jsonPath || executionResult.xlsxPath) ? "저장 완료" : "없음"}
                  </div>
                </div>
              </div>

              {/* 파일 경로 */}
              {(executionResult.jsonPath || executionResult.xlsxPath) && (
                <div className="mt-4 p-3 rounded-xl bg-stone-50 border border-stone-200">
                  <div className="text-xs font-bold text-stone-600 mb-2">저장 경로</div>
                  <div className="space-y-1.5">
                    {executionResult.jsonPath && (
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        <code className="text-[10px] text-stone-600 font-mono bg-white px-2 py-1 rounded flex-1 truncate">
                          {executionResult.jsonPath}
                        </code>
                      </div>
                    )}
                    {(executionResult.attachmentsCount ?? 0) > 0 && executionResult.attachmentDir && (
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-3.5 h-3.5 text-stone-400" />
                        <code className="text-[10px] text-stone-600 font-mono bg-white px-2 py-1 rounded flex-1 truncate">
                          {executionResult.attachmentDir}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 다운로드 파일 목록 (웹 스크래핑 모드에서만 표시) */}
            {executionResult.downloadedFiles && executionResult.downloadedFiles.length > 0 && (
              <div className="p-5 border-b border-stone-200/50">
                <div className="text-xs font-bold text-stone-600 mb-3">다운로드된 첨부파일</div>
                <div className="max-h-32 overflow-y-auto space-y-1.5">
                  {executionResult.downloadedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[10px]">
                      <Download className="w-3 h-3 text-emerald-500 shrink-0" />
                      <span className="text-stone-600 font-mono truncate">
                        {file.split("\\").pop() || file.split("/").pop()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 푸터 */}
            <div className="p-5 border-t border-stone-200/50 flex items-center justify-between">
              <button
                onClick={cleanupTestData}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-red-700 hover:bg-red-50 flex items-center gap-2 transition-colors"
                disabled={loading}
              >
                <Trash2 className="w-4 h-4" />
                테스트 데이터 삭제
              </button>
              <button
                onClick={() => setShowResultModal(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-stone-900 hover:bg-black text-white shadow-lg shadow-stone-900/20 transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
