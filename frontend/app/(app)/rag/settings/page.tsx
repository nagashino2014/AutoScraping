"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save, RotateCcw, Check, AlertCircle, RefreshCw, Info,
  Key, Bot, Search, Lightbulb, FileText, Settings2,
  Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  ChevronDown, HelpCircle, DollarSign, Gauge,
  Sliders, Brain, MessageSquare, Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// 타입 정의
// ============================================================

type LLMProvider = "openai" | "anthropic" | "google";
type LLMModel = string;
type TabId = "llm" | "vectorSearch" | "discovery" | "analysis" | "prompts" | "system";

interface APIKeyStatus {
  openai: "configured" | "not_configured";
  anthropic: "configured" | "not_configured";
  google: "configured" | "not_configured";
}

interface LLMSettings {
  apiKeys: {
    openai: string;
    anthropic: string;
    google: string;
  };
  apiKeyStatus?: APIKeyStatus;
  models: {
    discovery: LLMModel;
    analysis: LLMModel;
    report: LLMModel;
  };
  parameters: {
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
  };
  costManagement: {
    monthlyBudget: number;
    budgetAlertThreshold: number;
    blockOnBudgetExceed: boolean;
  };
}

interface VectorSearchSettings {
  basic: {
    topK: number;
    similarityThreshold: number;
    searchType: string;
  };
  mmr: {
    diversity: number;
  };
  hybrid: {
    alpha: number;
    keywordBoost: boolean;
  };
  filtering: {
    byDate: boolean;
    byOrg: boolean;
    byDocType: boolean;
  };
  reranking: {
    enabled: boolean;
    model: string;
    topN: number;
  };
}

interface DiscoverySettings {
  clustering: {
    algorithm: string;
    numClusters: number;
    minClusterSize: number;
    distanceMetric: string;
  };
  issueExtraction: {
    minIssues: number;
    maxIssues: number;
    minScoreThreshold: number;
  };
  scoreWeights: {
    legalMandatory: number;
    novelty: number;
    impact: number;
    international: number;
  };
  keywordBoosting: {
    keywords: string[];
    boostFactor: number;
  };
}

interface AnalysisSettings {
  steps: {
    factCheck: boolean;
    trendAnalysis: boolean;
    impactAssessment: boolean;
    responseStrategy: boolean;
  };
  depth: {
    level: string;
    includeHistoricalData: boolean;
    historicalLookbackMonths: number;
  };
  output: {
    format: string;
    includeTables: boolean;
    includeSources: boolean;
    maxSourcesPerStep: number;
  };
  chainOfThought: {
    enabled: boolean;
    showReasoning: boolean;
  };
}

interface PromptSettings {
  systemPrompts: {
    discovery: string;
    analysis: string;
    report: string;
  };
  analysisPrompts: {
    factCheck: string;
    trendAnalysis: string;
    impactAssessment: string;
    responseStrategy: string;
  };
}

interface SystemSettings {
  caching: {
    enableQueryCache: boolean;
    cacheTTLHours: number;
    enableEmbeddingCache: boolean;
  };
  rateLimiting: {
    maxRequestsPerMinute: number;
    requestDelayMs: number;
  };
  retry: {
    maxRetries: number;
    retryDelayMs: number;
    exponentialBackoff: boolean;
  };
  timeout: {
    requestTimeoutSec: number;
    analysisTimeoutSec: number;
  };
  logging: {
    enableDebugLogging: boolean;
    logPrompts: boolean;
    logResponses: boolean;
  };
  dataManagement: {
    autoCleanupDays: number;
    maxStoredSessions: number;
  };
}

interface RAGSettings {
  llm: LLMSettings;
  vectorSearch: VectorSearchSettings;
  discovery: DiscoverySettings;
  analysis: AnalysisSettings;
  prompts: PromptSettings;
  system: SystemSettings;
  updatedAt: string;
}

interface APIUsage {
  month: string;
  totalCost: number;
  budget: number;
  usagePercentage: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  isNearBudget: boolean;
  isOverBudget: boolean;
}

// ============================================================
// 모델 정보
// ============================================================

const MODEL_INFO: Record<string, {
  provider: LLMProvider;
  displayName: string;
  inputCost: number;
  outputCost: number;
  description: string;
}> = {
  "gpt-5-mini": { provider: "openai", displayName: "GPT-5 mini", inputCost: 0.25, outputCost: 2.00, description: "가장 저렴, 대량 처리에 적합" },
  "gpt-5.2": { provider: "openai", displayName: "GPT-5.2", inputCost: 1.75, outputCost: 14.00, description: "플래그십 기본 모델" },
  "gpt-5.2-pro": { provider: "openai", displayName: "GPT-5.2 pro", inputCost: 21.00, outputCost: 168.00, description: "최고 성능, 복잡한 추론" },
  "claude-haiku-4.5": { provider: "anthropic", displayName: "Claude Haiku 4.5", inputCost: 1.00, outputCost: 5.00, description: "빠른 응답, 경량 작업" },
  "claude-sonnet-4.5": { provider: "anthropic", displayName: "Claude Sonnet 4.5", inputCost: 3.00, outputCost: 15.00, description: "균형 잡힌 성능" },
  "claude-opus-4.5": { provider: "anthropic", displayName: "Claude Opus 4.5", inputCost: 5.00, outputCost: 25.00, description: "최고 품질 분석" },
  "gemini-3-flash": { provider: "google", displayName: "Gemini 3 Flash", inputCost: 0.50, outputCost: 2.00, description: "빠른 속도, 합리적 가격" },
  "gemini-3-pro": { provider: "google", displayName: "Gemini 3 Pro", inputCost: 2.00, outputCost: 12.00, description: "고성능 멀티모달" },
};

