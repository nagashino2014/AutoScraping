"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3, Loader2, RefreshCw,
  CheckCircle2, XCircle,
  Info, ChevronDown, ChevronUp, Factory,
  AlertTriangle, Lightbulb, ArrowRight, Sparkles,
  Settings2, History, Sliders, DollarSign, Clock, Hash,
  Shield, Globe, HardHat, HelpCircle,
  Zap, Thermometer, Trash, Droplet, Circle, Hammer,
  Hexagon, Fuel, FlaskConical, Beaker, Cpu, Car,
  Wine, Shirt, Package, Microchip, Building, Battery,
  MoreHorizontal, FileText, Beef,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ANALYSIS_CATEGORIES,
  countSelectedOptions,
} from "@/lib/rag/analysis-options";

// ============================================================
// 업종 아이콘 매핑 (lucide 컴포넌트)
// ============================================================
const INDUSTRY_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  power: Zap, steam: Thermometer, waste: Trash, petrochemical: Droplet,
  rubber: Circle, steel: Hammer, nonferrous: Hexagon, refinery: Fuel,
  inorganic: FlaskConical, otherchemical: Beaker, pulp: FileText,
  electronics: Cpu, meat: Beef, alcohol: Wine, textile: Shirt,
  plastic: Package, semiconductor: Microchip, autoparts: Car,
  cement: Building, battery: Battery, other: MoreHorizontal,
};

// 카테고리 아이콘 매핑
const CATEGORY_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield, Globe, HardHat,
};

// ============================================================
// 업종 상수 (site-profile.ts 기반, UI 전용)
// ============================================================
interface IndustryCategoryUI {
  id: string;
  label: string;
}

const INDUSTRY_CATEGORIES_UI: IndustryCategoryUI[] = [
  { id: "power", label: "발전업" },
  { id: "steam", label: "증기/냉온수" },
  { id: "waste", label: "폐기물" },
  { id: "petrochemical", label: "석유화학" },
  { id: "rubber", label: "고무" },
  { id: "steel", label: "철강" },
  { id: "nonferrous", label: "비철" },
  { id: "refinery", label: "석유정제/비료" },
  { id: "inorganic", label: "무기/유기화학" },
  { id: "otherchemical", label: "기타화학" },
  { id: "pulp", label: "종이/펄프" },
  { id: "electronics", label: "전자부품" },
  { id: "meat", label: "도축/육가공" },
  { id: "alcohol", label: "알콜음료" },
  { id: "textile", label: "섬유/염색" },
  { id: "plastic", label: "플라스틱" },
  { id: "semiconductor", label: "반도체" },
  { id: "autoparts", label: "자동차부품" },
  { id: "cement", label: "시멘트" },
  { id: "battery", label: "2차전지" },
  { id: "other", label: "기타" },
];

// ============================================================
// 프로파일 타입
// ============================================================
interface ProfileListItem {
  id: string;
  name: string;
  code?: string;
  logo?: string;
  industryCategory: string;
  industryLabel: string;
  scale: string;
  scaleLabel: string;
  location: string;
  emissionFacilityCount: number;
  preventionFacilityCount: number;
  permitCount: number;
  hasIntegratedPermit: boolean;
  updatedAt: string;
}

// ============================================================
// 타입 정의
// ============================================================

interface Stats {
  success: boolean;
  connected: boolean;
  totalChunks: number;
  organizations: { id: string; name: string; count: number }[];
  boards: { id: string; name: string; orgName: string; count: number }[];
  dateRange: {
    earliest: string;
    latest: string;
  };
  chunkTypes: { type: string; count: number }[];
  error?: string;
}

type PeriodMode = "monthly" | "quarterly" | "yearly" | "custom";

interface FilterState {
  dateStart: string;
  dateEnd: string;
  periodMode: PeriodMode;
  selectedYear: number;
  selectedMonths: number[];
  selectedQuarters: number[];
  selectedYears: number[];
}

interface DiscoveryConfig {
  numClusters: number;
  minClusterSize: number;
  numIssues: number;
  scoreWeights: Record<string, number>;
}

/** RAG 설정 연동 평가 기준 */
interface ScoringCriteriaItem {
  id: string;
  label: string;
  description: string;
  weight: number;
  enabled: boolean;
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
  
  // 필터 상태 (기간만)
  const [filter, setFilter] = useState<FilterState>({
    dateStart: "",
    dateEnd: "",
    periodMode: "monthly",
    selectedYear: new Date().getFullYear(),
    selectedMonths: [],
    selectedQuarters: [],
    selectedYears: [],
  });
  
  // 사업장 프로파일 목록
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  
  // 업종 태그 선택
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  // 업종별 필터링된 업체 목록
  const [industryProfiles, setIndustryProfiles] = useState<ProfileListItem[]>([]);
  // 선택된 업체
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  // 선택된 업체 상세 데이터
  const [selectedProfileDetail, setSelectedProfileDetail] = useState<any | null>(null);
  const [profileDetailLoading, setProfileDetailLoading] = useState(false);
  
