"use client";

import { useState, useEffect, useCallback, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Play, Pause, RefreshCw, Loader2,
  CheckCircle2, AlertTriangle, FileText, Building2, Target,
  Microscope, Lightbulb, ChevronDown, ChevronUp, Clock,
  Download, Send, Edit3, Save, X, BarChart3, Zap, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// 타입 정의
// ============================================================

interface SelectedIssue {
  id: string;
  title: string;
  summary: string;
  score: { total: number };
  sources: { orgName: string; boardName: string }[];
  clusterSize: number;
  keywords: string[];
  userTitle?: string;
  userSummary?: string;
}

interface AnalysisResult {
  issueId: string;
  step: number;
  stepName: string;
  content: string;
  method: string;
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
  sources?: string[];
}

interface TokenUsage {
  input: number;
  output: number;
  cost: number;
}

interface DeepAnalysisSession {
  sessionId: string;
  issues: SelectedIssue[];
  results: Record<string, AnalysisResult[]>;
  status: "idle" | "running" | "completed" | "error";
  progress: number;
  currentIssue?: string;
  currentStep?: number;
  tokenUsage?: TokenUsage;
  model?: string;
  error?: string;
}

// ============================================================
// 메인 컴포넌트 (Suspense 래퍼)
// ============================================================

export default function DeepAnalysisPageWrapper() {
  return (
    <Suspense fallback={<DeepAnalysisLoading />}>
      <DeepAnalysisPage />
    </Suspense>
  );
}

function DeepAnalysisLoading() {
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

function DeepAnalysisPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session");

  // 세션 상태
  const [loading, setLoading] = useState(true);
  const [selectedIssues, setSelectedIssues] = useState<SelectedIssue[]>([]);
  const [analysisResults, setAnalysisResults] = useState<Record<string, AnalysisResult[]>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [usedModel, setUsedModel] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // UI 상태
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // 분석 설정
  const [analysisConfig, setAnalysisConfig] = useState({
    depth: "standard" as "quick" | "standard" | "deep",
    includeEvidence: true,
    includeRecommendation: true,
    maxSteps: 4,
  });

  // SSE 연결 참조
  const abortControllerRef = useRef<AbortController | null>(null);

  // 세션 로드
  const loadSession = useCallback(async () => {
    if (!sessionIdParam) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/rag/discovery/sessions/${sessionIdParam}`);
      const data = await res.json();

      if (data.success && data.session) {
        const session = data.session;
        const selected = session.issues.filter((i: any) =>
          session.selectedIssueIds.includes(i.id)
        );
        setSelectedIssues(selected);
        if (selected.length > 0) {
          setSelectedIssueId(selected[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to load session:", error);
    } finally {
      setLoading(false);
    }
  }, [sessionIdParam]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // 분석 중지
  const stopAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setAnalyzing(false);
    setCurrentStep("중지됨");
  };

  // 심층 분석 실행 (실제 API 호출)
  const runDeepAnalysis = async () => {
    if (selectedIssues.length === 0 || !sessionIdParam) return;

    setAnalyzing(true);
    setProgress(0);
    setAnalysisResults({});
    setTokenUsage(null);
    setErrorMessage(null);
    setCurrentStep("분석 시작 중...");

    // AbortController 생성
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/rag/deep-analysis/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdParam,
          issueIds: selectedIssues.map(i => i.id),
          config: {
            depth: analysisConfig.depth,
            includeEvidence: analysisConfig.includeEvidence,
            includeRecommendation: analysisConfig.includeRecommendation,
            maxSteps: analysisConfig.maxSteps,
          },
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`API 오류: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("스트림을 읽을 수 없습니다.");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEMessage(data);
            } catch {
              // JSON 파싱 실패 무시
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("분석이 중지되었습니다.");
      } else {
        console.error("심층 분석 오류:", error);
        setErrorMessage(error.message || "분석 중 오류가 발생했습니다.");
      }
    } finally {
      setAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  // SSE 메시지 핸들러
  const handleSSEMessage = (data: any) => {
    switch (data.type) {
      case "started":
        setUsedModel(data.model || "");
        setCurrentStep("분석 시작됨");
        break;

      case "progress":
        setProgress(data.progress || 0);
        setCurrentStep(`${data.issueTitle?.slice(0, 20) || ""}... - ${data.stepName || ""}`);
        break;

      case "step_complete":
        setAnalysisResults((prev) => {
          const existing = prev[data.issueId] || [];
          return {
            ...prev,
            [data.issueId]: [
              ...existing,
              {
                issueId: data.issueId,
                step: data.step,
                stepName: data.stepName,
                content: data.content,
                method: data.method,
                timestamp: new Date().toISOString(),
                inputTokens: data.inputTokens,
                outputTokens: data.outputTokens,
              },
            ],
          };
        });
        break;

      case "step_error":
        setAnalysisResults((prev) => {
          const existing = prev[data.issueId] || [];
          return {
            ...prev,
            [data.issueId]: [
              ...existing,
              {
                issueId: data.issueId,
                step: data.step,
                stepName: data.stepName,
                content: `오류: ${data.error}`,
                method: "Error",
                timestamp: new Date().toISOString(),
              },
            ],
          };
        });
        break;

      case "issue_complete":
        // 이슈 분석 완료
        break;

      case "complete":
        setProgress(100);
        setCurrentStep("완료");
        setTokenUsage(data.tokenUsage);
        setUsedModel(data.model || "");
        break;

      case "error":
        setErrorMessage(data.error);
        setCurrentStep("오류 발생");
        break;
    }
  };

  // 스텝 토글
  const toggleStep = (key: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (loading) {
    return <DeepAnalysisLoading />;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(`/rag/interaction${sessionIdParam ? `?session=${sessionIdParam}` : ""}`)}
              className="p-2 rounded-lg hover:bg-stone-100"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-stone-800">심층 분석</h1>
              <p className="text-xs text-stone-500 mt-0.5">
                선택된 이슈에 대한 다단계 심층 분석 수행
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-100">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-stone-700">
                {selectedIssues.length}개 이슈
              </span>
            </div>

            {analyzing ? (
              <button
                onClick={stopAnalysis}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium bg-red-500 text-white hover:bg-red-600"
              >
                <Pause className="w-4 h-4" />
                중지
              </button>
            ) : (
              <button
                onClick={runDeepAnalysis}
                disabled={selectedIssues.length === 0 || !sessionIdParam}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all",
                  selectedIssues.length > 0 && sessionIdParam
                    ? "bg-primary text-white hover:bg-primary/90"
                    : "bg-stone-200 text-stone-400 cursor-not-allowed"
                )}
              >
                <Microscope className="w-4 h-4" />
                심층 분석 시작
              </button>
            )}
          </div>
        </div>

        {/* 진행 상황 */}
        {analyzing && (
          <div className="mt-4 p-4 rounded-xl bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-stone-700">{currentStep}</span>
              </div>
              <span className="text-sm font-bold text-primary">{progress}%</span>
            </div>
            <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            {usedModel && (
              <div className="mt-2 text-xs text-stone-500">
                사용 모델: {usedModel}
              </div>
            )}
          </div>
        )}

        {/* 오류 메시지 */}
        {errorMessage && (
          <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">{errorMessage}</span>
            </div>
          </div>
        )}

        {/* 완료 후 토큰 사용량 */}
        {!analyzing && tokenUsage && (
          <div className="mt-4 p-4 rounded-xl bg-green-50 border border-green-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">분석 완료</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-green-600">
                <span>입력: {tokenUsage.input.toLocaleString()} 토큰</span>
                <span>출력: {tokenUsage.output.toLocaleString()} 토큰</span>
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  {tokenUsage.cost.toFixed(4)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedIssues.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center">
          <AlertTriangle className="w-12 h-12 text-stone-300 mb-4" />
          <p className="font-semibold text-stone-500">선택된 이슈가 없습니다</p>
          <p className="text-sm text-stone-400 mt-1 text-center">
            사용자 인터랙션에서 분석할 이슈를 선택하세요.
          </p>
          <button
            onClick={() => router.push("/rag/interaction")}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20"
          >
            이슈 선택하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[300px_1fr] gap-6">
          {/* 왼쪽: 이슈 목록 및 설정 */}
          <div className="space-y-4">
            {/* 분석 대상 이슈 */}
            <div className="glass-panel rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-stone-50/50 border-b border-stone-100">
                <span className="font-semibold text-stone-700 text-sm">분석 대상 이슈</span>
              </div>
              <div className="divide-y divide-stone-100 max-h-[300px] overflow-y-auto">
                {selectedIssues.map((issue) => {
                  const hasResults = analysisResults[issue.id]?.length > 0;
                  return (
                    <button
                      key={issue.id}
                      onClick={() => setSelectedIssueId(issue.id)}
                      className={cn(
                        "w-full px-4 py-3 text-left hover:bg-stone-50/50 transition-all",
                        selectedIssueId === issue.id && "bg-primary/5 border-l-2 border-primary"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn(
                          "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                          hasResults ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"
                        )}>
                          {hasResults ? <CheckCircle2 className="w-4 h-4" /> : Math.round(issue.score.total * 100)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-stone-700 truncate">
                            {issue.title}
                          </div>
                          <div className="text-[10px] text-stone-400 mt-0.5">
                            {issue.clusterSize}개 문서 • {issue.sources[0]?.orgName || ""}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 분석 설정 */}
            <div className="glass-panel p-4 rounded-2xl space-y-4">
              <div className="font-semibold text-stone-700 text-sm">분석 설정</div>

              <div>
                <label className="text-xs text-stone-500 mb-1 block">분석 깊이</label>
                <select
                  value={analysisConfig.depth}
                  onChange={(e) => setAnalysisConfig((prev) => ({
                    ...prev,
                    depth: e.target.value as any,
                    maxSteps: e.target.value === "quick" ? 2 : e.target.value === "deep" ? 6 : 4,
                  }))}
                  className="w-full input-field text-sm"
                  disabled={analyzing}
                >
                  <option value="quick">빠른 분석 (2단계)</option>
                  <option value="standard">표준 분석 (4단계)</option>
                  <option value="deep">심층 분석 (6단계)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input
                    type="checkbox"
                    checked={analysisConfig.includeEvidence}
                    onChange={(e) => setAnalysisConfig((prev) => ({
                      ...prev,
                      includeEvidence: e.target.checked,
                    }))}
                    className="rounded border-stone-300"
                    disabled={analyzing}
                  />
                  근거 문서 포함
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input
                    type="checkbox"
                    checked={analysisConfig.includeRecommendation}
                    onChange={(e) => setAnalysisConfig((prev) => ({
                      ...prev,
                      includeRecommendation: e.target.checked,
                    }))}
                    className="rounded border-stone-300"
                    disabled={analyzing}
                  />
                  권고사항 생성
                </label>
              </div>
            </div>

            {/* 도움말 */}
            <div className="glass-panel p-4 rounded-2xl bg-blue-50/50 border-blue-200/60">
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-blue-500 mt-0.5" />
                <div className="text-xs text-blue-700">
                  <p className="font-semibold mb-1">심층 분석 프로세스</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                    <li>관련 데이터 수집 (RAG)</li>
                    <li>초기 분석 (CoT)</li>
                    <li>심층 추론 (Multi-step)</li>
                    <li>결론 및 권고 도출</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>

          {/* 오른쪽: 분석 결과 */}
          <div className="space-y-4">
            {selectedIssueId && (
              <>
                {/* 이슈 정보 */}
                <div className="glass-panel p-4 rounded-2xl">
                  {(() => {
                    const issue = selectedIssues.find((i) => i.id === selectedIssueId);
                    if (!issue) return null;
                    return (
                      <div>
                        <h2 className="font-semibold text-stone-800">{issue.title}</h2>
                        <p className="text-sm text-stone-500 mt-1">{issue.summary}</p>
                        <div className="flex items-center gap-3 mt-3 text-xs text-stone-400">
                          <span className="flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            점수: {Math.round(issue.score.total * 100)}
                          </span>
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {issue.clusterSize}개 문서
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 분석 결과 */}
                {analysisResults[selectedIssueId]?.length > 0 ? (
                  <div className="space-y-3">
                    {analysisResults[selectedIssueId].map((result, idx) => {
                      const key = `${result.issueId}-${result.step}`;
                      const isExpanded = expandedSteps.has(key);
                      const isError = result.method === "Error";

                      return (
                        <div key={key} className={cn(
                          "glass-panel rounded-2xl overflow-hidden",
                          isError && "border-red-200 bg-red-50/30"
                        )}>
                          <button
                            onClick={() => toggleStep(key)}
                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
                          >
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center",
                                isError ? "bg-red-100" : "bg-primary/10"
                              )}>
                                {isError ? (
                                  <AlertTriangle className="w-4 h-4 text-red-500" />
                                ) : (
                                  <span className="text-sm font-bold text-primary">{result.step}</span>
                                )}
                              </div>
                              <div className="text-left">
                                <div className={cn(
                                  "font-semibold text-sm",
                                  isError ? "text-red-700" : "text-stone-700"
                                )}>
                                  {result.stepName || ["데이터 수집", "초기 분석", "심층 추론", "결론 도출"][result.step - 1] || `단계 ${result.step}`}
                                </div>
                                <div className="text-[10px] text-stone-400">{result.method}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {result.inputTokens && result.outputTokens && (
                                <span className="text-[10px] text-stone-400 bg-stone-100 px-2 py-0.5 rounded">
                                  {result.inputTokens + result.outputTokens} 토큰
                                </span>
                              )}
                              <span className="text-[10px] text-stone-400">
                                {new Date(result.timestamp).toLocaleTimeString("ko-KR")}
                              </span>
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-stone-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-stone-400" />
                              )}
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 border-t border-stone-100">
                              <div className="pt-4 prose prose-sm prose-stone max-w-none">
                                <div
                                  className={cn(
                                    "text-sm whitespace-pre-wrap",
                                    isError ? "text-red-600" : "text-stone-600"
                                  )}
                                  dangerouslySetInnerHTML={{
                                    __html: result.content
                                      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                                      .replace(/##\s+(.*?)(\n|$)/g, "<h3 class='text-base font-semibold mt-4 mb-2'>$1</h3>")
                                      .replace(/\n/g, "<br/>"),
                                  }}
                                />
                              </div>
                              {result.sources && result.sources.length > 0 && (
                                <div className="mt-4 pt-3 border-t border-stone-100">
                                  <div className="text-xs font-semibold text-stone-500 mb-2">참조 출처</div>
                                  <div className="flex flex-wrap gap-1">
                                    {result.sources.map((src, i) => (
                                      <span key={i} className="text-[10px] bg-stone-100 text-stone-600 px-2 py-1 rounded">
                                        {src}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center">
                    <Microscope className="w-12 h-12 text-stone-300 mb-4" />
                    <p className="font-semibold text-stone-500">분석 대기 중</p>
                    <p className="text-sm text-stone-400 mt-1 text-center">
                      '심층 분석 시작' 버튼을 클릭하여<br />
                      선택한 이슈들을 분석하세요.
                    </p>
                  </div>
                )}

                {/* 내보내기 버튼 */}
                {analysisResults[selectedIssueId]?.length > 0 && (
                  <div className="flex items-center justify-end gap-2">
                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-stone-100 text-stone-600 hover:bg-stone-200">
                      <Download className="w-4 h-4" />
                      보고서 내보내기
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
