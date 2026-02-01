"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Check, X, Edit3, Trash2, RefreshCw,
  Loader2, Save, Clock, Target, FileText, Building2, CheckCircle2,
  AlertTriangle, Lightbulb, Filter, Star, BarChart3, ChevronDown,
  ChevronUp, Eye, EyeOff, MessageSquare, Plus, History,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// 타입 정의
// ============================================================

interface ImportanceScore {
  total: number;
  legalMandatory: number;
  novelty: number;
  impact: number;
  international: number;
}

interface DiscoveredIssue {
  id: string;
  sessionId: string;
  title: string;
  summary: string;
  keywords: string[];
  clusterId: number;
  clusterSize: number;
  representativeChunkIds: string[];
  score: ImportanceScore;
  status: "discovered" | "selected" | "rejected" | "analyzed";
  userTitle?: string;
  userSummary?: string;
  userNotes?: string;
  sources: {
    orgName: string;
    boardName: string;
    dateFolder: string;
    docTitle?: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

interface DiscoverySession {
  id: string;
  name: string;
  status: string;
  progress: number;
  filter: {
    dateRange?: { start: string; end: string };
    organizations?: string[];
    boards?: string[];
    chunkTypes?: string[];
  };
  filteredChunkCount: number;
  config: {
    numIssues: number;
    numClusters: number;
    minClusterSize: number;
    scoreWeights: {
      legalMandatory: number;
      novelty: number;
      impact: number;
      international: number;
    };
  };
  issues: DiscoveredIssue[];
  selectedIssueIds: string[];
  llmModel: string;
  tokenUsage: {
    input: number;
    output: number;
    cost: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface SessionListItem {
  id: string;
  name: string;
  status: string;
  issueCount: number;
  selectedCount: number;
  createdAt: string;
}

// ============================================================
// 메인 컴포넌트 (Suspense 래퍼)
// ============================================================

export default function InteractionPageWrapper() {
  return (
    <Suspense fallback={<InteractionLoading />}>
      <InteractionPage />
    </Suspense>
  );
}

function InteractionLoading() {
  return (
    <div className="glass-panel p-6 rounded-3xl flex items-center gap-2">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span>로딩 중...</span>
    </div>
  );
}

// ============================================================
// 실제 페이지 컴포넌트
// ============================================================

function InteractionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session");

  // 세션 상태
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionIdParam);
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [loading, setLoading] = useState(true);

  // 이슈 편집 상태
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", summary: "", notes: "" });

  // 필터 상태
  const [showRejected, setShowRejected] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "cluster">("score");

  // UI 상태
  const [sessionListOpen, setSessionListOpen] = useState(!sessionIdParam);
  const [saving, setSaving] = useState<string | null>(null);

  // 세션 목록 로드
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/rag/discovery/sessions");
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error("Failed to load sessions:", error);
    }
  }, []);

  // 세션 상세 로드
  const loadSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rag/discovery/sessions/${sessionId}`);
      const data = await res.json();
      if (data.success) {
        setSession(data.session);
      } else {
        alert(data.error || "세션을 불러올 수 없습니다.");
      }
    } catch (error) {
      console.error("Failed to load session:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedSessionId) {
      loadSession(selectedSessionId);
    } else {
      setLoading(false);
    }
  }, [selectedSessionId, loadSession]);

  // 이슈 상태 업데이트
  const updateIssueStatus = async (issueId: string, status: "selected" | "discovered" | "rejected") => {
    if (!session) return;
    setSaving(issueId);

    try {
      const res = await fetch(
        `/api/rag/discovery/sessions/${session.id}/issues/${issueId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const data = await res.json();
      if (data.success) {
        await loadSession(session.id);
      }
    } catch (error) {
      console.error("Failed to update issue status:", error);
    } finally {
      setSaving(null);
    }
  };

  // 이슈 내용 수정
  const saveIssueEdit = async (issueId: string) => {
    if (!session) return;
    setSaving(issueId);

    try {
      const res = await fetch(
        `/api/rag/discovery/sessions/${session.id}/issues/${issueId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userTitle: editForm.title,
            userSummary: editForm.summary,
            userNotes: editForm.notes,
          }),
        }
      );
      const data = await res.json();
      if (data.success) {
        setEditingIssueId(null);
        await loadSession(session.id);
      }
    } catch (error) {
      console.error("Failed to save issue edit:", error);
    } finally {
      setSaving(null);
    }
  };

  // 일괄 선택
  const selectAllIssues = async () => {
    if (!session) return;
    const allIds = session.issues
      .filter((i) => i.status !== "rejected")
      .map((i) => i.id);

    try {
      await fetch(`/api/rag/discovery/sessions/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIssueIds: allIds }),
      });
      await loadSession(session.id);
    } catch (error) {
      console.error("Failed to select all:", error);
    }
  };

  // 선택 해제
  const deselectAllIssues = async () => {
    if (!session) return;

    try {
      await fetch(`/api/rag/discovery/sessions/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIssueIds: [] }),
      });
      await loadSession(session.id);
    } catch (error) {
      console.error("Failed to deselect all:", error);
    }
  };

  // 심층 분석으로 이동
  const goToDeepAnalysis = () => {
    if (session && session.selectedIssueIds.length > 0) {
      router.push(`/rag/deep-analysis?session=${session.id}`);
    }
  };

  // 필터링된 이슈 목록
  const filteredIssues = session?.issues
    .filter((issue) => showRejected || issue.status !== "rejected")
    .sort((a, b) => {
      if (sortBy === "score") return b.score.total - a.score.total;
      return b.clusterSize - a.clusterSize;
    }) || [];

  const selectedCount = session?.selectedIssueIds.length || 0;

  if (loading) {
    return <InteractionLoading />;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/rag/analysis")}
              className="p-2 rounded-lg hover:bg-stone-100"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-stone-800">사용자 인터랙션</h1>
              <p className="text-xs text-stone-500 mt-0.5">
                발굴된 이슈 검토, 선택 및 수정
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {session && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-100">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-stone-700">
                  {selectedCount}개 선택됨
                </span>
              </div>
            )}

            <button
              onClick={goToDeepAnalysis}
              disabled={!session || selectedCount === 0}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all",
                session && selectedCount > 0
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "bg-stone-200 text-stone-400 cursor-not-allowed"
              )}
            >
              심층 분석 진행
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* 왼쪽: 세션 목록 */}
        <div className="space-y-4">
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button
              onClick={() => setSessionListOpen(!sessionListOpen)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
            >
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-stone-500" />
                <span className="font-semibold text-stone-700 text-sm">발굴 세션</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-500">
                  {sessions.length}
                </span>
              </div>
              {sessionListOpen ? (
                <ChevronUp className="w-4 h-4 text-stone-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-400" />
              )}
            </button>

            {sessionListOpen && (
              <div className="border-t border-stone-100 max-h-[400px] overflow-y-auto">
                {sessions.length > 0 ? (
                  <div className="divide-y divide-stone-100">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelectedSessionId(s.id);
                          router.push(`/rag/interaction?session=${s.id}`);
                        }}
                        className={cn(
                          "w-full px-4 py-3 text-left hover:bg-stone-50/50 transition-all",
                          selectedSessionId === s.id && "bg-primary/5 border-l-2 border-primary"
                        )}
                      >
                        <div className="text-sm font-medium text-stone-700 truncate">
                          {s.name}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                            s.status === "completed" ? "bg-green-100 text-green-700" :
                            s.status === "error" ? "bg-red-100 text-red-700" :
                            "bg-amber-100 text-amber-700"
                          )}>
                            {s.status === "completed" ? "완료" : s.status === "error" ? "오류" : "진행중"}
                          </span>
                          <span className="text-[10px] text-stone-400">
                            이슈 {s.issueCount}개
                          </span>
                          {s.selectedCount > 0 && (
                            <span className="text-[10px] text-primary">
                              ({s.selectedCount} 선택)
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-1">
                          {new Date(s.createdAt).toLocaleString("ko-KR")}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-stone-400">
                    발굴된 세션이 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 세션 정보 */}
          {session && (
            <div className="glass-panel p-4 rounded-2xl space-y-3">
              <div className="font-semibold text-stone-700 text-sm">세션 정보</div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">분석 청크</span>
                  <span className="font-medium">{session.filteredChunkCount.toLocaleString()}개</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">발굴 이슈</span>
                  <span className="font-medium">{session.issues.length}개</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">LLM 모델</span>
                  <span className="font-medium">{session.llmModel || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">비용</span>
                  <span className="font-medium">${session.tokenUsage.cost.toFixed(4)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 필터 옵션 */}
          {session && (
            <div className="glass-panel p-4 rounded-2xl space-y-3">
              <div className="font-semibold text-stone-700 text-sm">필터 옵션</div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input
                    type="checkbox"
                    checked={showRejected}
                    onChange={(e) => setShowRejected(e.target.checked)}
                    className="rounded border-stone-300"
                  />
                  제외된 이슈 표시
                </label>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-stone-500">정렬:</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="text-xs border border-stone-200 rounded px-2 py-1"
                  >
                    <option value="score">점수순</option>
                    <option value="cluster">클러스터 크기순</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 일괄 작업 */}
          {session && (
            <div className="glass-panel p-4 rounded-2xl space-y-2">
              <div className="font-semibold text-stone-700 text-sm mb-2">일괄 작업</div>
              <button
                onClick={selectAllIssues}
                className="w-full px-3 py-2 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20"
              >
                모두 선택
              </button>
              <button
                onClick={deselectAllIssues}
                className="w-full px-3 py-2 rounded-lg text-xs font-semibold bg-stone-100 text-stone-600 hover:bg-stone-200"
              >
                선택 해제
              </button>
            </div>
          )}
        </div>

        {/* 오른쪽: 이슈 카드 목록 */}
        <div className="space-y-4">
          {!session ? (
            <div className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center">
              <Lightbulb className="w-12 h-12 text-stone-300 mb-4" />
              <p className="font-semibold text-stone-500">세션을 선택하세요</p>
              <p className="text-sm text-stone-400 mt-1">
                왼쪽 목록에서 발굴 세션을 선택하거나,<br />
                RAG 분석에서 새로운 발굴을 실행하세요.
              </p>
              <button
                onClick={() => router.push("/rag/analysis")}
                className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20"
              >
                새 이슈 발굴
              </button>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center">
              <AlertTriangle className="w-12 h-12 text-stone-300 mb-4" />
              <p className="font-semibold text-stone-500">발굴된 이슈가 없습니다</p>
              <p className="text-sm text-stone-400 mt-1">
                RAG 분석에서 이슈 발굴을 다시 실행해 주세요.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIssues.map((issue, idx) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  index={idx + 1}
                  isSelected={session.selectedIssueIds.includes(issue.id)}
                  isEditing={editingIssueId === issue.id}
                  editForm={editForm}
                  saving={saving === issue.id}
                  onSelect={() => updateIssueStatus(issue.id, "selected")}
                  onDeselect={() => updateIssueStatus(issue.id, "discovered")}
                  onReject={() => updateIssueStatus(issue.id, "rejected")}
                  onStartEdit={() => {
                    setEditingIssueId(issue.id);
                    setEditForm({
                      title: issue.userTitle || issue.title,
                      summary: issue.userSummary || issue.summary,
                      notes: issue.userNotes || "",
                    });
                  }}
                  onCancelEdit={() => setEditingIssueId(null)}
                  onSaveEdit={() => saveIssueEdit(issue.id)}
                  onEditFormChange={setEditForm}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 이슈 카드 컴포넌트
// ============================================================

interface IssueCardProps {
  issue: DiscoveredIssue;
  index: number;
  isSelected: boolean;
  isEditing: boolean;
  editForm: { title: string; summary: string; notes: string };
  saving: boolean;
  onSelect: () => void;
  onDeselect: () => void;
  onReject: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditFormChange: (form: { title: string; summary: string; notes: string }) => void;
}

function IssueCard({
  issue,
  index,
  isSelected,
  isEditing,
  editForm,
  saving,
  onSelect,
  onDeselect,
  onReject,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditFormChange,
}: IssueCardProps) {
  const [expanded, setExpanded] = useState(false);

  const scoreColor =
    issue.score.total >= 0.7 ? "text-red-600 bg-red-50" :
    issue.score.total >= 0.5 ? "text-amber-600 bg-amber-50" :
    "text-stone-500 bg-stone-100";

  return (
    <div className={cn(
      "glass-panel rounded-2xl overflow-hidden transition-all",
      isSelected && "ring-2 ring-primary",
      issue.status === "rejected" && "opacity-60"
    )}>
      {/* 헤더 */}
      <div className="p-4 flex items-start gap-4">
        {/* 순위/점수 */}
        <div className="shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center bg-stone-100">
          <span className="text-[10px] text-stone-400">#{index}</span>
          <span className={cn("text-lg font-bold", scoreColor.split(" ")[0])}>
            {Math.round(issue.score.total * 100)}
          </span>
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editForm.title}
              onChange={(e) => onEditFormChange({ ...editForm, title: e.target.value })}
              className="w-full text-sm font-semibold px-2 py-1 border rounded"
            />
          ) : (
            <h3 className="font-semibold text-stone-800 line-clamp-1">
              {issue.userTitle || issue.title}
            </h3>
          )}

          {isEditing ? (
            <textarea
              value={editForm.summary}
              onChange={(e) => onEditFormChange({ ...editForm, summary: e.target.value })}
              rows={2}
              className="w-full text-xs px-2 py-1 border rounded mt-2"
            />
          ) : (
            <p className="text-xs text-stone-500 mt-1 line-clamp-2">
              {issue.userSummary || issue.summary}
            </p>
          )}

          {/* 키워드 */}
          <div className="flex flex-wrap gap-1 mt-2">
            {issue.keywords.slice(0, 5).map((kw, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-full text-[10px] bg-stone-100 text-stone-500"
              >
                {kw}
              </span>
            ))}
          </div>

          {/* 메타 정보 */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-stone-400">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {issue.clusterSize}개 문서
            </span>
            {issue.sources?.[0] && (
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {issue.sources[0].orgName}
              </span>
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="shrink-0 flex flex-col gap-1">
          {isEditing ? (
            <>
              <button
                onClick={onSaveEdit}
                disabled={saving}
                className="p-2 rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              </button>
              <button
                onClick={onCancelEdit}
                className="p-2 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              {issue.status !== "rejected" && (
                <>
                  <button
                    onClick={isSelected ? onDeselect : onSelect}
                    disabled={saving}
                    className={cn(
                      "p-2 rounded-lg transition-all",
                      isSelected
                        ? "bg-primary text-white"
                        : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                    )}
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={onStartEdit}
                    className="p-2 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={issue.status === "rejected" ? onDeselect : onReject}
                disabled={saving}
                className="p-2 rounded-lg bg-stone-100 text-stone-500 hover:bg-red-100 hover:text-red-500"
              >
                {issue.status === "rejected" ? <RefreshCw className="w-4 h-4" /> : <X className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-2 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200"
              >
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 확장 패널 */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-stone-100">
          <div className="pt-4 space-y-4">
            {/* 점수 상세 */}
            <div>
              <div className="text-xs font-semibold text-stone-600 mb-2">중요도 점수</div>
              <div className="grid grid-cols-4 gap-2">
                <ScoreBar label="법적 강제성" value={issue.score.legalMandatory} color="bg-red-400" />
                <ScoreBar label="신규성" value={issue.score.novelty} color="bg-amber-400" />
                <ScoreBar label="파급력" value={issue.score.impact} color="bg-blue-400" />
                <ScoreBar label="국제 동향" value={issue.score.international} color="bg-purple-400" />
              </div>
            </div>

            {/* 출처 */}
            <div>
              <div className="text-xs font-semibold text-stone-600 mb-2">출처</div>
              <div className="space-y-1">
                {issue.sources?.slice(0, 3).map((src, i) => (
                  <div key={i} className="text-xs text-stone-500">
                    • {src.orgName} / {src.boardName} {src.dateFolder && `(${src.dateFolder})`}
                  </div>
                ))}
              </div>
            </div>

            {/* 사용자 메모 */}
            {isEditing && (
              <div>
                <div className="text-xs font-semibold text-stone-600 mb-2">메모</div>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => onEditFormChange({ ...editForm, notes: e.target.value })}
                  rows={2}
                  placeholder="이 이슈에 대한 메모를 작성하세요..."
                  className="w-full text-xs px-2 py-1 border rounded"
                />
              </div>
            )}
            {!isEditing && issue.userNotes && (
              <div>
                <div className="text-xs font-semibold text-stone-600 mb-2">메모</div>
                <p className="text-xs text-stone-500">{issue.userNotes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 점수 바 컴포넌트
// ============================================================

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-[10px] text-stone-500 mb-1">{label}</div>
      <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <div className="text-[10px] text-stone-400 mt-0.5 text-right">
        {Math.round(value * 100)}%
      </div>
    </div>
  );
}
