"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Play, Pause, RefreshCw, Loader2,
  CheckCircle2, AlertTriangle, FileText, Building2, Target,
  Microscope, Lightbulb, ChevronDown, ChevronUp, Clock,
  Download, Send, Edit3, Save, X, BarChart3, Zap,
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
}

interface AnalysisResult {
  issueId: string;
  step: number;
  content: string;
  method: string;
  timestamp: string;
}

interface DeepAnalysisSession {
  sessionId: string;
  issues: SelectedIssue[];
  results: Record<string, AnalysisResult[]>;
  status: "idle" | "running" | "completed" | "error";
  progress: number;
  currentIssue?: string;
  currentStep?: number;
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

  // 분석 시작 (모의)
  const runDeepAnalysis = async () => {
    if (selectedIssues.length === 0) return;

    setAnalyzing(true);
    setProgress(0);
    setAnalysisResults({});

    const steps = [
      { name: "데이터 수집", method: "Retrieval" },
      { name: "초기 분석", method: "Chain-of-Thought" },
      { name: "심층 추론", method: "Multi-step Reasoning" },
      { name: "결론 도출", method: "Synthesis" },
    ];

    const totalSteps = selectedIssues.length * steps.length;
    let completedSteps = 0;

    for (const issue of selectedIssues) {
      const results: AnalysisResult[] = [];

      for (let i = 0; i < Math.min(steps.length, analysisConfig.maxSteps); i++) {
        const step = steps[i];
        setCurrentStep(`${issue.title.slice(0, 20)}... - ${step.name}`);

        // 모의 딜레이
        await new Promise((resolve) => setTimeout(resolve, 1500));

        results.push({
          issueId: issue.id,
          step: i + 1,
          content: generateMockAnalysis(issue, step.name),
          method: step.method,
          timestamp: new Date().toISOString(),
        });

        completedSteps++;
        setProgress(Math.round((completedSteps / totalSteps) * 100));

        // 중간 결과 업데이트
        setAnalysisResults((prev) => ({
          ...prev,
          [issue.id]: [...results],
        }));
      }
    }

    setAnalyzing(false);
    setProgress(100);
    setCurrentStep("완료");
  };

  // 모의 분석 결과 생성
  const generateMockAnalysis = (issue: SelectedIssue, stepName: string): string => {
    const templates: Record<string, string> = {
      "데이터 수집": `**${issue.title}** 관련 ${issue.clusterSize}개 문서를 분석했습니다.\n\n주요 출처:\n${issue.sources.slice(0, 3).map((s) => `- ${s.orgName} / ${s.boardName}`).join("\n")}\n\n핵심 키워드: ${issue.keywords.slice(0, 5).join(", ")}`,
      "초기 분석": `**핵심 내용 분석**\n\n${issue.summary}\n\n이 이슈는 ${issue.score.total >= 0.7 ? "높은" : issue.score.total >= 0.5 ? "중간" : "낮은"} 중요도를 가지며, 관련 정책 변화에 대한 면밀한 모니터링이 필요합니다.`,
      "심층 추론": `**영향 분석**\n\n1. **산업 영향**: 해당 분야 기업들의 규제 대응 필요\n2. **시기**: 관련 법규 시행 일정 확인 필요\n3. **대응 방안**: 내부 프로세스 점검 및 준비 권고\n\n관련 문서 ${issue.clusterSize}개에서 일관된 패턴을 확인했습니다.`,
      "결론 도출": `**최종 요약 및 권고사항**\n\n본 이슈는 ${issue.sources[0]?.orgName || "관련 기관"}에서 발표한 정책과 관련되어 있습니다.\n\n**권고사항**:\n1. 관련 규정 변경사항 지속 모니터링\n2. 내부 담당 부서와 공유\n3. 필요시 전문가 자문 검토\n\n분석 신뢰도: ${Math.round(issue.score.total * 100)}%`,
    };
    return templates[stepName] || `${stepName} 분석 결과`;
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
                onClick={() => setAnalyzing(false)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium bg-red-500 text-white hover:bg-red-600"
              >
                <Pause className="w-4 h-4" />
                중지
              </button>
            ) : (
              <button
                onClick={runDeepAnalysis}
                disabled={selectedIssues.length === 0}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all",
                  selectedIssues.length > 0
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
              <span className="text-sm font-medium text-stone-700">{currentStep}</span>
              <span className="text-sm font-bold text-primary">{progress}%</span>
            </div>
            <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
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

                      return (
                        <div key={key} className="glass-panel rounded-2xl overflow-hidden">
                          <button
                            onClick={() => toggleStep(key)}
                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50/50"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <span className="text-sm font-bold text-primary">{result.step}</span>
                              </div>
                              <div className="text-left">
                                <div className="font-semibold text-stone-700 text-sm">
                                  {["데이터 수집", "초기 분석", "심층 추론", "결론 도출"][result.step - 1] || `단계 ${result.step}`}
                                </div>
                                <div className="text-[10px] text-stone-400">{result.method}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
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
                                  className="text-sm text-stone-600 whitespace-pre-wrap"
                                  dangerouslySetInnerHTML={{
                                    __html: result.content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                                  }}
                                />
                              </div>
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
