"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar, Play, Filter, BarChart3, Loader2, RefreshCw,
  Building2, FolderOpen, FileText, CheckCircle2, XCircle,
  Info, ChevronDown, ChevronUp, Database,
  AlertTriangle, Lightbulb, ArrowRight, Sparkles,
  Settings2, History, Sliders, DollarSign, Clock, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// 타입 정의
// ============================================================

interface Organization {
  id: string;
  name: string;
  count: number;
}

interface Board {
  id: string;
  name: string;
  orgName: string;
  count: number;
}

interface ChunkType {
  type: string;
  count: number;
}

interface Stats {
  success: boolean;
  connected: boolean;
  totalChunks: number;
  organizations: Organization[];
  boards: Board[];
  dateRange: {
    earliest: string;
    latest: string;
  };
  chunkTypes: ChunkType[];
  error?: string;
}

interface FilterState {
  dateStart: string;
  dateEnd: string;
  selectedOrgs: string[];
  selectedBoards: string[];
  selectedChunkTypes: string[];
}

interface DiscoveryConfig {
  numClusters: number;
  minClusterSize: number;
  numIssues: number;
  scoreWeights: {
    legalMandatory: number;
    novelty: number;
    impact: number;
    international: number;
  };
}

interface DiscoveredIssue {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  score: {
    total: number;
    legalMandatory: number;
    novelty: number;
    impact: number;
    international: number;
  };
  clusterSize: number;
  sources: { orgName: string; boardName: string }[];
}

interface SessionListItem {
  id: string;
  name: string;
  status: string;
  issueCount: number;
  selectedCount: number;
  createdAt: string;
}

interface TokenUsage {
  input: number;
  output: number;
  cost: number;
}

// ============================================================
// 메인 컴포넌트
// ============================================================

