"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FileText,
  ChevronRight,
  ChevronDown,
  Search,
  Check,
  RefreshCw,
  Play,
  Eye,
  Settings,
  HelpCircle,
  Building2,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Table,
  SplitSquareHorizontal,
  Hash,
  ChevronUp,
  X,
  Cpu,
  Zap,
  Folder,
  Newspaper,
  ScrollText,
  Scale,
  BookOpen,
  FileSpreadsheet,
  Briefcase,
  TrendingUp,
  BarChart3,
  Building,
  HardDrive,
  Timer,
  Megaphone,
  Download,
  FileJson,
  FileType,
  Trash2,
  Database,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  ComposedChart,
} from "recharts";

// ============================================================================
// 타입 정의
// ============================================================================

type ChunkingStrategy = "recursive" | "sentence" | "semantic" | "markdown";
type EmbeddingModel = "openai-small" | "openai-large" | "ko-sroberta" | "bge-m3";
type TreeNodeType = "category" | "organization" | "board" | "date_folder";

interface ChunkingSettings {
  strategy: ChunkingStrategy;
  chunkSize: number;
  chunkOverlap: number;
  separators: string[];
  minChunkSize: number;
  maxChunkSize: number;
  tableChunking: {
    enabled: boolean;
    maxRowsPerChunk: number;
  };
}

interface EmbeddingSettings {
  model: EmbeddingModel;
  batchSize: number;
  concurrent: number;
  autoRetry: boolean;
}

interface TreeNodeStats {
  totalFiles: number;
  totalSize: number;
  chunkedFiles?: number;
  chunkingRate?: number;
}

interface TreeNode {
  id: string;
  type: TreeNodeType;
  name: string;
  logo?: string;
  docType?: string;
  orgType?: string;
  dateFolderPath?: string;
  children?: TreeNode[];
  isExpanded?: boolean;
  isChecked?: boolean;
  isIndeterminate?: boolean;
  stats?: TreeNodeStats;
}

interface ExtractedDocument {
  doc_id: string;
  org_id: string;
  board_id: string;
  org_name: string;
  board_name: string;
  source_file: string;
  file_path: string;
  file_size: number;
  date_folder: string;
  extracted_at?: string;
  token_count?: number;
}

interface ChunkingStats {
  totalDocuments: number;
  chunkedDocuments: number;
  pendingDocuments: number;
  failedDocuments: number;
  totalChunks: number;
  textChunks: number;
  tableChunks: number;
  totalTokens: number;
  embeddedChunks: number;
  chunkingRate: number;
  embeddingRate: number;
  // 추가 통계
  chunkingSuccessRate: number;
  embeddingSuccessRate: number;
  currentEmbeddingBatch: number;
  totalEmbeddedTokens: number;
  embeddingFailedChunks: number;
  estimatedCost: number;
}

interface SelectionSummary {
  totalFiles: number;
  totalSize: number;
  estimatedTokens: number;
  estimatedTime: number;
}

// 청킹 결과 타입
type ChunkingStatus = "pending" | "processing" | "success" | "failed";

interface ChunkingResult {
  doc_id: string;
  status: ChunkingStatus;
  chunks?: number;
  tokens?: number;
  error?: string;
}

interface ChunkItem {
  chunk_id: string;
  content: string;
  raw_content: string;
  token_count: number;
  metadata: {
    chunk_type: "text" | "table_full" | "table_segment";
    chunk_index: number;
    total_chunks: number;
    doc_id: string;
    org_id: string;
    board_id: string;
    source_file: string;
    table_id?: string;
    table_title?: string;
    headers?: string[];
  };
  created_at: string;
}

// ============================================================================
// 기본값
// ============================================================================

const DEFAULT_CHUNKING_SETTINGS: ChunkingSettings = {
  strategy: "recursive",
  chunkSize: 800,
  chunkOverlap: 150,
  separators: ["\n\n", "\n", ". ", " "],
  minChunkSize: 100,
  maxChunkSize: 2000,
  tableChunking: {
    enabled: true,
    maxRowsPerChunk: 10,
  },
};

const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
  model: "openai-small",
  batchSize: 100,
  concurrent: 5,
  autoRetry: true,
};

const STRATEGY_OPTIONS = [
  { value: "recursive", label: "RecursiveCharacter", desc: "의미 단위 유지 (권장)" },
  { value: "sentence", label: "Sentence", desc: "문장 단위" },
  { value: "semantic", label: "Semantic", desc: "의미 유사도 기반" },
  { value: "markdown", label: "MarkdownHeader", desc: "헤더 기반" },
];

const EMBEDDING_MODEL_OPTIONS = [
  { value: "openai-small", label: "text-embedding-3-small", provider: "OpenAI", dim: 1536, cost: "$0.02/1M" },
  { value: "openai-large", label: "text-embedding-3-large", provider: "OpenAI", dim: 3072, cost: "$0.13/1M" },
  { value: "ko-sroberta", label: "ko-sroberta-multitask", provider: "HuggingFace", dim: 768, cost: "무료" },
  { value: "bge-m3", label: "bge-m3", provider: "HuggingFace", dim: 1024, cost: "무료" },
];

// 문서 유형별 아이콘 함수
function getDocTypeIcon(docType?: string) {
  const t = (docType ?? "").trim();
  if (!t) return <FileText className="w-4 h-4 text-stone-500" />;
  if (t === "보도자료") return <Newspaper className="w-4 h-4 text-blue-700" />;
  if (t === "공지") return <Megaphone className="w-4 h-4 text-amber-700" />;
  if (t === "고시·훈령·예규") return <ScrollText className="w-4 h-4 text-emerald-700" />;
  if (t === "입법예고") return <Scale className="w-4 h-4 text-orange-700" />;
  if (t === "법령") return <Scale className="w-4 h-4 text-indigo-700" />;
  return <FileText className="w-4 h-4 text-stone-500" />;
}

// ============================================================================
// 트리뷰 노드 컴포넌트
// ============================================================================

