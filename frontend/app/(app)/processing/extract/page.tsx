"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  FileText,
  Newspaper,
  ScrollText,
  Scale,
  ChevronRight,
  ChevronDown,
  Search,
  Check,
  X,
  RefreshCw,
  Download,
  Play,
  Eye,
  RotateCcw,
  Trash2,
  Settings,
  HelpCircle,
  Building2,
  Folder,
  FileSpreadsheet,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  ExternalLink,
  ChevronUp,
  Filter,
  Sparkles,
  Megaphone,
  FileType,
  FileImage,
  Table,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

// ============================================================================
// 타입 정의
// ============================================================================

type OrgStatus = "active" | "inactive";
type CollectionMode = "web_scraping" | "api_only" | "hybrid";
type OrganizationType = "국가기관" | "유관기관" | "협회 및 학회";

type Organization = {
  org_id: string;
  org_name: string;
  base_url: string;
  status: OrgStatus;
  default_policy: { rps: number; timeout_sec: number };
  notes?: string;
  collection_mode?: CollectionMode;
  org_type?: OrganizationType;
  logo_path?: string;
};

type BoardAccessMode = "api" | "static_html" | "dynamic_js" | "login_required";

type Board = {
  board_id: string;
  org_id: string;
  board_name: string;
  access_mode: BoardAccessMode;
  list_url?: string;
  doc_type?: string;
  domain_tags?: string[];
  enabled: boolean;
};

type TreeNodeType = "category" | "organization" | "board" | "date_folder";

interface TreeNodeStats {
  totalFiles: number;
  extractedFiles: number;
  pendingFiles: number;
  failedFiles: number;
  extractionRate: number;
}

interface TreeNode {
  id: string;
  type: TreeNodeType;
  name: string;
  icon?: string;
  logo?: string;
  children?: TreeNode[];
  isExpanded?: boolean;
  isChecked?: boolean;
  isIndeterminate?: boolean;
  stats?: TreeNodeStats;
  orgType?: string;
  docType?: string;
  path?: string;
  dateFolderPath?: string;  // 년월 폴더 전체 경로
}

type FileFormat = "pdf" | "hwp" | "hwpx" | "docx" | "xlsx" | "html" | "txt" | "other";
type ExtractStatus = "pending" | "processing" | "completed" | "failed" | "llm_fallback";

interface QualityDetails {
  korean_score?: number;      // 한국어 비율 점수
  broken_score?: number;      // 깨진 문자 점수
  sentence_score?: number;    // 문장 구조 점수
  repetition_score?: number;  // 반복 이상 점수
  encoding_score?: number;    // 인코딩 오류 점수
}

interface ExtractedFile {
  file_id: string;
  org_id: string;
  board_id: string;
  org_name: string;
  board_name: string;
  original_filename: string;
  file_format: FileFormat;
  file_size_bytes: number;
  file_path: string;
  status: ExtractStatus;
  extraction_method?: string;
  error_message?: string;
  quality_score?: number;
  quality_details?: QualityDetails;
  token_count?: number;
  extracted_at?: string;
  processing_time_ms?: number;
}

interface FormatStats {
  format: FileFormat;
  label: string;
  total: number;
  success: number;
  failed: number;
  rate: number;
  ocrRequired?: number;
  failedFiles?: RetryingFile[]; // 실패한 파일 목록
}

interface ExtractionSettings {
  ocr: {
    engine: "paddleocr" | "hybrid" | "easyocr" | "tesseract";
    languages: string[];           // OCR 언어 목록
    confidenceThreshold: number;   // OCR 신뢰도 임계값 (0.0~1.0)
    detDbThresh: number;           // 문자 감지 민감도
    detDbBoxThresh: number;        // 박스 감지 민감도
  };
  pdf: {
    preferTextLayer: boolean;
    enableOcr: boolean;
    extractImageText: boolean;
    forceOcrMode: boolean;         // 강제 OCR 모드
    hybridExtraction: boolean;     // 하이브리드 추출 (텍스트+OCR 병합)
    pageOptimalMethod: boolean;    // 페이지별 최적 방법 자동 선택
    crossPageTableMerge: boolean;  // Cross-page 표 병합 활성화
    mergeConfidenceThreshold: number; // 병합 신뢰도 임계값 (0.0~1.0)
    headerSimilarityThreshold: number; // 헤더 유사도 임계값 (0.0~1.0)
  };
  hwp: {
    preserveTableStructure: boolean;
    convertBullets: boolean;
    includeFootnotes: boolean;
  };
  preprocessing: {
    enabled: boolean;              // 전처리 활성화
    renderDpi: number;             // 렌더링 DPI (200, 300, 400, 600)
    deskew: boolean;               // 기울기 보정
    denoise: boolean;              // 노이즈 제거
    binarize: boolean;             // 이미지 이진화
    contrastEnhancement: boolean;  // 대비 강화
    adaptivePreprocessing: boolean; // 적응형 전처리
  };
  encoding: {
    autoDetect: boolean;           // 인코딩 자동 감지
    forceEncoding: string;         // 강제 인코딩 지정 (auto, utf-8, euc-kr, cp949)
    fixUtf16Errors: boolean;       // UTF-16 오류 복구
    removeBrokenChars: boolean;    // 깨진 문자 제거
  };
  postprocessing: {
    removeHeaders: boolean;
    removePageNumbers: boolean;
    normalizeWhitespace: boolean;
    ocrErrorCorrection: boolean;
    domainTermCorrection: boolean;
    normalizeSpecialChars: boolean; // 특수문자 정규화
  };
  tableNormalization: {
    flattenHeaders: boolean;
    fillEmptyCells: boolean;
  };
  qualityValidation: {
    enabled: boolean;
    passThreshold: number;
    llmFallbackThreshold: number;
    autoLlmFallback: boolean;
  };
  processing: {
    concurrentFiles: number;
    timeoutSeconds: number;
    autoRetry: boolean;
    maxRetries: number;
  };
  retryStrategy: {
    enableProgressiveRetry: boolean;  // 단계적 재시도 활성화
    multiEngineComparison: boolean;   // 다중 엔진 비교
    qualityBasedAdjustment: boolean;  // 품질 항목별 자동 조정
  };
  preset: "default" | "scanned" | "encodingError" | "lowQuality" | "custom"; // 프리셋
}

// 재추출 프리셋 정의
const extractionPresets: Record<string, Partial<ExtractionSettings>> = {
  default: {},
  scanned: {
    // 스캔 문서용 프리셋
    ocr: {
      engine: "paddleocr",
      languages: ["korean", "en"],
      confidenceThreshold: 0.3,
      detDbThresh: 0.2,
      detDbBoxThresh: 0.4,
    },
    pdf: {
      preferTextLayer: false,
      enableOcr: true,
      extractImageText: true,
      forceOcrMode: true,
      hybridExtraction: false,
      pageOptimalMethod: false,
      crossPageTableMerge: false,
      mergeConfidenceThreshold: 0.7,
      headerSimilarityThreshold: 0.8,
    },
    preprocessing: {
      enabled: true,
      renderDpi: 400,
      deskew: true,
      denoise: true,
      binarize: true,
      contrastEnhancement: true,
      adaptivePreprocessing: true,
    },
  },
  encodingError: {
    // 인코딩 오류용 프리셋
    encoding: {
      autoDetect: true,
      forceEncoding: "auto",
      fixUtf16Errors: true,
      removeBrokenChars: true,
    },
    postprocessing: {
      removeHeaders: true,
      removePageNumbers: true,
      normalizeWhitespace: true,
      ocrErrorCorrection: true,
      domainTermCorrection: true,
      normalizeSpecialChars: true,
    },
  },
  lowQuality: {
    // 저품질 재추출용 프리셋
    ocr: {
      engine: "hybrid",
      languages: ["korean", "en"],
      confidenceThreshold: 0.2,
      detDbThresh: 0.15,
      detDbBoxThresh: 0.3,
    },
    preprocessing: {
      enabled: true,
      renderDpi: 600,
      deskew: true,
      denoise: true,
      binarize: true,
      contrastEnhancement: true,
      adaptivePreprocessing: true,
    },
    retryStrategy: {
      enableProgressiveRetry: true,
      multiEngineComparison: true,
      qualityBasedAdjustment: true,
    },
  },
};

const defaultSettings: ExtractionSettings = {
  ocr: {
    engine: "paddleocr",
    languages: ["korean", "en"],
    confidenceThreshold: 0.5,
    detDbThresh: 0.3,
    detDbBoxThresh: 0.5,
  },
  pdf: {
    preferTextLayer: true,
    enableOcr: true,
    extractImageText: false,
    forceOcrMode: false,
    hybridExtraction: false,
    pageOptimalMethod: false,
    crossPageTableMerge: true,
    mergeConfidenceThreshold: 0.7,
    headerSimilarityThreshold: 0.9,
  },
  hwp: { preserveTableStructure: true, convertBullets: true, includeFootnotes: true },
  preprocessing: {
    enabled: true,
    renderDpi: 300,
    deskew: true,
    denoise: true,
    binarize: false,
    contrastEnhancement: true,
    adaptivePreprocessing: true,
  },
  encoding: {
    autoDetect: true,
    forceEncoding: "auto",
    fixUtf16Errors: true,
    removeBrokenChars: true,
  },
  postprocessing: {
    removeHeaders: true,
    removePageNumbers: true,
    normalizeWhitespace: true,
    ocrErrorCorrection: true,
    domainTermCorrection: true,
    normalizeSpecialChars: true,
  },
  tableNormalization: {
    flattenHeaders: true,
    fillEmptyCells: true,
  },
  qualityValidation: {
    enabled: true,
    passThreshold: 0.85,
    llmFallbackThreshold: 0.5,
    autoLlmFallback: false,
  },
  processing: { concurrentFiles: 3, timeoutSeconds: 300, autoRetry: true, maxRetries: 2 },
  retryStrategy: {
    enableProgressiveRetry: false,
    multiEngineComparison: false,
    qualityBasedAdjustment: false,
  },
  preset: "default",
};

// ============================================================================
// 유틸리티 함수
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusIcon(status: ExtractStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    case "processing":
      return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
    case "pending":
      return <Clock className="w-4 h-4 text-stone-500" />;
    case "failed":
      return <AlertCircle className="w-4 h-4 text-red-600" />;
    case "llm_fallback":
      return <RefreshCw className="w-4 h-4 text-amber-600" />;
    default:
      return <Clock className="w-4 h-4 text-stone-500" />;
  }
}

function getStatusLabel(status: ExtractStatus): string {
  switch (status) {
    case "completed":
      return "완료";
    case "processing":
      return "진행중";
    case "pending":
      return "대기";
    case "failed":
      return "실패";
    case "llm_fallback":
      return "LLM 전환";
    default:
      return "알 수 없음";
  }
}

function getStatusBadgeClass(status: ExtractStatus): string {
  switch (status) {
    case "completed":
      return "bg-gradient-to-r from-emerald-100 to-emerald-50 text-emerald-700 border border-emerald-200/50";
    case "processing":
      return "bg-gradient-to-r from-blue-100 to-blue-50 text-blue-700 border border-blue-200/50";
    case "pending":
      return "bg-gradient-to-r from-stone-100 to-stone-50 text-stone-600 border border-stone-200/50";
    case "failed":
      return "bg-gradient-to-r from-red-100 to-red-50 text-red-700 border border-red-200/50";
    case "llm_fallback":
      return "bg-gradient-to-r from-amber-100 to-amber-50 text-amber-700 border border-amber-200/50";
    default:
      return "bg-gradient-to-r from-stone-100 to-stone-50 text-stone-600 border border-stone-200/50";
  }
}

function getFormatIcon(format: FileFormat) {
  switch (format) {
    case "pdf":
      return <FileText className="w-4 h-4 text-red-500" />;
    case "hwp":
      return <FileType className="w-4 h-4 text-blue-600" />;
    case "hwpx":
      return <FileType className="w-4 h-4 text-sky-500" />;
    case "docx":
      return <FileText className="w-4 h-4 text-blue-700" />;
    case "xlsx":
      return <Table className="w-4 h-4 text-emerald-600" />;
    case "html":
      return <FileImage className="w-4 h-4 text-orange-500" />;
    default:
      return <FileText className="w-4 h-4 text-stone-500" />;
  }
}

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

// API 호출 유틸리티
async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(input, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return data;
  } catch (err: any) {
    // AbortError는 무시 (정상적인 요청 취소)
    if (err.name === "AbortError") {
      throw err;
    }
    console.error(`[API] Fetch failed for ${input}:`, err.message);
    throw err;
  }
}

// ============================================================================
// 컴포넌트: 도넛 차트 (애니메이션 효과 포함)
// ============================================================================