export default function RAGAnalysisPage() {
  const router = useRouter();
  
  // 통계 상태
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // 필터 상태
  const [filter, setFilter] = useState<FilterState>({
    dateStart: "",
    dateEnd: "",
    selectedOrgs: [],
    selectedBoards: [],
    selectedChunkTypes: [],
  });
  
  // 필터링된 청크 수
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  
  // 발굴 설정 상태
  const [discoveryConfig, setDiscoveryConfig] = useState<DiscoveryConfig>({
    numClusters: 10,
    minClusterSize: 3,
    numIssues: 10,
    scoreWeights: {
      legalMandatory: 0.4,
      novelty: 0.25,
      impact: 0.2,
      international: 0.15,
    },
  });
  
  // UI 상태 - 모든 섹션 펼쳐진 상태로 기본 설정
  const [expandedSections, setExpandedSections] = useState({
    date: true,
    org: true,
    board: true,
    chunkType: true,
    discoveryConfig: true,
    sessions: true,
  });
  
  // 이슈 발굴 상태
  const [discovering, setDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState(0);
  const [discoveryStep, setDiscoveryStep] = useState("");
  const [discoveredIssues, setDiscoveredIssues] = useState<DiscoveredIssue[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  
  // 세션 히스토리 - 더미 데이터로 초기화 (UI 확인용)
  const [sessions, setSessions] = useState<SessionListItem[]>([
    {
      id: "demo-session-1",
      name: "2026년 1월 환경정책 이슈 발굴",
      status: "completed",
      issueCount: 8,
      selectedCount: 3,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2시간 전
    },
    {
      id: "demo-session-2",
      name: "에너지 규제 동향 분석",
      status: "completed",
      issueCount: 12,
      selectedCount: 5,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1일 전
    },
    {
      id: "demo-session-3",
      name: "탄소중립 정책 모니터링",
      status: "completed",
      issueCount: 6,
      selectedCount: 0,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3일 전
    },
  ]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  
  // 발굴된 이슈 더미 데이터 (UI 확인용)
  const dummyIssues: DiscoveredIssue[] = [
    {
      id: "demo-issue-1",
      title: "2026년 탄소배출권 거래제 개편안",
      summary: "환경부에서 발표한 탄소배출권 거래제 3기 계획에 따른 할당량 조정 및 유상할당 비율 확대 방안",
      keywords: ["탄소배출권", "배출권거래제", "유상할당", "온실가스"],
      score: { total: 0.85, legalMandatory: 0.9, novelty: 0.8, impact: 0.85, international: 0.75 },
      clusterSize: 24,
      sources: [{ orgName: "환경부", boardName: "보도자료" }],
    },
    {
      id: "demo-issue-2",
      title: "재생에너지 의무공급비율(RPS) 상향 조정",
      summary: "산업통상자원부의 2027년 RPS 의무비율 상향 및 신규 REC 가중치 적용 기준 변경 내용",
      keywords: ["RPS", "재생에너지", "REC", "신재생에너지"],
      score: { total: 0.78, legalMandatory: 0.85, novelty: 0.7, impact: 0.8, international: 0.65 },
      clusterSize: 18,
      sources: [{ orgName: "산업통상자원부", boardName: "정책공고" }],
    },
    {
      id: "demo-issue-3",
      title: "플라스틱 재활용 의무비율 강화",
      summary: "자원순환기본법 개정에 따른 플라스틱 재활용 의무비율 단계적 상향 계획 및 EPR 제도 개선",
      keywords: ["플라스틱", "재활용", "EPR", "자원순환"],
      score: { total: 0.72, legalMandatory: 0.75, novelty: 0.65, impact: 0.8, international: 0.6 },
      clusterSize: 15,
      sources: [{ orgName: "환경부", boardName: "정책자료" }],
    },
    {
      id: "demo-issue-4",
      title: "EU CBAM 대응 가이드라인 발표",
      summary: "산업부의 EU 탄소국경조정메커니즘(CBAM) 시행에 따른 국내 기업 대응 지원 방안",
      keywords: ["CBAM", "EU", "탄소국경조정", "수출기업"],
      score: { total: 0.68, legalMandatory: 0.6, novelty: 0.75, impact: 0.7, international: 0.9 },
      clusterSize: 12,
      sources: [{ orgName: "산업통상자원부", boardName: "보도자료" }],
    },
    {
      id: "demo-issue-5",
      title: "녹색금융 공시 의무화 로드맵",
      summary: "금융위원회의 ESG 공시 의무화 추진 계획 및 TCFD 권고안 적용 일정",
      keywords: ["ESG", "녹색금융", "TCFD", "공시의무"],
      score: { total: 0.55, legalMandatory: 0.5, novelty: 0.6, impact: 0.55, international: 0.7 },
      clusterSize: 9,
      sources: [{ orgName: "금융위원회", boardName: "정책자료" }],
    },
  ];
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // 통계 로드
  const loadStats = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    
    try {
      const res = await fetch("/api/rag/analysis/stats");
      const data = await res.json();
      setStats(data);
      
      // 날짜 범위 기본값 설정
      if (data.success && data.dateRange.earliest && !filter.dateStart) {
        setFilter((prev) => ({
          ...prev,
          dateStart: data.dateRange.earliest,
          dateEnd: data.dateRange.latest,
        }));
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
      setStats({
        success: false,
        connected: false,
        totalChunks: 0,
        organizations: [],
        boards: [],
        dateRange: { earliest: "", latest: "" },
        chunkTypes: [],
        error: "통계 로드에 실패했습니다.",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter.dateStart]);

  // 필터링된 개수 조회
  const loadFilteredCount = useCallback(async () => {
    setFilterLoading(true);
    
    try {
      const res = await fetch("/api/rag/analysis/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRange: filter.dateStart || filter.dateEnd ? {
            start: filter.dateStart,
            end: filter.dateEnd,
          } : undefined,
          orgs: filter.selectedOrgs.length > 0 ? filter.selectedOrgs : undefined,
          boards: filter.selectedBoards.length > 0 ? filter.selectedBoards : undefined,
          chunkTypes: filter.selectedChunkTypes.length > 0 ? filter.selectedChunkTypes : undefined,
        }),
      });
      
      const data = await res.json();
      setFilteredCount(data.count || 0);
    } catch (error) {
      console.error("Failed to load filtered count:", error);
    } finally {
      setFilterLoading(false);
    }
  }, [filter]);

  // 세션 목록 로드 - 실제 세션이 있으면 더미 데이터 대체
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/rag/discovery/sessions");
      const data = await res.json();
      if (data.success && data.sessions && data.sessions.length > 0) {
        // 실제 세션이 있으면 사용
        setSessions(data.sessions);
      }
      // 실제 세션이 없으면 더미 데이터 유지
    } catch (error) {
      console.error("Failed to load sessions:", error);
      // 에러 시에도 더미 데이터 유지
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadSessions();
  }, [loadStats, loadSessions]);

  // 필터 변경 시 개수 업데이트
  useEffect(() => {
    if (stats?.connected) {
      const timer = setTimeout(() => {
        loadFilteredCount();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [filter, stats?.connected, loadFilteredCount]);

  // 섹션 토글
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // 기관 선택 토글
  const toggleOrg = (orgName: string) => {
    setFilter((prev) => ({
      ...prev,
      selectedOrgs: prev.selectedOrgs.includes(orgName)
        ? prev.selectedOrgs.filter((o) => o !== orgName)
        : [...prev.selectedOrgs, orgName],
    }));
  };

  // 보드 선택 토글
  const toggleBoard = (boardName: string) => {
    setFilter((prev) => ({
      ...prev,
      selectedBoards: prev.selectedBoards.includes(boardName)
        ? prev.selectedBoards.filter((b) => b !== boardName)
        : [...prev.selectedBoards, boardName],
    }));
  };

  // 청크 유형 선택 토글
  const toggleChunkType = (type: string) => {
    setFilter((prev) => ({
      ...prev,
      selectedChunkTypes: prev.selectedChunkTypes.includes(type)
        ? prev.selectedChunkTypes.filter((t) => t !== type)
        : [...prev.selectedChunkTypes, type],
    }));
  };

  // 필터 초기화
  const resetFilter = () => {
    setFilter({
      dateStart: stats?.dateRange.earliest || "",
      dateEnd: stats?.dateRange.latest || "",
      selectedOrgs: [],
      selectedBoards: [],
      selectedChunkTypes: [],
    });
  };

  // 자동 이슈 발굴 실행
  const runDiscovery = async () => {
    if (discovering) return;
    
    setDiscovering(true);
    setDiscoveryProgress(0);
    setDiscoveryStep("초기화 중...");
    setDiscoveredIssues([]);
    setTokenUsage(null);
    
    abortControllerRef.current = new AbortController();
    
    try {
      const res = await fetch("/api/rag/discovery/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `이슈 발굴 ${new Date().toLocaleString("ko-KR")}`,
          filter: {
            dateRange: filter.dateStart || filter.dateEnd ? {
              start: filter.dateStart,
              end: filter.dateEnd,
            } : undefined,
            orgs: filter.selectedOrgs.length > 0 ? filter.selectedOrgs : undefined,
            boards: filter.selectedBoards.length > 0 ? filter.selectedBoards : undefined,
            chunkTypes: filter.selectedChunkTypes.length > 0 ? filter.selectedChunkTypes : undefined,
          },
          config: {
            numIssues: discoveryConfig.numIssues,
            numClusters: discoveryConfig.numClusters,
            minClusterSize: discoveryConfig.minClusterSize,
            scoreWeights: discoveryConfig.scoreWeights,
          },
        }),
        signal: abortControllerRef.current.signal,
      });
      
      const reader = res.body?.getReader();
      if (!reader) throw new Error("스트림을 읽을 수 없습니다.");
      
      const decoder = new TextDecoder();
      let buffer = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          
          try {
            const data = JSON.parse(line.slice(6));
            
            switch (data.type) {
              case "session_created":
                setSessionId(data.sessionId);
                break;
              case "progress":
                setDiscoveryProgress(data.progress || 0);
                setDiscoveryStep(data.step || "");
                break;
              case "complete":
                setDiscoveredIssues(data.issues || []);
                setSessionId(data.sessionId);
                setDiscoveryProgress(100);
                setDiscoveryStep("완료");
                if (data.tokenUsage) {
                  setTokenUsage(data.tokenUsage);
                }
                // 세션 목록 갱신
                loadSessions();
                break;
              case "error":
                throw new Error(data.error);
            }
          } catch (parseError) {
            console.error("Parse error:", parseError);
          }
        }
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("Discovery error:", error);
        alert(error.message || "이슈 발굴 중 오류가 발생했습니다.");
      }
    } finally {
      setDiscovering(false);
      abortControllerRef.current = null;
    }
  };

  // 발굴 취소
  const cancelDiscovery = () => {
    abortControllerRef.current?.abort();
  };

  // 사용자 인터랙션으로 이동
  const goToInteraction = () => {
    if (sessionId) {
      router.push(`/rag/interaction?session=${sessionId}`);
    }
  };

  // 필터가 적용되었는지 확인
  const hasActiveFilter = 
    filter.selectedOrgs.length > 0 ||
    filter.selectedBoards.length > 0 ||
    filter.selectedChunkTypes.length > 0;

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-3xl flex items-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>통계 로딩 중...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">RAG 분석</h1>
            <p className="text-xs text-stone-500 mt-0.5">
              분석 대상 데이터 필터링 및 자동 이슈 발굴
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 연결 상태 */}
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold",
              stats?.connected
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            )}>
              {stats?.connected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  벡터 DB 연결됨
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5" />
                  연결 안됨
                </>
              )}
            </div>
            
            {/* 새로고침 */}
            <button
              onClick={() => loadStats(true)}
              disabled={refreshing}
              className="p-2 rounded-lg hover:bg-stone-100 text-stone-500"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </button>
            
            {/* 이슈 발굴 버튼 */}
            {discovering ? (
              <button
                onClick={cancelDiscovery}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium bg-red-500 text-white hover:bg-red-600"
              >
                <XCircle className="w-4 h-4" />
                취소
              </button>
            ) : (
              <button
                onClick={runDiscovery}
                disabled={!stats?.connected || (filteredCount || 0) === 0}
                className={cn(
                  "flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium transition-all",
                  stats?.connected && (filteredCount || 0) > 0
                    ? "bg-primary text-white hover:bg-primary/90"
                    : "bg-stone-200 text-stone-400 cursor-not-allowed"
                )}
              >
                <Sparkles className="w-4 h-4" />
                자동 이슈 발굴
              </button>
            )}
          </div>
        </div>
        
        {/* 발굴 진행 상황 */}
        {discovering && (
          <div className="mt-4 p-4 rounded-xl bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-stone-700">{discoveryStep}</span>
              <span className="text-sm font-bold text-primary">{discoveryProgress}%</span>
            </div>
            <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${discoveryProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 연결 오류 알림 */}
      {!stats?.connected && (
        <div className="glass-panel p-4 rounded-2xl bg-red-50/50 border-red-200/60 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">벡터 DB 연결 실패</p>
            <p className="text-xs text-red-600 mt-0.5">
              {stats?.error || "백엔드 서버가 실행 중인지 확인하세요."}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[6fr_4fr] gap-6">
        {/* 왼쪽: 필터링 영역 + 발굴 설정 */}
        <div className="space-y-4">
          {/* 필터 요약 */}
          <div className="glass-panel p-4 rounded-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-stone-700">
                    분석 대상 청크
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xl font-bold text-primary">
                      {filterLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        (filteredCount ?? stats?.totalChunks ?? 0).toLocaleString()
                      )}
                    </span>
                    <span className="text-xs text-stone-400">
                      / {stats?.totalChunks.toLocaleString() || 0} 전체
                    </span>
                  </div>
                </div>
              </div>
              
              {hasActiveFilter && (
                <button
                  onClick={resetFilter}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-500 hover:bg-stone-100"
                >
                  필터 초기화
                </button>
              )}
            </div>
          </div>

          {/* 발굴 설정 패널 */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              onClick={() => toggleSection("discoveryConfig")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-indigo-500" />
                <span className="font-semibold text-stone-700 text-sm">발굴 설정</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                  클러스터 {discoveryConfig.numClusters}개
                </span>
              </div>
              {expandedSections.discoveryConfig ? (
                <ChevronUp className="w-4 h-4 text-stone-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-400" />
              )}
            </button>
            
            {expandedSections.discoveryConfig && (
              <div className="px-4 pb-4 border-t border-stone-100 pt-4 space-y-4">
                {/* 클러스터 설정 */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">클러스터 수</label>
                    <input
                      type="number"
                      min={3}
                      max={30}
                      value={discoveryConfig.numClusters}
                      onChange={(e) => setDiscoveryConfig((prev) => ({
                        ...prev,
                        numClusters: parseInt(e.target.value) || 10,
                      }))}
                      className="input-field text-sm"
                      disabled={discovering}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">최소 크기</label>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={discoveryConfig.minClusterSize}
                      onChange={(e) => setDiscoveryConfig((prev) => ({
                        ...prev,
                        minClusterSize: parseInt(e.target.value) || 3,
                      }))}
                      className="input-field text-sm"
                      disabled={discovering}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">최대 이슈 수</label>
                    <input
                      type="number"
                      min={3}
                      max={20}
                      value={discoveryConfig.numIssues}
                      onChange={(e) => setDiscoveryConfig((prev) => ({
                        ...prev,
                        numIssues: parseInt(e.target.value) || 10,
                      }))}
                      className="input-field text-sm"
                      disabled={discovering}
                    />
                  </div>
                </div>
                
                {/* 중요도 가중치 */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Sliders className="w-3.5 h-3.5 text-stone-400" />
                    <span className="text-xs font-semibold text-stone-600">중요도 가중치</span>
                    <span className="text-[10px] text-stone-400">
                      (합계: {Math.round((
                        discoveryConfig.scoreWeights.legalMandatory +
                        discoveryConfig.scoreWeights.novelty +
                        discoveryConfig.scoreWeights.impact +
                        discoveryConfig.scoreWeights.international
                      ) * 100)}%)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-stone-500">법적 강제성</span>
                        <span className="font-mono text-stone-700">
                          {Math.round(discoveryConfig.scoreWeights.legalMandatory * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.6}
                        step={0.05}
                        value={discoveryConfig.scoreWeights.legalMandatory}
                        onChange={(e) => setDiscoveryConfig((prev) => ({
                          ...prev,
                          scoreWeights: {
                            ...prev.scoreWeights,
                            legalMandatory: parseFloat(e.target.value),
                          },
                        }))}
                        className="w-full h-1.5"
                        disabled={discovering}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-stone-500">신규성</span>
                        <span className="font-mono text-stone-700">
                          {Math.round(discoveryConfig.scoreWeights.novelty * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.6}
                        step={0.05}
                        value={discoveryConfig.scoreWeights.novelty}
                        onChange={(e) => setDiscoveryConfig((prev) => ({
                          ...prev,
                          scoreWeights: {
                            ...prev.scoreWeights,
                            novelty: parseFloat(e.target.value),
                          },
                        }))}
                        className="w-full h-1.5"
                        disabled={discovering}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-stone-500">파급력</span>
                        <span className="font-mono text-stone-700">
                          {Math.round(discoveryConfig.scoreWeights.impact * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.6}
                        step={0.05}
                        value={discoveryConfig.scoreWeights.impact}
                        onChange={(e) => setDiscoveryConfig((prev) => ({
                          ...prev,
                          scoreWeights: {
                            ...prev.scoreWeights,
                            impact: parseFloat(e.target.value),
                          },
                        }))}
                        className="w-full h-1.5"
                        disabled={discovering}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-stone-500">국제 동향</span>
                        <span className="font-mono text-stone-700">
                          {Math.round(discoveryConfig.scoreWeights.international * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.6}
                        step={0.05}
                        value={discoveryConfig.scoreWeights.international}
                        onChange={(e) => setDiscoveryConfig((prev) => ({
                          ...prev,
                          scoreWeights: {
                            ...prev.scoreWeights,
                            international: parseFloat(e.target.value),
                          },
                        }))}
                        className="w-full h-1.5"
                        disabled={discovering}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 날짜 필터 */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              onClick={() => toggleSection("date")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                <span className="font-semibold text-stone-700 text-sm">분석 기간</span>
                {(filter.dateStart || filter.dateEnd) && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                    {filter.dateStart || "~"} ~ {filter.dateEnd || "~"}
                  </span>
                )}
              </div>
              {expandedSections.date ? (
                <ChevronUp className="w-4 h-4 text-stone-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-400" />
              )}
            </button>
            
            {expandedSections.date && (
              <div className="px-4 pb-4 border-t border-stone-100">
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">시작일</label>
                    <input
                      type="month"
                      value={filter.dateStart}
                      onChange={(e) => setFilter((prev) => ({ ...prev, dateStart: e.target.value }))}
                      min={stats?.dateRange.earliest}
                      max={stats?.dateRange.latest}
                      className="input-field text-sm"
                      disabled={!stats?.connected}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">종료일</label>
                    <input
                      type="month"
                      value={filter.dateEnd}
                      onChange={(e) => setFilter((prev) => ({ ...prev, dateEnd: e.target.value }))}
                      min={stats?.dateRange.earliest}
                      max={stats?.dateRange.latest}
                      className="input-field text-sm"
                      disabled={!stats?.connected}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 기관 필터 */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              onClick={() => toggleSection("org")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
            >
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-stone-700 text-sm">기관 필터</span>
                {filter.selectedOrgs.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                    {filter.selectedOrgs.length}개 선택
                  </span>
                )}
              </div>
              {expandedSections.org ? (
                <ChevronUp className="w-4 h-4 text-stone-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-400" />
              )}
            </button>
            
            {expandedSections.org && (
              <div className="px-4 pb-4 border-t border-stone-100">
                {stats?.organizations && stats.organizations.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-4">
                    {stats.organizations.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => toggleOrg(org.name)}
                        disabled={!stats.connected}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                          filter.selectedOrgs.includes(org.name)
                            ? "bg-blue-500 text-white"
                            : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                        )}
                      >
                        {org.name}
                        <span className="ml-1 opacity-70">({org.count})</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pt-4 text-xs text-stone-400 text-center">
                    등록된 기관이 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 보드 필터 */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              onClick={() => toggleSection("board")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
            >
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-purple-500" />
                <span className="font-semibold text-stone-700 text-sm">게시판 필터</span>
                {filter.selectedBoards.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">
                    {filter.selectedBoards.length}개 선택
                  </span>
                )}
              </div>
              {expandedSections.board ? (
                <ChevronUp className="w-4 h-4 text-stone-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-400" />
              )}
            </button>
            
            {expandedSections.board && (
              <div className="px-4 pb-4 border-t border-stone-100">
                {stats?.boards && stats.boards.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-4 max-h-48 overflow-y-auto">
                    {stats.boards.map((board) => (
                      <button
                        key={board.id}
                        onClick={() => toggleBoard(board.name)}
                        disabled={!stats.connected}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                          filter.selectedBoards.includes(board.name)
                            ? "bg-purple-500 text-white"
                            : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                        )}
                      >
                        {board.name}
                        <span className="ml-1 opacity-70">({board.count})</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pt-4 text-xs text-stone-400 text-center">
                    등록된 게시판이 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 청크 유형 필터 */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              onClick={() => toggleSection("chunkType")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-500" />
                <span className="font-semibold text-stone-700 text-sm">청크 유형</span>
                {filter.selectedChunkTypes.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                    {filter.selectedChunkTypes.length}개 선택
                  </span>
                )}
              </div>
              {expandedSections.chunkType ? (
                <ChevronUp className="w-4 h-4 text-stone-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-400" />
              )}
            </button>
            
            {expandedSections.chunkType && (
              <div className="px-4 pb-4 border-t border-stone-100">
                {stats?.chunkTypes && stats.chunkTypes.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-4">
                    {stats.chunkTypes.map((ct) => (
                      <button
                        key={ct.type}
                        onClick={() => toggleChunkType(ct.type)}
                        disabled={!stats.connected}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                          filter.selectedChunkTypes.includes(ct.type)
                            ? "bg-amber-500 text-white"
                            : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                        )}
                      >
                        {ct.type === "text" ? "텍스트" : ct.type === "table" ? "테이블" : ct.type}
                        <span className="ml-1 opacity-70">({ct.count})</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pt-4 text-xs text-stone-400 text-center">
                    청크 유형 정보가 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 오른쪽: 세션 히스토리 + 발굴된 이슈 */}
        <div className="space-y-4">
          {/* 세션 히스토리 */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              onClick={() => toggleSection("sessions")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
            >
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-stone-700 text-sm">발굴 히스토리</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                  {sessions.length}개
                </span>
                {sessions.some(s => s.id.startsWith("demo-")) && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600">
                    샘플
                  </span>
                )}
              </div>
              {expandedSections.sessions ? (
                <ChevronUp className="w-4 h-4 text-stone-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-400" />
              )}
            </button>
            
            {expandedSections.sessions && (
              <div className="border-t border-stone-100 max-h-[280px] overflow-y-auto">
                {sessionsLoading ? (
                  <div className="p-4 flex items-center justify-center text-stone-400">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    로딩 중...
                  </div>
                ) : sessions.length > 0 ? (
                  <div className="divide-y divide-stone-100">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => router.push(`/rag/interaction?session=${s.id}`)}
                        className={cn(
                          "w-full px-4 py-2.5 text-left hover:bg-stone-50/50 transition-all",
                          sessionId === s.id && "bg-primary/5"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-stone-700 truncate flex-1">
                            {s.name}
                          </span>
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ml-2",
                            s.status === "completed" ? "bg-green-100 text-green-700" :
                            s.status === "error" ? "bg-red-100 text-red-700" :
                            "bg-amber-100 text-amber-700"
                          )}>
                            {s.status === "completed" ? "완료" : s.status === "error" ? "오류" : "진행중"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-stone-400 flex items-center gap-1">
                            <Hash className="w-2.5 h-2.5" />
                            {s.issueCount}개 이슈
                          </span>
                          {s.selectedCount > 0 && (
                            <span className="text-[10px] text-primary">
                              ({s.selectedCount} 선택)
                            </span>
                          )}
                          <span className="text-[10px] text-stone-400 flex items-center gap-1 ml-auto">
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(s.createdAt).toLocaleDateString("ko-KR")}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-stone-400">
                    발굴 히스토리가 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 발굴된 이슈 */}
          {(() => {
            // 실제 발굴된 이슈가 있으면 사용, 없으면 더미 데이터 표시 (UI 확인용)
            const displayIssues = discoveredIssues.length > 0 ? discoveredIssues : dummyIssues;
            const isUsingDummy = discoveredIssues.length === 0;
            
            return (
          <div className="glass-panel p-4 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-primary" />
                <span className="font-semibold text-stone-700">발굴된 이슈</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-500">
                  {displayIssues.length}개
                </span>
                {isUsingDummy && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600">
                    샘플
                  </span>
                )}
              </div>
              {displayIssues.length > 0 && !isUsingDummy && (
                <button
                  onClick={goToInteraction}
                  className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                >
                  전체 보기
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
            
            {displayIssues.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {displayIssues.map((issue, idx) => (
                  <div
                    key={issue.id}
                    className="p-3 rounded-lg bg-stone-50 border border-stone-200 hover:border-primary/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-stone-400">#{idx + 1}</span>
                          <div className="text-sm font-medium text-stone-700 truncate">
                            {issue.title}
                          </div>
                        </div>
                        <div className="text-xs text-stone-500 mt-1 line-clamp-2">
                          {issue.summary}
                        </div>
                        {/* 키워드 */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {issue.keywords?.slice(0, 3).map((kw, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded text-[9px] bg-stone-100 text-stone-500"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className={cn(
                        "shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-white",
                        issue.score.total >= 0.7 ? "bg-red-500" :
                        issue.score.total >= 0.5 ? "bg-amber-500" : "bg-stone-400"
                      )}>
                        {Math.round(issue.score.total * 100)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-stone-100">
                      <span className="text-[10px] text-stone-400">
                        {issue.clusterSize}개 문서
                      </span>
                      <span className="text-[10px] text-stone-400">•</span>
                      <span className="text-[10px] text-stone-400 truncate">
                        {issue.sources?.[0]?.orgName || "출처 없음"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-stone-400">
                <Lightbulb className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm font-medium">발굴된 이슈 없음</p>
                <p className="text-xs mt-1 text-center">
                  필터를 설정하고<br />'자동 이슈 발굴'을 실행하세요
                </p>
              </div>
            )}
          </div>
            );
          })()}

          {/* 발굴 결과 통계 */}
          {(() => {
            // 실제 데이터가 있으면 실제 값, 없으면 더미 통계 표시
            const showStats = tokenUsage || discoveredIssues.length === 0;
            const statsData = tokenUsage || { input: 15200, output: 4800, cost: 0.0089 };
            const issueCount = discoveredIssues.length > 0 ? discoveredIssues.length : dummyIssues.length;
            const isUsingDummyStats = !tokenUsage && discoveredIssues.length === 0;
            
            return showStats && (
            <div className="glass-panel p-4 rounded-2xl bg-gradient-to-r from-primary/5 to-indigo-50/50">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="font-semibold text-stone-700 text-sm">발굴 결과 통계</span>
                {isUsingDummyStats && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600">
                    샘플
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg bg-white/60">
                  <div className="text-[10px] text-stone-500 mb-0.5">입력 토큰</div>
                  <div className="text-sm font-bold text-stone-700">
                    {(statsData.input / 1000).toFixed(1)}K
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/60">
                  <div className="text-[10px] text-stone-500 mb-0.5">출력 토큰</div>
                  <div className="text-sm font-bold text-stone-700">
                    {(statsData.output / 1000).toFixed(1)}K
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/60 col-span-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-stone-500 mb-0.5">예상 비용</div>
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-sm font-bold text-green-700">
                          {statsData.cost.toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-stone-500 mb-0.5">발굴된 이슈</div>
                      <div className="text-sm font-bold text-primary">
                        {issueCount}개
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
          })()}

          {/* 다음 단계 안내 */}
          {discoveredIssues.length > 0 && sessionId && (
            <button
              onClick={goToInteraction}
              className="w-full glass-panel p-4 rounded-2xl flex items-center justify-between hover:bg-stone-50/50 transition-all group"
            >
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-primary group-hover:translate-x-1 transition-transform" />
                <span className="font-semibold text-stone-700 text-sm">사용자 인터랙션으로 이동</span>
              </div>
              <span className="text-xs text-stone-400">이슈 검토 및 선택</span>
            </button>
          )}

          {/* 도움말 */}
          <div className="glass-panel p-4 rounded-2xl bg-blue-50/50 border-blue-200/60">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5" />
              <div className="text-xs text-blue-700">
                <p className="font-semibold mb-1">이슈 발굴 프로세스</p>
                <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                  <li>분석 대상 데이터 필터링</li>
                  <li>K-Means 클러스터링 수행</li>
                  <li>LLM으로 클러스터 요약</li>
                  <li>중요도 점수 산정</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