function TreeNodeComponent({
  node,
  depth = 0,
  onToggleExpand,
  onToggleCheck,
}: {
  node: TreeNode;
  depth?: number;
  onToggleExpand: (id: string) => void;
  onToggleCheck: (id: string, nodeType: TreeNodeType, dateFolderPath?: string) => void;
}) {
  const paddingLeft = depth * 20;
  const hasChildren = node.children && node.children.length > 0;
  
  // 노드 타입별 아이콘
  const NodeIcon = () => {
    if (node.type === "category") {
      return <Folder className="w-4 h-4 text-amber-600" />;
    }
    if (node.type === "organization") {
      if (node.logo) {
        return (
          <Image
            src={node.logo}
            alt={node.name}
            width={20}
            height={20}
            className="w-5 h-5 rounded object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        );
      }
      return <Building2 className="w-4 h-4 text-stone-600" />;
    }
    if (node.type === "date_folder") {
      return <Clock className="w-4 h-4 text-blue-500" />;
    }
    // board 타입
    return getDocTypeIcon(node.docType);
  };
  
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-3 rounded-xl cursor-pointer transition-all duration-200",
          "hover:bg-white/50 hover:shadow-sm",
          node.isChecked && "bg-primary/10 border border-primary/20"
        )}
        style={{ paddingLeft: paddingLeft + 12 }}
      >
        {/* 확장/축소 버튼 */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="w-5 h-5 flex items-center justify-center text-stone-400 hover:text-stone-600 hover:bg-white/60 rounded transition-colors"
          >
            {node.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <div className="w-5" />
        )}

        {/* 체크박스 (글라스 스타일) - category 제외 */}
        {node.type !== "category" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck(node.id, node.type, node.dateFolderPath);
            }}
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shadow-sm",
              node.isChecked
                ? "bg-gradient-to-br from-primary to-primary/80 border-primary text-white shadow-primary/30"
                : node.isIndeterminate
                  ? "bg-gradient-to-br from-primary/50 to-primary/30 border-primary/50 text-white"
                  : "border-stone-300 bg-white/60 backdrop-blur-sm hover:border-primary/50 hover:bg-white/80"
            )}
          >
            {(node.isChecked || node.isIndeterminate) && <Check className="w-3 h-3" />}
          </button>
        )}

        {/* 아이콘 */}
        <div className="p-1 rounded-md bg-white/40 backdrop-blur-sm">
          <NodeIcon />
        </div>

        {/* 노드명 - 클릭 시 하위 노드 확장 또는 선택/해제 */}
        <span
          className="flex-1 text-sm font-medium text-stone-700 truncate hover:text-primary cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            // 하위 노드가 있으면 확장/축소, 없으면 선택/해제
            if (hasChildren) {
              onToggleExpand(node.id);
            } else if (node.type !== "category") {
              onToggleCheck(node.id, node.type, node.dateFolderPath);
            }
          }}
        >
          {node.name}
        </span>

        {/* 통계 배지 */}
        {node.stats && node.stats.totalFiles > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-white/50 backdrop-blur-sm text-xs text-stone-500">
            {node.stats.totalFiles}개
          </span>
        )}
      </div>

      {/* 자식 노드 */}
      {node.isExpanded && hasChildren && (
        <div className="relative">
          <div className="absolute left-[30px] top-0 bottom-2 w-px bg-gradient-to-b from-stone-200 to-transparent" />
          {node.children!.map((child) => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              depth={depth + 1}
              onToggleExpand={onToggleExpand}
              onToggleCheck={onToggleCheck}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 메인 컴포넌트
// ============================================================================

export default function ChunkingPage() {
  // 상태
  const [chunkingSettings, setChunkingSettings] = useState<ChunkingSettings>(DEFAULT_CHUNKING_SETTINGS);
  const [embeddingSettings, setEmbeddingSettings] = useState<EmbeddingSettings>(DEFAULT_EMBEDDING_SETTINGS);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [stats, setStats] = useState<ChunkingStats | null>(null);
  const [selectionSummary, setSelectionSummary] = useState<SelectionSummary>({
    totalFiles: 0,
    totalSize: 0,
    estimatedTokens: 0,
    estimatedTime: 0,
  });
  
  const [loading, setLoading] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  // 선택된 폴더 경로
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  
  // 미리보기
  const [previewDoc, setPreviewDoc] = useState<ExtractedDocument | null>(null);
  const [previewChunks, setPreviewChunks] = useState<ChunkItem[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  
  // 설정 패널 접기
  const [chunkingSettingsCollapsed, setChunkingSettingsCollapsed] = useState(false);
  const [embeddingSettingsCollapsed, setEmbeddingSettingsCollapsed] = useState(false);
  
  // 도움말 툴팁 상태
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  
  // 임베딩 관련 상태
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [embeddingProcessing, setEmbeddingProcessing] = useState(false);
  const [embeddingProgress, setEmbeddingProgress] = useState({ current: 0, total: 0 });
  const [savingEmbedding, setSavingEmbedding] = useState(false);
  
  // ChromaDB 상태
  const [chromaDbStatus, setChromaDbStatus] = useState<{
    connected: boolean;
    total_embeddings: number;
    loading: boolean;
  }>({ connected: false, total_embeddings: 0, loading: true });
  const [migrating, setMigrating] = useState(false);
  const [clearingEmbeddings, setClearingEmbeddings] = useState(false);
  
  // 임베딩 통계 (영구 저장)
  const [embeddingStats, setEmbeddingStats] = useState<{
    total_embeddings: number;
    total_failed: number;
    total_cost: number;
    total_tokens: number;
  }>({ total_embeddings: 0, total_failed: 0, total_cost: 0, total_tokens: 0 });
  
  // 현재 작업 비용 (세션 내 작업만)
  const [currentSessionCost, setCurrentSessionCost] = useState(0);
  
  // 비용 추이 모달
  const [showCostModal, setShowCostModal] = useState(false);
  
  // 내보내기 관련 상태
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");
  const [includeEmbeddings, setIncludeEmbeddings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPreview, setExportPreview] = useState<{
    totalChunks: number;
    textChunks: number;
    tableChunks: number;
    embeddedChunks: number;
    totalTokens: number;
    estimatedJsonSize: number;
    estimatedCsvSize: number;
    documents: number;
  } | null>(null);

  // 청킹 결과 상태
  const [chunkingResults, setChunkingResults] = useState<Map<string, ChunkingResult>>(new Map());
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed" | "pending">("all");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [showErrorTooltip, setShowErrorTooltip] = useState<string | null>(null);

  // ============================================================================
  // ChromaDB 값을 반영한 계산된 stats
  // ============================================================================
  
  // 청킹 진행률 상태 (실시간) - Ref로 SSE 이벤트에서 업데이트, State는 폴링으로 UI 업데이트
  const [chunkingProgress, setChunkingProgress] = useState(0);
  const [currentChunkingDoc, setCurrentChunkingDoc] = useState("");
  const [chunkingCompletedDocs, setChunkingCompletedDocs] = useState(0);
  const [chunkingTotalDocs, setChunkingTotalDocs] = useState(0);
  
  // Ref로 진행률 추적 (SSE 이벤트에서 빠르게 업데이트)
  const chunkingProgressRef = useRef(0);
  const chunkingCompletedDocsRef = useRef(0);
  const chunkingTotalDocsRef = useRef(0);
  const chunkingPollingRef = useRef<NodeJS.Timeout | null>(null);
  
  const computedStats = useMemo(() => {
    if (!stats) return null;
    
    // ChromaDB의 실제 임베딩 수를 반영
    const actualEmbeddedChunks = chromaDbStatus.connected 
      ? chromaDbStatus.total_embeddings 
      : stats.embeddedChunks;
    
    // 청킹 진행률 (진행 중일 때는 실시간 진행률 사용)
    const actualChunkingRate = processing 
      ? chunkingProgress 
      : stats.chunkingRate;
    
    // 청킹 중 문서 수 (진행 중일 때는 실시간 값 사용)
    const actualChunkedDocs = processing 
      ? chunkingCompletedDocs 
      : stats.chunkedDocuments;
    const actualTotalDocs = processing && chunkingTotalDocs > 0
      ? chunkingTotalDocs
      : stats.totalDocuments;
    
    // 임베딩 진행률 계산
    // 1. 진행 중일 때: 실시간 진행률 사용
    // 2. 진행 중이 아닐 때: ChromaDB 기반 계산
    let actualEmbeddingRate: number;
    let actualEmbeddedChunksDisplay: number;
    
    if (embeddingProcessing && embeddingProgress.total > 0) {
      actualEmbeddingRate = Math.round((embeddingProgress.current / embeddingProgress.total) * 100);
      actualEmbeddedChunksDisplay = embeddingProgress.current; // 임베딩 진행 중에는 현재 처리된 수 표시
    } else {
      actualEmbeddingRate = stats.totalChunks > 0 
        ? Math.round((actualEmbeddedChunks / stats.totalChunks) * 100) 
        : 0;
      actualEmbeddedChunksDisplay = actualEmbeddedChunks;
    }
    
    // 임베딩 대상 총 청크 수 (진행 중일 때는 실시간 값 사용)
    const actualTotalChunks = embeddingProcessing && embeddingProgress.total > 0
      ? embeddingProgress.total
      : stats.totalChunks;
    
    // 임베딩 성공률 계산 (embedding-stats.json 기반)
    const totalAttempts = embeddingStats.total_embeddings + embeddingStats.total_failed;
    const actualEmbeddingSuccessRate = totalAttempts > 0
      ? Math.round((embeddingStats.total_embeddings / totalAttempts) * 100)
      : 0;
    
    return {
      ...stats,
      chunkingRate: actualChunkingRate,
      chunkedDocuments: actualChunkedDocs,
      totalDocuments: actualTotalDocs,
      embeddedChunks: actualEmbeddedChunksDisplay,
      totalChunks: actualTotalChunks,
      embeddingRate: actualEmbeddingRate,
      embeddingSuccessRate: actualEmbeddingSuccessRate,
      embeddingFailedChunks: embeddingStats.total_failed,
    };
  }, [stats, chromaDbStatus, embeddingStats, processing, chunkingProgress, chunkingCompletedDocs, chunkingTotalDocs, embeddingProcessing, embeddingProgress]);

  // ============================================================================
  // 데이터 로드
  // ============================================================================

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/processing/chunking/settings");
      const data = await res.json();
      if (data.success) {
        setChunkingSettings(data.settings);
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  }, []);

  const loadEmbeddingSettingsFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/processing/embedding/settings");
      const data = await res.json();
      if (data.success && data.settings) {
        setEmbeddingSettings(data.settings);
      }
    } catch (error) {
      console.error("Error loading embedding settings:", error);
    }
  }, []);

  // ChromaDB 상태 로드
  const loadChromaDbStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/processing/embedding/migrate");
      const data = await res.json();
      const newStatus = {
        connected: data.success && data.status === "connected",
        total_embeddings: data.total_embeddings || 0,
        loading: false,
      };
      // 데이터가 변경되었을 때만 상태 업데이트 (깜박임 방지)
      setChromaDbStatus(prev => {
        if (prev.connected === newStatus.connected && 
            prev.total_embeddings === newStatus.total_embeddings &&
            prev.loading === newStatus.loading) {
          return prev; // 변경 없으면 기존 상태 유지 (리렌더링 방지)
        }
        return newStatus;
      });
    } catch {
      setChromaDbStatus(prev => {
        if (!prev.connected && prev.total_embeddings === 0 && !prev.loading) {
          return prev;
        }
        return { connected: false, total_embeddings: 0, loading: false };
      });
    }
  }, []);

  // 임베딩 통계 로드 (영구 저장된 누적 데이터)
  const loadEmbeddingStats = useCallback(async () => {
    try {
      const res = await fetch("/api/processing/embedding/stats");
      const data = await res.json();
      if (data.success && data.stats) {
        const newStats = {
          total_embeddings: data.stats.total_embeddings || 0,
          total_failed: data.stats.total_failed || 0,
          total_cost: data.stats.total_cost || 0,
          total_tokens: data.stats.total_tokens || 0,
        };
        // 데이터가 변경되었을 때만 상태 업데이트 (깜박임 방지)
        setEmbeddingStats(prev => {
          if (prev.total_embeddings === newStats.total_embeddings &&
              prev.total_failed === newStats.total_failed &&
              prev.total_cost === newStats.total_cost &&
              prev.total_tokens === newStats.total_tokens) {
            return prev; // 변경 없으면 기존 상태 유지 (리렌더링 방지)
          }
          return newStats;
        });
      }
    } catch (error) {
      console.error("Error loading embedding stats:", error);
    }
  }, []);

  // JSON → ChromaDB 마이그레이션
  const handleMigrateToChromaDb = async () => {
    if (!confirm("기존 JSON 파일의 임베딩 데이터를 ChromaDB로 마이그레이션하시겠습니까?")) {
      return;
    }
    
    setMigrating(true);
    try {
      const res = await fetch("/api/processing/embedding/migrate", {
        method: "POST",
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`마이그레이션 완료: ${data.migrated}개 임베딩이 ChromaDB로 이동되었습니다.`);
        loadChromaDbStatus();
      } else {
        alert(`마이그레이션 실패: ${data.error}`);
      }
    } catch (error) {
      alert("마이그레이션 중 오류가 발생했습니다.");
      console.error(error);
    } finally {
      setMigrating(false);
    }
  };
  
  // 임베딩 전체 초기화 (ChromaDB 삭제)
  const handleClearEmbeddings = async () => {
    if (!confirm("⚠️ 경고: 모든 임베딩 데이터가 삭제됩니다.\n\n서로 다른 모델로 임베딩된 데이터가 섞여 있거나,\n임베딩을 처음부터 다시 하고 싶을 때 사용하세요.\n\n계속하시겠습니까?")) {
      return;
    }
    
    // 2차 확인
    if (!confirm("정말로 모든 임베딩을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")) {
      return;
    }
    
    setClearingEmbeddings(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${backendUrl}/vectordb/clear`, {
        method: "POST",
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`초기화 완료: ${data.deleted || 0}개 임베딩이 삭제되었습니다.`);
        // 모든 관련 상태 갱신
        loadChromaDbStatus();
        loadEmbeddingStats();
        loadTreeData();
        // 임베딩 통계 상태 리셋
        setEmbeddingStats({ total_embeddings: 0, total_failed: 0, total_cost: 0, total_tokens: 0 });
      } else {
        alert(`초기화 실패: ${data.error}`);
      }
    } catch (error) {
      alert("초기화 중 오류가 발생했습니다.");
      console.error(error);
    } finally {
      setClearingEmbeddings(false);
    }
  };

  const loadTreeData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/processing/chunking/documents");
      const data = await res.json();
      
      if (data.success) {
        setTreeData(data.tree);
        setStats(data.chunkingStats);
      }
    } catch (error) {
      console.error("Error loading tree data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadEmbeddingSettingsFromServer();
    loadTreeData();
    loadChromaDbStatus();
    loadEmbeddingStats();
  }, [loadSettings, loadEmbeddingSettingsFromServer, loadTreeData, loadChromaDbStatus, loadEmbeddingStats]);

  // ============================================================================
  // 선택된 폴더의 문서 로드
  // ============================================================================

  const prevPathsRef = useRef<string>("");

  useEffect(() => {
    const pathsKey = JSON.stringify(Array.from(selectedPaths).sort());
    if (prevPathsRef.current === pathsKey) return;
    prevPathsRef.current = pathsKey;

    if (selectedPaths.size === 0) {
      setDocuments([]);
      setSelectionSummary({ totalFiles: 0, totalSize: 0, estimatedTokens: 0, estimatedTime: 0 });
      setChunkingResults(new Map()); // 청킹 결과 초기화
      setStatusFilter("all"); // 필터 초기화
      return;
    }
    
    // 폴더 선택 변경 시 청킹 결과 초기화
    setChunkingResults(new Map());
    setStatusFilter("all");

    const loadDocuments = async () => {
      setLoadingDocs(true);
      try {
        const res = await fetch("/api/processing/chunking/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date_folder_paths: Array.from(selectedPaths) }),
        });
        const data = await res.json();

        if (data.success) {
          setDocuments(data.documents);
          setSelectionSummary(data.summary);
        }
      } catch (error) {
        console.error("Error loading documents:", error);
      } finally {
        setLoadingDocs(false);
      }
    };

    loadDocuments();
  }, [selectedPaths]);

  // ============================================================================
  // 트리 핸들러
  // ============================================================================

  const handleToggleExpand = useCallback((id: string) => {
    setTreeData((prev) => {
      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((node) => {
          if (node.id === id) {
            return { ...node, isExpanded: !node.isExpanded };
          }
          if (node.children) {
            return { ...node, children: updateNode(node.children) };
          }
          return node;
        });
      };
      return updateNode(prev);
    });
  }, []);

  const handleToggleCheck = useCallback((id: string, nodeType: TreeNodeType, dateFolderPath?: string) => {
    // 하위 date_folder 경로 수집 헬퍼
    const collectDateFolderPaths = (node: TreeNode): string[] => {
      const paths: string[] = [];
      if (node.type === "date_folder" && node.dateFolderPath) {
        paths.push(node.dateFolderPath);
      }
      if (node.children) {
        for (const child of node.children) {
          paths.push(...collectDateFolderPaths(child));
        }
      }
      return paths;
    };

    // 노드와 모든 하위 노드의 isChecked 설정 헬퍼
    const setNodeChecked = (node: TreeNode, checked: boolean): TreeNode => {
      const updatedNode = { ...node, isChecked: checked, isIndeterminate: false };
      if (node.children) {
        updatedNode.children = node.children.map(child => setNodeChecked(child, checked));
      }
      return updatedNode;
    };

    // 상위 노드의 indeterminate 상태 계산 헬퍼
    const updateParentState = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map(node => {
        if (node.children && node.children.length > 0) {
          const updatedChildren = updateParentState(node.children);
          const checkedCount = updatedChildren.filter(c => c.isChecked).length;
          const indeterminateCount = updatedChildren.filter(c => c.isIndeterminate).length;
          const totalCount = updatedChildren.length;
          
          return {
            ...node,
            children: updatedChildren,
            isChecked: checkedCount === totalCount && totalCount > 0,
            isIndeterminate: (checkedCount > 0 && checkedCount < totalCount) || indeterminateCount > 0,
          };
        }
        return node;
      });
    };

    setTreeData((prev) => {
      let targetNode: TreeNode | null = null;
      let newCheckedState = false;

      // 대상 노드 찾기 및 현재 상태 확인
      const findNode = (nodes: TreeNode[]): boolean => {
        for (const node of nodes) {
          if (node.id === id) {
            targetNode = node;
            newCheckedState = !node.isChecked;
            return true;
          }
          if (node.children && findNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      findNode(prev);

      if (!targetNode) return prev;

      // 노드 업데이트
      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((node) => {
          if (node.id === id) {
            return setNodeChecked(node, newCheckedState);
          }
          if (node.children) {
            return { ...node, children: updateNode(node.children) };
          }
          return node;
        });
      };

      // 노드 업데이트 후 상위 노드 상태 재계산
      const updated = updateNode(prev);
      return updateParentState(updated);
    });

    // 선택된 경로 업데이트
    setTreeData((prev) => {
      // 대상 노드의 모든 하위 date_folder 경로 수집
      const findNodeAndCollectPaths = (nodes: TreeNode[]): string[] => {
        for (const node of nodes) {
          if (node.id === id) {
            return collectDateFolderPaths(node);
          }
          if (node.children) {
            const paths = findNodeAndCollectPaths(node.children);
            if (paths.length > 0) return paths;
          }
        }
        return [];
      };
      
      const pathsToToggle = findNodeAndCollectPaths(prev);
      
      if (pathsToToggle.length > 0) {
        setSelectedPaths((prevPaths) => {
          const newPaths = new Set(prevPaths);
          // 현재 노드의 체크 상태 확인
          const isNowChecked = (() => {
            const findChecked = (nodes: TreeNode[]): boolean | null => {
              for (const node of nodes) {
                if (node.id === id) return node.isChecked ?? false;
                if (node.children) {
                  const result = findChecked(node.children);
                  if (result !== null) return result;
                }
              }
              return null;
            };
            return findChecked(prev) ?? false;
          })();

          for (const p of pathsToToggle) {
            if (isNowChecked) {
              newPaths.add(p);
            } else {
              newPaths.delete(p);
            }
          }
          return newPaths;
        });
      }
      
      return prev;
    });
  }, []);

  // ============================================================================
  // 설정 저장
  // ============================================================================

  const saveChunkingSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/processing/chunking/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunkingSettings),
      });
      const data = await res.json();
      if (data.success) {
        setChunkingSettings(data.settings);
      }
    } catch (error) {
      console.error("Error saving settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const saveEmbeddingSettingsToServer = async () => {
    setSavingEmbedding(true);
    try {
      const res = await fetch("/api/processing/embedding/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(embeddingSettings),
      });
      const data = await res.json();
      if (data.success) {
        setEmbeddingSettings(data.settings);
      }
    } catch (error) {
      console.error("Error saving embedding settings:", error);
    } finally {
      setSavingEmbedding(false);
    }
  };

  // ============================================================================
  // 내보내기
  // ============================================================================

  const loadExportPreview = async () => {
    try {
      const res = await fetch("/api/processing/chunking/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setExportPreview(data.preview);
      }
    } catch (error) {
      console.error("Error loading export preview:", error);
    }
  };

  const handleOpenExportModal = async () => {
    setShowExportModal(true);
    await loadExportPreview();
  };

  const executeExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        format: exportFormat,
        include_embeddings: includeEmbeddings.toString(),
      });
      
      const res = await fetch(`/api/processing/chunking/export?${params}`);
      
      if (!res.ok) {
        const errorData = await res.json();
        alert(`내보내기 실패: ${errorData.error}`);
        return;
      }
      
      // 파일 다운로드
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chunks_export_${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      setShowExportModal(false);
    } catch (error) {
      console.error("Error exporting:", error);
      alert("내보내기 중 오류가 발생했습니다.");
    } finally {
      setExporting(false);
    }
  };

  // ============================================================================
  // 청킹 실행
  // ============================================================================
  
  const executeChunking = async (rechunk = false) => {
    if (documents.length === 0) {
      alert("청킹할 문서를 선택해주세요.");
      return;
    }
    
    // 청킹 전 모든 문서를 processing 상태로 설정
    const initialResults = new Map<string, ChunkingResult>();
    documents.forEach(doc => {
      initialResults.set(doc.doc_id, {
        doc_id: doc.doc_id,
        status: "processing",
      });
    });
    setChunkingResults(initialResults);
    setChunkingProgress(0);
    setCurrentChunkingDoc("");
    setChunkingCompletedDocs(0);
    setChunkingTotalDocs(documents.length);
    
    // Ref 초기화
    chunkingProgressRef.current = 0;
    chunkingCompletedDocsRef.current = 0;
    chunkingTotalDocsRef.current = documents.length;
    
    setProcessing(true);
    
    // 폴링 시작 (500ms마다 Ref 값을 State로 동기화)
    chunkingPollingRef.current = setInterval(() => {
      setChunkingProgress(chunkingProgressRef.current);
      setChunkingCompletedDocs(chunkingCompletedDocsRef.current);
      setChunkingTotalDocs(chunkingTotalDocsRef.current);
    }, 500);
    try {
      const res = await fetch("/api/processing/chunking/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_ids: documents.map(d => d.doc_id),
          rechunk,
        }),
      });
      
      // SSE 스트림 처리
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error("스트림을 읽을 수 없습니다.");
      }
      
      let buffer = "";
      let finalData: any = null;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // SSE 이벤트 파싱
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              switch (data.type) {
                case "started":
                  console.log(`[청킹] 시작: 총 ${data.total}개 문서`);
                  // Ref 업데이트 (폴링에서 State로 동기화됨)
                  chunkingTotalDocsRef.current = data.total;
                  chunkingCompletedDocsRef.current = 0;
                  chunkingProgressRef.current = 0;
                  break;
                  
                case "progress":
                  // Ref 업데이트 (폴링에서 State로 동기화됨)
                  chunkingProgressRef.current = data.progress;
                  setCurrentChunkingDoc(data.doc_name || "");
                  break;
                  
                case "doc_complete":
                  // Ref 업데이트 (폴링에서 State로 동기화됨)
                  chunkingCompletedDocsRef.current += 1;
                  
                  setChunkingResults(prev => {
                    const newResults = new Map(prev);
                    newResults.set(data.doc_id, {
                      doc_id: data.doc_id,
                      status: data.success ? "success" : "failed",
                      chunks: data.chunks,
                      tokens: data.tokens,
                      error: data.error,
                    });
                    return newResults;
                  });
                  break;
                  
                case "complete":
                  finalData = data;
                  // 폴링 중지
                  if (chunkingPollingRef.current) {
                    clearInterval(chunkingPollingRef.current);
                    chunkingPollingRef.current = null;
                  }
                  // 최종 값 즉시 반영
                  chunkingProgressRef.current = 100;
                  setChunkingProgress(100);
                  setChunkingCompletedDocs(chunkingCompletedDocsRef.current);
                  break;
                  
                case "error":
                  // 폴링 중지
                  if (chunkingPollingRef.current) {
                    clearInterval(chunkingPollingRef.current);
                    chunkingPollingRef.current = null;
                  }
                  alert(`오류: ${data.error}`);
                  break;
              }
            } catch (e) {
              console.warn("SSE 파싱 오류:", e);
            }
          }
        }
      }
      
      // 실패 건이 있으면 실패 필터로 전환
      if (finalData?.failed > 0) {
        setStatusFilter("failed");
      }
      
      loadTreeData();
      
    } catch (error) {
      console.error("Error executing chunking:", error);
      // 폴링 중지
      if (chunkingPollingRef.current) {
        clearInterval(chunkingPollingRef.current);
        chunkingPollingRef.current = null;
      }
      alert("청킹 실행 중 오류가 발생했습니다.");
      // 모든 문서를 실패 상태로 설정
      const failedResults = new Map<string, ChunkingResult>();
      documents.forEach(doc => {
        failedResults.set(doc.doc_id, {
          doc_id: doc.doc_id,
          status: "failed",
          error: "네트워크 오류",
        });
      });
      setChunkingResults(failedResults);
    } finally {
      // 폴링 정리 (혹시 남아있으면)
      if (chunkingPollingRef.current) {
        clearInterval(chunkingPollingRef.current);
        chunkingPollingRef.current = null;
      }
      setProcessing(false);
      setCurrentChunkingDoc("");
    }
  };

  // ============================================================================
  // 실패 문서 삭제
  // ============================================================================

  const handleDeleteFailedDocuments = async () => {
    const failedDocIds = Array.from(chunkingResults.values())
      .filter(r => r.status === "failed")
      .map(r => r.doc_id);
    
    if (failedDocIds.length === 0) {
      alert("삭제할 실패 문서가 없습니다.");
      return;
    }
    
    const confirmed = confirm(
      `실패한 ${failedDocIds.length}개의 문서를 삭제하시겠습니까?\n\n` +
      `삭제 대상:\n` +
      `- 스크래핑 저장 경로 (ScrapingData)\n` +
      `- 텍스트 추출 저장 경로 (ExtractedData)\n\n` +
      `이 작업은 되돌릴 수 없습니다.`
    );
    
    if (!confirmed) return;
    
    try {
      const res = await fetch("/api/processing/chunking/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_ids: failedDocIds }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`삭제 완료: ${data.deleted}개 성공, ${data.failed}개 실패`);
        
        // 삭제된 문서를 목록에서 제거
        const deletedIds = new Set<string>(
          data.results
            .filter((r: { success: boolean }) => r.success)
            .map((r: { doc_id: string }) => r.doc_id)
        );
        
        // documents 상태 업데이트
        setDocuments(prev => prev.filter(doc => !deletedIds.has(doc.doc_id)));
        
        // chunkingResults에서도 삭제
        setChunkingResults(prev => {
          const newResults = new Map(prev);
          deletedIds.forEach(id => newResults.delete(id));
          return newResults;
        });
        
        // 트리 데이터 새로고침
        loadTreeData();
      } else {
        alert(`삭제 실패: ${data.error}`);
      }
    } catch (error) {
      console.error("Error deleting failed documents:", error);
      alert("문서 삭제 중 오류가 발생했습니다.");
    }
  };

  // ============================================================================
  // 임베딩 실행
  // ============================================================================

  // HuggingFace 모델인지 확인
  const isHuggingFaceModel = embeddingSettings.model === "ko-sroberta" || embeddingSettings.model === "bge-m3";

  const handleEmbeddingClick = async () => {
    if (isHuggingFaceModel) {
      // HuggingFace 모델은 API 키 불필요, 바로 실행
      executeEmbedding();
    } else {
      // OpenAI 모델: 환경 변수에 API 키가 있는지 먼저 확인
      try {
        const checkRes = await fetch("/api/processing/embedding/check-api-key");
        const checkData = await checkRes.json();
        
        if (checkData.hasApiKey) {
          // 환경 변수에 API 키가 있으면 바로 실행
          executeEmbedding();
        } else {
          // 환경 변수에 API 키가 없으면 모달 표시
          setShowApiKeyModal(true);
        }
      } catch {
        // 오류 시 안전하게 모달 표시
        setShowApiKeyModal(true);
      }
    }
  };

  // 현재 실행 중인 임베딩 Job ID
  const [currentEmbeddingJobId, setCurrentEmbeddingJobId] = useState<string | null>(null);
  const embeddingPollingRef = useRef<NodeJS.Timeout | null>(null);

  const executeEmbedding = async () => {
    // OpenAI 모델이고 API 키 모달에서 입력한 경우에만 apiKey 체크
    // 환경 변수를 사용하는 경우 apiKey가 비어있어도 OK
    setShowApiKeyModal(false);
    setEmbeddingProcessing(true);
    setEmbeddingProgress({ current: 0, total: stats?.totalChunks || 0 });

    // 백엔드 URL (Docker 환경에서는 환경 변수 사용)
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

    try {
      // 백그라운드 작업 생성 (Python 백엔드)
      const res = await fetch(`${BACKEND_URL}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "embedding",
          params: {
            api_key: apiKey.trim() || undefined,
            settings: embeddingSettings,
            skip_existing: true,
          },
        }),
      });
      const data = await res.json();

      if (!data.success) {
        alert(`오류: ${data.error}`);
        setEmbeddingProcessing(false);
        return;
      }

      const jobId = data.job.id;
      setCurrentEmbeddingJobId(jobId);

      // 작업 상태 폴링 시작
      const pollJobStatus = async () => {
        try {
          const statusRes = await fetch(`${BACKEND_URL}/jobs/${jobId}`);
          const statusData = await statusRes.json();

          if (!statusData.success) {
            console.error("Job status error:", statusData.error);
            return;
          }

          const job = statusData.job;
          
          // 진행률 업데이트
          setEmbeddingProgress(prev => {
            if (prev.current === job.progress.current && prev.total === job.progress.total) {
              return prev; // 변경 없으면 리렌더링 방지
            }
            return { current: job.progress.current, total: job.progress.total };
          });

          // 도넛 차트/통계 실시간 업데이트 (상태 비교로 깜박임 방지)
          if (job.status === "running") {
            loadChromaDbStatus();
            loadEmbeddingStats();
          }

          // 상태에 따른 처리
          if (job.status === "completed") {
            // 폴링 중지
            if (embeddingPollingRef.current) {
              clearInterval(embeddingPollingRef.current);
              embeddingPollingRef.current = null;
            }

            const result = job.result;
            const costMessage = isHuggingFaceModel 
              ? "" 
              : `\n예상 비용: $${(result?.data?.estimated_cost || 0).toFixed(4)}`;
            const timeMessage = result?.data?.processing_time_ms 
              ? `\n처리 시간: ${(result.data.processing_time_ms / 1000).toFixed(1)}초` 
              : "";
            alert(`임베딩 완료: ${result?.processed || 0}개 성공, ${result?.failed || 0}개 실패${result?.skipped > 0 ? `, ${result.skipped}개 스킵` : ""}${costMessage}${timeMessage}`);
            
            // 현재 세션 비용 업데이트
            if (!isHuggingFaceModel && result?.data?.estimated_cost) {
              setCurrentSessionCost(prev => prev + result.data.estimated_cost);
            }
            
            // 통계 리로드 (ChromaDB 상태, 임베딩 통계, 트리 데이터 모두 갱신)
            await loadChromaDbStatus();
            await loadEmbeddingStats();
            await loadTreeData();
            
            setEmbeddingProcessing(false);
            setCurrentEmbeddingJobId(null);
            setEmbeddingProgress({ current: 0, total: 0 });
          } else if (job.status === "failed" || job.status === "cancelled") {
            // 폴링 중지
            if (embeddingPollingRef.current) {
              clearInterval(embeddingPollingRef.current);
              embeddingPollingRef.current = null;
            }

            alert(`임베딩 ${job.status === "cancelled" ? "취소됨" : "실패"}: ${job.error || "알 수 없는 오류"}`);
            
            setEmbeddingProcessing(false);
            setCurrentEmbeddingJobId(null);
            setEmbeddingProgress({ current: 0, total: 0 });
          }
          // running 상태면 계속 폴링
        } catch (pollError) {
          console.error("Polling error:", pollError);
        }
      };

      // 초기 폴링 (1초 후)
      setTimeout(pollJobStatus, 1000);
      
      // 주기적 폴링 (2초마다)
      embeddingPollingRef.current = setInterval(pollJobStatus, 2000);

    } catch (error) {
      console.error("Error starting embedding job:", error);
      alert("임베딩 작업 시작 중 오류가 발생했습니다.");
      setEmbeddingProcessing(false);
      setEmbeddingProgress({ current: 0, total: 0 });
    }
  };

  // 임베딩 작업 취소
  const cancelEmbedding = async () => {
    if (!currentEmbeddingJobId) return;

    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

    try {
      const res = await fetch(`${BACKEND_URL}/jobs/${currentEmbeddingJobId}?action=cancel`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        // 폴링 중지
        if (embeddingPollingRef.current) {
          clearInterval(embeddingPollingRef.current);
          embeddingPollingRef.current = null;
        }
        
        setEmbeddingProcessing(false);
        setCurrentEmbeddingJobId(null);
        setEmbeddingProgress({ current: 0, total: 0 });
      }
    } catch (error) {
      console.error("Error cancelling embedding:", error);
    }
  };

  // 컴포넌트 언마운트 시 폴링 정리
  useEffect(() => {
    return () => {
      if (embeddingPollingRef.current) {
        clearInterval(embeddingPollingRef.current);
      }
    };
  }, []);

  // ============================================================================
  // 포맷 유틸
  // ============================================================================

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}초`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
    return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
  };

  // ============================================================================
  // 도움말 내용
  // ============================================================================

  const HELP_CONTENT: Record<string, { title: string; content: string }> = {
    strategy: {
      title: "청킹 전략",
      content: `• RecursiveCharacter (권장): 문단, 문장, 단어 순으로 의미 단위를 유지하며 분할합니다. 대부분의 문서에 적합합니다.\n\n• Sentence: 문장 단위로 분할합니다. 짧은 문서나 문장 완결성이 중요한 경우 적합합니다.\n\n• Semantic: 의미적 유사도를 기반으로 분할합니다. 처리 시간이 길지만 맥락 보존이 우수합니다.\n\n• MarkdownHeader: 마크다운 헤더(#, ##, ###)를 기준으로 분할합니다. 구조화된 문서에 적합합니다.`
    },
    chunkSize: {
      title: "청크 크기",
      content: `청크 하나에 포함되는 토큰 수를 설정합니다.\n\n• 작은 값 (200~400): 정밀한 검색에 유리하지만 맥락 손실 가능성이 있습니다. 짧은 질의에 적합합니다.\n\n• 중간 값 (500~800): 검색 정확도와 맥락 보존의 균형. 대부분의 RAG 시스템에 권장됩니다.\n\n• 큰 값 (1000~2000): 넓은 맥락을 유지하지만 검색 정밀도가 낮아질 수 있습니다. 긴 문맥이 필요한 경우 적합합니다.`
    },
    chunkOverlap: {
      title: "오버랩",
      content: `인접한 청크 간에 겹치는 토큰 수를 설정합니다.\n\n• 0: 오버랩 없음. 처리 속도가 빠르지만 청크 경계에서 문맥이 끊길 수 있습니다.\n\n• 50~100: 기본 맥락 연결. 일반적인 문서에 적합합니다.\n\n• 150~250: 강한 맥락 연결. 문맥 유지가 중요한 경우 권장됩니다.\n\n• 300 이상: 매우 높은 오버랩. 중복이 많아져 저장 공간과 처리 비용이 증가합니다.`
    },
    embeddingModel: {
      title: "임베딩 모델",
      content: `• text-embedding-3-small (OpenAI): 빠르고 저렴함. 1536차원. 일반적인 용도에 적합합니다.\n\n• text-embedding-3-large (OpenAI): 높은 품질. 3072차원. 정밀한 검색이 필요한 경우 권장됩니다.\n\n• ko-sroberta-multitask (HuggingFace): 한국어 특화. 768차원. 무료이지만 로컬 GPU 필요.\n\n• bge-m3 (HuggingFace): 다국어 지원. 1024차원. 무료이며 한국어 성능이 우수합니다.\n\n⚠️ OpenAI 모델은 API 비용이 발생합니다.`
    },
    batchSize: {
      title: "배치 크기",
      content: `한 번에 처리하는 청크 수를 설정합니다.\n\n• 작은 값 (10~50): 메모리 사용량이 적고 안정적. 대형 청크나 제한된 환경에서 권장됩니다.\n\n• 중간 값 (100~200): 처리 속도와 안정성의 균형. 대부분의 경우 권장됩니다.\n\n• 큰 값 (300~500): 빠른 처리. API 호출 횟수를 줄여 비용 효율적이지만 Rate Limit에 주의해야 합니다.`
    },
  };

  // ============================================================================
  // 도움말 툴팁 컴포넌트
  // ============================================================================

  const HelpButton = ({ id }: { id: string }) => (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setActiveTooltip(activeTooltip === id ? null : id);
        }}
        className="w-4 h-4 rounded-full bg-stone-200 hover:bg-stone-300 flex items-center justify-center transition-colors"
      >
        <span className="text-[10px] font-bold text-stone-500">?</span>
      </button>
      
      {activeTooltip === id && HELP_CONTENT[id] && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setActiveTooltip(null)}
          />
          <div className="absolute left-6 top-0 z-50 w-72 p-3 rounded-xl bg-white shadow-xl border border-stone-200 animate-in fade-in slide-in-from-left-2 duration-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-stone-800">{HELP_CONTENT[id].title}</h4>
              <button
                onClick={() => setActiveTooltip(null)}
                className="w-5 h-5 rounded-full hover:bg-stone-100 flex items-center justify-center"
              >
                <X className="w-3 h-3 text-stone-400" />
              </button>
            </div>
            <p className="text-[11px] text-stone-600 whitespace-pre-line leading-relaxed">
              {HELP_CONTENT[id].content}
            </p>
          </div>
        </>
      )}
    </div>
  );

  // ============================================================================
  // 렌더링
  // ============================================================================

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* 헤더 - 박스화 */}
      <div className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">청킹 및 임베딩</h1>
            <p className="text-xs text-stone-500">추출된 텍스트를 청킹하고 임베딩 벡터를 생성합니다</p>
          </div>
          <button className="p-2 rounded-xl hover:bg-stone-100 transition-colors">
            <HelpCircle className="w-5 h-5 text-stone-400" />
          </button>
        </div>
      </div>

      {/* 메인 레이아웃 (5:5 비율) */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* ========== 좌측 영역 (50%) ========== */}
        <div className="w-1/2 flex flex-col gap-4 overflow-y-auto">
          {/* 상단: 청킹/임베딩 현황 (70%) + 빠른 작업 (30%) */}
          <div className="flex gap-4 h-[384px]">
            {/* 청킹/임베딩 현황 카드 (70%) */}
            <div className="w-[70%] glass-panel p-4 rounded-2xl flex flex-col">
              <h3 className="text-sm font-semibold text-stone-700 mb-3">청킹/임베딩 현황</h3>
              
              {computedStats ? (
                <div className="flex-1 flex flex-col gap-3">
                  {/* 소카드 2개 영역 */}
                  <div className="flex gap-3 flex-1">
                    {/* 좌측 소카드 - 청킹 */}
                    <div className="flex-1 rounded-xl p-3 flex flex-col bg-white/40 backdrop-blur-md border border-white/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_2px_8px_0_rgba(0,0,0,0.04)]">
                      <span className="text-[11px] font-semibold text-stone-700 mb-2">청킹 {processing && <span className="text-blue-500 animate-pulse">처리 중...</span>}</span>
                      <div className="flex gap-2 justify-center flex-1 items-center">
                        {/* 진행률 도넛 - 진행 중일 때는 직접 상태값 사용 */}
                        {(() => {
                          const displayRate = processing ? chunkingProgress : computedStats.chunkingRate;
                          const displayCompletedDocs = processing ? chunkingCompletedDocs : computedStats.chunkedDocuments;
                          const displayTotalDocs = processing ? chunkingTotalDocs : computedStats.totalDocuments;
                          return (
                            <div className="flex flex-col items-center">
                              <div className="relative w-32 h-32">
                                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                  <defs>
                                    <linearGradient id="chunking-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                      <stop offset="0%" stopColor="#3B82F6" />
                                      <stop offset="100%" stopColor="#60A5FA" />
                                    </linearGradient>
                                  </defs>
                                  <circle cx="50" cy="50" r="42" fill="none" stroke="#E7E5E4" strokeWidth="10" />
                                  <circle 
                                    cx="50" cy="50" r="42" fill="none" strokeWidth="10" strokeLinecap="round"
                                    stroke="url(#chunking-progress-gradient)"
                                    style={{
                                      strokeDasharray: 2 * Math.PI * 42,
                                      strokeDashoffset: 2 * Math.PI * 42 - (displayRate / 100) * 2 * Math.PI * 42,
                                    }}
                                    className={processing ? "transition-all duration-300 ease-out" : "transition-all duration-500 ease-out"}
                                  />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                  <span className="text-xl font-bold text-stone-800">{displayRate}%</span>
                                  <span className="text-[11px] text-stone-500">진행률</span>
                                </div>
                              </div>
                              <span className="mt-1 text-xs text-stone-600 font-medium">{displayCompletedDocs}/{displayTotalDocs} 문서</span>
                            </div>
                          );
                        })()}
                        {/* 성공률 도넛 */}
                        <div className="flex flex-col items-center">
                          <div className="relative w-32 h-32">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                              <defs>
                                <linearGradient id="chunking-success-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                  <stop offset="0%" stopColor="#10B981" />
                                  <stop offset="100%" stopColor="#34D399" />
                                </linearGradient>
                              </defs>
                              <circle cx="50" cy="50" r="42" fill="none" stroke="#E7E5E4" strokeWidth="10" />
                              <circle 
                                cx="50" cy="50" r="42" fill="none" strokeWidth="10" strokeLinecap="round"
                                stroke="url(#chunking-success-gradient)"
                                style={{
                                  strokeDasharray: 2 * Math.PI * 42,
                                  strokeDashoffset: 2 * Math.PI * 42 - ((computedStats.chunkingSuccessRate ?? 0) / 100) * 2 * Math.PI * 42,
                                }}
                                className="transition-all duration-500 ease-out"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-xl font-bold text-stone-800">{computedStats.chunkingSuccessRate ?? 0}%</span>
                              <span className="text-[11px] text-stone-500">성공률</span>
                            </div>
                          </div>
                          <span className="mt-1 text-xs text-stone-600 font-medium">{computedStats.chunkedDocuments}/{computedStats.chunkedDocuments + computedStats.failedDocuments || 0} 성공</span>
                        </div>
                      </div>
                      {/* 청킹 KPI */}
                      <div className="grid grid-cols-2 gap-1.5 mt-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <FileText className="w-3 h-3 text-blue-500" />
                          <span className="text-[11px] text-stone-600">텍스트</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">{computedStats.textChunks}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <Table className="w-3 h-3 text-purple-500" />
                          <span className="text-[11px] text-stone-600">표</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">{computedStats.tableChunks}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <Hash className="w-3 h-3 text-amber-500" />
                          <span className="text-[11px] text-stone-600">토큰</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">{formatTokens(computedStats.totalTokens)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <AlertCircle className="w-3 h-3 text-red-500" />
                          <span className="text-[11px] text-stone-600">실패</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">{computedStats.failedDocuments}</span>
                        </div>
                      </div>
                    </div>

                    {/* 우측 소카드 - 임베딩 */}
                    <div className="flex-1 rounded-xl p-3 flex flex-col bg-white/40 backdrop-blur-md border border-white/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_2px_8px_0_rgba(0,0,0,0.04)]">
                      <span className="text-[11px] font-semibold text-stone-700 mb-2">임베딩 {embeddingProcessing && <span className="text-blue-500 animate-pulse">처리 중...</span>}</span>
                      <div className="flex gap-2 justify-center flex-1 items-center">
                        {/* 진행률 도넛 - 진행 중일 때는 직접 상태값 사용 */}
                        {(() => {
                          const displayRate = embeddingProcessing && embeddingProgress.total > 0
                            ? Math.round((embeddingProgress.current / embeddingProgress.total) * 100)
                            : computedStats.embeddingRate;
                          const displayEmbeddedChunks = embeddingProcessing 
                            ? embeddingProgress.current 
                            : computedStats.embeddedChunks;
                          const displayTotalChunks = embeddingProcessing && embeddingProgress.total > 0
                            ? embeddingProgress.total
                            : computedStats.totalChunks;
                          return (
                            <div className="flex flex-col items-center">
                              <div className="relative w-32 h-32">
                                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                  <defs>
                                    <linearGradient id="embedding-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                      <stop offset="0%" stopColor="#3B82F6" />
                                      <stop offset="100%" stopColor="#60A5FA" />
                                    </linearGradient>
                                  </defs>
                                  <circle cx="50" cy="50" r="42" fill="none" stroke="#E7E5E4" strokeWidth="10" />
                                  <circle 
                                    cx="50" cy="50" r="42" fill="none" strokeWidth="10" strokeLinecap="round"
                                    stroke="url(#embedding-progress-gradient)"
                                    style={{
                                      strokeDasharray: 2 * Math.PI * 42,
                                      strokeDashoffset: 2 * Math.PI * 42 - (displayRate / 100) * 2 * Math.PI * 42,
                                    }}
                                    className={embeddingProcessing ? "transition-all duration-300 ease-out" : "transition-all duration-500 ease-out"}
                                  />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                  <span className="text-xl font-bold text-stone-800">{displayRate}%</span>
                                  <span className="text-[11px] text-stone-500">진행률</span>
                                </div>
                              </div>
                              <span className="mt-1 text-xs text-stone-600 font-medium">{displayEmbeddedChunks.toLocaleString()}/{displayTotalChunks.toLocaleString()} 청크</span>
                            </div>
                          );
                        })()}
                        {/* 성공률 도넛 */}
                        <div className="flex flex-col items-center">
                          <div className="relative w-32 h-32">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                              <defs>
                                <linearGradient id="embedding-success-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                  <stop offset="0%" stopColor="#10B981" />
                                  <stop offset="100%" stopColor="#34D399" />
                                </linearGradient>
                              </defs>
                              <circle cx="50" cy="50" r="42" fill="none" stroke="#E7E5E4" strokeWidth="10" />
                              <circle 
                                cx="50" cy="50" r="42" fill="none" strokeWidth="10" strokeLinecap="round"
                                stroke="url(#embedding-success-gradient)"
                                style={{
                                  strokeDasharray: 2 * Math.PI * 42,
                                  strokeDashoffset: 2 * Math.PI * 42 - ((computedStats.embeddingSuccessRate ?? 0) / 100) * 2 * Math.PI * 42,
                                }}
                                className="transition-all duration-500 ease-out"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-xl font-bold text-stone-800">{computedStats.embeddingSuccessRate ?? 0}%</span>
                              <span className="text-[11px] text-stone-500">성공률</span>
                            </div>
                          </div>
                          <span className="mt-1 text-xs text-stone-600 font-medium">{embeddingStats.total_embeddings}/{embeddingStats.total_embeddings + embeddingStats.total_failed || 0} 성공</span>
                        </div>
                      </div>
                      {/* 임베딩 KPI */}
                      <div className="grid grid-cols-2 gap-1.5 mt-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <Zap className="w-3 h-3 text-blue-500" />
                          <span className="text-[11px] text-stone-600">현재</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">{computedStats.currentEmbeddingBatch || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span className="text-[11px] text-stone-600">누적</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">{embeddingStats.total_embeddings.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <AlertCircle className="w-3 h-3 text-red-500" />
                          <span className="text-[11px] text-stone-600">실패</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">{embeddingStats.total_failed}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/60">
                          <TrendingUp className="w-3 h-3 text-amber-500" />
                          <span className="text-[11px] text-stone-600">비용</span>
                          <span className="text-[11px] font-semibold text-stone-800 ml-auto">${currentSessionCost.toFixed(4)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
                </div>
              )}
            </div>

            {/* 빠른 작업 카드 (30%) */}
            <div className="w-[30%] glass-panel p-4 rounded-2xl flex flex-col">
              <h3 className="text-sm font-semibold text-stone-700 mb-3">빠른 작업</h3>
              <div className="space-y-2.5 flex-1 flex flex-col justify-center">
                <button
                  onClick={() => executeChunking(false)}
                  disabled={processing || documents.length === 0}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 rounded-xl transition-all text-left h-[70px] backdrop-blur-sm border",
                    documents.length > 0
                      ? "bg-blue-50/80 hover:bg-blue-100/80 active:bg-blue-200/80 text-blue-700 border-blue-200/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]"
                      : "bg-stone-100/80 text-stone-400 cursor-not-allowed border-stone-200/50"
                  )}
                >
                  {processing ? (
                    <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                  ) : (
                    <Play className="w-5 h-5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block">청킹 시작</span>
                    <span className="text-xs opacity-70">{documents.length}개 문서</span>
                  </div>
                </button>
                
                <button
                  onClick={() => executeChunking(true)}
                  disabled={processing || documents.length === 0}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 rounded-xl transition-all text-left h-[70px] backdrop-blur-sm border",
                    documents.length > 0
                      ? "bg-amber-50/80 hover:bg-amber-100/80 text-amber-700 border-amber-200/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]"
                      : "bg-stone-100/80 text-stone-400 cursor-not-allowed border-stone-200/50"
                  )}
                >
                  <RefreshCw className="w-5 h-5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block">재청킹</span>
                    <span className="text-xs opacity-70">덮어쓰기</span>
                  </div>
                </button>
                
                {embeddingProcessing ? (
                  <button
                    onClick={cancelEmbedding}
                    className="w-full flex items-center gap-3 px-3 rounded-xl transition-all text-left h-[70px] backdrop-blur-sm border bg-red-50/80 hover:bg-red-100/80 text-red-700 border-red-200/50"
                  >
                    <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block">임베딩 처리 중...</span>
                      <span className="text-xs opacity-70">클릭하여 취소</span>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={handleEmbeddingClick}
                    disabled={(stats?.totalChunks || 0) === 0}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 rounded-xl transition-all text-left h-[70px] backdrop-blur-sm border",
                      (stats?.totalChunks || 0) > 0
                        ? "bg-violet-50/80 hover:bg-violet-100/80 text-violet-700 border-violet-200/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]"
                        : "bg-stone-100/80 text-stone-400 cursor-not-allowed border-stone-200/50"
                    )}
                  >
                    <Zap className="w-5 h-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block">임베딩 생성</span>
                      <span className="text-xs opacity-70">
                        {stats?.totalChunks || 0}개 청크 {isHuggingFaceModel && "(로컬)"}
                      </span>
                    </div>
                  </button>
                )}
                
                <button
                  onClick={handleOpenExportModal}
                  disabled={exporting || (stats?.totalChunks || 0) === 0}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 rounded-xl transition-all text-left h-[70px] backdrop-blur-sm border",
                    (stats?.totalChunks || 0) > 0
                      ? "bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-700 border-emerald-200/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]"
                      : "bg-stone-100/80 text-stone-400 cursor-not-allowed border-stone-200/50"
                  )}
                >
                  {exporting ? (
                    <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                  ) : (
                    <Download className="w-5 h-5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block">결과 내보내기</span>
                    <span className="text-xs opacity-70">JSON/CSV</span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* 하단: 청킹 설정 (50%) + 임베딩 설정 (50%) */}
          <div className="flex gap-4 flex-1 min-h-0">
            {/* 청킹 설정 카드 (50%) */}
            <div className="w-1/2 glass-panel rounded-2xl overflow-hidden flex flex-col">
              <button
                onClick={() => setChunkingSettingsCollapsed(!chunkingSettingsCollapsed)}
                className="w-full flex items-center justify-between p-4 hover:bg-stone-50 transition-colors"
              >
                <span className="text-sm font-semibold text-stone-700">청킹 설정</span>
                {chunkingSettingsCollapsed ? (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                )}
              </button>
              
              {!chunkingSettingsCollapsed && (
                <div className="p-4 pt-0 space-y-3 flex-1 overflow-y-auto">
                  {/* 청킹 전략 */}
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="text-[11px] font-medium text-stone-600">청킹 전략</label>
                      <HelpButton id="strategy" />
                    </div>
                    <div className="space-y-1.5">
                      {STRATEGY_OPTIONS.map(opt => (
                        <label
                          key={opt.value}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all backdrop-blur-sm",
                            chunkingSettings.strategy === opt.value
                              ? "bg-primary/15 border border-primary/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]"
                              : "bg-white/50 border border-white/60 hover:bg-white/70"
                          )}
                        >
                          <input
                            type="radio"
                            name="strategy"
                            value={opt.value}
                            checked={chunkingSettings.strategy === opt.value}
                            onChange={e => setChunkingSettings({ ...chunkingSettings, strategy: e.target.value as ChunkingStrategy })}
                            className="w-3 h-3"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium text-stone-800">{opt.label}</span>
                            <span className="text-[11px] text-stone-500 ml-1">({opt.desc})</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  
                  {/* 청크 크기 */}
                  <div className="p-2.5 rounded-lg bg-white/40 backdrop-blur-sm border border-white/60">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-medium text-stone-600">
                        청크 크기: <span className="text-primary">{chunkingSettings.chunkSize}</span> 토큰
                      </label>
                      <HelpButton id="chunkSize" />
                    </div>
                    <input
                      type="range" min={200} max={2000} step={50}
                      value={chunkingSettings.chunkSize}
                      onChange={e => setChunkingSettings({ ...chunkingSettings, chunkSize: parseInt(e.target.value) })}
                      className="w-full accent-primary h-1.5"
                    />
                    <div className="flex justify-between text-[11px] text-stone-400">
                      <span>200</span><span>2000</span>
                    </div>
                  </div>
                  
                  {/* 오버랩 */}
                  <div className="p-2.5 rounded-lg bg-white/40 backdrop-blur-sm border border-white/60">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-medium text-stone-600">
                        오버랩: <span className="text-primary">{chunkingSettings.chunkOverlap}</span> 토큰
                      </label>
                      <HelpButton id="chunkOverlap" />
                    </div>
                    <input
                      type="range" min={0} max={500} step={25}
                      value={chunkingSettings.chunkOverlap}
                      onChange={e => setChunkingSettings({ ...chunkingSettings, chunkOverlap: parseInt(e.target.value) })}
                      className="w-full accent-primary h-1.5"
                    />
                    <div className="flex justify-between text-[11px] text-stone-400">
                      <span>0</span><span>500</span>
                    </div>
                  </div>
                  
                  {/* 표 데이터 자동 감지 */}
                  <div className="p-2.5 rounded-lg bg-white/40 backdrop-blur-sm border border-white/60">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={chunkingSettings.tableChunking.enabled}
                        onChange={e => setChunkingSettings({
                          ...chunkingSettings,
                          tableChunking: { ...chunkingSettings.tableChunking, enabled: e.target.checked }
                        })}
                        className="rounded accent-primary w-3.5 h-3.5"
                      />
                      <span className="text-xs text-stone-700">표 데이터 자동 감지</span>
                    </label>
                    
                    {chunkingSettings.tableChunking.enabled && (
                      <div className="mt-2 ml-5 p-2 rounded-lg bg-white/30 border border-white/50">
                        <label className="block text-[11px] font-medium text-stone-600 mb-1">
                          최대 행 수: {chunkingSettings.tableChunking.maxRowsPerChunk}
                        </label>
                        <input
                          type="range" min={5} max={60} step={5}
                          value={chunkingSettings.tableChunking.maxRowsPerChunk}
                          onChange={e => setChunkingSettings({
                            ...chunkingSettings,
                            tableChunking: { ...chunkingSettings.tableChunking, maxRowsPerChunk: parseInt(e.target.value) }
                          })}
                          className="w-full accent-primary h-1.5"
                        />
                        <div className="flex justify-between text-[11px] text-stone-400">
                          <span>5</span><span>60</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <button
                    onClick={saveChunkingSettings}
                    disabled={saving}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-primary text-white hover:bg-primary/80 active:bg-primary/70 transition-colors disabled:opacity-50 text-xs shadow-md"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span className="font-medium">설정 저장</span>
                  </button>
                </div>
              )}
            </div>

            {/* 임베딩 설정 카드 (50%) */}
            <div className="w-1/2 glass-panel rounded-2xl overflow-hidden flex flex-col">
              <button
                onClick={() => setEmbeddingSettingsCollapsed(!embeddingSettingsCollapsed)}
                className="w-full flex items-center justify-between p-4 hover:bg-stone-50 transition-colors"
              >
                <span className="text-sm font-semibold text-stone-700">임베딩 설정</span>
                {embeddingSettingsCollapsed ? (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                )}
              </button>
              
              {!embeddingSettingsCollapsed && (
                <div className="p-4 pt-0 space-y-3 flex-1 overflow-y-auto">
                  {/* 임베딩 모델 */}
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="text-xs font-medium text-stone-600">임베딩 모델</label>
                      <HelpButton id="embeddingModel" />
                    </div>
                    <div className="space-y-1.5">
                      {EMBEDDING_MODEL_OPTIONS.map(opt => (
                        <label
                          key={opt.value}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all backdrop-blur-sm",
                            embeddingSettings.model === opt.value
                              ? "bg-primary/15 border border-primary/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]"
                              : "bg-white/50 border border-white/60 hover:bg-white/70"
                          )}
                        >
                          <input
                            type="radio" name="model" value={opt.value}
                            checked={embeddingSettings.model === opt.value}
                            onChange={e => setEmbeddingSettings({ ...embeddingSettings, model: e.target.value as EmbeddingModel })}
                            className="w-3 h-3"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-medium text-stone-800 truncate">{opt.label}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-stone-500">
                              <span>{opt.dim}차원</span>
                              <span>·</span>
                              <span className={opt.cost === "무료" ? "text-emerald-600" : "text-amber-600"}>{opt.cost}</span>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  
                  {/* 배치 크기 */}
                  <div className="p-2.5 rounded-lg bg-white/40 backdrop-blur-sm border border-white/60">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-medium text-stone-600">
                        배치 크기: <span className="text-primary">{embeddingSettings.batchSize}</span>
                      </label>
                      <HelpButton id="batchSize" />
                    </div>
                    <input
                      type="range" min={10} max={500} step={10}
                      value={embeddingSettings.batchSize}
                      onChange={e => setEmbeddingSettings({ ...embeddingSettings, batchSize: parseInt(e.target.value) })}
                      className="w-full accent-primary h-1.5"
                    />
                    <div className="flex justify-between text-[11px] text-stone-400">
                      <span>10</span><span>500</span>
                    </div>
                  </div>
                  
                  {/* 동시 처리 */}
                  <div className="p-2.5 rounded-lg bg-white/40 backdrop-blur-sm border border-white/60">
                    <label className="block text-xs font-medium text-stone-600 mb-1">
                      동시 처리: <span className="text-primary">{embeddingSettings.concurrent}</span>
                    </label>
                    <input
                      type="range" min={1} max={10} step={1}
                      value={embeddingSettings.concurrent}
                      onChange={e => setEmbeddingSettings({ ...embeddingSettings, concurrent: parseInt(e.target.value) })}
                      className="w-full accent-primary h-1.5"
                    />
                    <div className="flex justify-between text-[11px] text-stone-400">
                      <span>1</span><span>10</span>
                    </div>
                  </div>
                  
                  {/* 자동 재시도 */}
                  <div className="p-2.5 rounded-lg bg-white/40 backdrop-blur-sm border border-white/60">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={embeddingSettings.autoRetry}
                        onChange={e => setEmbeddingSettings({ ...embeddingSettings, autoRetry: e.target.checked })}
                        className="rounded accent-primary w-3.5 h-3.5"
                      />
                      <span className="text-xs text-stone-700">실패 시 자동 재시도</span>
                    </label>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={saveEmbeddingSettingsToServer}
                      disabled={savingEmbedding}
                      className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl bg-primary text-white hover:bg-primary/80 active:bg-primary/70 transition-colors disabled:opacity-50 text-xs shadow-md"
                    >
                      {savingEmbedding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      <span className="font-medium">설정 저장</span>
                    </button>
                    <button
                      onClick={() => setShowCostModal(true)}
                      className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700 transition-colors text-xs shadow-md"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span className="font-medium">비용 추이</span>
                    </button>
                  </div>
                  
                  {/* ChromaDB 상태 */}
                  <div className="mt-3 pt-3 border-t border-stone-200/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-stone-600">Vector DB (ChromaDB)</span>
                      <div className="flex items-center gap-1.5">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          chromaDbStatus.loading ? "bg-amber-400 animate-pulse" :
                          chromaDbStatus.connected ? "bg-emerald-500" : "bg-stone-400"
                        )} />
                        <span className="text-[10px] text-stone-500">
                          {chromaDbStatus.loading ? "확인 중..." :
                           chromaDbStatus.connected ? `${chromaDbStatus.total_embeddings.toLocaleString()}개 벡터` : "미설치"}
                        </span>
                      </div>
                    </div>
                    {!chromaDbStatus.connected && !chromaDbStatus.loading && (
                      <p className="text-[9px] text-amber-600 mb-2">
                        ChromaDB 미설치. 임베딩은 JSON 파일에 저장됩니다.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleMigrateToChromaDb}
                        disabled={migrating || !chromaDbStatus.connected}
                        className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 transition-colors disabled:opacity-50 text-xs"
                      >
                        {migrating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                        <span className="font-medium">마이그레이션</span>
                      </button>
                      <button
                        onClick={handleClearEmbeddings}
                        disabled={clearingEmbeddings || !chromaDbStatus.connected || chromaDbStatus.total_embeddings === 0}
                        className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors disabled:opacity-50 text-xs"
                        title="모든 임베딩 삭제 (모델 불일치 시 사용)"
                      >
                        {clearingEmbeddings ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        <span className="font-medium">초기화</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ========== 우측 영역 (50%) ========== */}
        <div className="w-1/2 flex flex-col gap-4 min-h-0">
          {/* 대상 문서 선택 트리뷰 - 높이 고정 */}
          <div className="glass-panel p-4 rounded-2xl h-[384px] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-stone-700">대상 문서 선택</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
                  <input
                    type="text"
                    placeholder="검색..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-primary/30 w-32"
                  />
                </div>
                <button onClick={loadTreeData} className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors">
                  <RefreshCw className="w-4 h-4 text-stone-500" />
                </button>
              </div>
            </div>
            
            {/* 선택 요약 */}
            {selectedPaths.size > 0 && (
              <div className="flex items-center gap-4 p-3 mb-3 rounded-xl bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-xs font-medium text-stone-700">{selectionSummary.totalFiles}개 파일</span>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-stone-600">{formatSize(selectionSummary.totalSize)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-stone-600">~{formatTokens(selectionSummary.estimatedTokens)} 토큰</span>
                </div>
                <div className="flex items-center gap-2">
                  <Timer className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs text-stone-600">~{formatTime(selectionSummary.estimatedTime)}</span>
                </div>
              </div>
            )}
            
            {/* 트리뷰 */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
                </div>
              ) : treeData.length === 0 ? (
                <div className="text-center py-8 text-stone-500 text-sm">
                  <p>추출된 문서가 없습니다.</p>
                  <p className="text-xs mt-1 text-stone-400">텍스트 추출 메뉴에서 먼저 문서를 추출해주세요.</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {treeData.map((node) => (
                    <TreeNodeComponent
                      key={node.id}
                      node={node}
                      onToggleExpand={handleToggleExpand}
                      onToggleCheck={handleToggleCheck}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 선택된 문서 목록 (파일 목록 형식) */}
          <div className="glass-panel p-4 rounded-2xl flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-stone-700">청킹 대상 문서</h3>
              <div className="flex items-center gap-2">
                {/* 상태별 통계 */}
                {chunkingResults.size > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="flex items-center gap-0.5 text-emerald-600">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {Array.from(chunkingResults.values()).filter(r => r.status === "success").length}
                    </span>
                    <span className="flex items-center gap-0.5 text-red-600">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {Array.from(chunkingResults.values()).filter(r => r.status === "failed").length}
                    </span>
                  </div>
                )}
                <span className="text-xs text-stone-500 bg-white/50 px-2 py-0.5 rounded-full">
                  {documents.length}개
                </span>
              </div>
            </div>

            {/* 필터 및 검색 바 */}
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="ui-field text-xs py-1.5"
                style={{ width: "150px" }}
              >
                <option value="all">전체 상태</option>
                <option value="success">성공</option>
                <option value="failed">실패</option>
                <option value="pending">대기</option>
              </select>
              {/* 실패 문서 삭제 버튼 */}
              {Array.from(chunkingResults.values()).filter(r => r.status === "failed").length > 0 && (
                <button
                  onClick={handleDeleteFailedDocuments}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-red-100 hover:bg-red-200 text-red-700 transition-colors"
                  title="실패한 문서를 스크래핑/추출 경로에서 삭제합니다"
                >
                  <Trash2 className="w-3 h-3" />
                  실패 삭제
                </button>
              )}
              <div className="flex-1" />
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder="검색..."
                  value={fileSearchQuery}
                  onChange={(e) => setFileSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-primary/30 w-32"
                />
              </div>
            </div>
            
            {/* 파일 목록 */}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/60 bg-white/20 backdrop-blur-sm">
              {loadingDocs ? (
                <div className="flex flex-col items-center justify-center h-full text-stone-500">
                  <Loader2 className="w-6 h-6 mb-2 text-primary animate-spin" />
                  <p className="text-xs">문서 목록을 불러오는 중...</p>
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-stone-500">
                  <FileText className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">트리에서 기관, 보드 또는</p>
                  <p className="text-xs">연도-월 폴더를 선택하세요</p>
                </div>
              ) : (
                <>
                  {/* 열 헤더 */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100/60 text-[10px] font-semibold text-stone-500 sticky top-0 z-10 backdrop-blur-sm">
                    <div className="w-5 flex-shrink-0 text-center">상태</div>
                    <div className="flex-1 min-w-0">파일명</div>
                    <div className="w-12 text-right flex-shrink-0">크기</div>
                    <div className="w-14 text-right flex-shrink-0">청크</div>
                    <div className="w-5 flex-shrink-0" /> {/* 액션 버튼 공간 */}
                  </div>
                  <div className="divide-y divide-stone-200/40">
                    {documents
                      .filter(doc => {
                        // 검색 필터
                        if (fileSearchQuery && !doc.source_file.toLowerCase().includes(fileSearchQuery.toLowerCase())) {
                          return false;
                        }
                        // 상태 필터
                        if (statusFilter === "all") return true;
                        const result = chunkingResults.get(doc.doc_id);
                        if (!result) return statusFilter === "pending";
                        return result.status === statusFilter;
                      })
                      .map(doc => {
                        const result = chunkingResults.get(doc.doc_id);
                        const status = result?.status || "pending";
                        const error = result?.error;
                        
                        return (
                          <div 
                            key={doc.doc_id}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 hover:bg-white/40 transition-colors",
                              status === "failed" && "bg-red-50/50",
                              status === "success" && "bg-emerald-50/30"
                            )}
                          >
                            {/* 상태 아이콘 */}
                            <div className="w-5 flex-shrink-0 flex justify-center">
                              {status === "processing" && (
                                <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                              )}
                              {status === "success" && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              )}
                              {status === "failed" && (
                                <div className="relative">
                                  <AlertCircle 
                                    className="w-3.5 h-3.5 text-red-500 cursor-pointer"
                                    onMouseEnter={() => setShowErrorTooltip(doc.doc_id)}
                                    onMouseLeave={() => setShowErrorTooltip(null)}
                                  />
                                  {/* 에러 툴팁 */}
                                  {showErrorTooltip === doc.doc_id && error && (
                                    <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 w-64 p-2 bg-red-900 text-white text-[11px] rounded-lg shadow-lg whitespace-normal">
                                      <div className="font-semibold mb-1">청킹 실패 원인:</div>
                                      <div className="break-words">{error}</div>
                                      <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-red-900" />
                                    </div>
                                  )}
                                </div>
                              )}
                              {status === "pending" && (
                                <div className="w-3 h-3 rounded-full border-2 border-stone-300 bg-white" />
                              )}
                            </div>
                            
                            {/* 파일명 */}
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-medium text-stone-800 truncate" title={doc.source_file}>
                                {doc.source_file}
                              </div>
                              <div className="text-[10px] text-stone-500 truncate">
                                {doc.org_name} &gt; {doc.board_name}
                              </div>
                            </div>
                            
                            {/* 파일 크기 */}
                            <div className="w-12 text-right flex-shrink-0">
                              <span className="text-[10px] text-stone-500">{formatSize(doc.file_size)}</span>
                            </div>
                            
                            {/* 청크 수 */}
                            <div className="w-14 text-right flex-shrink-0">
                              {result?.chunks !== undefined ? (
                                <span className="text-[10px] font-medium text-stone-700">{result.chunks}개</span>
                              ) : (
                                <span className="text-[10px] text-stone-400">-</span>
                              )}
                            </div>
                            
                            {/* 액션 버튼 (실패 시 상세보기) */}
                            <div className="w-5 flex-shrink-0 flex justify-center">
                              {status === "failed" && (
                                <button
                                  onClick={() => {
                                    alert(`청킹 실패 원인:\n\n${error || "알 수 없는 오류"}`);
                                  }}
                                  className="p-0.5 rounded bg-red-100 hover:bg-red-200 text-red-600 transition-colors"
                                  title="에러 상세"
                                >
                                  <HelpCircle className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
            
            {/* 하단 요약 바 */}
            {documents.length > 0 && chunkingResults.size > 0 && (
              <div className="mt-2 pt-2 border-t border-stone-200/50 flex items-center justify-between text-[11px] text-stone-500">
                <span>
                  성공: {Array.from(chunkingResults.values()).filter(r => r.status === "success").length}개 / 
                  실패: {Array.from(chunkingResults.values()).filter(r => r.status === "failed").length}개
                </span>
                <span>
                  총 청크: {Array.from(chunkingResults.values()).reduce((sum, r) => sum + (r.chunks || 0), 0)}개
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* API 키 입력 모달 */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-100">
                  <Zap className="w-5 h-5 text-violet-600" />
                </div>
                <h3 className="text-lg font-bold text-stone-800">임베딩 생성</h3>
              </div>
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="p-2 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                />
                <p className="mt-2 text-xs text-stone-500">
                  API 키는 서버에 저장되지 않으며, 이 세션에서만 사용됩니다.
                </p>
              </div>
              
              <div className="p-4 rounded-xl bg-stone-50 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-stone-600">대상 청크</span>
                  <span className="font-medium text-stone-800">{stats?.totalChunks || 0}개</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-stone-600">선택 모델</span>
                  <span className="font-medium text-stone-800">
                    {embeddingSettings.model === "openai-small" ? "text-embedding-3-small" : 
                     embeddingSettings.model === "openai-large" ? "text-embedding-3-large" : embeddingSettings.model}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-stone-600">예상 비용</span>
                  <span className="font-medium text-amber-600">
                    ~${((computedStats?.totalTokens || 0) / 1_000_000 * (embeddingSettings.model === "openai-large" ? 0.13 : 0.02)).toFixed(4)}
                  </span>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowApiKeyModal(false)}
                  className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors font-medium"
                >
                  취소
                </button>
                <button
                  onClick={executeEmbedding}
                  disabled={!apiKey.trim()}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-medium transition-colors",
                    apiKey.trim()
                      ? "bg-violet-600 text-white hover:bg-violet-700"
                      : "bg-stone-200 text-stone-400 cursor-not-allowed"
                  )}
                >
                  임베딩 시작
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 내보내기 모달 */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-100">
                  <Download className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold text-stone-800">결과 내보내기</h3>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-2 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* 내보내기 미리보기 정보 */}
              {exportPreview ? (
                <div className="p-4 rounded-xl bg-stone-50 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-stone-600">총 청크</span>
                      <span className="font-medium text-stone-800">{exportPreview.totalChunks}개</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-600">텍스트</span>
                      <span className="font-medium text-stone-800">{exportPreview.textChunks}개</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-600">표</span>
                      <span className="font-medium text-stone-800">{exportPreview.tableChunks}개</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-600">임베딩됨</span>
                      <span className="font-medium text-emerald-600">{exportPreview.embeddedChunks}개</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-600">총 토큰</span>
                      <span className="font-medium text-stone-800">{formatTokens(exportPreview.totalTokens)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-600">문서 수</span>
                      <span className="font-medium text-stone-800">{exportPreview.documents}개</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-stone-50 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
                </div>
              )}
              
              {/* 내보내기 형식 선택 */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  내보내기 형식
                </label>
                <div className="flex gap-3">
                  <label
                    className={cn(
                      "flex-1 flex items-center gap-3 p-4 rounded-xl cursor-pointer border-2 transition-all",
                      exportFormat === "json"
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-stone-200 hover:border-stone-300"
                    )}
                  >
                    <input
                      type="radio"
                      name="exportFormat"
                      value="json"
                      checked={exportFormat === "json"}
                      onChange={() => setExportFormat("json")}
                      className="sr-only"
                    />
                    <FileJson className="w-6 h-6 text-emerald-600" />
                    <div>
                      <span className="font-medium text-stone-800 block">JSON</span>
                      <span className="text-xs text-stone-500">
                        ~{exportPreview ? formatSize(exportPreview.estimatedJsonSize) : "..."}
                      </span>
                    </div>
                  </label>
                  
                  <label
                    className={cn(
                      "flex-1 flex items-center gap-3 p-4 rounded-xl cursor-pointer border-2 transition-all",
                      exportFormat === "csv"
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-stone-200 hover:border-stone-300"
                    )}
                  >
                    <input
                      type="radio"
                      name="exportFormat"
                      value="csv"
                      checked={exportFormat === "csv"}
                      onChange={() => setExportFormat("csv")}
                      className="sr-only"
                    />
                    <FileType className="w-6 h-6 text-blue-600" />
                    <div>
                      <span className="font-medium text-stone-800 block">CSV</span>
                      <span className="text-xs text-stone-500">
                        ~{exportPreview ? formatSize(exportPreview.estimatedCsvSize) : "..."}
                      </span>
                    </div>
                  </label>
                </div>
              </div>
              
              {/* 임베딩 벡터 포함 옵션 (JSON만) */}
              {exportFormat === "json" && (
                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeEmbeddings}
                      onChange={(e) => setIncludeEmbeddings(e.target.checked)}
                      className="rounded accent-emerald-600 w-4 h-4"
                    />
                    <div>
                      <span className="text-sm text-stone-700">임베딩 벡터 포함</span>
                      <p className="text-xs text-stone-500">파일 크기가 크게 증가합니다</p>
                    </div>
                  </label>
                </div>
              )}
              
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors font-medium"
                >
                  취소
                </button>
                <button
                  onClick={executeExport}
                  disabled={exporting || !exportPreview || exportPreview.totalChunks === 0}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2",
                    exportPreview && exportPreview.totalChunks > 0
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-stone-200 text-stone-400 cursor-not-allowed"
                  )}
                >
                  {exporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      내보내는 중...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      내보내기
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 임베딩 비용 추이 모달 */}
      {showCostModal && (
        <EmbeddingCostModal 
          isOpen={showCostModal} 
          onClose={() => setShowCostModal(false)} 
        />
      )}
    </div>
  );
}

// ============================================================================
// 임베딩 비용 추이 모달 컴포넌트
// ============================================================================

interface CostChartData {
  date: string;
  cost: number;
  tokens: number;
  count: number;
  cumulativeCost: number;
}

interface CostHistoryResponse {
  success: boolean;
  period: string;
  chartData: CostChartData[];
  summary: {
    period_cost: number;
    period_tokens: number;
    period_count: number;
    total_cost: number;
    total_tokens: number;
    total_embeddings: number;
    model_costs: Record<string, { total: number; period: number }>;
    records_in_period: number;
  };
}

function EmbeddingCostModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<"week" | "month" | "quarter" | "year">("week");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CostHistoryResponse | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCostHistory();
    }
  }, [isOpen, period]);

  const loadCostHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/processing/embedding/cost-history?period=${period}`);
      const result = await res.json();
      if (result.success) {
        setData(result);
      }
    } catch (error) {
      console.error("Error loading cost history:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(6)}`;
    if (cost < 1) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  const periodLabels: Record<string, string> = {
    week: "주간",
    month: "월간",
    quarter: "분기",
    year: "연간",
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[900px] max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-stone-200">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-100">
              <BarChart3 className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-stone-800">임베딩 비용 추이</h3>
          </div>
          
          {/* 기간 선택 */}
          <div className="flex items-center gap-2">
            {(["week", "month", "quarter", "year"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  period === p
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                )}
              >
                {periodLabels[p]}
              </button>
            ))}
            <button
              onClick={onClose}
              className="ml-4 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
            >
              <X className="w-5 h-5 text-stone-500" />
            </button>
          </div>
        </div>

        {/* 콘텐츠 */}
        <div className="p-5 overflow-y-auto max-h-[calc(85vh-140px)]">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
            </div>
          ) : data ? (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200">
                  <div className="text-xs text-amber-600 font-medium mb-1">{periodLabels[period]} 비용</div>
                  <div className="text-xl font-bold text-amber-800">{formatCost(data.summary.period_cost)}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200">
                  <div className="text-xs text-blue-600 font-medium mb-1">{periodLabels[period]} 토큰</div>
                  <div className="text-xl font-bold text-blue-800">{formatTokens(data.summary.period_tokens)}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200">
                  <div className="text-xs text-emerald-600 font-medium mb-1">총 누적 비용</div>
                  <div className="text-xl font-bold text-emerald-800">{formatCost(data.summary.total_cost)}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200">
                  <div className="text-xs text-violet-600 font-medium mb-1">총 임베딩 수</div>
                  <div className="text-xl font-bold text-violet-800">{data.summary.total_embeddings.toLocaleString()}</div>
                </div>
              </div>

              {/* 그래프 */}
              <div className="bg-stone-50 rounded-xl p-4 mb-6">
                <h4 className="text-sm font-semibold text-stone-700 mb-4">비용 발생 내역 및 추세</h4>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 10, fill: "#6b7280" }}
                        tickLine={false}
                      />
                      <YAxis 
                        yAxisId="left"
                        tick={{ fontSize: 10, fill: "#6b7280" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `$${value.toFixed(4)}`}
                      />
                      <YAxis 
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10, fill: "#6b7280" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `$${value.toFixed(3)}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "white", 
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                          fontSize: "12px"
                        }}
                        formatter={((value: any, name: any) => {
                          const v = value ?? 0;
                          const n = name ?? "";
                          if (n === "cost" || n === "비용") return [formatCost(v), "비용"];
                          if (n === "cumulativeCost" || n === "누적 비용") return [formatCost(v), "누적 비용"];
                          return [v, n];
                        }) as any}
                      />
                      <Legend 
                        wrapperStyle={{ fontSize: "11px" }}
                        formatter={(value) => {
                          if (value === "cost") return "비용";
                          if (value === "cumulativeCost") return "누적 비용 (추세선)";
                          return value;
                        }}
                      />
                      <Bar 
                        yAxisId="left"
                        dataKey="cost" 
                        fill="#f59e0b" 
                        radius={[4, 4, 0, 0]}
                        name="비용"
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="cumulativeCost" 
                        stroke="#10b981" 
                        strokeWidth={2}
                        dot={false}
                        name="누적 비용 (추세선)"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 모델별 비용 상세 */}
              <div className="bg-stone-50 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-stone-700 mb-4">모델별 비용 현황</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-200">
                        <th className="text-left py-2 px-3 text-stone-600 font-medium">모델</th>
                        <th className="text-right py-2 px-3 text-stone-600 font-medium">{periodLabels[period]} 비용</th>
                        <th className="text-right py-2 px-3 text-stone-600 font-medium">총 비용</th>
                        <th className="text-right py-2 px-3 text-stone-600 font-medium">비율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(data.summary.model_costs).length > 0 ? (
                        Object.entries(data.summary.model_costs).map(([model, costs]) => (
                          <tr key={model} className="border-b border-stone-100 hover:bg-white transition-colors">
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-stone-800">{model}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right text-amber-600 font-medium">
                              {formatCost(costs.period)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-emerald-600 font-medium">
                              {formatCost(costs.total)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-stone-500">
                              {data.summary.total_cost > 0 
                                ? `${((costs.total / data.summary.total_cost) * 100).toFixed(1)}%`
                                : "0%"
                              }
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-stone-400">
                            아직 기록된 임베딩 비용이 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {Object.entries(data.summary.model_costs).length > 0 && (
                      <tfoot>
                        <tr className="bg-stone-100">
                          <td className="py-2.5 px-3 font-bold text-stone-700">합계</td>
                          <td className="py-2.5 px-3 text-right font-bold text-amber-700">
                            {formatCost(data.summary.period_cost)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                            {formatCost(data.summary.total_cost)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-stone-700">100%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-64 text-stone-400">
              데이터를 불러올 수 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