function DonutChart({
  percentage,
  label,
  subLabel,
  color,
  animated = false,
}: {
  percentage: number;
  label: string;
  subLabel: string;
  color: "blue" | "emerald" | "amber";
  animated?: boolean;
}) {
  const [displayPercentage, setDisplayPercentage] = useState(0);
  const circumference = 2 * Math.PI * 42;
  const strokeDashoffset = circumference - (displayPercentage / 100) * circumference;

  // 애니메이션 효과: percentage가 변경될 때 부드럽게 증가
  useEffect(() => {
    if (animated && percentage > 0) {
      const duration = 1000; // 1초
      const steps = 30;
      const increment = percentage / steps;
      let current = 0;
      const timer = setInterval(() => {
        current += increment;
        if (current >= percentage) {
          setDisplayPercentage(percentage);
          clearInterval(timer);
        } else {
          setDisplayPercentage(Math.round(current));
        }
      }, duration / steps);
      return () => clearInterval(timer);
    } else {
      setDisplayPercentage(percentage);
    }
  }, [percentage, animated]);

  // 고정된 ID 사용 (hydration 에러 방지)
  const gradientId = `donut-gradient-${color}`;

  const gradientColors = {
    blue: { start: "#3B82F6", end: "#60A5FA" },
    emerald: { start: "#10B981", end: "#34D399" },
    amber: { start: "#F59E0B", end: "#FBBF24" },
  }[color];

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={gradientColors.start} />
              <stop offset="100%" stopColor={gradientColors.end} />
            </linearGradient>
          </defs>
          {/* 배경 원 */}
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#E7E5E4"
            strokeWidth="12"
          />
          {/* 진행률 원 (그라데이션) - 애니메이션 효과 */}
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            stroke={`url(#${gradientId})`}
            className="transition-all duration-500 ease-out"
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: strokeDashoffset,
            }}
          />
        </svg>
        {/* 중앙 텍스트 (투명 배경) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-stone-800 transition-all duration-300">
            {displayPercentage}%
          </span>
          <span className="text-xs text-stone-500">{label}</span>
        </div>
      </div>
      <span className="mt-2 text-sm text-stone-600 font-medium">{subLabel}</span>
    </div>
  );
}

// ============================================================================
// 컴포넌트: 실패 파일 재시도 진행률 아이템
// ============================================================================

interface RetryingFile {
  file_id: string;
  original_filename: string;
  quality_score?: number;
  previous_score?: number;  // 재시도 전 점수
  status: ExtractStatus;
  progress?: number; // 0-100
  passed?: boolean; // 기준율 통과 여부
}

function FailedFileItem({
  file,
  isRetrying,
  passThreshold,
}: {
  file: RetryingFile;
  isRetrying: boolean;
  passThreshold: number;
}) {
  const progress = file.progress ?? 0;
  const passed = file.quality_score !== undefined && file.quality_score >= passThreshold;
  const hasImproved = file.previous_score !== undefined && 
                      file.quality_score !== undefined && 
                      file.quality_score > file.previous_score;
  const scoreDiff = file.previous_score !== undefined && file.quality_score !== undefined
    ? Math.round((file.quality_score - file.previous_score) * 100)
    : 0;
  
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-white/30 hover:bg-white/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium text-stone-700 truncate">{file.original_filename}</div>
        {isRetrying && file.status === "processing" && (
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-stone-200/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[9px] text-blue-600 font-medium">{progress}%</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* 이전 점수 (있는 경우) */}
        {file.previous_score !== undefined && (
          <span className="text-[9px] text-stone-400">
            {Math.round(file.previous_score * 100)}%
          </span>
        )}
        {/* 화살표 (점수 변동이 있는 경우) */}
        {file.previous_score !== undefined && file.quality_score !== undefined && (
          <span className={cn(
            "text-[9px]",
            hasImproved ? "text-emerald-600" : scoreDiff < 0 ? "text-red-600" : "text-stone-400"
          )}>
            →
          </span>
        )}
        {file.status === "processing" ? (
          <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
        ) : file.status === "completed" || file.quality_score !== undefined ? (
          <>
            <span className={cn(
              "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
              passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            )}>
              {file.quality_score !== undefined ? `${Math.round(file.quality_score * 100)}%` : "-"}
            </span>
            {/* 점수 변동 표시 */}
            {scoreDiff !== 0 && (
              <span className={cn(
                "text-[8px] font-bold",
                scoreDiff > 0 ? "text-emerald-600" : "text-red-600"
              )}>
                {scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff}
              </span>
            )}
            {passed ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            ) : (
              <AlertCircle className="w-3 h-3 text-red-500" />
            )}
          </>
        ) : file.status === "failed" ? (
          <>
            {file.quality_score !== undefined && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                {Math.round(file.quality_score * 100)}%
              </span>
            )}
            <X className="w-3 h-3 text-red-500" />
          </>
        ) : (
          <Clock className="w-3 h-3 text-stone-400" />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 컴포넌트: 수평 바 차트 (글라스 효과 + 그라데이션 + 실패 목록)
// ============================================================================

function HorizontalBar({
  stat,
  onClick,
  failedFiles,
  isRetrying,
  passThreshold = 0.85,
  onRetryFormat,
  previousScores,
}: {
  stat: FormatStats;
  onClick?: () => void;
  failedFiles?: RetryingFile[];
  isRetrying?: boolean;
  passThreshold?: number;
  onRetryFormat?: (format: FileFormat) => void;
  previousScores?: Map<string, number>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const barGradient =
    stat.rate >= 90
      ? "from-emerald-400 to-emerald-500"
      : stat.rate >= 70
        ? "from-amber-400 to-amber-500"
        : "from-red-400 to-red-500";

  const Icon = () => getFormatIcon(stat.format as FileFormat);
  const hasFailedFiles = failedFiles && failedFiles.length > 0;

  return (
    <div className="rounded-xl transition-all duration-200">
      <div
        className="group cursor-pointer hover:bg-white/40 rounded-xl p-3 -mx-2 transition-all duration-200 hover:shadow-md"
        onClick={onClick}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm shadow-sm">
              <Icon />
            </div>
            <span className="text-sm font-semibold text-stone-700">{stat.label}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span>{stat.total}개</span>
            <span
              className={cn(
                "px-2.5 py-1 rounded-full font-semibold backdrop-blur-sm shadow-sm",
                stat.rate >= 90
                  ? "bg-gradient-to-r from-emerald-100/80 to-emerald-50/80 text-emerald-700 border border-emerald-200/50"
                  : stat.rate >= 70
                    ? "bg-gradient-to-r from-amber-100/80 to-amber-50/80 text-amber-700 border border-amber-200/50"
                    : "bg-gradient-to-r from-red-100/80 to-red-50/80 text-red-700 border border-red-200/50"
              )}
            >
              {stat.rate}%
            </span>
          </div>
        </div>
        {/* 진행률 바 (글라스 효과) */}
        <div className="w-full h-3 bg-white/40 backdrop-blur-sm rounded-full overflow-hidden shadow-inner border border-white/60">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700 bg-gradient-to-r shadow-sm",
              barGradient
            )}
            style={{ width: `${stat.rate}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-stone-500">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            성공: {stat.success}
          </span>
          <span className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-red-500" />
            실패: {stat.failed}
          </span>
          {stat.ocrRequired !== undefined && (
            <span className="flex items-center gap-1 text-amber-600">
              <Eye className="w-3 h-3" />
              OCR 필요: {stat.ocrRequired}
            </span>
          )}
          {/* 실패 목록 확장 버튼 */}
          {hasFailedFiles && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="ml-auto flex items-center gap-1 text-red-600 hover:text-red-700 transition-colors"
            >
              <span className="text-[10px]">실패 목록</span>
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>
      
      {/* 실패 파일 목록 (확장 시 표시) */}
      {isExpanded && hasFailedFiles && (
        <div className="mt-2 mx-1 p-2 rounded-lg bg-red-50/50 border border-red-200/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-red-700">실패 파일 ({failedFiles.length}개)</span>
            {onRetryFormat && !isRetrying && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryFormat(stat.format as FileFormat);
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 hover:bg-red-200 text-red-700 text-[9px] font-medium transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                재시도
              </button>
            )}
            {isRetrying && (
              <span className="flex items-center gap-1 text-[9px] text-blue-600">
                <Loader2 className="w-3 h-3 animate-spin" />
                재시도 중...
              </span>
            )}
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {failedFiles.map((file) => (
              <FailedFileItem 
                key={file.file_id} 
                file={{
                  ...file,
                  previous_score: previousScores?.get(file.file_id),
                }} 
                isRetrying={isRetrying || false}
                passThreshold={passThreshold}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 컴포넌트: 트리뷰 노드
// ============================================================================

function TreeNodeComponent({
  node,
  depth = 0,
  onToggleExpand,
  onToggleCheck,
  onNodeClick,
}: {
  node: TreeNode;
  depth?: number;
  onToggleExpand: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onNodeClick: (node: TreeNode) => void;
}) {
  const paddingLeft = depth * 20;
  const hasChildren = node.children && node.children.length > 0;

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

        {/* 체크박스 (글라스 스타일) */}
        {node.type !== "category" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck(node.id);
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
              // 하위 노드가 없는 경우 (년도-월 노드 등) 선택/해제
              onToggleCheck(node.id);
            }
            onNodeClick(node);
          }}
        >
          {node.name}
        </span>

        {/* 통계 배지 */}
        {node.stats && (
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span className="hidden sm:inline px-2 py-0.5 rounded-full bg-white/50 backdrop-blur-sm">
              {node.stats.totalFiles}개
            </span>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full font-medium backdrop-blur-sm shadow-sm",
                node.stats.extractionRate >= 90
                  ? "bg-gradient-to-r from-emerald-100/80 to-emerald-50/80 text-emerald-700 border border-emerald-200/50"
                  : node.stats.extractionRate >= 70
                    ? "bg-gradient-to-r from-amber-100/80 to-amber-50/80 text-amber-700 border border-amber-200/50"
                    : "bg-gradient-to-r from-red-100/80 to-red-50/80 text-red-700 border border-red-200/50"
              )}
            >
              {node.stats.extractionRate}%
            </span>
          </div>
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
              onNodeClick={onNodeClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 컴포넌트: 파일 테이블 행
// ============================================================================

function FileTableRow({
  file,
  isSelected,
  onSelect,
  onView,
  onRetry,
}: {
  file: ExtractedFile;
  isSelected: boolean;
  onSelect: () => void;
  onView: () => void;
  onRetry: () => void;
}) {
  return (
    <tr className={cn(
      "border-b border-stone-200/40 transition-all duration-200",
      isSelected ? "bg-primary/5" : "hover:bg-white/40"
    )}>
      <td className="px-4 py-3">
        <button
          onClick={onSelect}
          className={cn(
            "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shadow-sm",
            isSelected
              ? "bg-gradient-to-br from-primary to-primary/80 border-primary text-white"
              : "border-stone-300 bg-white/60 backdrop-blur-sm hover:border-primary/50"
          )}
        >
          {isSelected && <Check className="w-3 h-3" />}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm shadow-sm">
            {getFormatIcon(file.file_format)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-stone-800 truncate max-w-[200px]">{file.original_filename}</div>
            <div className="text-xs text-stone-500">
              {file.org_name} &gt; {file.board_name}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs font-semibold text-stone-600 uppercase px-2 py-1 rounded-md bg-white/50 backdrop-blur-sm">
          {file.file_format}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-stone-600">{formatFileSize(file.file_size_bytes)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {getStatusIcon(file.status)}
          <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", getStatusBadgeClass(file.status))}>
            {getStatusLabel(file.status)}
          </span>
        </div>
        {file.error_message && <div className="text-xs text-red-600 mt-1">{file.error_message}</div>}
      </td>
      <td className="px-4 py-3">
        {file.quality_score !== undefined && (
          <span
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm",
              file.quality_score >= 0.85
                ? "bg-gradient-to-r from-emerald-100/80 to-emerald-50/80 text-emerald-700 border border-emerald-200/50"
                : file.quality_score >= 0.7
                  ? "bg-gradient-to-r from-amber-100/80 to-amber-50/80 text-amber-700 border border-amber-200/50"
                  : "bg-gradient-to-r from-red-100/80 to-red-50/80 text-red-700 border border-red-200/50"
            )}
          >
            {(file.quality_score * 100).toFixed(0)}%
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {(file.status === "completed" || file.status === "failed") && (
            <button
              onClick={onView}
              className={cn(
                "p-2 rounded-lg backdrop-blur-sm transition-all shadow-sm",
                file.status === "completed"
                  ? "bg-white/50 hover:bg-white/80 text-stone-500 hover:text-stone-700"
                  : "bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700"
              )}
              title="미리보기"
            >
              {file.status === "completed" ? <Eye className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            </button>
          )}
          {file.status === "pending" && (
            <button
              onClick={onRetry}
              className="p-2 rounded-lg bg-white/50 backdrop-blur-sm hover:bg-white/80 text-stone-500 hover:text-stone-700 transition-all shadow-sm"
              title="추출 시작"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// 컴포넌트: 추출 결과 미리보기 모달
// ============================================================================

function PreviewModal({
  file,
  onClose,
}: {
  file: ExtractedFile | null;
  onClose: () => void;
}) {
  const [extractedText, setExtractedText] = useState<string>("");
  const [extractedTables, setExtractedTables] = useState<any[]>([]);
  const [extractedMetadata, setExtractedMetadata] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 추출된 텍스트 로드 (성공/실패 모두 시도)
  useEffect(() => {
    // 완료 또는 실패 상태에서 텍스트 로드 시도
    if (!file || (file.status !== "completed" && file.status !== "failed")) return;

    const loadExtractedText = async () => {
      setIsLoading(true);
      setLoadError(null);
      
      try {
        // 추출된 텍스트 파일 경로 생성
        const response = await fetch(`/api/processing/extract/text?file_path=${encodeURIComponent(file.file_path)}`);
        
        if (response.ok) {
          const data = await response.json();
          setExtractedText(data.text || "추출된 텍스트가 없습니다.");
          // JSON 형식인 경우 추가 데이터 저장
          if (data.is_json_format) {
            setExtractedTables(data.tables || []);
            setExtractedMetadata(data.metadata || {});
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          // 실패한 경우에도 에러 텍스트 표시
          if (errorData.text) {
            setExtractedText(errorData.text);
          } else if (file.status === "failed") {
            setExtractedText(`추출에 실패한 파일입니다.\n\n품질 점수: ${((file.quality_score || 0) * 100).toFixed(1)}%\n\n텍스트 파일이 저장되지 않았거나 인코딩 오류로 인해 추출에 실패했을 수 있습니다.\n\n다른 설정으로 재추출을 시도해보세요.`);
          } else {
            setExtractedText("추출된 텍스트를 불러올 수 없습니다.\n\n백엔드 서버에서 텍스트 조회 API를 확인해주세요.");
          }
          setLoadError("텍스트 로드 실패");
        }
      } catch (err) {
        console.error("[미리보기] 텍스트 로드 실패:", err);
        setExtractedText("텍스트를 불러오는 중 오류가 발생했습니다.");
        setLoadError("네트워크 오류");
      } finally {
        setIsLoading(false);
      }
    };

    loadExtractedText();
  }, [file]);

  // 전체 텍스트 복사
  const handleCopyText = useCallback(() => {
    navigator.clipboard.writeText(extractedText);
    alert("텍스트가 클립보드에 복사되었습니다.");
  }, [extractedText]);

  // JSON 다운로드 (RAG 최적화 형식)
  const handleDownloadJson = useCallback(() => {
    if (!file) return;
    
    // JSON 데이터 구성
    const jsonData = {
      metadata: {
        source_file: file.file_path,
        original_filename: file.original_filename,
        file_format: file.file_format,
        quality_score: file.quality_score,
        extracted_at: file.extracted_at || new Date().toISOString(),
        ...extractedMetadata
      },
      content: {
        text: extractedText,
        text_length: extractedText.length,
      },
      tables: extractedTables,
    };
    
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.original_filename.replace(/\.[^/.]+$/, "")}_extracted.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [extractedText, extractedTables, extractedMetadata, file]);

  if (!file) return null;

  // 미리보기용 텍스트 (처음 1000자)
  const previewText = extractedText.length > 1000 
    ? extractedText.slice(0, 1000) + "..."
    : extractedText;

  // 추출일 표시 (현재 시간 또는 extracted_at)
  const extractionDate = file.extracted_at 
    ? formatDate(file.extracted_at) 
    : new Date().toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <>
      {/* 오버레이 배경 */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />
      
      {/* 모달 컨테이너 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div 
          className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 모달 헤더 */}
          <div className="flex items-center justify-between p-5 border-b border-stone-200/60">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10">
                <Eye className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-800">추출 결과 미리보기</h3>
                <p className="text-xs text-stone-500 truncate max-w-md">{file.original_filename}</p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-500 hover:text-stone-700 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 모달 본문 */}
          <div className="p-5 overflow-y-auto" style={{ maxHeight: "calc(90vh - 180px)" }}>
            {/* 파일 정보 */}
            <div className="bg-gradient-to-r from-stone-50 to-stone-100/50 rounded-xl p-4 mb-4 border border-stone-200/60">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase mb-0.5">추출일</span>
                  <span className="text-stone-700 font-medium">{extractionDate}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase mb-0.5">소요 시간</span>
                  <span className="text-stone-700 font-medium">
                    {file.processing_time_ms 
                      ? file.processing_time_ms > 1000 
                        ? `${(file.processing_time_ms / 1000).toFixed(1)}초`
                        : `${file.processing_time_ms}ms`
                      : "-"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase mb-0.5">토큰 수</span>
                  <span className="text-stone-700 font-medium">
                    {file.token_count 
                      ? file.token_count.toLocaleString() 
                      : extractedText.length > 0 
                        ? `약 ${Math.round(extractedText.length / 4).toLocaleString()}`
                        : "-"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase mb-0.5">품질 점수</span>
                  <span className={cn(
                    "font-bold",
                    file.quality_score !== undefined
                      ? file.quality_score >= 0.85
                        ? "text-emerald-600"
                        : file.quality_score >= 0.7
                          ? "text-amber-600"
                          : "text-red-600"
                      : "text-stone-400"
                  )}>
                    {file.quality_score !== undefined ? `${(file.quality_score * 100).toFixed(0)}%` : "-"}
                  </span>
                </div>
              </div>
            </div>

            {/* 품질 점수 상세 항목 */}
            {file.quality_score !== undefined && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50/50 border border-blue-200/60 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-blue-700">품질 점수 상세</span>
                  <div className="group relative">
                    <HelpCircle className="w-3.5 h-3.5 text-blue-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-72 p-3 bg-stone-800 text-white text-[10px] rounded-lg shadow-xl z-50">
                      <div className="font-semibold mb-2">품질 점수 산정 기준</div>
                      <div className="space-y-1.5 text-stone-300">
                        <p><strong className="text-white">한국어 비율 (30%)</strong>: 추출된 텍스트 중 한국어 문자의 비율. 높을수록 좋음.</p>
                        <p><strong className="text-white">깨진 문자 (25%)</strong>: 비정상적인 문자나 깨진 글자의 비율. 낮을수록 좋음.</p>
                        <p><strong className="text-white">문장 구조 (15%)</strong>: 마침표, 물음표 등 문장 부호의 적절성. 정상적인 문장 구조 여부.</p>
                        <p><strong className="text-white">반복 이상 (10%)</strong>: 동일 패턴의 비정상적 반복 여부. 반복이 적을수록 좋음.</p>
                        <p><strong className="text-white">인코딩 오류 (20%)</strong>: UTF-16/UTF-8 인코딩 오류 감지. 오류가 없을수록 좋음.</p>
                      </div>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full">
                        <div className="border-8 border-transparent border-t-stone-800" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {/* 한국어 비율 */}
                  <div className="bg-white/60 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-stone-500 mb-1">한국어 비율</div>
                    <div className="text-xs font-bold text-blue-600">
                      {file.quality_details?.korean_score !== undefined 
                        ? `${Math.round(file.quality_details.korean_score * 100)}%`
                        : "-"}
                    </div>
                    <div className="text-[8px] text-stone-400 mt-0.5">가중치 30%</div>
                  </div>
                  {/* 깨진 문자 */}
                  <div className="bg-white/60 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-stone-500 mb-1">깨진 문자</div>
                    <div className="text-xs font-bold text-blue-600">
                      {file.quality_details?.broken_score !== undefined 
                        ? `${Math.round(file.quality_details.broken_score * 100)}%`
                        : "-"}
                    </div>
                    <div className="text-[8px] text-stone-400 mt-0.5">가중치 25%</div>
                  </div>
                  {/* 문장 구조 */}
                  <div className="bg-white/60 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-stone-500 mb-1">문장 구조</div>
                    <div className="text-xs font-bold text-blue-600">
                      {file.quality_details?.sentence_score !== undefined 
                        ? `${Math.round(file.quality_details.sentence_score * 100)}%`
                        : "-"}
                    </div>
                    <div className="text-[8px] text-stone-400 mt-0.5">가중치 15%</div>
                  </div>
                  {/* 반복 이상 */}
                  <div className="bg-white/60 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-stone-500 mb-1">반복 이상</div>
                    <div className="text-xs font-bold text-blue-600">
                      {file.quality_details?.repetition_score !== undefined 
                        ? `${Math.round(file.quality_details.repetition_score * 100)}%`
                        : "-"}
                    </div>
                    <div className="text-[8px] text-stone-400 mt-0.5">가중치 10%</div>
                  </div>
                  {/* 인코딩 오류 */}
                  <div className="bg-white/60 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-stone-500 mb-1">인코딩 오류</div>
                    <div className="text-xs font-bold text-blue-600">
                      {file.quality_details?.encoding_score !== undefined 
                        ? `${Math.round(file.quality_details.encoding_score * 100)}%`
                        : "-"}
                    </div>
                    <div className="text-[8px] text-stone-400 mt-0.5">가중치 20%</div>
                  </div>
                </div>
              </div>
            )}

            {/* 메타데이터 */}
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-xl p-4 mb-4">
              <div className="text-xs font-semibold text-primary mb-2">메타데이터</div>
              <div className="grid grid-cols-2 gap-3 text-sm text-stone-600">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-stone-400" />
                  <span>{file.org_name} &gt; {file.board_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-stone-400" />
                  <span>{file.file_format.toUpperCase()} · {formatFileSize(file.file_size_bytes)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-stone-400" />
                  <span>추출 방법: {file.extraction_method || "기본 추출기"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-stone-400" />
                  <span>문자 수: {extractedText.length.toLocaleString()}자</span>
                </div>
              </div>
            </div>

            {/* 추출된 텍스트 */}
            <div className="bg-white rounded-xl border border-stone-200/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-stone-200/60">
                <span className="text-xs font-semibold text-stone-600">
                  추출된 텍스트 {!showFullText && extractedText.length > 1000 && "(처음 1000자)"}
                </span>
                {extractedText.length > 1000 && (
                  <button
                    onClick={() => setShowFullText(!showFullText)}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    {showFullText ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        접기
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        전체 보기
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className={cn(
                "p-4 overflow-y-auto transition-all duration-300",
                showFullText ? "max-h-[400px]" : "max-h-[200px]"
              )}>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 text-stone-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    텍스트를 불러오는 중...
                  </div>
                ) : loadError ? (
                  <div className="text-sm text-amber-600 bg-amber-50 rounded-lg p-3">
                    {extractedText}
                  </div>
                ) : (
                  <pre className="text-sm text-stone-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {showFullText ? extractedText : previewText}
                  </pre>
                )}
              </div>
            </div>
          </div>

          {/* 모달 푸터 */}
          <div className="flex items-center justify-between gap-3 p-5 border-t border-stone-200/60 bg-stone-50/50">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-200 transition-all"
            >
              닫기
            </button>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleCopyText}
                disabled={isLoading || !extractedText}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Copy className="w-4 h-4" />
                전체 텍스트 복사
              </button>
              <button 
                onClick={handleDownloadJson}
                disabled={isLoading || !extractedText}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                JSON 다운로드
              </button>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-stone-800 to-stone-900 text-white hover:from-black hover:to-stone-800 transition-all shadow-lg">
                <ExternalLink className="w-4 h-4" />
                청킹/벡터화로 이동
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// 메인 페이지 컴포넌트
// ============================================================================

// 년월 폴더 통계 타입
interface DateFolderStats {
  folder_name: string;
  folder_path: string;
  total_files: number;
}

// 기관/보드별 파일 통계 타입
interface OrgStatsData {
  org_id: string;
  total_files: number;
  extracted_files: number;
  pending_files: number;
  failed_files: number;
  boards: {
    board_id: string;
    total_files: number;
    extracted_files: number;
    pending_files: number;
    failed_files: number;
    date_folders?: DateFolderStats[];
  }[];
}

export default function TextExtractionPage(): React.JSX.Element {
  // API에서 가져온 실제 데이터
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [orgStats, setOrgStats] = useState<Record<string, OrgStatsData>>({});
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);

  // 트리뷰 데이터 (실제 기관/보드 기반)
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<ExtractedFile[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [refreshTrigger, setRefreshTrigger] = useState(0); // 파일 목록 새로고침 트리거
  const [previewFile, setPreviewFile] = useState<ExtractedFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<FileFormat | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ExtractStatus | "all">("all");
  const [settings, setSettings] = useState<ExtractionSettings>(defaultSettings);
  
  // 파일 목록 정렬 상태
  type SortKey = "filename" | "quality" | "format" | "size" | "status";
  type SortOrder = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("filename");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  
  // 정렬 토글 핸들러
  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  }, [sortKey]);

  // 추출 진행 상태
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState({
    current: 0,
    total: 0,
    currentFile: "",
    status: "" as "" | "processing" | "completed" | "error",
  });
  
  // 추출 결과 통계 (최근 작업용)
  const [lastExtractionStats, setLastExtractionStats] = useState({
    completedAt: "",
    duration: "",
    totalTokens: 0,
    usedLLM: false,
  });
  
  // 재시도 통계 (실패 파일의 이전 점수 및 재시도 결과)
  const [retryStats, setRetryStats] = useState<{
    totalRetried: number;  // 재시도한 총 파일 수
    improved: number;      // 품질 임계값 이상으로 향상된 파일 수
    previousScores: Map<string, number>;  // file_id -> 이전 품질 점수
  }>({
    totalRetried: 0,
    improved: 0,
    previousScores: new Map(),
  });

  // API에서 기관/보드 데이터 및 파일 통계 가져오기
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [orgsRes, boardsRes, statsRes] = await Promise.all([
          jsonFetch<{ orgs: Organization[] }>("/api/scraper/targets/orgs"),
          jsonFetch<{ boards: Board[] }>("/api/scraper/targets/boards"),
          jsonFetch<{ org_stats: Record<string, OrgStatsData>; total_files: number }>("/api/scraper/extract/stats"),
        ]);
        setOrgs(orgsRes.orgs || []);
        setBoards(boardsRes.boards || []);
        setOrgStats(statsRes.org_stats || {});
      } catch (err) {
        console.error("Failed to fetch data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // 실제 기관/보드 데이터를 트리뷰 구조로 변환 (실제 파일 통계 사용)
  useEffect(() => {
    if (orgs.length === 0) return;

    // 기관 유형별로 그룹화
    const orgsByType: Record<string, Organization[]> = {
      "국가기관": [],
      "유관기관": [],
      "협회 및 학회": [],
    };

    orgs.forEach((org) => {
      const type = org.org_type || "유관기관";
      if (!orgsByType[type]) orgsByType[type] = [];
      orgsByType[type].push(org);
    });

    // 트리 노드 생성 (실제 파일 통계 사용)
    const tree: TreeNode[] = Object.entries(orgsByType)
      .filter(([, orgList]) => orgList.length > 0)
      .map(([category, orgList]) => ({
        id: `cat_${category}`,
        type: "category" as TreeNodeType,
        name: category,
        icon: "Folder",
        isExpanded: category === "국가기관",
        children: orgList.map((org) => {
          const orgBoards = boards.filter((b) => b.org_id === org.org_id && b.enabled);
          // 실제 파일 통계 사용
          const orgStat = orgStats[org.org_id];
          const totalFiles = orgStat?.total_files ?? 0;
          const extractedFiles = orgStat?.extracted_files ?? 0;
          const pendingFiles = orgStat?.pending_files ?? totalFiles;
          const failedFiles = orgStat?.failed_files ?? 0;

          return {
            id: org.org_id,
            type: "organization" as TreeNodeType,
            name: org.org_name,
            logo: org.logo_path,
            icon: "Building2",
            isExpanded: false,
            stats: {
              totalFiles,
              extractedFiles,
              pendingFiles,
              failedFiles,
              extractionRate: totalFiles > 0 ? Math.round((extractedFiles / totalFiles) * 100) : 0,
            },
            children: orgBoards.map((board) => {
              // 보드별 실제 파일 통계 사용
              const boardStat = orgStat?.boards.find((b) => b.board_id === board.board_id);
              const boardTotal = boardStat?.total_files ?? 0;
              const boardExtracted = boardStat?.extracted_files ?? 0;
              const boardPending = boardStat?.pending_files ?? boardTotal;
              const boardFailed = boardStat?.failed_files ?? 0;

              // 년월 폴더 노드 생성
              const dateFolderNodes: TreeNode[] = (boardStat?.date_folders ?? []).map((df) => ({
                id: `${board.board_id}_${df.folder_name}`,
                type: "date_folder" as TreeNodeType,
                name: df.folder_name,
                dateFolderPath: df.folder_path,
                stats: {
                  totalFiles: df.total_files,
                  extractedFiles: 0,
                  pendingFiles: df.total_files,
                  failedFiles: 0,
                  extractionRate: 0,
                },
              }));

              return {
                id: board.board_id,
                type: "board" as TreeNodeType,
                name: board.board_name,
                docType: board.doc_type,
                stats: {
                  totalFiles: boardTotal,
                  extractedFiles: boardExtracted,
                  pendingFiles: boardPending,
                  failedFiles: boardFailed,
                  extractionRate: boardTotal > 0 ? Math.round((boardExtracted / boardTotal) * 100) : 0,
                },
                children: dateFolderNodes.length > 0 ? dateFolderNodes : undefined,
              };
            }),
          };
        }),
      }));

    setTreeData(tree);
  }, [orgs, boards, orgStats]);

  // 통계 계산 (선택된 파일 기반)
  const stats = useMemo(() => {
    const totalFiles = files.length;
    const extractedFiles = files.filter((f) => f.status === "completed").length;
    const pendingFiles = files.filter((f) => f.status === "pending").length;
    const failedFiles = files.filter((f) => f.status === "failed").length;
    const processingFiles = files.filter((f) => f.status === "processing").length;
    
    // 진행률: 처리 완료된 파일 (성공+실패) / 전체 파일
    const processedFiles = extractedFiles + failedFiles;
    const progressRate = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
    
    // 완료율 (성공률): 성공 / (성공 + 실패) - 처리 완료된 것 중 성공 비율
    const successRate = processedFiles > 0 ? Math.round((extractedFiles / processedFiles) * 100) : 0;

    // 파일 크기 합계 계산
    const totalSize = files.reduce((sum, f) => sum + f.file_size_bytes, 0);
    const extractedSize = totalSize > 1024 * 1024 * 1024
      ? `${(totalSize / (1024 * 1024 * 1024)).toFixed(1)}GB`
      : totalSize > 1024 * 1024
        ? `${(totalSize / (1024 * 1024)).toFixed(1)}MB`
        : `${(totalSize / 1024).toFixed(1)}KB`;

    // 토큰 수 합계 계산
    const totalTokens = files
      .filter((f) => f.token_count !== undefined)
      .reduce((sum, f) => sum + (f.token_count || 0), 0);
    const tokensDisplay = totalTokens > 0 
      ? totalTokens > 1000000 
        ? `${(totalTokens / 1000000).toFixed(1)}M`
        : totalTokens > 1000
          ? `${(totalTokens / 1000).toFixed(1)}K`
          : `${totalTokens}`
      : "-";

    return {
      totalFiles,
      extractedFiles,
      pendingFiles,
      failedFiles,
      processingFiles,
      progressRate,
      successRate,
      lastExtraction: lastExtractionStats.completedAt || "-",
      duration: lastExtractionStats.duration || "-",
      extractedSize: totalFiles > 0 ? extractedSize : "-",
      tokens: lastExtractionStats.totalTokens > 0 
        ? lastExtractionStats.totalTokens > 1000 
          ? `${(lastExtractionStats.totalTokens / 1000).toFixed(1)}K`
          : `${lastExtractionStats.totalTokens}`
        : tokensDisplay,
      usedLLM: lastExtractionStats.usedLLM,
    };
  }, [files, lastExtractionStats]);

  // 선택된 기관/보드 계산
  const selectedTreeStats = useMemo(() => {
    let orgCount = 0;
    let boardCount = 0;

    const countSelected = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.isChecked) {
          if (node.type === "organization") {
            orgCount++;
          } else if (node.type === "board") {
            boardCount++;
          }
        }
        if (node.children) {
          countSelected(node.children);
        }
      }
    };
    countSelected(treeData);

    // 실제 로드된 파일 수 사용
    const result = { orgCount, boardCount, fileCount: files.length };
    console.log("[선택 통계] orgCount:", orgCount, "boardCount:", boardCount, "fileCount:", files.length);
    return result;
  }, [treeData, files.length]);

  // 필터링 및 정렬된 파일 목록
  const filteredFiles = useMemo(() => {
    // 1. 필터링
    const filtered = files.filter((file) => {
      if (formatFilter !== "all" && file.file_format !== formatFilter) return false;
      if (statusFilter !== "all" && file.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          file.original_filename.toLowerCase().includes(q) ||
          file.org_name.toLowerCase().includes(q) ||
          file.board_name.toLowerCase().includes(q)
        );
      }
      return true;
    });
    
    // 2. 정렬
    return filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortKey) {
        case "filename":
          comparison = a.original_filename.localeCompare(b.original_filename, "ko");
          break;
        case "quality":
          const aQuality = a.quality_score ?? -1;
          const bQuality = b.quality_score ?? -1;
          comparison = aQuality - bQuality;
          break;
        case "format":
          comparison = a.file_format.localeCompare(b.file_format);
          break;
        case "size":
          comparison = a.file_size_bytes - b.file_size_bytes;
          break;
        case "status":
          const statusOrder: Record<ExtractStatus, number> = {
            completed: 0,
            processing: 1,
            pending: 2,
            llm_fallback: 3,
            failed: 4,
          };
          comparison = statusOrder[a.status] - statusOrder[b.status];
          break;
      }
      
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [files, formatFilter, statusFilter, searchQuery, sortKey, sortOrder]);

  // 파일 형식별 통계 계산 (선택된 파일 기반 + 실패 파일 목록)
  const formatStats = useMemo((): FormatStats[] => {
    const FORMAT_LABELS: Record<FileFormat, string> = {
      pdf: "PDF",
      hwp: "HWP",
      hwpx: "HWPX",
      docx: "DOCX",
      xlsx: "XLSX",
      html: "HTML",
      txt: "TXT",
      other: "기타",
    };

    const formatCounts: Record<FileFormat, { total: number; success: number; failed: number; failedFiles: RetryingFile[] }> = {
      pdf: { total: 0, success: 0, failed: 0, failedFiles: [] },
      hwp: { total: 0, success: 0, failed: 0, failedFiles: [] },
      hwpx: { total: 0, success: 0, failed: 0, failedFiles: [] },
      docx: { total: 0, success: 0, failed: 0, failedFiles: [] },
      xlsx: { total: 0, success: 0, failed: 0, failedFiles: [] },
      html: { total: 0, success: 0, failed: 0, failedFiles: [] },
      txt: { total: 0, success: 0, failed: 0, failedFiles: [] },
      other: { total: 0, success: 0, failed: 0, failedFiles: [] },
    };

    for (const file of files) {
      formatCounts[file.file_format].total++;
      if (file.status === "completed") {
        formatCounts[file.file_format].success++;
      } else if (file.status === "failed") {
        formatCounts[file.file_format].failed++;
        // 실패 파일 목록에 추가
        formatCounts[file.file_format].failedFiles.push({
          file_id: file.file_id,
          original_filename: file.original_filename,
          quality_score: file.quality_score,
          status: file.status,
        });
      }
    }

    return Object.entries(formatCounts)
      .filter(([, counts]) => counts.total > 0)
      .map(([format, counts]) => ({
        format: format as FileFormat,
        label: FORMAT_LABELS[format as FileFormat],
        total: counts.total,
        success: counts.success,
        failed: counts.failed,
        rate: counts.total > 0 ? Math.round((counts.success / counts.total) * 100) : 0,
        failedFiles: counts.failedFiles,
      }))
      .sort((a, b) => b.total - a.total); // 파일 개수 많은 순으로 정렬
  }, [files]);

  // 트리뷰 핸들러
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

  const handleToggleCheck = useCallback((id: string) => {
    console.log("[트리 체크] 노드 체크 토글:", id);
    setTreeData((prev) => {
      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((node) => {
          if (node.id === id) {
            const newChecked = !node.isChecked;
            console.log("[트리 체크] 노드", id, "의 체크 상태:", node.isChecked, "->", newChecked);
            const updateChildren = (children?: TreeNode[]): TreeNode[] | undefined => {
              if (!children) return undefined;
              return children.map((child) => ({
                ...child,
                isChecked: newChecked,
                isIndeterminate: false,
                children: updateChildren(child.children),
              }));
            };
            return {
              ...node,
              isChecked: newChecked,
              isIndeterminate: false,
              children: updateChildren(node.children),
            };
          }
          if (node.children) {
            const updatedChildren = updateNode(node.children);
            const checkedCount = updatedChildren.filter((c) => c.isChecked).length;
            const indeterminateCount = updatedChildren.filter((c) => c.isIndeterminate).length;
            const totalChildren = updatedChildren.length;

            return {
              ...node,
              children: updatedChildren,
              isChecked: checkedCount === totalChildren && totalChildren > 0,
              isIndeterminate: (checkedCount > 0 && checkedCount < totalChildren) || indeterminateCount > 0,
            };
          }
          return node;
        });
      };
      return updateNode(prev);
    });
  }, []);

  const handleNodeClick = useCallback((node: TreeNode) => {
    console.log("Node clicked:", node);
  }, []);

  // 선택된 기관/보드/년월폴더 ID 추출 함수
  const getSelectedIds = useCallback((nodes: TreeNode[]): { 
    orgIds: string[]; 
    boardIds: string[]; 
    dateFolderPaths: string[];
  } => {
    const orgIds: string[] = [];
    const boardIds: string[] = [];
    const dateFolderPaths: string[] = [];

    const collectIds = (nodeList: TreeNode[]) => {
      for (const node of nodeList) {
        if (node.isChecked) {
          if (node.type === "organization") {
            orgIds.push(node.id);
          } else if (node.type === "board") {
            boardIds.push(node.id);
          } else if (node.type === "date_folder" && node.dateFolderPath) {
            dateFolderPaths.push(node.dateFolderPath);
          }
        }
        if (node.children) {
          collectIds(node.children);
        }
      }
    };
    collectIds(nodes);
    return { orgIds, boardIds, dateFolderPaths };
  }, []);

  // 선택된 기관/보드/년월폴더가 변경되면 파일 목록 로드
  // extractionProgress.status를 사용하여 추출 완료 후에도 파일 상태 유지
  const prevTreeDataRef = useRef<string>("");
  
  useEffect(() => {
    const { orgIds, boardIds, dateFolderPaths } = getSelectedIds(treeData);
    
    // 트리 선택 상태가 실제로 변경되었는지 확인 (추출 중/완료로 인한 재실행 방지)
    const currentTreeKey = JSON.stringify({ orgIds, boardIds, dateFolderPaths });
    const treeSelectionChanged = prevTreeDataRef.current !== currentTreeKey;
    
    // 추출 중이거나 추출 완료 직후에는 파일 목록 재로드 건너뛰기
    // (트리 선택이 변경된 경우에만 재로드)
    if (!treeSelectionChanged && (isExtracting || extractionProgress.status === "completed")) {
      return;
    }
    
    prevTreeDataRef.current = currentTreeKey;
    
    console.log("[파일 로드] 선택된 orgIds:", orgIds, "boardIds:", boardIds, "dateFolderPaths:", dateFolderPaths);
    
    // 선택된 항목이 없으면 파일 목록 초기화
    if (orgIds.length === 0 && boardIds.length === 0 && dateFolderPaths.length === 0) {
      console.log("[파일 로드] 선택된 항목 없음 - 파일 목록 초기화");
      setFiles([]);
      setSelectedFileIds(new Set());
      return;
    }

    // 파일 목록 로드
    async function loadFiles() {
      try {
        setFilesLoading(true);
        
        const allFiles: ExtractedFile[] = [];
        
        // 년월 폴더 경로가 선택된 경우 각각 로드
        if (dateFolderPaths.length > 0) {
          for (const folderPath of dateFolderPaths) {
            const params = new URLSearchParams();
            params.set("date_folder_path", folderPath);
            
            const apiUrl = `/api/scraper/extract/files?${params.toString()}`;
            console.log("[파일 로드] 년월 폴더 API 호출:", apiUrl);
            
            const res = await jsonFetch<{
              ok: boolean;
              files: ExtractedFile[];
              stats: FormatStats[];
              total: number;
            }>(apiUrl);
            
            if (res.ok && res.files) {
              allFiles.push(...res.files);
            }
          }
        }
        
        // 기관/보드가 선택된 경우 (년월 폴더가 선택되지 않은 기관/보드만)
        const selectedOrgIds = new Set(orgIds);
        const filteredBoardIds = boardIds.filter((boardId) => {
          const board = boards.find((b) => b.board_id === boardId);
          return board && !selectedOrgIds.has(board.org_id);
        });
        
        if (orgIds.length > 0 || filteredBoardIds.length > 0) {
          const params = new URLSearchParams();
          if (orgIds.length > 0) {
            params.set("org_ids", orgIds.join(","));
          }
          if (filteredBoardIds.length > 0) {
            params.set("board_ids", filteredBoardIds.join(","));
          }

          const apiUrl = `/api/scraper/extract/files?${params.toString()}`;
          console.log("[파일 로드] 기관/보드 API 호출:", apiUrl);

          const res = await jsonFetch<{
            ok: boolean;
            files: ExtractedFile[];
            stats: FormatStats[];
            total: number;
          }>(apiUrl);

          console.log("[파일 로드] API 응답:", { ok: res.ok, fileCount: res.files?.length, total: res.total });

          if (res.ok && res.files) {
            allFiles.push(...res.files);
          }
        }
        
        // 중복 제거 (file_id 기준)
        const uniqueFiles = Array.from(
          new Map(allFiles.map((f) => [f.file_id, f])).values()
        );
        
        console.log("[파일 로드] 총 파일 수:", uniqueFiles.length);
        
        setFiles(uniqueFiles);
        // 모든 파일을 기본 선택 상태로 설정
        const fileIds = uniqueFiles.map((f) => f.file_id);
        setSelectedFileIds(new Set(fileIds));
      } catch (err) {
        console.error("[파일 로드] 실패:", err);
      } finally {
        setFilesLoading(false);
      }
    }

    loadFiles();
  }, [treeData, boards, getSelectedIds, isExtracting, extractionProgress.status, refreshTrigger]);

  // 파일 선택 핸들러
  const handleSelectFile = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedFileIds.size === filteredFiles.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(filteredFiles.map((f) => f.file_id)));
    }
  }, [filteredFiles, selectedFileIds.size]);

  // 추출 핸들러
  const handleStartExtraction = useCallback(async () => {
    console.log("[추출 시작] 버튼 클릭됨!");
    console.log("[추출 시작] 선택된 파일 수:", selectedFileIds.size);
    
    if (selectedFileIds.size === 0) {
      console.warn("[추출 시작] 선택된 파일이 없습니다.");
      return;
    }

    // 선택된 파일들의 file_path 수집
    const selectedFiles = files.filter((f) => selectedFileIds.has(f.file_id));
    const filePaths = selectedFiles.map((f) => f.file_path);
    
    console.log("[추출 시작] 추출 대상 파일 경로:", filePaths.slice(0, 3), "... 총", filePaths.length, "개");

    const startTime = Date.now();
    let totalTokensExtracted = 0;
    let successCount = 0;
    let failedCount = 0;

    setIsExtracting(true);
    setExtractionProgress({
      current: 0,
      total: filePaths.length,
      currentFile: "",
      status: "processing",
    });

    try {
      // 스트리밍 API 사용하여 실시간 진행 상황 표시
      // 설정을 백엔드에 전달 (모든 고급 옵션 포함)
      const extractionConfig = {
        ocr: {
          engine: settings.ocr.engine,
          languages: settings.ocr.languages,
          confidence_threshold: settings.ocr.confidenceThreshold,
          det_db_thresh: settings.ocr.detDbThresh,
          det_db_box_thresh: settings.ocr.detDbBoxThresh,
        },
        pdf: {
          prefer_text_layer: settings.pdf.preferTextLayer,
          enable_ocr: settings.pdf.enableOcr,
          extract_image_text: settings.pdf.extractImageText,
          force_ocr_mode: settings.pdf.forceOcrMode,
          hybrid_extraction: settings.pdf.hybridExtraction,
          page_optimal_method: settings.pdf.pageOptimalMethod,
        },
        cross_page_merge: {
          enabled: settings.pdf.crossPageTableMerge,
          merge_confidence_threshold: settings.pdf.mergeConfidenceThreshold,
          header_similarity_threshold: settings.pdf.headerSimilarityThreshold,
        },
        hwp: {
          preserve_table_structure: settings.hwp.preserveTableStructure,
          convert_bullets: settings.hwp.convertBullets,
          include_footnotes: settings.hwp.includeFootnotes,
        },
        preprocessing: {
          enabled: settings.preprocessing.enabled,
          render_dpi: settings.preprocessing.renderDpi,
          deskew: settings.preprocessing.deskew,
          denoise: settings.preprocessing.denoise,
          binarize: settings.preprocessing.binarize,
          contrast_enhancement: settings.preprocessing.contrastEnhancement,
          adaptive_preprocessing: settings.preprocessing.adaptivePreprocessing,
        },
        encoding: {
          auto_detect: settings.encoding.autoDetect,
          force_encoding: settings.encoding.forceEncoding,
          fix_utf16_errors: settings.encoding.fixUtf16Errors,
          remove_broken_chars: settings.encoding.removeBrokenChars,
        },
        postprocessing: {
          remove_headers: settings.postprocessing.removeHeaders,
          remove_page_numbers: settings.postprocessing.removePageNumbers,
          normalize_whitespace: settings.postprocessing.normalizeWhitespace,
          ocr_error_correction: settings.postprocessing.ocrErrorCorrection,
          normalize_special_chars: settings.postprocessing.normalizeSpecialChars,
        },
        table_normalization: {
          flatten_headers: settings.tableNormalization.flattenHeaders,
          fill_empty_cells: settings.tableNormalization.fillEmptyCells,
        },
        quality_validation: {
          enabled: settings.qualityValidation.enabled,
          pass_threshold: settings.qualityValidation.passThreshold,
          auto_llm_fallback: settings.qualityValidation.autoLlmFallback,
        },
        processing: {
          concurrent_files: settings.processing.concurrentFiles,
          timeout_seconds: settings.processing.timeoutSeconds,
        },
        retry_strategy: {
          enable_progressive_retry: settings.retryStrategy.enableProgressiveRetry,
          multi_engine_comparison: settings.retryStrategy.multiEngineComparison,
          quality_based_adjustment: settings.retryStrategy.qualityBasedAdjustment,
        },
      };
      
      const response = await fetch("/api/processing/extract/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_paths: filePaths, config: extractionConfig }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "추출 요청 실패");
      }

      // SSE 스트림 처리
      const reader = response.body?.getReader();
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
              
              // 상세 로그 출력
              if (data.type === "progress") {
                const statusIcon = data.status === "completed" ? "✓" : "✗";
                let logMsg = `[추출] ${statusIcon} ${data.current}/${data.total}: ${data.file_name} -> ${data.status}`;
                if (data.error_message) {
                  logMsg += ` | 오류: ${data.error_message}`;
                }
                if (data.status === "completed") {
                  logMsg += ` | 품질: ${data.quality_score?.toFixed(2)}`;
                  successCount++;
                  if (data.token_count) {
                    totalTokensExtracted += data.token_count;
                  }
                } else if (data.status === "failed") {
                  failedCount++;
                }
                console.log(logMsg);
                
                // 진행률 업데이트: data.completed + data.failed를 사용 (병렬 처리로 인한 순서 문제 해결)
                const processedCount = (data.completed || 0) + (data.failed || 0);
                setExtractionProgress((prev) => ({
                  ...prev,
                  current: processedCount > prev.current ? processedCount : prev.current,
                  total: data.total || prev.total,
                  currentFile: data.file_name || prev.currentFile,
                }));

                // 파일 상태 업데이트 (품질 점수, 토큰 수, 처리 시간 포함)
                if (data.file_path) {
                  setFiles((prevFiles) =>
                    prevFiles.map((f) =>
                      f.file_path === data.file_path 
                        ? { 
                            ...f, 
                            status: data.status,
                            quality_score: data.quality_score,
                            quality_details: data.quality_details,
                            token_count: data.token_count,
                            processing_time_ms: data.processing_time_ms,
                            error_message: data.error_message,
                          } 
                        : f
                    )
                  );
                }
              } else if (data.type === "complete") {
                console.log("[추출 완료]", data);
                // 완료 이벤트 수신 시 최종 진행률 업데이트
                setExtractionProgress((prev) => ({
                  ...prev,
                  current: data.total || prev.total,
                  total: data.total || prev.total,
                }));
                // 파일 목록에서 성공/실패 수 업데이트
                successCount = data.completed || successCount;
                failedCount = data.failed || failedCount;
              } else if (data.type === "keepalive") {
                // keep-alive 이벤트는 무시 (연결 유지용)
                console.log("[추출] Keep-alive 수신, 경과:", data.elapsed, "초");
              } else if (data.type === "error") {
                console.error("[추출 오류]", data.error);
              }
            } catch (parseErr) {
              console.warn("[추출] SSE 파싱 실패:", line);
            }
          }
        }
      }

      // 추출 완료 통계 업데이트
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const durationStr = durationMs > 60000 
        ? `${Math.floor(durationMs / 60000)}분 ${Math.round((durationMs % 60000) / 1000)}초`
        : `${Math.round(durationMs / 1000)}초`;

      setLastExtractionStats({
        completedAt: new Date().toLocaleString("ko-KR", { 
          month: "2-digit", 
          day: "2-digit", 
          hour: "2-digit", 
          minute: "2-digit" 
        }),
        duration: durationStr,
        totalTokens: totalTokensExtracted,
        usedLLM: false,
      });

      setExtractionProgress((prev) => ({ ...prev, status: "completed" }));
      console.log("[추출 시작] 모든 파일 추출 완료 -", `성공: ${successCount}, 실패: ${failedCount}, 소요시간: ${durationStr}`);
      
      // 추출 완료 후 파일 목록 새로고침 (SSE 이벤트 누락 대비)
      setTimeout(() => {
        setRefreshTrigger((prev) => prev + 1);
        console.log("[추출 완료] 파일 목록 새로고침 트리거");
      }, 1000);

    } catch (err: any) {
      console.error("[추출 시작] 오류:", err);
      setExtractionProgress((prev) => ({ ...prev, status: "error" }));
      
      // 백엔드 서비스 연결 실패 안내
      alert(
        "⚠️ 텍스트 추출 백엔드 서비스에 연결할 수 없습니다.\n\n" +
        "Python 백엔드 서버를 실행해주세요:\n\n" +
        "1. 터미널에서 backend 폴더로 이동\n" +
        "   cd backend\n\n" +
        "2. 가상환경 활성화\n" +
        "   venv\\Scripts\\activate\n\n" +
        "3. 서버 실행\n" +
        "   python run.py\n\n" +
        "서버가 http://localhost:8000 에서 실행되어야 합니다."
      );
    } finally {
      setIsExtracting(false);
    }
  }, [selectedFileIds, files]);

  const handleLLMExtraction = useCallback(() => {
    console.log("Starting LLM extraction for:", selectedFileIds);
    // TODO: LLM 기반 추출 기능 구현
  }, [selectedFileIds]);

  // 실패 항목 재시도 (재추출 전략 설정 적용)
  const handleRetryFailed = useCallback(async () => {
    const failedFiles = files.filter((f) => f.status === "failed");
    if (failedFiles.length === 0) {
      console.warn("[재시도] 실패한 파일이 없습니다.");
      return;
    }

    // 재시도 전 점수 저장 (점수 변동 추적용)
    const previousScoresMap = new Map<string, number>();
    failedFiles.forEach((f) => {
      if (f.quality_score !== undefined) {
        previousScoresMap.set(f.file_id, f.quality_score);
      }
    });
    setRetryStats((prev) => ({
      ...prev,
      previousScores: new Map([...prev.previousScores, ...previousScoresMap]),
      totalRetried: failedFiles.length,
      improved: 0,  // 재시도 시작 시 초기화
    }));

    const filePaths = failedFiles.map((f) => f.file_path);
    console.log("[재시도] 실패한 파일 재추출:", filePaths.length, "개");
    console.log("[재시도] 재추출 전략:", settings.retryStrategy);

    const startTime = Date.now();
    let successCount = 0;
    let stillFailedCount = 0;
    let improvedCount = 0;
    const passThreshold = settings.qualityValidation.passThreshold;

    setIsExtracting(true);
    setExtractionProgress({
      current: 0,
      total: filePaths.length,
      currentFile: "",
      status: "processing",
    });

    // 설정을 백엔드 형식으로 변환
    const extractionConfig = {
      ocr: {
        engine: settings.ocr.engine,
        languages: settings.ocr.languages,
        confidence_threshold: settings.ocr.confidenceThreshold,
        det_db_thresh: settings.ocr.detDbThresh,
        det_db_box_thresh: settings.ocr.detDbBoxThresh,
      },
      pdf: {
        prefer_text_layer: settings.pdf.preferTextLayer,
        enable_ocr: settings.pdf.enableOcr,
        extract_image_text: settings.pdf.extractImageText,
        force_ocr_mode: settings.pdf.forceOcrMode,
        hybrid_extraction: settings.pdf.hybridExtraction,
        page_optimal_method: settings.pdf.pageOptimalMethod,
      },
      cross_page_merge: {
        enabled: settings.pdf.crossPageTableMerge,
        merge_confidence_threshold: settings.pdf.mergeConfidenceThreshold,
        header_similarity_threshold: settings.pdf.headerSimilarityThreshold,
      },
      hwp: {
        preserve_table_structure: settings.hwp.preserveTableStructure,
        convert_bullets: settings.hwp.convertBullets,
        include_footnotes: settings.hwp.includeFootnotes,
      },
      preprocessing: {
        enabled: settings.preprocessing.enabled,
        render_dpi: settings.preprocessing.renderDpi,
        deskew: settings.preprocessing.deskew,
        denoise: settings.preprocessing.denoise,
        binarize: settings.preprocessing.binarize,
        contrast_enhancement: settings.preprocessing.contrastEnhancement,
        adaptive_preprocessing: settings.preprocessing.adaptivePreprocessing,
      },
      encoding: {
        auto_detect: settings.encoding.autoDetect,
        force_encoding: settings.encoding.forceEncoding,
        fix_utf16_errors: settings.encoding.fixUtf16Errors,
        remove_broken_chars: settings.encoding.removeBrokenChars,
      },
      postprocessing: {
        remove_headers: settings.postprocessing.removeHeaders,
        remove_page_numbers: settings.postprocessing.removePageNumbers,
        normalize_whitespace: settings.postprocessing.normalizeWhitespace,
        ocr_error_correction: settings.postprocessing.ocrErrorCorrection,
        normalize_special_chars: settings.postprocessing.normalizeSpecialChars,
      },
      table_normalization: {
        flatten_headers: settings.tableNormalization.flattenHeaders,
        fill_empty_cells: settings.tableNormalization.fillEmptyCells,
      },
      quality_validation: {
        enabled: settings.qualityValidation.enabled,
        pass_threshold: settings.qualityValidation.passThreshold,
        auto_llm_fallback: settings.qualityValidation.autoLlmFallback,
      },
      processing: {
        concurrent_files: settings.processing.concurrentFiles,
        timeout_seconds: settings.processing.timeoutSeconds,
      },
      retry_strategy: {
        enable_progressive_retry: settings.retryStrategy.enableProgressiveRetry,
        multi_engine_comparison: settings.retryStrategy.multiEngineComparison,
        quality_based_adjustment: settings.retryStrategy.qualityBasedAdjustment,
      },
    };

    try {
      console.log("[재시도] API 호출 시작... (재추출 전략 적용)");
      console.log("[재시도] 전략:", extractionConfig.retry_strategy);
      const response = await fetch("/api/processing/extract/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          file_paths: filePaths,
          config: extractionConfig,  // 백엔드 형식으로 변환된 설정
          is_retry: true,  // 재시도 플래그
        }),
      });

      if (!response.ok) {
        // 실제 에러 메시지 가져오기
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`;
        console.error("[재시도] API 에러:", errorMessage);
        throw new Error(errorMessage);
      }

      console.log("[재시도] API 응답 수신 시작...");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("스트림을 읽을 수 없습니다.");

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
              
              if (data.type === "progress") {
                // 진행률 업데이트: data.completed + data.failed를 사용 (병렬 처리로 인한 순서 문제 해결)
                const processedCount = (data.completed || 0) + (data.failed || 0);
                setExtractionProgress((prev) => ({
                  ...prev,
                  current: processedCount > prev.current ? processedCount : prev.current,
                  total: data.total || prev.total,
                  currentFile: data.file_name || prev.currentFile,
                }));

                if (data.status === "completed") {
                  successCount++;
                  // 재시도 후 품질 임계값 이상으로 향상된 경우 카운트
                  if (data.quality_score !== undefined && data.quality_score >= passThreshold) {
                    improvedCount++;
                    setRetryStats((prev) => ({
                      ...prev,
                      improved: prev.improved + 1,
                    }));
                  }
                } else if (data.status === "failed") {
                  stillFailedCount++;
                }

                if (data.file_path) {
                  setFiles((prevFiles) =>
                    prevFiles.map((f) =>
                      f.file_path === data.file_path 
                        ? { 
                            ...f, 
                            status: data.status,
                            quality_score: data.quality_score,
                            quality_details: data.quality_details,
                            token_count: data.token_count,
                            processing_time_ms: data.processing_time_ms,
                            error_message: data.error_message,
                          } 
                        : f
                    )
                  );
                }
              }
            } catch (parseErr) {
              console.warn("[재시도] SSE 파싱 실패:", line);
            }
          }
        }
      }

      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const durationStr = durationMs > 60000 
        ? `${Math.floor(durationMs / 60000)}분 ${Math.round((durationMs % 60000) / 1000)}초`
        : `${Math.round(durationMs / 1000)}초`;

      setLastExtractionStats((prev) => ({
        ...prev,
        completedAt: new Date().toLocaleString("ko-KR", { 
          month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" 
        }),
        duration: durationStr,
      }));

      console.log("[재시도 완료]", `성공: ${successCount}, 여전히 실패: ${stillFailedCount}`);

      // 완료 상태 설정 (stats 유지를 위해 중요)
      setExtractionProgress((prev) => ({
        ...prev,
        status: "completed",
      }));
      
      // 재시도 완료 후 파일 목록 새로고침 (SSE 이벤트 누락 대비)
      setTimeout(() => {
        setRefreshTrigger((prev) => prev + 1);
        console.log("[재시도 완료] 파일 목록 새로고침 트리거");
      }, 1000);

    } catch (err: any) {
      console.error("[재시도] 오류:", err);
      setExtractionProgress((prev) => ({ ...prev, status: "error" }));
      
      // 네트워크 에러 또는 백엔드 연결 실패 확인
      if (err.message?.includes("fetch") || err.message?.includes("network") || err.name === "TypeError") {
        alert(
          "⚠️ 텍스트 추출 백엔드 서비스에 연결할 수 없습니다.\n\n" +
          "Python 백엔드 서버가 실행 중인지 확인해주세요:\n" +
          "http://localhost:8000"
        );
      } else {
        alert(`재시도 중 오류가 발생했습니다:\n\n${err.message}`);
      }
    } finally {
      setIsExtracting(false);
    }
  }, [files, settings]);

  // 결과 내보내기
  const handleExportResults = useCallback((format: "json" | "csv" | "txt") => {
    const completedFiles = files.filter((f) => f.status === "completed");
    if (completedFiles.length === 0) {
      alert("내보낼 완료된 파일이 없습니다.");
      return;
    }

    let content = "";
    let filename = "";
    let mimeType = "";

    if (format === "json") {
      const exportData = completedFiles.map((f) => ({
        file_name: f.original_filename,
        org_name: f.org_name,
        board_name: f.board_name,
        file_format: f.file_format,
        file_size: f.file_size_bytes,
        quality_score: f.quality_score,
        token_count: f.token_count,
        processing_time_ms: f.processing_time_ms,
        extracted_at: f.extracted_at,
      }));
      content = JSON.stringify(exportData, null, 2);
      filename = `extraction_results_${new Date().toISOString().slice(0, 10)}.json`;
      mimeType = "application/json";
    } else if (format === "csv") {
      const headers = ["파일명", "기관", "보드", "형식", "크기(bytes)", "품질점수", "토큰수", "처리시간(ms)"];
      const rows = completedFiles.map((f) => [
        f.original_filename,
        f.org_name,
        f.board_name,
        f.file_format,
        f.file_size_bytes,
        f.quality_score?.toFixed(2) || "",
        f.token_count || "",
        f.processing_time_ms || "",
      ]);
      content = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      filename = `extraction_results_${new Date().toISOString().slice(0, 10)}.csv`;
      mimeType = "text/csv";
    } else {
      content = completedFiles.map((f) => 
        `[${f.original_filename}]\n기관: ${f.org_name} > ${f.board_name}\n형식: ${f.file_format}\n품질: ${(f.quality_score || 0) * 100}%\n토큰: ${f.token_count || "-"}\n---`
      ).join("\n\n");
      filename = `extraction_results_${new Date().toISOString().slice(0, 10)}.txt`;
      mimeType = "text/plain";
    }

    // 다운로드 트리거
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[내보내기] ${format.toUpperCase()} 형식으로 ${completedFiles.length}개 파일 내보내기 완료`);
  }, [files]);

  // 내보내기 드롭다운 상태
  const [showExportMenu, setShowExportMenu] = useState(false);

  // 실패한 파일 수 계산
  const failedCount = files.filter((f) => f.status === "failed").length;

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="glass-panel rounded-3xl p-6 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">텍스트 추출</h1>
            <p className="text-xs text-stone-500">수집된 문서에서 텍스트를 추출하고 품질을 검증합니다</p>
          </div>
          <button className="p-2.5 rounded-xl bg-white/50 backdrop-blur-sm hover:bg-white/80 text-stone-400 transition-all shadow-sm">
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 메인 콘텐츠 - 3열 레이아웃 (35% / 40% / 25%) */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* 좌측 열 (30%) - 추출 현황 요약 + 파일 형식별 추출 현황 */}
        <div className="w-[30%] flex flex-col gap-4 min-h-0">
          {/* 추출 현황 요약 카드 (높이: 380px) */}
          <div className="glass-panel rounded-2xl p-5 flex flex-col" style={{ height: "380px" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-stone-800">추출 현황 요약</h2>
              <span className="text-xs text-stone-500 px-2 py-0.5 rounded-full bg-white/50 backdrop-blur-sm">
                {new Date().toLocaleDateString("ko-KR")} 기준
              </span>
            </div>

            <div className="flex-1 flex items-center justify-around">
              <DonutChart
                percentage={isExtracting 
                  ? Math.round((extractionProgress.current / Math.max(extractionProgress.total, 1)) * 100)
                  : stats.progressRate
                }
                label="진행률"
                subLabel={isExtracting 
                  ? `${extractionProgress.current}/${extractionProgress.total} 처리중`
                  : `${stats.extractedFiles + stats.failedFiles}/${stats.totalFiles} 완료`
                }
                color="blue"
                animated={false}
              />
              <DonutChart
                percentage={extractionProgress.status === "completed" || !isExtracting ? stats.successRate : 0}
                label="성공률"
                subLabel={extractionProgress.status === "completed" || !isExtracting 
                  ? `성공 ${stats.extractedFiles} / 실패 ${stats.failedFiles}`
                  : "작업 완료 후 표시"
                }
                color="emerald"
                animated={false}
              />
              <DonutChart
                percentage={retryStats.totalRetried > 0 
                  ? Math.round((retryStats.improved / retryStats.totalRetried) * 100)
                  : 0
                }
                label="재시도 성공"
                subLabel={retryStats.totalRetried > 0 
                  ? `향상 ${retryStats.improved} / 재시도 ${retryStats.totalRetried}`
                  : "재시도 후 표시"
                }
                color="amber"
                animated={false}
              />
            </div>

            <div className="bg-white/40 backdrop-blur-sm rounded-xl p-3 border border-white/60 mt-auto">
              <div className="text-xs font-semibold text-stone-600 mb-2">최근 작업</div>
              <div className="grid grid-cols-2 gap-1.5 text-xs text-stone-600">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-stone-400" />
                  마지막: {stats.lastExtraction}
                </div>
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 text-stone-400" />
                  소요 시간: {stats.duration}
                </div>
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-stone-400" />
                  텍스트: {stats.extractedSize}
                </div>
                <div className="flex items-center gap-1.5">
                  <Sparkles className={cn("w-3 h-3", stats.usedLLM ? "text-violet-500" : "text-stone-400")} />
                  소요 토큰: {stats.usedLLM ? `약 ${stats.tokens}` : stats.tokens}
                </div>
              </div>
            </div>
          </div>

          {/* 형식별 통계 카드 */}
          <div className="glass-panel rounded-2xl p-5 flex flex-col flex-1 min-h-0 overflow-hidden">
            <h2 className="font-bold text-stone-800 mb-4 flex-shrink-0">파일 형식별 추출 현황</h2>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {formatStats.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-stone-500">
                  <FileText className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">기관/보드를 선택하면</p>
                  <p className="text-sm">형식별 통계가 표시됩니다</p>
                </div>
              ) : (
                formatStats.map((stat) => (
                  <HorizontalBar
                    key={stat.format}
                    stat={stat}
                    onClick={() => setFormatFilter(stat.format)}
                    failedFiles={stat.failedFiles}
                    isRetrying={isExtracting}
                    passThreshold={settings.qualityValidation.passThreshold}
                    previousScores={retryStats.previousScores}
                    onRetryFormat={(format) => {
                      // 해당 형식의 실패 파일만 재시도
                      const failedFilesOfFormat = files.filter(
                        (f) => f.file_format === format && f.status === "failed"
                      );
                      if (failedFilesOfFormat.length > 0) {
                        console.log(`[재시도] ${format} 형식 실패 파일 재추출:`, failedFilesOfFormat.length, "개");
                        // handleRetryFailed와 유사한 로직으로 재시도
                        setSelectedFileIds(new Set(failedFilesOfFormat.map((f) => f.file_id)));
                        // 짧은 딜레이 후 재시도 시작
                        setTimeout(() => handleRetryFailed(), 100);
                      }
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* 중앙 열 (40%) - 대상기관/보드 선택 + 파일 목록 */}
        <div className="w-[40%] flex flex-col gap-4 min-h-0">
          {/* 대상기관/보드 선택 트리뷰 (높이: 380px) */}
          <div className="glass-panel rounded-2xl p-5 flex flex-col" style={{ height: "380px" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-stone-800">대상기관/보드 선택</h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="검색..."
                  className="ui-field pl-10 pr-3 py-2 text-sm w-32 text-center placeholder:text-center"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <span className="ml-3 text-stone-500 text-sm">기관/보드 정보를 불러오는 중...</span>
              </div>
            ) : treeData.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-stone-500">
                <Building2 className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">등록된 기관이 없습니다</p>
                <p className="text-xs mt-1">먼저 대상기관 관리에서 기관을 등록해주세요</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1">
                {treeData.map((node) => (
                  <TreeNodeComponent
                    key={node.id}
                    node={node}
                    onToggleExpand={handleToggleExpand}
                    onToggleCheck={handleToggleCheck}
                    onNodeClick={handleNodeClick}
                  />
                ))}
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-stone-200/60 text-xs text-stone-600 flex items-center justify-between">
              <span>
                선택됨: 기관 {selectedTreeStats.orgCount}개, 보드 {selectedTreeStats.boardCount}개
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/50 backdrop-blur-sm font-medium">
                총 파일: {selectedTreeStats.fileCount}개
              </span>
            </div>
          </div>

          {/* 파일 목록 테이블 */}
          <div className="glass-panel rounded-2xl p-5 flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <h2 className="font-bold text-stone-800">파일 목록</h2>
              <span className="text-xs text-stone-500 px-2 py-0.5 rounded-full bg-white/50 backdrop-blur-sm">
                총 {filteredFiles.length}개
              </span>
            </div>

            {/* 필터 바 - 좌측에 셀렉트 박스, 우측에 검색창 */}
            <div className="flex items-center gap-2 mb-3 flex-shrink-0">
              <select
                value={formatFilter}
                onChange={(e) => setFormatFilter(e.target.value as any)}
                className="ui-field text-xs py-1.5"
                style={{ width: "120px" }}
              >
                <option value="all">전체 형식</option>
                <option value="pdf">PDF</option>
                <option value="hwp">HWP</option>
                <option value="hwpx">HWPX</option>
                <option value="docx">DOCX</option>
                <option value="xlsx">XLSX</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="ui-field text-xs py-1.5"
                style={{ width: "120px" }}
              >
                <option value="all">전체 상태</option>
                <option value="completed">완료</option>
                <option value="processing">진행중</option>
                <option value="pending">대기</option>
                <option value="failed">실패</option>
              </select>
              <div className="flex-1" />
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="파일 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ui-field pl-10 pr-3 py-1.5 text-xs w-36 text-center placeholder:text-center"
                />
              </div>
            </div>

            {/* 선택 액션 바 */}
            <div className="flex items-center gap-2 mb-2 p-2 bg-white/40 backdrop-blur-sm rounded-xl border border-white/60 flex-shrink-0">
                <button
                  onClick={handleSelectAll}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all",
                    selectedFileIds.size === filteredFiles.length && filteredFiles.length > 0
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "hover:bg-white/60 text-stone-600"
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded border-2 flex items-center justify-center transition-all",
                      selectedFileIds.size === filteredFiles.length && filteredFiles.length > 0
                        ? "bg-primary border-primary text-white"
                        : "border-stone-300 bg-white/60"
                    )}
                  >
                    {selectedFileIds.size === filteredFiles.length && filteredFiles.length > 0 && (
                      <Check className="w-2 h-2" />
                    )}
                  </div>
                  전체
                </button>
                <span className="text-[10px] text-stone-500">{selectedFileIds.size}개 선택</span>
                {/* LLM/추출 버튼을 왼쪽으로 이동 */}
                <div className="ml-2 flex items-center gap-1">
                  <button
                    onClick={handleLLMExtraction}
                    disabled={selectedFileIds.size === 0}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all shadow-sm",
                      selectedFileIds.size > 0
                        ? "bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:from-violet-600 hover:to-purple-600"
                        : "bg-stone-200 text-stone-400 cursor-not-allowed"
                    )}
                  >
                    <Sparkles className="w-3 h-3" />
                    LLM
                  </button>
                  <button
                    onClick={handleStartExtraction}
                    disabled={selectedFileIds.size === 0 || isExtracting}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all shadow-sm",
                      selectedFileIds.size > 0 && !isExtracting
                        ? "bg-primary text-white hover:bg-primary/90"
                        : "bg-stone-200 text-stone-400 cursor-not-allowed"
                    )}
                  >
                    {isExtracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    추출
                  </button>
                </div>
                <div className="flex-1" />
                <button
                  disabled={selectedFileIds.size === 0}
                  className="p-1 rounded-lg text-xs bg-white/50 hover:bg-white/80 text-stone-600 transition-all disabled:opacity-50"
                  title="재시도"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
                <button
                  disabled={selectedFileIds.size === 0}
                  className="p-1 rounded-lg text-xs bg-white/50 hover:bg-red-50 text-red-600 transition-all disabled:opacity-50"
                  title="삭제"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* 파일 체크박스 목록 */}
              <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/60 bg-white/20 backdrop-blur-sm">
                {filesLoading ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-500">
                    <Loader2 className="w-8 h-8 mb-2 text-primary animate-spin" />
                    <p className="text-sm">파일 목록을 불러오는 중...</p>
                  </div>
                ) : files.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-500">
                    <FileText className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-sm">기관/보드를 선택하면</p>
                    <p className="text-sm">파일 목록이 표시됩니다</p>
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-500">
                    <FileText className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-sm">필터 조건에 맞는 파일이 없습니다</p>
                  </div>
                ) : (
                  <div className="divide-y divide-stone-200/40">
                    {/* 열 헤더 (정렬 가능) */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100/60 text-[8px] font-semibold text-stone-500 sticky top-0 z-10 backdrop-blur-sm">
                      <div className="w-3.5 flex-shrink-0" /> {/* 체크박스 공간 */}
                      <div className="w-8 flex-shrink-0" /> {/* 아이콘 공간 */}
                      <button 
                        className="flex-1 min-w-0 flex items-center gap-0.5 hover:text-stone-700 transition-colors text-left"
                        onClick={() => handleSort("filename")}
                      >
                        파일명
                        {sortKey === "filename" && (
                          sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                      <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
                        <button 
                          className="w-11 text-center flex items-center justify-center gap-0.5 hover:text-stone-700 transition-colors"
                          onClick={() => handleSort("quality")}
                        >
                          품질
                          {sortKey === "quality" && (
                            sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                        <button 
                          className="w-10 text-center flex items-center justify-center gap-0.5 hover:text-stone-700 transition-colors"
                          onClick={() => handleSort("format")}
                        >
                          형식
                          {sortKey === "format" && (
                            sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                        <button 
                          className="w-14 text-center flex items-center justify-center gap-0.5 hover:text-stone-700 transition-colors"
                          onClick={() => handleSort("size")}
                        >
                          크기
                          {sortKey === "size" && (
                            sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                        <button 
                          className="w-5 text-center flex items-center justify-center gap-0.5 hover:text-stone-700 transition-colors"
                          onClick={() => handleSort("status")}
                        >
                          상태
                          {sortKey === "status" && (
                            sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <div className="w-7 flex-shrink-0" /> {/* 액션 버튼 공간 */}
                    </div>
                    {filteredFiles.map((file) => (
                      <div 
                        key={file.file_id}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 hover:bg-white/40 transition-colors cursor-pointer",
                          selectedFileIds.has(file.file_id) && "bg-primary/5"
                        )}
                        onClick={() => handleSelectFile(file.file_id)}
                      >
                        <button
                          className={cn(
                            "w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0",
                            selectedFileIds.has(file.file_id)
                              ? "bg-gradient-to-br from-primary to-primary/80 border-primary text-white"
                              : "border-stone-300 bg-white/60 hover:border-primary/50"
                          )}
                        >
                          {selectedFileIds.has(file.file_id) && <Check className="w-2 h-2" />}
                        </button>
                        <div className="w-8 flex-shrink-0 flex justify-center">
                          <div className="p-1 rounded-md bg-white/60 backdrop-blur-sm">
                            {getFormatIcon(file.file_format)}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-medium text-stone-800 truncate">{file.original_filename}</div>
                          <div className="text-[9px] text-stone-500 truncate">{file.org_name} &gt; {file.board_name}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* 품질 점수 */}
                          <span className="w-11 text-center">
                            {file.quality_score !== undefined ? (
                              <span
                                className={cn(
                                  "text-[8px] font-bold px-1.5 py-0.5 rounded-full",
                                  file.quality_score >= settings.qualityValidation.passThreshold
                                    ? "bg-emerald-100 text-emerald-700"
                                    : file.quality_score >= 0.5
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-red-100 text-red-700"
                                )}
                              >
                                {Math.round(file.quality_score * 100)}%
                              </span>
                            ) : (
                              <span className="text-[8px] text-stone-400">-</span>
                            )}
                          </span>
                          {/* 파일 형식 */}
                          <span className="w-10 text-center text-[9px] text-stone-500 uppercase font-semibold">{file.file_format}</span>
                          {/* 파일 크기 */}
                          <span className="w-14 text-center text-[9px] text-stone-500">{formatFileSize(file.file_size_bytes)}</span>
                          {/* 상태 */}
                          <span className="w-5 text-center">{getStatusIcon(file.status)}</span>
                        </div>
                        <div className="w-7 flex items-center justify-center flex-shrink-0">
                          {(file.status === "completed" || file.status === "failed") && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                              className={cn(
                                "p-1 rounded-lg transition-all",
                                file.status === "completed" 
                                  ? "bg-white/50 hover:bg-white/80 text-stone-500 hover:text-stone-700"
                                  : "bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700"
                              )}
                              title="미리보기"
                            >
                              {file.status === "completed" ? <Eye className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                            </button>
                          )}
                          {file.status === "pending" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); console.log("Start:", file.file_id); }}
                              className="p-1 rounded-lg bg-white/50 hover:bg-white/80 text-stone-500 hover:text-stone-700 transition-all"
                              title="추출 시작"
                            >
                              <Play className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </div>

          {/* 추출 결과 미리보기 모달 */}
          {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        </div>

        {/* 우측 열 (30%) - 빠른 작업 + 추출 설정 */}
        <div className="w-[30%] flex flex-col gap-4 min-h-0">
          {/* 빠른 작업 카드 (높이: 380px) */}
          <div className="glass-panel rounded-2xl p-4 flex flex-col" style={{ height: "380px" }}>
            <h2 className="font-bold text-stone-800 mb-3">빠른 작업</h2>
            <div className="flex-1 flex flex-col gap-2">
              <button
                onClick={handleStartExtraction}
                disabled={selectedTreeStats.fileCount === 0 || isExtracting}
                className={cn(
                  "w-full flex items-center gap-2 p-3 rounded-xl text-left transition-all",
                  isExtracting
                    ? "bg-gradient-to-r from-blue-100 to-blue-50 text-blue-700 border border-blue-200 cursor-wait"
                    : selectedTreeStats.fileCount > 0
                      ? "bg-gradient-to-r from-primary/15 to-primary/5 hover:from-primary/20 hover:to-primary/10 text-primary border border-primary/20 shadow-sm hover:shadow-md"
                      : "bg-white/30 text-stone-400 cursor-not-allowed border border-white/40"
                )}
              >
                <div className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm">
                  {isExtracting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-xs">
                    {isExtracting ? "추출 진행 중..." : "선택 항목 추출 시작"}
                  </div>
                  <div className="text-[10px] opacity-70 truncate">
                    {isExtracting
                      ? `${extractionProgress.current}/${extractionProgress.total}개 처리 중`
                      : `${selectedTreeStats.fileCount}개 파일 선택됨`}
                  </div>
                </div>
              </button>

              {/* 추출 진행 상황 표시 */}
              {isExtracting && extractionProgress.total > 0 && (
                <div className="p-3 rounded-xl bg-blue-50/80 border border-blue-200/50">
                  <div className="flex items-center justify-between text-xs text-blue-700 mb-2">
                    <span>진행률</span>
                    <span>{Math.round((extractionProgress.current / extractionProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-blue-200/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${(extractionProgress.current / extractionProgress.total) * 100}%` }}
                    />
                  </div>
                  {extractionProgress.currentFile && (
                    <div className="mt-2 text-[10px] text-blue-600 truncate">
                      현재: {extractionProgress.currentFile}
                    </div>
                  )}
                </div>
              )}

              {/* 실패 항목 재시도 */}
              <button
                onClick={handleRetryFailed}
                disabled={failedCount === 0 || isExtracting}
                className={cn(
                  "w-full flex items-center gap-2 p-3 rounded-xl text-left transition-all",
                  failedCount > 0 && !isExtracting
                    ? "bg-gradient-to-r from-amber-100/80 to-amber-50/60 hover:from-amber-100 hover:to-amber-50 text-amber-700 border border-amber-200/50 shadow-sm hover:shadow-md"
                    : "bg-white/30 text-stone-400 cursor-not-allowed border border-white/40"
                )}
              >
                <div className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm">
                  <RefreshCw className={cn("w-4 h-4", isExtracting && "animate-spin")} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-xs">실패 항목 재시도</div>
                  <div className="text-[10px] opacity-70">
                    실패한 {failedCount}개 파일 재추출 (재추출 전략 설정 적용)
                  </div>
                </div>
              </button>

              <div className="relative">
                <button 
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={stats.extractedFiles === 0}
                  className={cn(
                    "w-full flex items-center gap-2 p-3 rounded-xl text-left transition-all shadow-sm hover:shadow-md",
                    stats.extractedFiles > 0
                      ? "bg-white/40 backdrop-blur-sm hover:bg-white/60 text-stone-700 border border-white/60"
                      : "bg-white/30 text-stone-400 cursor-not-allowed border border-white/40"
                  )}
                >
                  <div className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm">
                    <Download className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-xs">결과 내보내기</div>
                    <div className="text-[10px] opacity-70">
                      {stats.extractedFiles > 0 ? `${stats.extractedFiles}개 파일` : "완료된 파일 없음"}
                    </div>
                  </div>
                  <ChevronDown className={cn(
                    "w-4 h-4 ml-auto transition-transform",
                    showExportMenu && "rotate-180"
                  )} />
                </button>
                
                {/* 내보내기 드롭다운 메뉴 */}
                {showExportMenu && stats.extractedFiles > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-white/60 overflow-hidden z-10">
                    <button
                      onClick={() => { handleExportResults("json"); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-700 hover:bg-stone-100 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-amber-600" />
                      JSON 형식
                    </button>
                    <button
                      onClick={() => { handleExportResults("csv"); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-700 hover:bg-stone-100 transition-colors"
                    >
                      <Table className="w-3.5 h-3.5 text-emerald-600" />
                      CSV 형식
                    </button>
                    <button
                      onClick={() => { handleExportResults("txt"); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-700 hover:bg-stone-100 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-stone-600" />
                      TXT 형식
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 추출 설정 패널 */}
          <div className="glass-panel rounded-2xl p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <h2 className="font-bold text-stone-800">추출 설정</h2>
              {/* 프리셋 선택 */}
              <select
                value={settings.preset}
                onChange={(e) => {
                  const presetName = e.target.value as keyof typeof extractionPresets;
                  const preset = extractionPresets[presetName];
                  if (preset && presetName !== "default") {
                    setSettings({ ...defaultSettings, ...preset as any, preset: presetName });
                  } else {
                    setSettings({ ...defaultSettings, preset: "default" });
                  }
                }}
                className="ui-field text-[9px] py-0.5 px-2 rounded-lg"
                style={{ width: "160px" }}
              >
                <option value="default">기본 설정</option>
                <option value="scanned">📄 스캔 문서용</option>
                <option value="encodingError">🔤 인코딩 오류용</option>
                <option value="lowQuality">⚡ 저품질 재추출</option>
                <option value="custom">⚙️ 사용자 정의</option>
              </select>
            </div>
            
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* 2열 그리드 레이아웃 */}
              <div className="grid grid-cols-2 gap-2">
                {/* 좌측 열 */}
                <div className="space-y-2">
                  {/* OCR 설정 */}
                  <div className="bg-white/30 backdrop-blur-sm rounded-xl p-2 border border-white/60">
                    <div className="text-[10px] font-semibold text-stone-600 mb-1">OCR 설정</div>
                    <div className="space-y-1">
                      <div className="grid grid-cols-2 gap-1">
                        {[
                          { value: "paddleocr", label: "Paddle" },
                          { value: "hybrid", label: "하이브리드" },
                          { value: "easyocr", label: "EasyOCR" },
                          { value: "tesseract", label: "Tesseract" },
                        ].map((option) => (
                          <label key={option.value} className={cn(
                            "flex items-center gap-1 cursor-pointer p-1 rounded transition-all text-[9px]",
                            settings.ocr.engine === option.value
                              ? "bg-primary/15 border border-primary/30"
                              : "hover:bg-white/40"
                          )}
                          onClick={() => setSettings({ ...settings, ocr: { ...settings.ocr, engine: option.value as any }, preset: "custom" })}
                          >
                            <div className={cn(
                              "w-2 h-2 rounded-full border flex items-center justify-center",
                              settings.ocr.engine === option.value ? "border-primary bg-primary" : "border-stone-300"
                            )}>
                              {settings.ocr.engine === option.value && <div className="w-0.5 h-0.5 rounded-full bg-white" />}
                            </div>
                            <span className="text-stone-700">{option.label}</span>
                          </label>
                        ))}
                      </div>
                      <div>
                        <label className="text-[9px] text-stone-500 block">OCR 신뢰도 임계값</label>
                        <input
                          type="range" min="0.1" max="0.9" step="0.1"
                          value={settings.ocr.confidenceThreshold}
                          onChange={(e) => setSettings({ ...settings, ocr: { ...settings.ocr, confidenceThreshold: parseFloat(e.target.value) }, preset: "custom" })}
                          className="w-full h-1 accent-primary"
                        />
                        <div className="text-[8px] text-stone-400 text-right">{settings.ocr.confidenceThreshold}</div>
                      </div>
                    </div>
                  </div>

                  {/* PDF 설정 */}
                  <div className="bg-white/30 backdrop-blur-sm rounded-xl p-2 border border-white/60">
                    <div className="text-[10px] font-semibold text-stone-600 mb-1">PDF 추출 전략</div>
                    <div className="space-y-0.5">
                      {[
                        { key: "preferTextLayer", label: "텍스트 레이어 우선" },
                        { key: "forceOcrMode", label: "강제 OCR 모드" },
                        { key: "hybridExtraction", label: "하이브리드 추출" },
                        { key: "pageOptimalMethod", label: "페이지별 최적화" },
                        { key: "extractImageText", label: "이미지 내 텍스트" },
                        { key: "crossPageTableMerge", label: "Cross-page 표 병합" },
                      ].map((option) => (
                        <label 
                          key={option.key} 
                          className="flex items-center gap-1 cursor-pointer p-0.5 rounded hover:bg-white/40"
                          onClick={() => setSettings({ ...settings, pdf: { ...settings.pdf, [option.key]: !(settings.pdf as any)[option.key] }, preset: "custom" })}
                        >
                          <div className={cn(
                            "w-2.5 h-2.5 rounded border flex items-center justify-center transition-all",
                            (settings.pdf as any)[option.key] ? "bg-primary border-primary text-white" : "border-stone-300 bg-white/60"
                          )}>
                            {(settings.pdf as any)[option.key] && <Check className="w-1.5 h-1.5" />}
                          </div>
                          <span className="text-[9px] text-stone-700">{option.label}</span>
                        </label>
                      ))}
                    </div>
                    
                    {/* Cross-page 표 병합 상세 설정 */}
                    {settings.pdf.crossPageTableMerge && (
                      <div className="mt-2 pt-2 border-t border-stone-200/60 space-y-1">
                        <div className="text-[9px] font-medium text-stone-500">표 병합 설정</div>
                        <div>
                          <label className="text-[8px] text-stone-400 block">병합 신뢰도 임계값</label>
                          <input
                            type="range"
                            min="0.5"
                            max="1.0"
                            step="0.05"
                            value={settings.pdf.mergeConfidenceThreshold}
                            onChange={(e) => setSettings({ 
                              ...settings, 
                              pdf: { ...settings.pdf, mergeConfidenceThreshold: parseFloat(e.target.value) }, 
                              preset: "custom" 
                            })}
                            className="w-full h-1"
                          />
                          <div className="text-[8px] text-stone-400 text-right">{settings.pdf.mergeConfidenceThreshold}</div>
                        </div>
                        <div>
                          <label className="text-[8px] text-stone-400 block">헤더 유사도 임계값</label>
                          <input
                            type="range"
                            min="0.7"
                            max="1.0"
                            step="0.05"
                            value={settings.pdf.headerSimilarityThreshold}
                            onChange={(e) => setSettings({ 
                              ...settings, 
                              pdf: { ...settings.pdf, headerSimilarityThreshold: parseFloat(e.target.value) }, 
                              preset: "custom" 
                            })}
                            className="w-full h-1"
                          />
                          <div className="text-[8px] text-stone-400 text-right">{settings.pdf.headerSimilarityThreshold}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 전처리 설정 */}
                  <div className="bg-white/30 backdrop-blur-sm rounded-xl p-2 border border-white/60">
                    <div className="text-[10px] font-semibold text-stone-600 mb-1">이미지 전처리</div>
                    <div className="space-y-1">
                      <div>
                        <label className="text-[9px] text-stone-500 block">렌더링 DPI</label>
                        <select
                          value={settings.preprocessing.renderDpi}
                          onChange={(e) => setSettings({ ...settings, preprocessing: { ...settings.preprocessing, renderDpi: parseInt(e.target.value) }, preset: "custom" })}
                          className="ui-field w-full py-0.5"
                          style={{ fontSize: "9px" }}
                        >
                          {[200, 300, 400, 600].map((v) => (
                            <option key={v} value={v}>{v} DPI</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-0.5">
                        {[
                          { key: "deskew", label: "기울기 보정" },
                          { key: "denoise", label: "노이즈 제거" },
                          { key: "binarize", label: "이진화" },
                          { key: "contrastEnhancement", label: "대비 강화" },
                        ].map((option) => (
                          <label 
                            key={option.key} 
                            className="flex items-center gap-1 cursor-pointer p-0.5 rounded hover:bg-white/40"
                            onClick={() => setSettings({ ...settings, preprocessing: { ...settings.preprocessing, [option.key]: !(settings.preprocessing as any)[option.key] }, preset: "custom" })}
                          >
                            <div className={cn(
                              "w-2.5 h-2.5 rounded border flex items-center justify-center",
                              (settings.preprocessing as any)[option.key] ? "bg-primary border-primary text-white" : "border-stone-300 bg-white/60"
                            )}>
                              {(settings.preprocessing as any)[option.key] && <Check className="w-1.5 h-1.5" />}
                            </div>
                            <span className="text-[9px] text-stone-700">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 인코딩 설정 */}
                  <div className="bg-white/30 backdrop-blur-sm rounded-xl p-2 border border-white/60">
                    <div className="text-[10px] font-semibold text-stone-600 mb-1">인코딩 복구</div>
                    <div className="space-y-1">
                      <div>
                        <label className="text-[9px] text-stone-500 block">강제 인코딩</label>
                        <select
                          value={settings.encoding.forceEncoding}
                          onChange={(e) => setSettings({ ...settings, encoding: { ...settings.encoding, forceEncoding: e.target.value }, preset: "custom" })}
                          className="ui-field w-full py-0.5"
                          style={{ fontSize: "9px" }}
                        >
                          <option value="auto">자동 감지</option>
                          <option value="utf-8">UTF-8</option>
                          <option value="euc-kr">EUC-KR</option>
                          <option value="cp949">CP949</option>
                          <option value="utf-16">UTF-16</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-0.5">
                        {[
                          { key: "fixUtf16Errors", label: "UTF-16 복구" },
                          { key: "removeBrokenChars", label: "깨진문자 제거" },
                        ].map((option) => (
                          <label 
                            key={option.key} 
                            className="flex items-center gap-1 cursor-pointer p-0.5 rounded hover:bg-white/40"
                            onClick={() => setSettings({ ...settings, encoding: { ...settings.encoding, [option.key]: !(settings.encoding as any)[option.key] }, preset: "custom" })}
                          >
                            <div className={cn(
                              "w-2.5 h-2.5 rounded border flex items-center justify-center",
                              (settings.encoding as any)[option.key] ? "bg-primary border-primary text-white" : "border-stone-300 bg-white/60"
                            )}>
                              {(settings.encoding as any)[option.key] && <Check className="w-1.5 h-1.5" />}
                            </div>
                            <span className="text-[9px] text-stone-700">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 우측 열 */}
                <div className="space-y-2">
                  {/* 재추출 전략 - 2열 배치 */}
                  <div className="bg-gradient-to-r from-amber-50/80 to-orange-50/60 backdrop-blur-sm rounded-xl p-2 border border-amber-200/60">
                    <div className="text-[10px] font-semibold text-amber-700 mb-1">재추출 전략</div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { key: "enableProgressiveRetry", label: "단계적 재시도" },
                        { key: "multiEngineComparison", label: "다중 엔진 비교" },
                        { key: "qualityBasedAdjustment", label: "품질 기반 조정" },
                      ].map((option) => (
                        <label 
                          key={option.key} 
                          className="flex items-center gap-1 cursor-pointer p-0.5 rounded hover:bg-white/40"
                          onClick={() => setSettings({ ...settings, retryStrategy: { ...settings.retryStrategy, [option.key]: !(settings.retryStrategy as any)[option.key] }, preset: "custom" })}
                        >
                          <div className={cn(
                            "w-2.5 h-2.5 rounded border flex items-center justify-center transition-all",
                            (settings.retryStrategy as any)[option.key] ? "bg-amber-500 border-amber-500 text-white" : "border-stone-300 bg-white/60"
                          )}>
                            {(settings.retryStrategy as any)[option.key] && <Check className="w-1.5 h-1.5" />}
                          </div>
                          <span className="text-[9px] text-stone-700">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 후처리 옵션 */}
                  <div className="bg-white/30 backdrop-blur-sm rounded-xl p-2 border border-white/60">
                    <div className="text-[10px] font-semibold text-stone-600 mb-1">후처리</div>
                    <div className="grid grid-cols-2 gap-0.5">
                      {[
                        { key: "removeHeaders", label: "머리글 제거" },
                        { key: "removePageNumbers", label: "페이지번호" },
                        { key: "normalizeWhitespace", label: "공백 정리" },
                        { key: "ocrErrorCorrection", label: "OCR 교정" },
                      ].map((option) => (
                        <label 
                          key={option.key} 
                          className="flex items-center gap-1 cursor-pointer p-0.5 rounded hover:bg-white/40"
                          onClick={() => setSettings({ ...settings, postprocessing: { ...settings.postprocessing, [option.key]: !(settings.postprocessing as any)[option.key] }, preset: "custom" })}
                        >
                          <div className={cn(
                            "w-2.5 h-2.5 rounded border flex items-center justify-center",
                            (settings.postprocessing as any)[option.key] ? "bg-primary border-primary text-white" : "border-stone-300 bg-white/60"
                          )}>
                            {(settings.postprocessing as any)[option.key] && <Check className="w-1.5 h-1.5" />}
                          </div>
                          <span className="text-[9px] text-stone-700">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 품질/처리 설정 */}
                  <div className="bg-white/30 backdrop-blur-sm rounded-xl p-2 border border-white/60">
                    <div className="text-[10px] font-semibold text-stone-600 mb-1">품질/처리</div>
                    <div className="space-y-1">
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <label className="text-[9px] text-stone-500 block">품질 임계값</label>
                          <select
                            value={settings.qualityValidation.passThreshold}
                            onChange={(e) => setSettings({ ...settings, qualityValidation: { ...settings.qualityValidation, passThreshold: parseFloat(e.target.value) }, preset: "custom" })}
                            className="ui-field w-full py-0.5"
                            style={{ fontSize: "9px" }}
                          >
                            {[0.5, 0.6, 0.7, 0.8, 0.85, 0.9].map((v) => (
                              <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-stone-500 block">동시 처리</label>
                          <select
                            value={settings.processing.concurrentFiles}
                            onChange={(e) => setSettings({ ...settings, processing: { ...settings.processing, concurrentFiles: parseInt(e.target.value) }, preset: "custom" })}
                            className="ui-field w-full py-0.5"
                            style={{ fontSize: "9px" }}
                          >
                            {[1, 2, 3, 4, 5].map((v) => (
                              <option key={v} value={v}>{v}개</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] text-stone-500 block">타임아웃</label>
                        <select
                          value={settings.processing.timeoutSeconds}
                          onChange={(e) => setSettings({ ...settings, processing: { ...settings.processing, timeoutSeconds: parseInt(e.target.value) }, preset: "custom" })}
                          className="ui-field w-full py-0.5"
                          style={{ fontSize: "9px" }}
                        >
                          {[60, 120, 180, 300, 600].map((v) => (
                            <option key={v} value={v}>{v}초</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* HWP/표 설정 */}
                  <div className="bg-white/30 backdrop-blur-sm rounded-xl p-2 border border-white/60">
                    <div className="text-[10px] font-semibold text-stone-600 mb-1">HWP/표</div>
                    <div className="grid grid-cols-2 gap-0.5">
                      {[
                        { cat: "hwp", key: "preserveTableStructure", label: "표 구조" },
                        { cat: "hwp", key: "includeFootnotes", label: "각주" },
                        { cat: "tableNormalization", key: "flattenHeaders", label: "헤더 병합" },
                        { cat: "tableNormalization", key: "fillEmptyCells", label: "빈 셀" },
                      ].map((option) => (
                        <label 
                          key={`${option.cat}-${option.key}`} 
                          className="flex items-center gap-1 cursor-pointer p-0.5 rounded hover:bg-white/40"
                          onClick={() => setSettings({ 
                            ...settings, 
                            [option.cat]: { ...(settings as any)[option.cat], [option.key]: !((settings as any)[option.cat] as any)[option.key] },
                            preset: "custom"
                          })}
                        >
                          <div className={cn(
                            "w-2.5 h-2.5 rounded border flex items-center justify-center",
                            ((settings as any)[option.cat] as any)[option.key] ? "bg-primary border-primary text-white" : "border-stone-300 bg-white/60"
                          )}>
                            {((settings as any)[option.cat] as any)[option.key] && <Check className="w-1.5 h-1.5" />}
                          </div>
                          <span className="text-[9px] text-stone-700">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 버튼 */}
            <div className="flex items-center justify-between pt-2 mt-2 border-t border-stone-200/60">
              <span className="text-[8px] text-stone-400">
                {settings.preset === "custom" ? "사용자 정의" : `프리셋: ${settings.preset}`}
              </span>
              <button 
                onClick={() => setSettings(defaultSettings)}
                className="glass-button px-2 py-1 rounded-lg text-[9px] font-medium hover:shadow-md transition-all"
              >
                기본값
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