  // 분석 옵션 (카테고리별 선택된 옵션 ID 배열)
  const [analysisOptions, setAnalysisOptions] = useState<Record<string, string[]>>({
    integrated_permit: [],
    climate_change: [],
    industrial_safety: [],
  });
  // 옵션 탭
  const [optionTab, setOptionTab] = useState<string>("integrated_permit");
  
  // 발굴 설정 상태
  const [discoveryConfig, setDiscoveryConfig] = useState<DiscoveryConfig>({
    numClusters: 10,
    minClusterSize: 3,
    numIssues: 10,
    scoreWeights: {},
  });
  
  // RAG 설정 연동 평가 기준
  const [scoringCriteria, setScoringCriteria] = useState<ScoringCriteriaItem[]>([]);
  
  // UI 상태
  const [expandedSections, setExpandedSections] = useState({
    date: true,
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
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    },
    {
      id: "demo-session-2",
      name: "에너지 규제 동향 분석",
      status: "completed",
      issueCount: 12,
      selectedCount: 5,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    },
    {
      id: "demo-session-3",
      name: "탄소중립 정책 모니터링",
      status: "completed",
      issueCount: 6,
      selectedCount: 0,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
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

  // ============================================================
  // 데이터 로드
  // ============================================================

  // 통계 로드
  const loadStats = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    
    try {
      const res = await fetch("/api/rag/analysis/stats");
      const data = await res.json();
      setStats(data);
      
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
  }, []);

  // 세션 목록 로드
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/rag/discovery/sessions");
      const data = await res.json();
      if (data.success && data.sessions && data.sessions.length > 0) {
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // 프로파일 목록 로드
  const loadProfiles = useCallback(async () => {
    try {
      setProfilesLoading(true);
      const res = await fetch("/api/rag/profiles");
      const data = await res.json();
      if (data.success) {
        setProfiles(data.profiles || []);
      }
    } catch (error) {
      console.error("Failed to load profiles:", error);
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadSessions();
    loadProfiles();
  }, [loadStats, loadSessions, loadProfiles]);

  // RAG 설정에서 평가 기준 로드
  useEffect(() => {
    fetch("/api/rag/settings")
      .then(res => res.json())
      .then((data) => {
        const criteria: ScoringCriteriaItem[] = data.discovery?.scoringCriteria || [];
        setScoringCriteria(criteria);
        // 활성화된 기준으로 scoreWeights 초기화
        const weights: Record<string, number> = {};
        criteria.filter(c => c.enabled).forEach(c => {
          weights[c.id] = c.weight;
        });
        setDiscoveryConfig(prev => ({ ...prev, scoreWeights: weights }));
      })
      .catch(err => console.error("Failed to load RAG settings for scoring criteria:", err));
  }, []);

  // 업종 태그 선택 시 업체 목록 필터링
  useEffect(() => {
    if (selectedIndustry) {
      const filtered = profiles.filter(p => p.industryCategory === selectedIndustry);
      setIndustryProfiles(filtered);
      setSelectedProfileId(null);
    } else {
      setIndustryProfiles(profiles);
    }
  }, [selectedIndustry, profiles]);

  // 선택된 사업장 상세 데이터 로드
  useEffect(() => {
    if (!selectedProfileId) {
      setSelectedProfileDetail(null);
      return;
    }
    setProfileDetailLoading(true);
    fetch(`/api/rag/profiles/${selectedProfileId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.profile) {
          setSelectedProfileDetail(data.profile);
        }
      })
      .catch(err => console.error("Failed to load profile detail:", err))
      .finally(() => setProfileDetailLoading(false));
  }, [selectedProfileId]);

  // 업종별 카운트
  const industryCounts = profiles.reduce((acc, p) => {
    acc[p.industryCategory] = (acc[p.industryCategory] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // ============================================================
  // 핸들러
  // ============================================================

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // 분석 옵션 토글
  const toggleAnalysisOption = (categoryId: string, optionId: string) => {
    setAnalysisOptions((prev) => ({
      ...prev,
      [categoryId]: prev[categoryId].includes(optionId)
        ? prev[categoryId].filter((o) => o !== optionId)
        : [...prev[categoryId], optionId],
    }));
  };

  // 기간 모드 변경 시 날짜 범위 계산
  const calculateDateRange = useCallback(() => {
    const year = filter.selectedYear;
    
    switch (filter.periodMode) {
      case "monthly":
        if (filter.selectedMonths.length === 0) return { start: "", end: "" };
        const sortedMonths = [...filter.selectedMonths].sort((a, b) => a - b);
        const startMonth = String(sortedMonths[0]).padStart(2, "0");
        const endMonth = String(sortedMonths[sortedMonths.length - 1]).padStart(2, "0");
        return {
          start: `${year}-${startMonth}`,
          end: `${year}-${endMonth}`,
        };
      
      case "quarterly":
        if (filter.selectedQuarters.length === 0) return { start: "", end: "" };
        const sortedQuarters = [...filter.selectedQuarters].sort((a, b) => a - b);
        const qStart = (sortedQuarters[0] - 1) * 3 + 1;
        const qEnd = sortedQuarters[sortedQuarters.length - 1] * 3;
        return {
          start: `${year}-${String(qStart).padStart(2, "0")}`,
          end: `${year}-${String(qEnd).padStart(2, "0")}`,
        };
      
      case "yearly":
        if (filter.selectedYears.length === 0) return { start: "", end: "" };
        const sortedYears = [...filter.selectedYears].sort((a, b) => a - b);
        return {
          start: `${sortedYears[0]}-01`,
          end: `${sortedYears[sortedYears.length - 1]}-12`,
        };
      
      case "custom":
      default:
        return { start: filter.dateStart, end: filter.dateEnd };
    }
  }, [filter.periodMode, filter.selectedYear, filter.selectedMonths, filter.selectedQuarters, filter.selectedYears, filter.dateStart, filter.dateEnd]);

  // 기간 선택 변경 시 dateStart/dateEnd 업데이트
  useEffect(() => {
    if (filter.periodMode !== "custom") {
      const range = calculateDateRange();
      if (range.start !== filter.dateStart || range.end !== filter.dateEnd) {
        setFilter(prev => ({ ...prev, dateStart: range.start, dateEnd: range.end }));
      }
    }
  }, [filter.periodMode, filter.selectedYear, filter.selectedMonths, filter.selectedQuarters, filter.selectedYears, calculateDateRange]);

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
      const selectedProfile = profiles.find(p => p.id === selectedProfileId);
      
      const res = await fetch("/api/rag/discovery/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedProfile 
            ? `${selectedProfile.name} - 이슈 발굴` 
            : `이슈 발굴 ${new Date().toLocaleString("ko-KR")}`,
          profileId: selectedProfileId || undefined,
          analysisOptions: analysisOptions,
          filter: {
            dateRange: filter.dateStart || filter.dateEnd ? {
              start: filter.dateStart,
              end: filter.dateEnd,
            } : undefined,
          },
          config: {
            numIssues: discoveryConfig.numIssues,
            numClusters: discoveryConfig.numClusters,
            minClusterSize: discoveryConfig.minClusterSize,
            scoreWeights: discoveryConfig.scoreWeights,
            scoringCriteria: scoringCriteria.filter(c => c.enabled).map(c => ({
              id: c.id,
              label: c.label,
              description: c.description,
              weight: discoveryConfig.scoreWeights[c.id] ?? c.weight,
            })),
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

  const cancelDiscovery = () => {
    abortControllerRef.current?.abort();
  };

  const goToInteraction = () => {
    if (sessionId) {
      router.push(`/rag/interaction?session=${sessionId}`);
    }
  };

  // 선택된 옵션 총 개수
  const totalSelectedOptions = countSelectedOptions(analysisOptions);

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-3xl flex items-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>통계 로딩 중...</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* 헤더 */}
      <div className="glass-panel p-6 rounded-3xl shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">RAG 분석</h1>
            <p className="text-xs text-stone-500 mt-0.5">
              사업장 맞춤형 이슈 발굴 및 자동 분석
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
                disabled={!stats?.connected || (stats?.totalChunks || 0) === 0}
                className={cn(
                  "flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium transition-all",
                  stats?.connected && (stats?.totalChunks || 0) > 0
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
        <div className="glass-panel p-4 rounded-2xl bg-red-50/50 border-red-200/60 flex items-start gap-3 shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">벡터 DB 연결 실패</p>
            <p className="text-xs text-red-600 mt-0.5">
              {stats?.error || "백엔드 서버가 실행 중인지 확인하세요."}
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[6fr_4fr] gap-6">
        {/* ============================== */}
        {/* 왼쪽 패널 */}
        {/* ============================== */}
        <div className="h-full flex flex-col gap-4 overflow-auto">
          {/* 필터 요약 */}
          <div className="glass-panel p-4 rounded-2xl shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-sm font-semibold text-stone-700">
                    분석 대상 청크
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xl font-bold text-primary">
                      {(stats?.totalChunks ?? 0).toLocaleString()}
                    </span>
                    <span className="text-xs text-stone-400">전체</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-stone-500">
                {selectedProfileId && (
                  <span className="px-2 py-1 rounded-lg bg-green-50 text-green-700 font-medium">
                    {profiles.find(p => p.id === selectedProfileId)?.name}
                  </span>
                )}
                {totalSelectedOptions > 0 && (
                  <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-medium">
                    옵션 {totalSelectedOptions}개
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 발굴 설정 + 분석 기간 병렬 배치 */}
          <div className="grid grid-cols-2 gap-4 shrink-0 min-h-[360px]">
            {/* 발굴 설정 패널 */}
            <div className="glass-panel rounded-2xl overflow-hidden flex flex-col">
              <button
                onClick={() => toggleSection("discoveryConfig")}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
              >
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-indigo-500" />
                  <span className="font-semibold text-stone-700 text-sm">발굴 설정</span>
                </div>
                {expandedSections.discoveryConfig ? (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                )}
              </button>
              
              {expandedSections.discoveryConfig && (
                <div className="px-4 pb-5 border-t border-stone-100 pt-4 space-y-4 flex-1">
                  {/* 클러스터 설정 */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-stone-500 mb-1 block">클러스터</label>
                      <input
                        type="number"
                        min={3}
                        max={30}
                        value={discoveryConfig.numClusters}
                        onChange={(e) => setDiscoveryConfig((prev) => ({
                          ...prev,
                          numClusters: parseInt(e.target.value) || 10,
                        }))}
                        className="input-field text-xs"
                        disabled={discovering}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-stone-500 mb-1 block">최소크기</label>
                      <input
                        type="number"
                        min={2}
                        max={10}
                        value={discoveryConfig.minClusterSize}
                        onChange={(e) => setDiscoveryConfig((prev) => ({
                          ...prev,
                          minClusterSize: parseInt(e.target.value) || 3,
                        }))}
                        className="input-field text-xs"
                        disabled={discovering}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-stone-500 mb-1 block">이슈 수</label>
                      <input
                        type="number"
                        min={3}
                        max={20}
                        value={discoveryConfig.numIssues}
                        onChange={(e) => setDiscoveryConfig((prev) => ({
                          ...prev,
                          numIssues: parseInt(e.target.value) || 10,
                        }))}
                        className="input-field text-xs"
                        disabled={discovering}
                      />
                    </div>
                  </div>
                  
                  {/* 중요도 가중치 (RAG 설정 연동) */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sliders className="w-3 h-3 text-stone-400" />
                      <span className="text-[10px] font-semibold text-stone-600">가중치</span>
                      <span className="text-[9px] text-stone-400">
                        ({Math.round(
                          Object.values(discoveryConfig.scoreWeights).reduce((sum, v) => sum + v, 0) * 100
                        )}%)
                      </span>
                    </div>
                    {scoringCriteria.filter(c => c.enabled).length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {scoringCriteria.filter(c => c.enabled).map((criteria) => (
                          <div key={criteria.id}>
                            <div className="flex justify-between text-[10px] mb-1">
                              <span className="text-stone-500 truncate" title={criteria.description}>
                                {criteria.label}
                              </span>
                              <span className="font-mono text-stone-700 shrink-0 ml-1">
                                {Math.round((discoveryConfig.scoreWeights[criteria.id] ?? criteria.weight) * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={0.6}
                              step={0.05}
                              value={discoveryConfig.scoreWeights[criteria.id] ?? criteria.weight}
                              onChange={(e) => setDiscoveryConfig((prev) => ({
                                ...prev,
                                scoreWeights: {
                                  ...prev.scoreWeights,
                                  [criteria.id]: parseFloat(e.target.value),
                                },
                              }))}
                              className="w-full h-1.5"
                              disabled={discovering}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-stone-400 text-center py-2">
                        RAG 설정에서 평가 기준을 추가하세요
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 분석 기간 카드 */}
            <div className="glass-panel rounded-2xl overflow-hidden flex flex-col">
              <button
                onClick={() => toggleSection("date")}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-stone-700 text-sm">분석 기간</span>
                  {(filter.dateStart || filter.dateEnd) && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-primary/10 text-primary">
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
                <div className="border-t border-stone-100 pt-[30px]">
                  <div className="flex pl-[30px] pr-[30px]">
                    {/* 좌측 탭 */}
                    <div className="w-16 border-r border-stone-100 bg-stone-50/50">
                      {(["monthly", "quarterly", "yearly", "custom"] as PeriodMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setFilter(prev => ({ ...prev, periodMode: mode }))}
                          className={cn(
                            "w-full px-1.5 py-2 text-[10px] font-medium text-left border-l-2 transition-all",
                            filter.periodMode === mode
                              ? "bg-white border-primary text-primary"
                              : "border-transparent text-stone-500 hover:bg-white/50 hover:text-stone-700"
                          )}
                        >
                          {mode === "monthly" && "월별"}
                          {mode === "quarterly" && "분기별"}
                          {mode === "yearly" && "연도별"}
                          {mode === "custom" && "직접입력"}
                        </button>
                      ))}
                    </div>
                    
                    {/* 우측 컨텐츠 */}
                    <div className="flex-1 p-3 h-[260px] overflow-auto">
                      {/* 월별 */}
                      {filter.periodMode === "monthly" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => setFilter(prev => ({ ...prev, selectedYear: prev.selectedYear - 1 }))}
                              className="p-0.5 rounded hover:bg-stone-100"
                            >
                              <ChevronDown className="w-3.5 h-3.5 rotate-90" />
                            </button>
                            <span className="text-xs font-semibold text-stone-700 w-14 text-center">
                              {filter.selectedYear}년
                            </span>
                            <button
                              onClick={() => setFilter(prev => ({ ...prev, selectedYear: prev.selectedYear + 1 }))}
                              className="p-0.5 rounded hover:bg-stone-100"
                            >
                              <ChevronUp className="w-3.5 h-3.5 rotate-90" />
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                              const isSelected = filter.selectedMonths.includes(month);
                              return (
                                <button
                                  key={month}
                                  onClick={() => {
                                    setFilter(prev => ({
                                      ...prev,
                                      selectedMonths: isSelected
                                        ? prev.selectedMonths.filter(m => m !== month)
                                        : [...prev.selectedMonths, month].sort((a, b) => a - b),
                                    }));
                                  }}
                                  className={cn(
                                    "py-1.5 text-[10px] font-medium rounded-md transition-all",
                                    isSelected
                                      ? "bg-primary text-white"
                                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                                  )}
                                >
                                  {month}월
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      
                      {/* 분기별 */}
                      {filter.periodMode === "quarterly" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => setFilter(prev => ({ ...prev, selectedYear: prev.selectedYear - 1 }))}
                              className="p-0.5 rounded hover:bg-stone-100"
                            >
                              <ChevronDown className="w-3.5 h-3.5 rotate-90" />
                            </button>
                            <span className="text-xs font-semibold text-stone-700 w-14 text-center">
                              {filter.selectedYear}년
                            </span>
                            <button
                              onClick={() => setFilter(prev => ({ ...prev, selectedYear: prev.selectedYear + 1 }))}
                              className="p-0.5 rounded hover:bg-stone-100"
                            >
                              <ChevronUp className="w-3.5 h-3.5 rotate-90" />
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {[1, 2, 3, 4].map((q) => {
                              const isSelected = filter.selectedQuarters.includes(q);
                              return (
                                <button
                                  key={q}
                                  onClick={() => {
                                    setFilter(prev => ({
                                      ...prev,
                                      selectedQuarters: isSelected
                                        ? prev.selectedQuarters.filter(x => x !== q)
                                        : [...prev.selectedQuarters, q].sort((a, b) => a - b),
                                    }));
                                  }}
                                  className={cn(
                                    "py-2.5 text-xs font-medium rounded-lg transition-all",
                                    isSelected
                                      ? "bg-primary text-white"
                                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                                  )}
                                >
                                  Q{q}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[9px] text-stone-400 text-center">
                            Q1: 1-3월 | Q2: 4-6월 | Q3: 7-9월 | Q4: 10-12월
                          </p>
                        </div>
                      )}
                      
                      {/* 연도별 */}
                      {filter.periodMode === "yearly" && (
                        <div className="space-y-2">
                          <p className="text-[10px] text-stone-500 text-center">연도 선택</p>
                          <div className="flex flex-wrap gap-1.5 justify-center">
                            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 5 + i).map((year) => {
                              const isSelected = filter.selectedYears.includes(year);
                              return (
                                <button
                                  key={year}
                                  onClick={() => {
                                    setFilter(prev => ({
                                      ...prev,
                                      selectedYears: isSelected
                                        ? prev.selectedYears.filter(y => y !== year)
                                        : [...prev.selectedYears, year].sort((a, b) => a - b),
                                    }));
                                  }}
                                  className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                                    isSelected
                                      ? "bg-primary text-white"
                                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                                  )}
                                >
                                  {year}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      
                      {/* 직접 입력 */}
                      {filter.periodMode === "custom" && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-stone-500 mb-1 block">시작</label>
                            <input
                              type="month"
                              value={filter.dateStart}
                              onChange={(e) => setFilter((prev) => ({ ...prev, dateStart: e.target.value }))}
                              min={stats?.dateRange.earliest}
                              max={stats?.dateRange.latest}
                              className="input-field text-xs"
                              disabled={!stats?.connected}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-stone-500 mb-1 block">종료</label>
                            <input
                              type="month"
                              value={filter.dateEnd}
                              onChange={(e) => setFilter((prev) => ({ ...prev, dateEnd: e.target.value }))}
                              min={stats?.dateRange.earliest}
                              max={stats?.dateRange.latest}
                              className="input-field text-xs"
                              disabled={!stats?.connected}
                            />
                          </div>
                        </div>
                      )}
                      
                      {/* 선택된 기간 표시 */}
                      {(filter.dateStart || filter.dateEnd) && (
                        <div className="mt-2 pt-2 border-t border-stone-100">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-stone-500">기간:</span>
                            <span className="font-medium text-primary">
                              {filter.dateStart || "~"} ~ {filter.dateEnd || "~"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 선택된 기간 표시 태그 소카드 */}
                  <div className="mx-[30px] mt-3 mb-3 p-2.5 rounded-lg bg-stone-50/80 border border-stone-200/60">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-[10px] font-semibold text-stone-600 shrink-0">선택 기간</span>
                      {filter.periodMode === "monthly" && filter.selectedMonths.length > 0 ? (
                        <>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                            {filter.selectedYear}년
                          </span>
                          {filter.selectedMonths.map(m => (
                            <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                              {m}월
                            </span>
                          ))}
                        </>
                      ) : filter.periodMode === "quarterly" && filter.selectedQuarters.length > 0 ? (
                        <>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                            {filter.selectedYear}년
                          </span>
                          {filter.selectedQuarters.map(q => (
                            <span key={q} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                              Q{q}
                            </span>
                          ))}
                        </>
                      ) : filter.periodMode === "yearly" && filter.selectedYears.length > 0 ? (
                        <>
                          {filter.selectedYears.map(y => (
                            <span key={y} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                              {y}년
                            </span>
                          ))}
                        </>
                      ) : filter.periodMode === "custom" && (filter.dateStart || filter.dateEnd) ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                          {filter.dateStart || "~"} ~ {filter.dateEnd || "~"}
                        </span>
                      ) : (
                        <span className="text-[10px] text-stone-400 italic">기간을 선택해 주세요</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ============================== */}
          {/* 사업장 프로파일 카드 (3열 구성) */}
          {/* ============================== */}
          <div className="glass-panel rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="px-4 py-3 border-b border-stone-100 shrink-0">
              <div className="flex items-center gap-2">
                <Factory className="w-4 h-4 text-primary" />
                <span className="font-semibold text-stone-700 text-sm">사업장 프로파일</span>
                {selectedProfileId && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
                    선택됨
                  </span>
                )}
                {totalSelectedOptions > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                    옵션 {totalSelectedOptions}개
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex-1 min-h-0 grid grid-cols-[3fr_3fr_4fr] divide-x divide-stone-200 overflow-hidden">
              {/* ===== 1열 (30%): 업종 선택 + 전체 사업장 (세로 배치) ===== */}
              <div className="overflow-y-auto p-3 flex flex-col gap-3">
                {/* 업종 선택 */}
                <div>
                  <h4 className="text-xs font-semibold text-stone-500 mb-2 px-1">업종 선택</h4>
                  <div className="grid grid-cols-3 gap-1">
                    {INDUSTRY_CATEGORIES_UI.map((industry) => {
                      const Icon = INDUSTRY_ICON_MAP[industry.id] || MoreHorizontal;
                      const count = industryCounts[industry.id] || 0;
                      const isSelected = selectedIndustry === industry.id;
                      
                      return (
                        <button
                          key={industry.id}
                          onClick={() => setSelectedIndustry(isSelected ? null : industry.id)}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all",
                            isSelected
                              ? "bg-primary text-white"
                              : count > 0
                              ? "bg-stone-100 text-stone-700 hover:bg-stone-200"
                              : "bg-stone-50 text-stone-400 hover:bg-stone-100"
                          )}
                        >
                          <Icon className="w-3 h-3 shrink-0" />
                          <span className="truncate">{industry.label}</span>
                          {count > 0 && (
                            <span className={cn(
                              "px-1 rounded-full text-[8px] shrink-0",
                              isSelected ? "bg-white/20" : "bg-stone-200"
                            )}>
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 전체 사업장 (업종 선택 하단) */}
                <div className="border-t border-stone-100 pt-2">
                  <h4 className="text-xs font-semibold text-stone-500 mb-2 px-1">
                    {selectedIndustry
                      ? `${INDUSTRY_CATEGORIES_UI.find(i => i.id === selectedIndustry)?.label} (${industryProfiles.length})`
                      : `전체 사업장 (${industryProfiles.length})`
                    }
                  </h4>
                  
                  {profilesLoading ? (
                    <div className="p-4 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                    </div>
                  ) : industryProfiles.length === 0 ? (
                    <div className="p-3 text-center">
                      <Factory className="w-5 h-5 text-stone-300 mx-auto mb-1" />
                      <p className="text-[10px] text-stone-400">
                        {selectedIndustry ? "해당 업종 사업장 없음" : "등록된 사업장 없음"}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1">
                      {industryProfiles.map((profile) => (
                        <button
                          key={profile.id}
                          onClick={() => setSelectedProfileId(
                            selectedProfileId === profile.id ? null : profile.id
                          )}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all text-left",
                            selectedProfileId === profile.id
                              ? "bg-primary text-white"
                              : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                          )}
                        >
                          <Factory className="w-3 h-3 shrink-0" />
                          <span className="truncate">{profile.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ===== 2열 (30%): 사업장 개요 ===== */}
              <div className="overflow-y-auto p-3 flex flex-col">
                <h4 className="text-xs font-semibold text-stone-500 mb-2 px-1">사업장 개요</h4>
                {!selectedProfileId ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <Building className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                      <p className="text-[11px] text-stone-400">사업장을 선택해 주세요</p>
                    </div>
                  </div>
                ) : profileDetailLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(() => {
                      const detail = selectedProfileDetail;
                      const basicInfo = detail?.overview?.basicInfo || {};
                      const facilitySummary = detail?.overview?.facilitySummary || {};
                      const listItem = industryProfiles.find(p => p.id === selectedProfileId);
                      const currentIssues = detail?.overview?.currentIssues || [];

                      return (
                        <>
                          {/* 로고 + 사업장명 */}
                          <div className="flex items-center gap-2.5 p-2 rounded-lg bg-stone-50 border border-stone-200/60">
                            {basicInfo.logo ? (
                              <img
                                src={basicInfo.logo}
                                alt="로고"
                                className="w-10 h-10 rounded-lg object-contain bg-white border border-stone-200 shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-stone-200 flex items-center justify-center shrink-0">
                                <Factory className="w-5 h-5 text-stone-400" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-stone-800 truncate">
                                {basicInfo.name || listItem?.name || ""}
                              </div>
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                  {listItem?.industryLabel || ""}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 font-medium">
                                  {listItem?.scaleLabel || ""}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* 기본 정보 리스트 */}
                          <div className="space-y-1.5">
                            {/* 소재지 */}
                            <div className="flex items-start gap-1.5 text-[10px]">
                              <span className="text-stone-400 shrink-0 w-14">소재지</span>
                              <span className="text-stone-700 font-medium">
                                {basicInfo.location?.roadAddress || basicInfo.location?.jibunAddress || listItem?.location || "미등록"}
                              </span>
                            </div>
                            {/* 대상업종 */}
                            <div className="flex items-start gap-1.5 text-[10px]">
                              <span className="text-stone-400 shrink-0 w-14">대상업종</span>
                              <span className="text-stone-700 font-medium">{listItem?.industryLabel || ""}</span>
                            </div>
                            {/* 표준산업분류코드 */}
                            {basicInfo.industryCodes?.length > 0 && (
                              <div className="flex items-start gap-1.5 text-[10px]">
                                <span className="text-stone-400 shrink-0 w-14">분류코드</span>
                                <div className="flex flex-wrap gap-0.5">
                                  {basicInfo.industryCodes.map((code: any, i: number) => (
                                    <span key={i} className="px-1 py-0.5 rounded bg-stone-100 text-stone-600 text-[9px] font-mono">
                                      {typeof code === 'string' ? code : code.code || code.name || ''}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* 대기/수질 종규모 */}
                            {(basicInfo.facilityClass?.airClass || basicInfo.facilityClass?.waterClass) && (
                              <div className="flex items-start gap-1.5 text-[10px]">
                                <span className="text-stone-400 shrink-0 w-14">종규모</span>
                                <div className="flex gap-1.5">
                                  {basicInfo.facilityClass?.airClass && (
                                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-medium">
                                      대기 {basicInfo.facilityClass.airClass}종
                                    </span>
                                  )}
                                  {basicInfo.facilityClass?.waterClass && (
                                    <span className="px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 text-[9px] font-medium">
                                      수질 {basicInfo.facilityClass.waterClass}종
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 시설현황 요약 */}
                          <div className="p-2 rounded-lg bg-stone-50 border border-stone-200/60">
                            <div className="text-[10px] font-semibold text-stone-600 mb-1.5">시설 현황</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              {[
                                { label: "배출시설", value: facilitySummary.emissionFacilityCount || 0 },
                                { label: "방지시설", value: facilitySummary.preventionFacilityCount || 0 },
                                { label: "일반굴뚝", value: facilitySummary.generalStackCount || 0 },
                                { label: "CleanSYS", value: facilitySummary.cleansysStackCount || 0 },
                                { label: "플레어스택", value: facilitySummary.flareStackCount || 0 },
                                { label: "방류구", value: facilitySummary.dischargePointCount || 0 },
                              ].map((item) => (
                                <div key={item.label} className="flex justify-between text-[10px]">
                                  <span className="text-stone-400">{item.label}</span>
                                  <span className="font-medium text-stone-700">{item.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* 주요 생산품 */}
                          <div className="p-2 rounded-lg bg-stone-50 border border-stone-200/60">
                            <div className="text-[10px] font-semibold text-stone-600 mb-1.5">주요 생산품</div>
                            {basicInfo.mainProducts?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {basicInfo.mainProducts.map((product: string, i: number) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 text-[9px] font-medium">
                                    {product}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-stone-400 italic">등록된 생산품 없음</p>
                            )}
                          </div>

                          {/* 현재 이슈 상황 */}
                          <div className="p-2 rounded-lg bg-stone-50 border border-stone-200/60">
                            <div className="text-[10px] font-semibold text-stone-600 mb-1.5">현재 이슈</div>
                            {currentIssues.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {currentIssues.map((issue: any) => (
                                  <span
                                    key={issue.id}
                                    className={cn(
                                      "px-1.5 py-0.5 rounded text-[9px] font-medium",
                                      issue.severity === "critical" ? "bg-red-100 text-red-700" :
                                      issue.severity === "warning" ? "bg-amber-100 text-amber-700" :
                                      "bg-blue-100 text-blue-700"
                                    )}
                                    title={issue.memo || ""}
                                  >
                                    {issue.severity === "critical" ? "●" : issue.severity === "warning" ? "●" : "●"}{" "}
                                    {issue.label}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-stone-400 italic">등록된 이슈 없음</p>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* ===== 3열 (40%): 카테고리 탭 옵션 패널 ===== */}
              <div className="flex flex-col overflow-hidden">
                {/* 탭 헤더 */}
                <div className="flex border-b border-stone-100 shrink-0">
                  {ANALYSIS_CATEGORIES.map((cat) => {
                    const Icon = CATEGORY_ICON_MAP[cat.iconName] || Shield;
                    const selectedCount = analysisOptions[cat.id]?.length || 0;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setOptionTab(cat.id)}
                        className={cn(
                          "flex-1 px-2 py-2 text-[11px] font-medium transition-all flex items-center justify-center gap-1",
                          optionTab === cat.id
                            ? "bg-white text-primary border-b-2 border-primary"
                            : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {cat.label}
                        {selectedCount > 0 && (
                          <span className="px-1 py-0.5 rounded-full text-[8px] font-bold bg-primary/10 text-primary">
                            {selectedCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* 탭 컨텐츠 */}
                <div className="overflow-y-auto p-2.5">
                  {ANALYSIS_CATEGORIES.map((cat) => (
                    <div
                      key={cat.id}
                      className={cn(
                        "grid grid-cols-2 gap-1.5",
                        optionTab !== cat.id && "hidden"
                      )}
                    >
                      {cat.options.map((opt) => {
                        const isChecked = analysisOptions[cat.id]?.includes(opt.id);
                        return (
                          <label
                            key={opt.id}
                            className={cn(
                              "flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-all",
                              isChecked
                                ? "bg-primary/5 border border-primary/30"
                                : "bg-stone-50 border border-transparent hover:bg-stone-100"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleAnalysisOption(cat.id, opt.id)}
                              className="shrink-0 w-3.5 h-3.5 rounded accent-primary"
                              disabled={discovering}
                            />
                            <span className="flex-1 min-w-0 text-[11px] font-medium text-stone-700 truncate">
                              {opt.label}
                            </span>
                            {/* 설명 툴팁 */}
                            <span className="relative group shrink-0">
                              <HelpCircle className="w-3.5 h-3.5 text-stone-400 hover:text-stone-600 cursor-help" />
                              <span className="absolute bottom-full right-0 mb-1 w-52 p-2 rounded-lg bg-stone-800 text-white text-[9px] leading-relaxed shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                                {opt.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ))}

                  {/* 전부 선택 / 전부 해제 버튼 (탭 컨텐츠 바로 아래 10px) */}
                  <div className="flex justify-end gap-2 mt-[10px]">
                    <button
                      onClick={() => {
                        const cat = ANALYSIS_CATEGORIES.find(c => c.id === optionTab);
                        if (cat) {
                          setAnalysisOptions(prev => ({
                            ...prev,
                            [optionTab]: cat.options.map(o => o.id),
                          }));
                        }
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-all"
                      disabled={discovering}
                    >
                      전부 선택
                    </button>
                    <button
                      onClick={() => {
                        setAnalysisOptions(prev => ({
                          ...prev,
                          [optionTab]: [],
                        }));
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-stone-100 text-stone-600 hover:bg-stone-200 transition-all"
                      disabled={discovering}
                    >
                      전부 해제
                    </button>
                  </div>
                </div>

                {/* 선택된 옵션 요약 태그 */}
                {totalSelectedOptions > 0 && (
                  <div className="border-t border-stone-100 px-2.5 py-2 shrink-0 bg-stone-50/50 overflow-y-auto">
                    <div className="text-[10px] font-semibold text-stone-500 mb-1.5">선택된 옵션</div>
                    <div className="flex flex-wrap gap-1">
                      {ANALYSIS_CATEGORIES.map((cat) =>
                        (analysisOptions[cat.id] || []).map((optId) => {
                          const opt = cat.options.find((o) => o.id === optId);
                          if (!opt) return null;
                          const colorMap: Record<string, string> = {
                            integrated_permit: "bg-emerald-100 text-emerald-700",
                            climate_change: "bg-blue-100 text-blue-700",
                            industrial_safety: "bg-amber-100 text-amber-700",
                          };
                          return (
                            <button
                              key={`${cat.id}-${optId}`}
                              onClick={() => toggleAnalysisOption(cat.id, optId)}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-0.5",
                                colorMap[cat.id] || "bg-stone-100 text-stone-600"
                              )}
                              title={`${cat.label}: ${opt.label} (클릭하여 제거)`}
                            >
                              {opt.label}
                              <XCircle className="w-2.5 h-2.5 opacity-60" />
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ============================== */}
        {/* 오른쪽: 세션 히스토리 + 발굴된 이슈 */}
        {/* ============================== */}
        <div className="h-full flex flex-col gap-4 overflow-auto">
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
                  설정을 완료하고<br />&apos;자동 이슈 발굴&apos;을 실행하세요
                </p>
              </div>
            )}
          </div>
            );
          })()}

          {/* 발굴 결과 통계 */}
          {(() => {
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