// ============================================================
// 탭 정보
// ============================================================

const TABS: { id: TabId; label: string; icon: typeof Bot }[] = [
  { id: "llm", label: "LLM 모델", icon: Bot },
  { id: "vectorSearch", label: "벡터 검색", icon: Search },
  { id: "discovery", label: "이슈 발굴", icon: Lightbulb },
  { id: "analysis", label: "심층 분석", icon: Brain },
  { id: "prompts", label: "프롬프트", icon: MessageSquare },
  { id: "system", label: "시스템", icon: Settings2 },
];

// ============================================================
// 메인 컴포넌트
// ============================================================

export default function RAGSettingsPage() {
  const [settings, setSettings] = useState<RAGSettings | null>(null);
  const [usage, setUsage] = useState<APIUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("llm");
  
  // API 키 관련 상태
  const [showApiKeys, setShowApiKeys] = useState<Record<LLMProvider, boolean>>({
    openai: false,
    anthropic: false,
    google: false,
  });
  const [validatingKey, setValidatingKey] = useState<LLMProvider | null>(null);
  const [keyValidation, setKeyValidation] = useState<Record<LLMProvider, { valid: boolean; error?: string } | null>>({
    openai: null,
    anthropic: null,
    google: null,
  });
  const [tempApiKeys, setTempApiKeys] = useState<Record<LLMProvider, string>>({
    openai: "",
    anthropic: "",
    google: "",
  });

  // 설정 로드
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/rag/settings");
      const data = await res.json();
      if (!data.error) {
        setSettings(data);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, []);

  // 사용량 로드
  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/rag/settings/usage");
      const data = await res.json();
      if (!data.error) {
        setUsage(data);
      }
    } catch (error) {
      console.error("Failed to load usage:", error);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadSettings(), loadUsage()]).finally(() => setLoading(false));
  }, [loadSettings, loadUsage]);

  // 저장
  const save = async () => {
    if (!settings) return;
    
    setSaving(true);
    setMsg(null);
    
    try {
      // tempApiKeys에서 실제 값이 있는 것만 포함
      const apiKeysToSave: Record<string, string> = {};
      if (tempApiKeys.openai && !tempApiKeys.openai.includes("...")) {
        apiKeysToSave.openai = tempApiKeys.openai;
      }
      if (tempApiKeys.anthropic && !tempApiKeys.anthropic.includes("...")) {
        apiKeysToSave.anthropic = tempApiKeys.anthropic;
      }
      if (tempApiKeys.google && !tempApiKeys.google.includes("...")) {
        apiKeysToSave.google = tempApiKeys.google;
      }
      
      const toSave = {
        ...settings,
        llm: {
          ...settings.llm,
          apiKeys: {
            ...settings.llm.apiKeys,
            ...apiKeysToSave,
          },
        },
      };
      
      const res = await fetch("/api/rag/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      
      const data = await res.json();
      
      if (data.ok) {
        setSettings(data.settings);
        setMsg({ type: "ok", text: "설정이 저장되었습니다." });
        // temp 키 초기화
        setTempApiKeys({ openai: "", anthropic: "", google: "" });
      } else {
        setMsg({ type: "err", text: data.error || "저장에 실패했습니다." });
      }
    } catch (error: any) {
      setMsg({ type: "err", text: error.message || "저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  // 초기화
  const reset = async () => {
    if (!confirm("모든 RAG 설정을 초기화하시겠습니까?")) return;
    
    setSaving(true);
    setMsg(null);
    
    try {
      const res = await fetch("/api/rag/settings", { method: "DELETE" });
      const data = await res.json();
      
      if (data.ok) {
        setSettings(data.settings);
        setMsg({ type: "ok", text: "설정이 초기화되었습니다." });
        setTempApiKeys({ openai: "", anthropic: "", google: "" });
      } else {
        setMsg({ type: "err", text: data.error || "초기화에 실패했습니다." });
      }
    } catch (error: any) {
      setMsg({ type: "err", text: error.message || "초기화에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  // API 키 검증
  const validateKey = async (provider: LLMProvider) => {
    const apiKey = tempApiKeys[provider];
    if (!apiKey) {
      setKeyValidation((prev) => ({
        ...prev,
        [provider]: { valid: false, error: "API 키를 입력해주세요." },
      }));
      return;
    }
    
    setValidatingKey(provider);
    setKeyValidation((prev) => ({ ...prev, [provider]: null }));
    
    try {
      const res = await fetch("/api/rag/settings/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, saveIfValid: true }),
      });
      
      const data = await res.json();
      
      setKeyValidation((prev) => ({
        ...prev,
        [provider]: { valid: data.valid, error: data.error },
      }));
      
      if (data.valid && data.saved) {
        // 설정 다시 로드
        await loadSettings();
        setMsg({ type: "ok", text: `${provider.toUpperCase()} API 키가 저장되었습니다.` });
      }
    } catch (error: any) {
      setKeyValidation((prev) => ({
        ...prev,
        [provider]: { valid: false, error: error.message },
      }));
    } finally {
      setValidatingKey(null);
    }
  };

  // 설정 업데이트 헬퍼
  const updateLLM = (field: string, value: any) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      llm: { ...prev!.llm, [field]: value },
    }));
  };

  const updateLLMModels = (field: string, value: string) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      llm: { ...prev!.llm, models: { ...prev!.llm.models, [field]: value } },
    }));
  };

  const updateLLMParams = (field: string, value: number) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      llm: { ...prev!.llm, parameters: { ...prev!.llm.parameters, [field]: value } },
    }));
  };

  const updateLLMCost = (field: string, value: number | boolean) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      llm: { ...prev!.llm, costManagement: { ...prev!.llm.costManagement, [field]: value } },
    }));
  };

  const updateVectorSearch = (category: string, field: string, value: any) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      vectorSearch: {
        ...prev!.vectorSearch,
        [category]: { ...(prev!.vectorSearch as any)[category], [field]: value },
      },
    }));
  };

  const updateDiscovery = (category: string, field: string, value: any) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      discovery: {
        ...prev!.discovery,
        [category]: { ...(prev!.discovery as any)[category], [field]: value },
      },
    }));
  };

  const updateAnalysis = (category: string, field: string, value: any) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      analysis: {
        ...prev!.analysis,
        [category]: { ...(prev!.analysis as any)[category], [field]: value },
      },
    }));
  };

  const updateSystem = (category: string, field: string, value: any) => {
    if (!settings) return;
    setSettings((prev) => ({
      ...prev!,
      system: {
        ...prev!.system,
        [category]: { ...(prev!.system as any)[category], [field]: value },
      },
    }));
  };

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-3xl flex items-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>로딩 중...</span>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="glass-panel p-6 rounded-3xl">
        <div className="text-red-600">설정을 불러올 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">RAG 설정</h1>
            <p className="text-xs text-stone-500 mt-0.5">
              RAG 시스템의 LLM, 검색, 분석 관련 설정을 관리합니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={reset}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 hover:bg-stone-100 disabled:opacity-50 flex items-center gap-1"
            >
              <RotateCcw className="w-4 h-4" />
              초기화
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              저장
            </button>
          </div>
        </div>
        {msg && (
          <div className={cn(
            "mt-4 px-4 py-2 rounded-xl flex items-center gap-2 text-sm",
            msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          )}>
            {msg.type === "ok" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {msg.text}
          </div>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div className="glass-panel p-2 rounded-2xl">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all",
                activeTab === tab.id
                  ? "bg-primary text-white shadow-lg shadow-primary/20"
                  : "text-stone-600 hover:bg-white/50"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 컨텐츠 */}
      <div className="glass-panel p-6 rounded-3xl">
        {/* LLM 모델 설정 */}
        {activeTab === "llm" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              {/* API 키 관리 */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-stone-700 font-semibold">
                  <Key className="w-4 h-4 text-primary" />
                  API 키 관리
                </div>
                
                {/* OpenAI */}
                <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-stone-700">OpenAI</span>
                    {settings.llm.apiKeyStatus?.openai === "configured" ? (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        설정됨
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-stone-400">
                        <XCircle className="w-3.5 h-3.5" />
                        미설정
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showApiKeys.openai ? "text" : "password"}
                        value={tempApiKeys.openai || settings.llm.apiKeys.openai}
                        onChange={(e) => setTempApiKeys((prev) => ({ ...prev, openai: e.target.value }))}
                        placeholder="sk-..."
                        className="input-field text-sm pr-10"
                      />
                      <button
                        onClick={() => setShowApiKeys((prev) => ({ ...prev, openai: !prev.openai }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600"
                      >
                        {showApiKeys.openai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      onClick={() => validateKey("openai")}
                      disabled={validatingKey === "openai"}
                      className="px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold disabled:opacity-50"
                    >
                      {validatingKey === "openai" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "검증"
                      )}
                    </button>
                  </div>
                  {keyValidation.openai && (
                    <div className={cn(
                      "text-xs",
                      keyValidation.openai.valid ? "text-green-600" : "text-red-600"
                    )}>
                      {keyValidation.openai.valid ? "✓ 유효한 API 키입니다." : keyValidation.openai.error}
                    </div>
                  )}
                </div>

                {/* Anthropic */}
                <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-stone-700">Anthropic</span>
                    {settings.llm.apiKeyStatus?.anthropic === "configured" ? (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        설정됨
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-stone-400">
                        <XCircle className="w-3.5 h-3.5" />
                        미설정
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showApiKeys.anthropic ? "text" : "password"}
                        value={tempApiKeys.anthropic || settings.llm.apiKeys.anthropic}
                        onChange={(e) => setTempApiKeys((prev) => ({ ...prev, anthropic: e.target.value }))}
                        placeholder="sk-ant-..."
                        className="input-field text-sm pr-10"
                      />
                      <button
                        onClick={() => setShowApiKeys((prev) => ({ ...prev, anthropic: !prev.anthropic }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600"
                      >
                        {showApiKeys.anthropic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      onClick={() => validateKey("anthropic")}
                      disabled={validatingKey === "anthropic"}
                      className="px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold disabled:opacity-50"
                    >
                      {validatingKey === "anthropic" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "검증"
                      )}
                    </button>
                  </div>
                  {keyValidation.anthropic && (
                    <div className={cn(
                      "text-xs",
                      keyValidation.anthropic.valid ? "text-green-600" : "text-red-600"
                    )}>
                      {keyValidation.anthropic.valid ? "✓ 유효한 API 키입니다." : keyValidation.anthropic.error}
                    </div>
                  )}
                </div>

                {/* Google */}
                <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-stone-700">Google</span>
                    {settings.llm.apiKeyStatus?.google === "configured" ? (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        설정됨
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-stone-400">
                        <XCircle className="w-3.5 h-3.5" />
                        미설정
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showApiKeys.google ? "text" : "password"}
                        value={tempApiKeys.google || settings.llm.apiKeys.google}
                        onChange={(e) => setTempApiKeys((prev) => ({ ...prev, google: e.target.value }))}
                        placeholder="AIzaSy..."
                        className="input-field text-sm pr-10"
                      />
                      <button
                        onClick={() => setShowApiKeys((prev) => ({ ...prev, google: !prev.google }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600"
                      >
                        {showApiKeys.google ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      onClick={() => validateKey("google")}
                      disabled={validatingKey === "google"}
                      className="px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold disabled:opacity-50"
                    >
                      {validatingKey === "google" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "검증"
                      )}
                    </button>
                  </div>
                  {keyValidation.google && (
                    <div className={cn(
                      "text-xs",
                      keyValidation.google.valid ? "text-green-600" : "text-red-600"
                    )}>
                      {keyValidation.google.valid ? "✓ 유효한 API 키입니다." : keyValidation.google.error}
                    </div>
                  )}
                </div>
              </div>

              {/* 기본 모델 선택 */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-stone-700 font-semibold">
                  <Bot className="w-4 h-4 text-primary" />
                  기본 모델 선택
                </div>

                {/* 이슈 발굴용 */}
                <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                  <label className="text-sm font-semibold text-stone-700">이슈 발굴용</label>
                  <select
                    value={settings.llm.models.discovery}
                    onChange={(e) => updateLLMModels("discovery", e.target.value)}
                    className="input-field text-sm"
                  >
                    {Object.entries(MODEL_INFO).map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.displayName} - ${info.inputCost}/${info.outputCost} (in/out)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-stone-500">
                    💡 {MODEL_INFO[settings.llm.models.discovery]?.description}
                  </p>
                </div>

                {/* 심층 분석용 */}
                <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                  <label className="text-sm font-semibold text-stone-700">심층 분석용</label>
                  <select
                    value={settings.llm.models.analysis}
                    onChange={(e) => updateLLMModels("analysis", e.target.value)}
                    className="input-field text-sm"
                  >
                    {Object.entries(MODEL_INFO).map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.displayName} - ${info.inputCost}/${info.outputCost} (in/out)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-stone-500">
                    💡 {MODEL_INFO[settings.llm.models.analysis]?.description}
                  </p>
                </div>

                {/* 보고서 생성용 */}
                <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                  <label className="text-sm font-semibold text-stone-700">보고서 생성용</label>
                  <select
                    value={settings.llm.models.report}
                    onChange={(e) => updateLLMModels("report", e.target.value)}
                    className="input-field text-sm"
                  >
                    {Object.entries(MODEL_INFO).map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.displayName} - ${info.inputCost}/${info.outputCost} (in/out)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-stone-500">
                    💡 {MODEL_INFO[settings.llm.models.report]?.description}
                  </p>
                </div>
              </div>
            </div>

            {/* 모델 파라미터 & 비용 관리 */}
            <div className="grid grid-cols-2 gap-6">
              {/* 모델 파라미터 */}
              <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
                <div className="flex items-center gap-2 text-stone-700 font-semibold">
                  <Sliders className="w-4 h-4 text-primary" />
                  모델 파라미터
                </div>
                
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-600">Temperature</span>
                      <span className="font-mono text-stone-700">{settings.llm.parameters.temperature}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={settings.llm.parameters.temperature}
                      onChange={(e) => updateLLMParams("temperature", parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-[10px] text-stone-400">낮을수록 일관된 출력, 높을수록 창의적</p>
                  </div>
                  
                  <div>
                    <label className="text-xs text-stone-600">Max Tokens (출력)</label>
                    <input
                      type="number"
                      min={256}
                      max={16384}
                      value={settings.llm.parameters.maxTokens}
                      onChange={(e) => updateLLMParams("maxTokens", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-600">Top P</span>
                      <span className="font-mono text-stone-700">{settings.llm.parameters.topP}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.llm.parameters.topP}
                      onChange={(e) => updateLLMParams("topP", parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              {/* 비용 관리 */}
              <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
                <div className="flex items-center gap-2 text-stone-700 font-semibold">
                  <DollarSign className="w-4 h-4 text-primary" />
                  비용 관리
                </div>

                {/* 현재 사용량 */}
                {usage && (
                  <div className="p-3 rounded-lg bg-white border border-stone-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-stone-500">현재 월 사용량</span>
                      <span className={cn(
                        "text-xs font-semibold",
                        usage.isOverBudget ? "text-red-600" : usage.isNearBudget ? "text-amber-600" : "text-green-600"
                      )}>
                        ${usage.totalCost.toFixed(2)} / ${usage.budget}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all",
                          usage.isOverBudget ? "bg-red-500" : usage.isNearBudget ? "bg-amber-500" : "bg-green-500"
                        )}
                        style={{ width: `${Math.min(usage.usagePercentage, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1.5 text-[10px] text-stone-400">
                      <span>{usage.requests}회 요청</span>
                      <span>{(usage.inputTokens / 1000).toFixed(1)}K 입력 / {(usage.outputTokens / 1000).toFixed(1)}K 출력</span>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-stone-600">월간 예산 한도 ($)</label>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={settings.llm.costManagement.monthlyBudget}
                      onChange={(e) => updateLLMCost("monthlyBudget", parseFloat(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-600">예산 알림 임계값</span>
                      <span className="font-mono text-stone-700">{Math.round(settings.llm.costManagement.budgetAlertThreshold * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={0.95}
                      step={0.05}
                      value={settings.llm.costManagement.budgetAlertThreshold}
                      onChange={(e) => updateLLMCost("budgetAlertThreshold", parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                  
                  <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.llm.costManagement.blockOnBudgetExceed}
                      onChange={(e) => updateLLMCost("blockOnBudgetExceed", e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    예산 초과 시 API 호출 차단
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 벡터 검색 설정 */}
        {activeTab === "vectorSearch" && (
          <div className="grid grid-cols-2 gap-6">
            {/* 기본 검색 설정 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Search className="w-4 h-4 text-primary" />
                기본 검색 설정
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-600">검색 결과 개수 (Top K)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.vectorSearch.basic.topK}
                    onChange={(e) => updateVectorSearch("basic", "topK", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
                
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">유사도 임계값</span>
                    <span className="font-mono text-stone-700">{settings.vectorSearch.basic.similarityThreshold}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.vectorSearch.basic.similarityThreshold}
                    onChange={(e) => updateVectorSearch("basic", "similarityThreshold", parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-stone-600">검색 유형</label>
                  <select
                    value={settings.vectorSearch.basic.searchType}
                    onChange={(e) => updateVectorSearch("basic", "searchType", e.target.value)}
                    className="input-field text-sm mt-1"
                  >
                    <option value="similarity">Similarity (유사도 기반)</option>
                    <option value="mmr">MMR (다양성 고려)</option>
                    <option value="hybrid">Hybrid (벡터+키워드)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* MMR & 하이브리드 설정 */}
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-3">
                <div className="flex items-center gap-2 text-stone-700 font-semibold text-sm">
                  <Gauge className="w-4 h-4 text-purple-500" />
                  MMR 설정 (다양성)
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">결과 다양성</span>
                    <span className="font-mono text-stone-700">{settings.vectorSearch.mmr.diversity}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={settings.vectorSearch.mmr.diversity}
                    onChange={(e) => updateVectorSearch("mmr", "diversity", parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-[10px] text-stone-400">0=유사도 우선, 1=다양성 우선</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-3">
                <div className="flex items-center gap-2 text-stone-700 font-semibold text-sm">
                  <Database className="w-4 h-4 text-blue-500" />
                  하이브리드 검색
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">벡터/키워드 비중 (Alpha)</span>
                    <span className="font-mono text-stone-700">{settings.vectorSearch.hybrid.alpha}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={settings.vectorSearch.hybrid.alpha}
                    onChange={(e) => updateVectorSearch("hybrid", "alpha", parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-[10px] text-stone-400">0=키워드만, 1=벡터만</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.vectorSearch.hybrid.keywordBoost}
                    onChange={(e) => updateVectorSearch("hybrid", "keywordBoost", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  키워드 매칭 가중치 부여
                </label>
              </div>
            </div>

            {/* 필터링 옵션 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-3">
              <div className="flex items-center gap-2 text-stone-700 font-semibold text-sm">
                <Sliders className="w-4 h-4 text-amber-500" />
                메타데이터 필터링
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.vectorSearch.filtering.byDate}
                    onChange={(e) => updateVectorSearch("filtering", "byDate", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  날짜 필터 활성화
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.vectorSearch.filtering.byOrg}
                    onChange={(e) => updateVectorSearch("filtering", "byOrg", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  기관 필터 활성화
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.vectorSearch.filtering.byDocType}
                    onChange={(e) => updateVectorSearch("filtering", "byDocType", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  문서 유형 필터 활성화
                </label>
              </div>
            </div>

            {/* Reranking */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-3">
              <div className="flex items-center gap-2 text-stone-700 font-semibold text-sm">
                <Lightbulb className="w-4 h-4 text-green-500" />
                Reranking (재정렬)
              </div>
              <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.vectorSearch.reranking.enabled}
                  onChange={(e) => updateVectorSearch("reranking", "enabled", e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                리랭킹 활성화
              </label>
              {settings.vectorSearch.reranking.enabled && (
                <div className="space-y-2 mt-2">
                  <div>
                    <label className="text-xs text-stone-600">리랭킹 모델</label>
                    <select
                      value={settings.vectorSearch.reranking.model}
                      onChange={(e) => updateVectorSearch("reranking", "model", e.target.value)}
                      className="input-field text-sm mt-1"
                    >
                      <option value="cohere-rerank-v3">Cohere Rerank v3</option>
                      <option value="bge-reranker">BGE Reranker</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-stone-600">최종 결과 수</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={settings.vectorSearch.reranking.topN}
                      onChange={(e) => updateVectorSearch("reranking", "topN", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 이슈 발굴 설정 */}
        {activeTab === "discovery" && (
          <div className="grid grid-cols-2 gap-6">
            {/* 클러스터링 설정 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Lightbulb className="w-4 h-4 text-primary" />
                클러스터링 설정
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-600">클러스터링 알고리즘</label>
                  <select
                    value={settings.discovery.clustering.algorithm}
                    onChange={(e) => updateDiscovery("clustering", "algorithm", e.target.value)}
                    className="input-field text-sm mt-1"
                  >
                    <option value="kmeans">K-Means</option>
                    <option value="hdbscan">HDBSCAN</option>
                    <option value="bertopic">BERTopic</option>
                  </select>
                </div>
                
                <div>
                  <label className="text-xs text-stone-600">클러스터 수 (K-Means)</label>
                  <input
                    type="number"
                    min={3}
                    max={50}
                    value={settings.discovery.clustering.numClusters}
                    onChange={(e) => updateDiscovery("clustering", "numClusters", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-stone-600">최소 클러스터 크기</label>
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={settings.discovery.clustering.minClusterSize}
                    onChange={(e) => updateDiscovery("clustering", "minClusterSize", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
              </div>
            </div>

            {/* 이슈 추출 설정 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <FileText className="w-4 h-4 text-primary" />
                이슈 추출 설정
              </div>
              
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-stone-600">최소 이슈 수</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={settings.discovery.issueExtraction.minIssues}
                      onChange={(e) => updateDiscovery("issueExtraction", "minIssues", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-600">최대 이슈 수</label>
                    <input
                      type="number"
                      min={5}
                      max={30}
                      value={settings.discovery.issueExtraction.maxIssues}
                      onChange={(e) => updateDiscovery("issueExtraction", "maxIssues", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">최소 중요도 점수</span>
                    <span className="font-mono text-stone-700">{settings.discovery.issueExtraction.minScoreThreshold}</span>
                  </div>
                  <input
                    type="range"
                    min={0.3}
                    max={0.9}
                    step={0.05}
                    value={settings.discovery.issueExtraction.minScoreThreshold}
                    onChange={(e) => updateDiscovery("issueExtraction", "minScoreThreshold", parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            {/* 중요도 가중치 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4 col-span-2">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Gauge className="w-4 h-4 text-primary" />
                중요도 가중치 (합계: 100%)
              </div>
              
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">법적 강제성</span>
                    <span className="font-mono text-stone-700">{Math.round(settings.discovery.scoreWeights.legalMandatory * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.discovery.scoreWeights.legalMandatory}
                    onChange={(e) => updateDiscovery("scoreWeights", "legalMandatory", parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">신규성</span>
                    <span className="font-mono text-stone-700">{Math.round(settings.discovery.scoreWeights.novelty * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.discovery.scoreWeights.novelty}
                    onChange={(e) => updateDiscovery("scoreWeights", "novelty", parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">파급력</span>
                    <span className="font-mono text-stone-700">{Math.round(settings.discovery.scoreWeights.impact * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.discovery.scoreWeights.impact}
                    onChange={(e) => updateDiscovery("scoreWeights", "impact", parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600">국제 동향</span>
                    <span className="font-mono text-stone-700">{Math.round(settings.discovery.scoreWeights.international * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.discovery.scoreWeights.international}
                    onChange={(e) => updateDiscovery("scoreWeights", "international", parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 심층 분석 설정 */}
        {activeTab === "analysis" && (
          <div className="grid grid-cols-2 gap-6">
            {/* 분석 단계 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Brain className="w-4 h-4 text-primary" />
                분석 단계 활성화
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.steps.factCheck}
                    onChange={(e) => updateAnalysis("steps", "factCheck", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  Step 1: 사실 확인 (Fact Check)
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.steps.trendAnalysis}
                    onChange={(e) => updateAnalysis("steps", "trendAnalysis", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  Step 2: 배경 분석 (Trend Analysis)
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.steps.impactAssessment}
                    onChange={(e) => updateAnalysis("steps", "impactAssessment", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  Step 3: 영향 분석 (Impact Assessment)
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.steps.responseStrategy}
                    onChange={(e) => updateAnalysis("steps", "responseStrategy", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  Step 4: 대응 전략 (Response Strategy)
                </label>
              </div>
            </div>

            {/* 분석 깊이 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Sliders className="w-4 h-4 text-primary" />
                분석 깊이
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-600">분석 수준</label>
                  <select
                    value={settings.analysis.depth.level}
                    onChange={(e) => updateAnalysis("depth", "level", e.target.value)}
                    className="input-field text-sm mt-1"
                  >
                    <option value="quick">Quick (빠른 분석)</option>
                    <option value="standard">Standard (표준)</option>
                    <option value="thorough">Thorough (심층)</option>
                  </select>
                </div>
                
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.depth.includeHistoricalData}
                    onChange={(e) => updateAnalysis("depth", "includeHistoricalData", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  과거 데이터 참조 포함
                </label>
                
                {settings.analysis.depth.includeHistoricalData && (
                  <div>
                    <label className="text-xs text-stone-600">과거 데이터 조회 기간 (월)</label>
                    <input
                      type="number"
                      min={1}
                      max={36}
                      value={settings.analysis.depth.historicalLookbackMonths}
                      onChange={(e) => updateAnalysis("depth", "historicalLookbackMonths", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 출력 형식 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <FileText className="w-4 h-4 text-primary" />
                출력 형식
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-600">출력 형식</label>
                  <select
                    value={settings.analysis.output.format}
                    onChange={(e) => updateAnalysis("output", "format", e.target.value)}
                    className="input-field text-sm mt-1"
                  >
                    <option value="structured">Structured (구조화)</option>
                    <option value="narrative">Narrative (서술형)</option>
                    <option value="bullet">Bullet (글머리 기호)</option>
                  </select>
                </div>
                
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.output.includeTables}
                    onChange={(e) => updateAnalysis("output", "includeTables", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  비교표 포함
                </label>
                
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.output.includeSources}
                    onChange={(e) => updateAnalysis("output", "includeSources", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  출처 인용 포함
                </label>
                
                {settings.analysis.output.includeSources && (
                  <div>
                    <label className="text-xs text-stone-600">단계당 최대 인용 출처 수</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.analysis.output.maxSourcesPerStep}
                      onChange={(e) => updateAnalysis("output", "maxSourcesPerStep", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Chain-of-Thought */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <MessageSquare className="w-4 h-4 text-primary" />
                Chain-of-Thought
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.analysis.chainOfThought.enabled}
                    onChange={(e) => updateAnalysis("chainOfThought", "enabled", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  CoT 프롬프팅 활성화
                </label>
                <p className="text-[10px] text-stone-500 ml-6">단계별 추론으로 분석 품질 향상</p>
                
                {settings.analysis.chainOfThought.enabled && (
                  <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer ml-6 mt-2">
                    <input
                      type="checkbox"
                      checked={settings.analysis.chainOfThought.showReasoning}
                      onChange={(e) => updateAnalysis("chainOfThought", "showReasoning", e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    추론 과정 표시
                  </label>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 프롬프트 설정 */}
        {activeTab === "prompts" && (
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200/60">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 mt-0.5" />
                <p className="text-xs text-amber-700">
                  프롬프트 템플릿에서 <code className="px-1 py-0.5 bg-amber-100 rounded">{"{issue_title}"}</code>, 
                  <code className="px-1 py-0.5 bg-amber-100 rounded">{"{context}"}</code> 등의 변수를 사용할 수 있습니다.
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {/* 이슈 발굴용 시스템 프롬프트 */}
              <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                <label className="text-sm font-semibold text-stone-700">이슈 발굴용 시스템 프롬프트</label>
                <textarea
                  value={settings.prompts.systemPrompts.discovery}
                  onChange={(e) => {
                    setSettings((prev) => ({
                      ...prev!,
                      prompts: {
                        ...prev!.prompts,
                        systemPrompts: {
                          ...prev!.prompts.systemPrompts,
                          discovery: e.target.value,
                        },
                      },
                    }));
                  }}
                  rows={4}
                  className="ui-textarea text-sm font-mono"
                />
              </div>

              {/* 심층 분석용 시스템 프롬프트 */}
              <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                <label className="text-sm font-semibold text-stone-700">심층 분석용 시스템 프롬프트</label>
                <textarea
                  value={settings.prompts.systemPrompts.analysis}
                  onChange={(e) => {
                    setSettings((prev) => ({
                      ...prev!,
                      prompts: {
                        ...prev!.prompts,
                        systemPrompts: {
                          ...prev!.prompts.systemPrompts,
                          analysis: e.target.value,
                        },
                      },
                    }));
                  }}
                  rows={4}
                  className="ui-textarea text-sm font-mono"
                />
              </div>

              {/* 보고서 생성용 시스템 프롬프트 */}
              <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-2">
                <label className="text-sm font-semibold text-stone-700">보고서 생성용 시스템 프롬프트</label>
                <textarea
                  value={settings.prompts.systemPrompts.report}
                  onChange={(e) => {
                    setSettings((prev) => ({
                      ...prev!,
                      prompts: {
                        ...prev!.prompts,
                        systemPrompts: {
                          ...prev!.prompts.systemPrompts,
                          report: e.target.value,
                        },
                      },
                    }));
                  }}
                  rows={4}
                  className="ui-textarea text-sm font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* 시스템 설정 */}
        {activeTab === "system" && (
          <div className="grid grid-cols-2 gap-6">
            {/* 캐싱 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Database className="w-4 h-4 text-primary" />
                캐싱
              </div>
              
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.system.caching.enableQueryCache}
                    onChange={(e) => updateSystem("caching", "enableQueryCache", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  쿼리 결과 캐싱
                </label>
                
                {settings.system.caching.enableQueryCache && (
                  <div className="ml-6">
                    <label className="text-xs text-stone-600">캐시 유효 기간 (시간)</label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={settings.system.caching.cacheTTLHours}
                      onChange={(e) => updateSystem("caching", "cacheTTLHours", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                )}
                
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.system.caching.enableEmbeddingCache}
                    onChange={(e) => updateSystem("caching", "enableEmbeddingCache", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  임베딩 캐싱
                </label>
              </div>
            </div>

            {/* Rate Limiting */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Gauge className="w-4 h-4 text-primary" />
                Rate Limiting
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-600">분당 최대 요청 수</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={settings.system.rateLimiting.maxRequestsPerMinute}
                    onChange={(e) => updateSystem("rateLimiting", "maxRequestsPerMinute", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-stone-600">요청 간 딜레이 (ms)</label>
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={100}
                    value={settings.system.rateLimiting.requestDelayMs}
                    onChange={(e) => updateSystem("rateLimiting", "requestDelayMs", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
              </div>
            </div>

            {/* 재시도 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <RefreshCw className="w-4 h-4 text-primary" />
                재시도 설정
              </div>
              
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-stone-600">최대 재시도 횟수</label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={settings.system.retry.maxRetries}
                      onChange={(e) => updateSystem("retry", "maxRetries", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-600">재시도 대기 (ms)</label>
                    <input
                      type="number"
                      min={100}
                      max={10000}
                      step={100}
                      value={settings.system.retry.retryDelayMs}
                      onChange={(e) => updateSystem("retry", "retryDelayMs", parseInt(e.target.value))}
                      className="input-field text-sm mt-1"
                    />
                  </div>
                </div>
                
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.system.retry.exponentialBackoff}
                    onChange={(e) => updateSystem("retry", "exponentialBackoff", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  Exponential Backoff 사용
                </label>
              </div>
            </div>

            {/* 타임아웃 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Settings2 className="w-4 h-4 text-primary" />
                타임아웃
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-600">요청 타임아웃 (초)</label>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={settings.system.timeout.requestTimeoutSec}
                    onChange={(e) => updateSystem("timeout", "requestTimeoutSec", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-stone-600">분석 타임아웃 (초)</label>
                  <input
                    type="number"
                    min={60}
                    max={600}
                    value={settings.system.timeout.analysisTimeoutSec}
                    onChange={(e) => updateSystem("timeout", "analysisTimeoutSec", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
              </div>
            </div>

            {/* 로깅 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <FileText className="w-4 h-4 text-primary" />
                로깅
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.system.logging.enableDebugLogging}
                    onChange={(e) => updateSystem("logging", "enableDebugLogging", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  디버그 로깅 활성화
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.system.logging.logPrompts}
                    onChange={(e) => updateSystem("logging", "logPrompts", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  프롬프트 로깅
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.system.logging.logResponses}
                    onChange={(e) => updateSystem("logging", "logResponses", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  응답 로깅
                </label>
              </div>
            </div>

            {/* 데이터 관리 */}
            <div className="p-4 rounded-xl bg-stone-50/80 border border-stone-200/60 space-y-4">
              <div className="flex items-center gap-2 text-stone-700 font-semibold">
                <Database className="w-4 h-4 text-primary" />
                데이터 관리
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-600">분석 결과 자동 정리 (일)</label>
                  <input
                    type="number"
                    min={7}
                    max={365}
                    value={settings.system.dataManagement.autoCleanupDays}
                    onChange={(e) => updateSystem("dataManagement", "autoCleanupDays", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-stone-600">최대 저장 세션 수</label>
                  <input
                    type="number"
                    min={10}
                    max={200}
                    value={settings.system.dataManagement.maxStoredSessions}
                    onChange={(e) => updateSystem("dataManagement", "maxStoredSessions", parseInt(e.target.value))}
                    className="input-field text-sm mt-1"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 도움말 */}
      <div className="glass-panel p-4 rounded-2xl flex items-start gap-3">
        <Info className="w-5 h-5 text-primary mt-0.5" />
        <div className="text-sm text-stone-600">
          <p className="font-semibold mb-1">설정 안내</p>
          <ul className="list-disc list-inside text-xs space-y-0.5">
            <li><b>LLM 모델</b>: API 키 설정 및 용도별 모델 선택, 비용 관리</li>
            <li><b>벡터 검색</b>: 유사도 검색, MMR, 하이브리드 검색 설정</li>
            <li><b>이슈 발굴</b>: 클러스터링 알고리즘, 중요도 가중치 설정</li>
            <li><b>심층 분석</b>: 4단계 분석 활성화, 출력 형식 설정</li>
            <li><b>프롬프트</b>: 시스템 프롬프트 및 분석 템플릿 커스터마이징</li>
            <li><b>시스템</b>: 캐싱, Rate Limiting, 재시도, 타임아웃 설정</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
