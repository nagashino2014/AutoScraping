"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  RefreshCw,
  Upload,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Key,
  Trash2,
  Table,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Clock,
  Download,
  FileJson,
  FileSpreadsheet,
  Copy,
  Check,
  FolderUp,
  Building2,
  ChevronRight,
  Folder,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

// ============================================================================
// 타입 정의
// ============================================================================

interface VectorDBStatus {
  success: boolean;
  status: string;
  db_type?: string;
  collection_name?: string;
  total_vectors?: number;
  total_embeddings?: number;
  error?: string;
  org_distribution?: Record<string, number>;
  model_distribution?: Record<string, number>;
}

interface LocalStatus {
  totalChunks: number;
  embeddedChunks: number;
  pendingChunks: number;
  syncedToVectorDB: number;
}

interface SearchResult {
  chunk_id: string;
  document: string;
  metadata: Record<string, unknown>;
  distance: number;
  similarity: number;
}

interface SearchSettings {
  nResults: number;
  similarityThreshold: number;
  tableReconstruction: boolean;
}

interface MetadataFilter {
  org_name: string;
  board_name: string;
  chunk_type: string;
}

interface CollectionInfo {
  name: string;
  count: number;
  dimension: number;
  storage_path: string;
}

interface ReconstructedTable {
  table_id: string;
  table_title: string;
  content: string;
  total_chunks: number;
}

interface SearchHistoryItem {
  query: string;
  timestamp: number;
  resultsCount: number;
}

// 기관 정보
interface Organization {
  org_id: string;
  org_name: string;
  org_type?: "국가기관" | "유관기관" | "협회 및 학회";
  logo_path?: string;
}

// 보드 정보
interface Board {
  board_id: string;
  org_id: string;
  board_name: string;
  enabled: boolean;
}

// 트리 노드 타입
type TreeNodeType = "category" | "organization";

interface OrgTreeNode {
  id: string;
  type: TreeNodeType;
  name: string;
  logo?: string;
  count: number;
  isExpanded?: boolean;
  isChecked?: boolean;
  children?: OrgTreeNode[];
}

// ============================================================================
// 로컬 스토리지 헬퍼
// ============================================================================

const SEARCH_HISTORY_KEY = "vectorize_search_history";
const MAX_HISTORY_ITEMS = 10;

function loadSearchHistory(): SearchHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(history: SearchHistoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // ignore
  }
}

// ============================================================================
// 테이블 청크 파싱 및 렌더링
// ============================================================================

interface ParsedTableData {
  title: string;
  rowInfo: string;
  headers: string[];
  rows: { rowNum: number; cells: Record<string, string> }[];
}

/**
 * 테이블 청크 문서 내용을 파싱하여 구조화된 데이터로 변환
 * 형식: [표: 표 2] (1~4행 / 전체 4행) 이 표의 열: 시 간, 주요 내용, 비 고 - 1행: 키=값, ... - 2행: ...
 */
function parseTableChunk(document: string): ParsedTableData | null {
  try {
    // 제목 추출
    const titleMatch = document.match(/\[표:\s*([^\]]+)\]/);
    const title = titleMatch ? titleMatch[1].trim() : "표";
    
    // 행 정보 추출
    const rowInfoMatch = document.match(/\(([^)]+)\)/);
    const rowInfo = rowInfoMatch ? rowInfoMatch[1] : "";
    
    // 헤더 추출
    const headerMatch = document.match(/이 표의 열:\s*([^\n-]+)/);
    const headers = headerMatch 
      ? headerMatch[1].split(",").map(h => h.trim()).filter(Boolean)
      : [];
    
    // 행 데이터 추출
    const rows: ParsedTableData["rows"] = [];
    const rowPattern = /- (\d+)행:\s*([^\n]+)/g;
    let match;
    
    while ((match = rowPattern.exec(document)) !== null) {
      const rowNum = parseInt(match[1]);
      const cellData = match[2];
      const cells: Record<string, string> = {};
      
      // 키=값 형식 파싱
      const cellPattern = /([^=,]+)=([^,]+)/g;
      let cellMatch;
      while ((cellMatch = cellPattern.exec(cellData)) !== null) {
        const key = cellMatch[1].trim();
        const value = cellMatch[2].trim();
        cells[key] = value;
      }
      
      if (Object.keys(cells).length > 0) {
        rows.push({ rowNum, cells });
      }
    }
    
    // 파싱 실패 시 null 반환
    if (headers.length === 0 && rows.length === 0) {
      return null;
    }
    
    return { title, rowInfo, headers, rows };
  } catch {
    return null;
  }
}

/**
 * 시맨틱 형식 테이블 문서 파싱 (항목 N: - 키: 값 형식)
 */
function parseSemanticTableChunk(document: string): ParsedTableData | null {
  try {
    // [표 데이터] 패턴 확인
    if (!document.includes("[표 데이터]") && !document.includes("항목")) {
      return null;
    }
    
    const headers: string[] = [];
    const rows: ParsedTableData["rows"] = [];
    const headerSet = new Set<string>();
    
    // 항목별로 분리
    const itemPattern = /항목\s*(\d+):([\s\S]*?)(?=항목\s*\d+:|$)/g;
    let match;
    let rowNum = 1;
    
    while ((match = itemPattern.exec(document)) !== null) {
      const itemContent = match[2];
      const cells: Record<string, string> = {};
      
      // 키: 값 형식 파싱
      const kvPattern = /- ([^:：]+)[：:][\s]*([^\n]+)/g;
      let kvMatch;
      while ((kvMatch = kvPattern.exec(itemContent)) !== null) {
        const key = kvMatch[1].trim();
        const value = kvMatch[2].trim();
        cells[key] = value;
        headerSet.add(key);
      }
      
      if (Object.keys(cells).length > 0) {
        rows.push({ rowNum, cells });
        rowNum++;
      }
    }
    
    if (rows.length === 0) {
      return null;
    }
    
    // 헤더 설정
    headers.push(...Array.from(headerSet));
    
    return {
      title: "표 데이터",
      rowInfo: `전체 ${rows.length}행`,
      headers,
      rows,
    };
  } catch {
    return null;
  }
}

/**
 * 파싱된 테이블 데이터를 HTML 테이블 컴포넌트로 렌더링
 */
function TableRenderer({ data }: { data: ParsedTableData }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="bg-stone-50 px-3 py-2 border-b border-stone-200">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-700">{data.title}</span>
          <span className="text-xs text-stone-500">{data.rowInfo}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-stone-100">
              <th className="px-3 py-2 text-left font-medium text-stone-600 border-r border-stone-200 w-12">#</th>
              {data.headers.map((header, idx) => (
                <th 
                  key={idx} 
                  className="px-3 py-2 text-left font-medium text-stone-600 border-r border-stone-200 last:border-r-0 whitespace-nowrap"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, idx) => (
              <tr 
                key={idx} 
                className={cn(
                  "border-t border-stone-100",
                  idx % 2 === 0 ? "bg-white" : "bg-stone-50/50"
                )}
              >
                <td className="px-3 py-2 text-stone-400 border-r border-stone-100">{row.rowNum}</td>
                {data.headers.map((header, cellIdx) => (
                  <td 
                    key={cellIdx} 
                    className="px-3 py-2 text-stone-700 border-r border-stone-100 last:border-r-0"
                  >
                    {row.cells[header] || "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// 트리뷰 노드 컴포넌트
// ============================================================================

function OrgTreeNodeComponent({
  node,
  depth = 0,
  onToggleExpand,
  onToggleCheck,
}: {
  node: OrgTreeNode;
  depth?: number;
  onToggleExpand: (id: string) => void;
  onToggleCheck: (id: string) => void;
}) {
  const paddingLeft = depth * 20;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-3 rounded-xl cursor-pointer transition-all duration-200",
          "hover:bg-white/50 hover:shadow-sm",
          node.isChecked && node.type === "organization" && "bg-primary/10 border border-primary/20"
        )}
        style={{ paddingLeft: paddingLeft + 12 }}
        onClick={() => {
          if (node.type === "category") {
            onToggleExpand(node.id);
          } else {
            onToggleCheck(node.id);
          }
        }}
      >
        {/* 확장/축소 버튼 (카테고리만) */}
        {node.type === "category" ? (
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

        {/* 체크박스 (기관만) */}
        {node.type === "organization" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck(node.id);
            }}
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shadow-sm",
              node.isChecked
                ? "bg-gradient-to-br from-primary to-primary/80 border-primary text-white shadow-primary/30"
                : "border-stone-300 bg-white/60 backdrop-blur-sm hover:border-primary/50 hover:bg-white/80"
            )}
          >
            {node.isChecked && <Check className="w-3 h-3" />}
          </button>
        )}

        {/* 아이콘 */}
        <div className="p-1 rounded-md bg-white/40 backdrop-blur-sm">
          {node.type === "category" ? (
            <Folder className="w-4 h-4 text-amber-600" />
          ) : node.logo ? (
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
          ) : (
            <Building2 className="w-4 h-4 text-stone-600" />
          )}
        </div>

        {/* 노드명 */}
        <span className="flex-1 text-sm font-medium text-stone-700 truncate">
          {node.name}
        </span>

        {/* 벡터 수 배지 */}
        {node.type === "organization" && (
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs backdrop-blur-sm",
            node.count > 0 
              ? "bg-primary/10 text-primary font-medium"
              : "bg-stone-100 text-stone-400"
          )}>
            {node.count.toLocaleString()}개
          </span>
        )}
        {node.type === "category" && (
          <span className="text-xs text-stone-400">
            {node.children?.length || 0}개 기관
          </span>
        )}
      </div>

      {/* 자식 노드 */}
      {node.isExpanded && hasChildren && (
        <div className="relative">
          <div className="absolute left-[30px] top-0 bottom-2 w-px bg-gradient-to-b from-stone-200 to-transparent" />
          {node.children!.map((child) => (
            <OrgTreeNodeComponent
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

export default function VectorizePage() {
  // 상태
  const [vectorDBStatus, setVectorDBStatus] = useState<VectorDBStatus | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 검색 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState<string>("openai-small");
  
  // 검색 설정
  const [searchSettings, setSearchSettings] = useState<SearchSettings>({
    nResults: 5,
    similarityThreshold: 0.0,
    tableReconstruction: false,
  });
  
  // 메타데이터 필터
  const [metadataFilter, setMetadataFilter] = useState<MetadataFilter>({
    org_name: "",
    board_name: "",
    chunk_type: "",
  });
  
  // 필터 옵션 (DB에서 로드)
  const [filterOptions, setFilterOptions] = useState<{
    orgs: string[];
    boards: string[];
    chunkTypes: string[];
  }>({
    orgs: [],
    boards: [],
    chunkTypes: ["text", "table_full", "table_segment"],
  });

  // 인덱스 관리 상태
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // 기관 데이터
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgDistribution, setOrgDistribution] = useState<Record<string, number>>({});
  
  // 보드 데이터 (기관별 필터용)
  const [allBoards, setAllBoards] = useState<Board[]>([]);
  const [filteredBoards, setFilteredBoards] = useState<Board[]>([]);

  // 트리뷰 상태
  const [treeData, setTreeData] = useState<OrgTreeNode[]>([]);

  // 표 재조합 상태
  const [reconstructedTables, setReconstructedTables] = useState<Map<string, ReconstructedTable>>(new Map());
  const [reconstructing, setReconstructing] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  // 검색 히스토리 상태
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // 내보내기/가져오기 상태
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============================================================================
  // 데이터 로드
  // ============================================================================

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/processing/vectorize");
      const data = await res.json();
      
      setVectorDBStatus(data.vectordb);
      setLocalStatus(data.local);
      
      // 필터 옵션 추출
      if (data.vectordb?.org_distribution) {
        setOrgDistribution(data.vectordb.org_distribution);
        setFilterOptions(prev => ({
          ...prev,
          orgs: Object.keys(data.vectordb.org_distribution),
        }));
      }
    } catch (error) {
      console.error("Error loading status:", error);
      setVectorDBStatus({
        success: false,
        status: "error",
        error: "상태 조회 실패"
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // 기관 및 보드 데이터 로드
  const loadOrgsData = useCallback(async () => {
    try {
      // 기관 데이터 로드
      const orgsRes = await fetch("/api/scraper/targets/orgs");
      const orgsData = await orgsRes.json();
      if (orgsData.orgs) {
        setOrgs(orgsData.orgs);
      }
      
      // 보드 데이터 로드
      const boardsRes = await fetch("/api/scraper/targets/boards");
      const boardsData = await boardsRes.json();
      if (boardsData.boards) {
        setAllBoards(boardsData.boards);
      }
    } catch (error) {
      console.error("Error loading orgs/boards:", error);
    }
  }, []);

  // 컬렉션 정보 로드
  const loadCollections = useCallback(async () => {
    try {
      const res = await fetch("/api/processing/vectorize/collections");
      const data = await res.json();
      if (data.success) {
        setCollections(data.collections || []);
      }
    } catch (error) {
      console.error("Error loading collections:", error);
    }
  }, []);

  // 임베딩 설정 로드
  const loadEmbeddingSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/processing/embedding/settings");
      const data = await res.json();
      if (data.success && data.settings) {
        setEmbeddingModel(data.settings.model);
      }
    } catch (error) {
      console.error("Error loading embedding settings:", error);
    }
  }, []);

  // .env.local에서 API 키 자동 로드
  const checkApiKey = useCallback(async () => {
    try {
      const res = await fetch("/api/processing/embedding/check-api-key");
      const data = await res.json();
      if (data.hasKey && data.key) {
        setApiKey(data.key);
      }
    } catch (error) {
      console.error("Error checking API key:", error);
    }
  }, []);

  useEffect(() => {
    loadOrgsData();
    loadCollections();
    loadEmbeddingSettings();
    checkApiKey();
    setSearchHistory(loadSearchHistory());
  }, [loadOrgsData, loadCollections, loadEmbeddingSettings, checkApiKey]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // 트리뷰 데이터 생성
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

    // 트리 노드 생성
    const tree: OrgTreeNode[] = Object.entries(orgsByType)
      .filter(([, orgList]) => orgList.length > 0)
      .map(([category, orgList]) => ({
        id: `cat_${category}`,
        type: "category" as TreeNodeType,
        name: category,
        count: 0,
        isExpanded: category === "국가기관",
        children: orgList.map((org) => ({
          id: org.org_id,
          type: "organization" as TreeNodeType,
          name: org.org_name,
          logo: org.logo_path,
          count: orgDistribution[org.org_name] || 0,
          isChecked: false,
        })),
      }));

    setTreeData(tree);
  }, [orgs, orgDistribution]);

  // ============================================================================
  // 트리뷰 핸들러
  // ============================================================================

  const handleToggleExpand = useCallback((id: string) => {
    setTreeData((prev) => {
      const updateNode = (nodes: OrgTreeNode[]): OrgTreeNode[] => {
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
    setTreeData((prev) => {
      const updateNode = (nodes: OrgTreeNode[]): OrgTreeNode[] => {
        return nodes.map((node) => {
          if (node.id === id && node.type === "organization") {
            return { ...node, isChecked: !node.isChecked };
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

  // 선택된 기관 목록
  const selectedOrgs = useMemo(() => {
    const selected: { org_name: string; count: number }[] = [];
    const findSelected = (nodes: OrgTreeNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "organization" && node.isChecked) {
          selected.push({ org_name: node.name, count: node.count });
        }
        if (node.children) {
          findSelected(node.children);
        }
      });
    };
    findSelected(treeData);
    return selected;
  }, [treeData]);

  // ============================================================================
  // 인덱스 관리
  // ============================================================================

  const handleDeleteSelected = async () => {
    if (selectedOrgs.length === 0) return;
    
    setDeleting(true);
    try {
      let totalDeleted = 0;
      
      for (const org of selectedOrgs) {
        const res = await fetch("/api/processing/vectorize/delete-by-filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filter: { org_name: org.org_name } }),
        });
        const data = await res.json();
        
        if (data.success) {
          totalDeleted += data.deleted || 0;
        }
      }
      
      alert(`${totalDeleted}개 벡터가 삭제되었습니다.`);
      setShowDeleteConfirm(false);
      // 체크 해제
      setTreeData((prev) => {
        const uncheckAll = (nodes: OrgTreeNode[]): OrgTreeNode[] => {
          return nodes.map((node) => ({
            ...node,
            isChecked: false,
            children: node.children ? uncheckAll(node.children) : undefined,
          }));
        };
        return uncheckAll(prev);
      });
      loadStatus();
      loadCollections();
    } catch (error) {
      console.error("Error deleting:", error);
      alert("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const handleClearCollection = async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/processing/vectorize/clear", {
        method: "POST",
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`컬렉션이 초기화되었습니다. (${data.deleted}개 벡터 삭제)`);
        setShowClearConfirm(false);
        loadStatus();
        loadCollections();
      } else {
        alert(`오류: ${data.error}`);
      }
    } catch (error) {
      console.error("Error clearing:", error);
      alert("초기화 중 오류가 발생했습니다.");
    } finally {
      setClearing(false);
    }
  };

  // ============================================================================
  // 표 재조합
  // ============================================================================

  const reconstructTable = async (tableId: string) => {
    if (reconstructing.has(tableId)) return;
    
    setReconstructing(prev => new Set(prev).add(tableId));
    try {
      const res = await fetch("/api/processing/vectorize/reconstruct-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_id: tableId }),
      });
      const data = await res.json();
      
      if (data.success) {
        setReconstructedTables(prev => new Map(prev).set(tableId, {
          table_id: tableId,
          table_title: data.table_title || "",
          content: data.content || "",
          total_chunks: data.total_chunks || 0,
        }));
        setExpandedTables(prev => new Set(prev).add(tableId));
      }
    } catch (error) {
      console.error("Error reconstructing table:", error);
    } finally {
      setReconstructing(prev => {
        const next = new Set(prev);
        next.delete(tableId);
        return next;
      });
    }
  };

  const toggleTableExpand = (tableId: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableId)) {
        next.delete(tableId);
      } else {
        next.add(tableId);
        if (!reconstructedTables.has(tableId)) {
          reconstructTable(tableId);
        }
      }
      return next;
    });
  };

  // ============================================================================
  // 검색
  // ============================================================================

  const isOpenAIModel = embeddingModel.startsWith("openai");

  const handleSearchClick = () => {
    // API 키는 서버에서 .env.local에서 자동 로드하므로 바로 검색 실행
    executeSearch();
  };

  const executeSearch = async (queryOverride?: string) => {
    const query = queryOverride || searchQuery;
    if (!query.trim()) {
      alert("검색어를 입력하세요.");
      return;
    }

    setShowApiKeyModal(false);
    setSearching(true);
    setSearchResults([]);
    setReconstructedTables(new Map());
    setExpandedTables(new Set());
    setShowHistory(false);

    try {
      const filter: Record<string, string> = {};
      if (metadataFilter.org_name) filter.org_name = metadataFilter.org_name;
      if (metadataFilter.board_name) filter.board_name = metadataFilter.board_name;
      if (metadataFilter.chunk_type) filter.chunk_type = metadataFilter.chunk_type;

      const res = await fetch("/api/processing/vectorize/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query,
          api_key: isOpenAIModel ? apiKey : undefined,
          n_results: searchSettings.nResults,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        }),
      });
      const data = await res.json();

      if (data.success) {
        let results = data.results || [];
        if (searchSettings.similarityThreshold > 0) {
          results = results.filter((r: SearchResult) => 
            (r.similarity || (1 - r.distance)) >= searchSettings.similarityThreshold
          );
        }
        setSearchResults(results);

        // 검색 히스토리 저장
        const newHistory: SearchHistoryItem[] = [
          { query: query, timestamp: Date.now(), resultsCount: results.length },
          ...searchHistory.filter(h => h.query !== query)
        ].slice(0, MAX_HISTORY_ITEMS);
        setSearchHistory(newHistory);
        saveSearchHistory(newHistory);

        // 표 재조합
        if (searchSettings.tableReconstruction) {
          const tableIds = new Set<string>();
          results.forEach((r: SearchResult) => {
            const tableId = r.metadata?.table_id as string;
            if (tableId && (r.metadata?.chunk_type === "table_segment" || r.metadata?.chunk_type === "table_full")) {
              tableIds.add(tableId);
            }
          });
          tableIds.forEach(tableId => reconstructTable(tableId));
        }
      } else {
        alert(`검색 오류: ${data.error}`);
      }
    } catch (error) {
      console.error("Error searching:", error);
      alert("검색 중 오류가 발생했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const handleHistoryClick = (query: string) => {
    setSearchQuery(query);
    setShowHistory(false);
    // 검색 자동 실행
    setTimeout(() => {
      executeSearch(query);
    }, 100);
  };
  
  // 기관 선택 시 보드 필터링
  useEffect(() => {
    if (metadataFilter.org_name) {
      // 선택된 기관의 보드만 필터링
      const org = orgs.find(o => o.org_name === metadataFilter.org_name);
      if (org) {
        const orgBoards = allBoards.filter(b => b.org_id === org.org_id && b.enabled);
        setFilteredBoards(orgBoards);
      } else {
        setFilteredBoards([]);
      }
      // 기관 변경 시 보드 선택 초기화
      setMetadataFilter(prev => ({ ...prev, board_name: "" }));
    } else {
      setFilteredBoards([]);
    }
  }, [metadataFilter.org_name, orgs, allBoards]);

  const clearSearchHistory = () => {
    setSearchHistory([]);
    saveSearchHistory([]);
  };

  // ============================================================================
  // 내보내기/가져오기
  // ============================================================================

  const exportSearchResults = (format: "json" | "csv") => {
    if (searchResults.length === 0) {
      alert("내보낼 검색 결과가 없습니다.");
      return;
    }

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === "json") {
      const exportData = {
        query: searchQuery,
        timestamp: new Date().toISOString(),
        settings: searchSettings,
        filters: metadataFilter,
        resultsCount: searchResults.length,
        results: searchResults.map(r => ({
          chunk_id: r.chunk_id,
          similarity: r.similarity || (1 - r.distance),
          document: r.document,
          metadata: r.metadata
        }))
      };
      content = JSON.stringify(exportData, null, 2);
      filename = `search_results_${Date.now()}.json`;
      mimeType = "application/json";
    } else {
      // CSV 형식
      const headers = ["순위", "청크ID", "유사도", "기관", "보드", "청크타입", "게시일", "내용"];
      const rows = searchResults.map((r, i) => [
        i + 1,
        r.chunk_id || "",
        ((r.similarity || (1 - r.distance)) * 100).toFixed(2) + "%",
        r.metadata?.org_name || "",
        r.metadata?.board_name || "",
        r.metadata?.chunk_type || "",
        r.metadata?.published_date ? String(r.metadata.published_date).substring(0, 10) : "",
        `"${(r.document || "").replace(/"/g, '""').substring(0, 200)}..."`
      ]);
      content = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      filename = `search_results_${Date.now()}.csv`;
      mimeType = "text/csv;charset=utf-8";
    }

    // 파일 다운로드
    const blob = new Blob(["\ufeff" + content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportVectorDB = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/processing/vectorize/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "json" }),
      });
      
      if (!res.ok) {
        throw new Error("Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vectordb_backup_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert("벡터 DB 백업이 완료되었습니다.");
    } catch (error) {
      console.error("Error exporting:", error);
      alert("내보내기 중 오류가 발생했습니다.");
    } finally {
      setExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const importVectorDB = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const content = await file.text();
      const data = JSON.parse(content);

      if (!data.vectors || !Array.isArray(data.vectors)) {
        throw new Error("잘못된 백업 파일 형식입니다.");
      }

      const res = await fetch("/api/processing/vectorize/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vectors: data.vectors }),
      });

      const result = await res.json();
      
      if (result.success) {
        alert(`${result.imported}개 벡터가 복원되었습니다.`);
        loadStatus();
        loadCollections();
      } else {
        alert(`오류: ${result.error}`);
      }
    } catch (error) {
      console.error("Error importing:", error);
      alert("가져오기 중 오류가 발생했습니다. 파일 형식을 확인하세요.");
    } finally {
      setImporting(false);
      // 파일 입력 초기화
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const copyChunkId = (chunkId: string) => {
    navigator.clipboard.writeText(chunkId);
    setCopiedId(chunkId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ============================================================================
  // 포맷 유틸
  // ============================================================================

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatSimilarity = (distance: number, similarity?: number) => {
    const sim = similarity ?? (1 - distance);
    return (sim * 100).toFixed(1);
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days}일 전`;
    if (hours > 0) return `${hours}시간 전`;
    if (minutes > 0) return `${minutes}분 전`;
    return "방금 전";
  };

  // ============================================================================
  // 렌더링
  // ============================================================================

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* 숨겨진 파일 입력 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={importVectorDB}
        className="hidden"
      />

      {/* 헤더 - 박스화 */}
      <div className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">벡터화</h1>
            <p className="text-xs text-stone-500">임베딩 벡터를 벡터 데이터베이스에 저장하고 검색합니다</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { loadStatus(); loadCollections(); }}
              disabled={loading}
              className="p-2 rounded-xl hover:bg-stone-100 transition-colors"
            >
              <RefreshCw className={cn("w-5 h-5 text-stone-400", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </div>

      {/* 메인 레이아웃 - 5:5 비율 */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* 좌측 (50%) */}
        <div className="w-1/2 flex flex-col gap-4 overflow-y-auto">
          {/* 벡터 DB 상태 카드 */}
          <div className="glass-panel p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-stone-700">벡터 DB 상태</h3>
              {vectorDBStatus?.success ? (
                <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" />
                  연결됨
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded-full">
                  <AlertCircle className="w-3 h-3" />
                  연결 안됨
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
              </div>
            ) : vectorDBStatus?.success ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50">
                  <span className="text-sm text-stone-600">DB 타입</span>
                  <span className="text-sm font-medium text-stone-800">{vectorDBStatus.db_type}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50">
                  <span className="text-sm text-stone-600">컬렉션</span>
                  <span className="text-sm font-medium text-stone-800">{vectorDBStatus.collection_name}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5">
                  <span className="text-sm text-stone-600">저장된 벡터</span>
                  <span className="text-lg font-bold text-primary">
                    {formatNumber(vectorDBStatus.total_embeddings || vectorDBStatus.total_vectors || 0)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-red-50 text-red-600 text-sm">
                <p className="font-medium mb-1">백엔드 서버 연결 필요</p>
                <p className="text-xs opacity-80">
                  백엔드 서버를 시작하세요: <code className="bg-white/50 px-1 rounded">python run.py</code>
                </p>
              </div>
            )}
          </div>

          {/* 로컬 데이터 현황 + 데이터 관리 카드 (한 행 배치) */}
          <div className="flex gap-4">
            {/* 로컬 데이터 현황 카드 */}
            <div className="glass-panel p-5 rounded-2xl flex-1">
              <h3 className="text-sm font-semibold text-stone-700 mb-4">로컬 데이터 현황</h3>

              {localStatus ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-xl bg-stone-50 text-center">
                      <p className="text-base font-bold text-stone-800">{formatNumber(localStatus.totalChunks)}</p>
                      <p className="text-xs text-stone-500">총 청크</p>
                    </div>
                    <div className="p-2 rounded-xl bg-stone-50 text-center">
                      <p className="text-base font-bold text-stone-800">{formatNumber(localStatus.syncedToVectorDB)}</p>
                      <p className="text-xs text-stone-500">임베딩됨</p>
                    </div>
                  </div>

                  <div className="p-2 rounded-xl bg-stone-50">
                    <div className="flex justify-between text-xs text-stone-500 mb-1">
                      <span>임베딩 진행률</span>
                      <span>{Math.round((localStatus.syncedToVectorDB / localStatus.totalChunks) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
                        style={{
                          width: localStatus.totalChunks > 0
                            ? `${(localStatus.syncedToVectorDB / localStatus.totalChunks) * 100}%`
                            : "0%"
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
                </div>
              )}
            </div>

            {/* 데이터 관리 카드 */}
            <div className="glass-panel p-5 rounded-2xl flex-1">
              <h3 className="text-sm font-semibold text-stone-700 mb-4">데이터 관리</h3>

              <div className="grid grid-cols-2 gap-2">
                {/* 벡터 DB 백업 */}
                <button
                  onClick={exportVectorDB}
                  disabled={exporting || !vectorDBStatus?.success}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl border border-stone-200 hover:bg-stone-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exporting ? (
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  ) : (
                    <Download className="w-5 h-5 text-primary" />
                  )}
                  <p className="text-xs font-medium text-stone-700">백업</p>
                </button>

                {/* 벡터 DB 복원 */}
                <button
                  onClick={handleImportClick}
                  disabled={importing || !vectorDBStatus?.success}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl border border-stone-200 hover:bg-stone-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  ) : (
                    <FolderUp className="w-5 h-5 text-blue-500" />
                  )}
                  <p className="text-xs font-medium text-stone-700">복원</p>
                </button>

                {/* 검색 결과 JSON */}
                <button
                  onClick={() => exportSearchResults("json")}
                  disabled={searchResults.length === 0}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl border border-stone-200 hover:bg-stone-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileJson className="w-5 h-5 text-purple-500" />
                  <p className="text-xs font-medium text-stone-700">JSON</p>
                </button>

                {/* 검색 결과 CSV */}
                <button
                  onClick={() => exportSearchResults("csv")}
                  disabled={searchResults.length === 0}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl border border-stone-200 hover:bg-stone-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet className="w-5 h-5 text-green-500" />
                  <p className="text-xs font-medium text-stone-700">CSV</p>
                </button>
              </div>
            </div>
          </div>

          {/* 인덱스 관리 카드 */}
          <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-stone-700">인덱스 관리</h3>
              {collections.length > 0 && (
                <span className="text-xs text-stone-500">
                  {collections[0]?.dimension}차원 · {formatNumber(collections[0]?.count || 0)}개
                </span>
              )}
            </div>

            {/* 기관별 데이터 삭제 - 트리뷰 */}
            <div className="flex-1 overflow-y-auto min-h-0 mb-3">
              <label className="block text-xs text-stone-500 mb-2">기관별 데이터 삭제</label>
              
              {treeData.length > 0 ? (
                <div className="space-y-1 rounded-xl bg-white/30 backdrop-blur-sm p-2 border border-stone-200/50">
                  {treeData.map(node => (
                    <OrgTreeNodeComponent
                      key={node.id}
                      node={node}
                      onToggleExpand={handleToggleExpand}
                      onToggleCheck={handleToggleCheck}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-stone-400 text-sm">
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "기관 데이터를 불러오는 중..."
                  )}
                </div>
              )}
            </div>

            {/* 버튼 영역 */}
            <div className="space-y-2">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={selectedOrgs.length === 0 || deleting}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
                  selectedOrgs.length > 0
                    ? "bg-red-100 text-red-600 hover:bg-red-200"
                    : "bg-stone-100 text-stone-400 cursor-not-allowed"
                )}
              >
                <Trash2 className="w-4 h-4" />
                선택 삭제 ({selectedOrgs.length}개 기관)
              </button>

              <button
                onClick={() => setShowClearConfirm(true)}
                disabled={clearing || !vectorDBStatus?.success}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
                컬렉션 전체 초기화
              </button>
            </div>
          </div>
        </div>

        {/* 우측 (50%) */}
        <div className="w-1/2 flex flex-col gap-4 overflow-y-auto">
          {/* 검색 설정 카드 */}
          <div className="glass-panel p-5 rounded-2xl">
            <h3 className="text-sm font-semibold text-stone-700 mb-4">검색 설정</h3>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-stone-500 mb-1">결과 수</label>
                <select
                  value={searchSettings.nResults}
                  onChange={(e) => setSearchSettings(prev => ({ ...prev, nResults: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={3}>3개</option>
                  <option value={5}>5개</option>
                  <option value={10}>10개</option>
                  <option value={15}>15개</option>
                  <option value={20}>20개</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs text-stone-500 mb-1">유사도 임계값</label>
                <select
                  value={searchSettings.similarityThreshold}
                  onChange={(e) => setSearchSettings(prev => ({ ...prev, similarityThreshold: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0}>없음</option>
                  <option value={0.1}>10% 이상</option>
                  <option value={0.2}>20% 이상</option>
                  <option value={0.3}>30% 이상</option>
                  <option value={0.5}>50% 이상</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs text-stone-500 mb-1">표 재조합</label>
                <button
                  onClick={() => setSearchSettings(prev => ({ ...prev, tableReconstruction: !prev.tableReconstruction }))}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg border text-sm transition-all",
                    searchSettings.tableReconstruction
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-stone-200 text-stone-600 hover:bg-stone-50"
                  )}
                >
                  {searchSettings.tableReconstruction ? "활성화" : "비활성화"}
                </button>
              </div>
            </div>
          </div>

          {/* 메타데이터 필터 카드 */}
          <div className="glass-panel p-5 rounded-2xl">
            <h3 className="text-sm font-semibold text-stone-700 mb-4">메타데이터 필터</h3>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-stone-500 mb-1">기관</label>
                <select
                  value={metadataFilter.org_name}
                  onChange={(e) => setMetadataFilter(prev => ({ ...prev, org_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">전체 기관</option>
                  {filterOptions.orgs.map(org => (
                    <option key={org} value={org}>{org}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-xs text-stone-500 mb-1">보드</label>
                <select
                  value={metadataFilter.board_name}
                  onChange={(e) => setMetadataFilter(prev => ({ ...prev, board_name: e.target.value }))}
                  disabled={!metadataFilter.org_name}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
                    !metadataFilter.org_name && "bg-stone-100 text-stone-400 cursor-not-allowed"
                  )}
                >
                  <option value="">{metadataFilter.org_name ? "전체 보드" : "기관을 먼저 선택하세요"}</option>
                  {filteredBoards.map((board) => (
                    <option key={board.board_id} value={board.board_name}>
                      {board.board_name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-xs text-stone-500 mb-1">청크 타입</label>
                <select
                  value={metadataFilter.chunk_type}
                  onChange={(e) => setMetadataFilter(prev => ({ ...prev, chunk_type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">전체 타입</option>
                  {filterOptions.chunkTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
            
            {(metadataFilter.org_name || metadataFilter.board_name || metadataFilter.chunk_type) && (
              <button
                onClick={() => setMetadataFilter({ org_name: "", board_name: "", chunk_type: "" })}
                className="mt-3 text-xs text-stone-500 hover:text-primary transition-colors"
              >
                필터 초기화
              </button>
            )}
          </div>

          {/* 검색 테스트 카드 */}
          <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col min-h-0">
            <h3 className="text-sm font-semibold text-stone-700 mb-4">벡터 검색 테스트</h3>

            {/* 검색 입력 */}
            <div className="relative mb-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchClick()}
                    onFocus={() => searchHistory.length > 0 && setShowHistory(true)}
                    placeholder="검색어를 입력하세요..."
                    className="w-full px-4 py-3 pr-10 rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className={cn(
                      "absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors",
                      searchHistory.length > 0
                        ? "hover:bg-stone-100 text-stone-400"
                        : "text-stone-300 cursor-default"
                    )}
                    disabled={searchHistory.length === 0}
                    title={searchHistory.length > 0 ? "검색 히스토리" : "검색 기록 없음"}
                  >
                    <Clock className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={handleSearchClick}
                  disabled={searching || !vectorDBStatus?.success}
                  className={cn(
                    "px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2",
                    vectorDBStatus?.success
                      ? "bg-primary text-white hover:bg-primary/90"
                      : "bg-stone-200 text-stone-400 cursor-not-allowed"
                  )}
                >
                  {searching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  검색
                </button>
              </div>

              {/* 검색 히스토리 드롭다운 */}
              {showHistory && searchHistory.length > 0 && (
                <div className="absolute left-0 right-16 top-full mt-1 bg-white rounded-xl shadow-lg border border-stone-200 py-2 z-10 max-h-60 overflow-y-auto">
                  <div className="flex items-center justify-between px-3 py-1 mb-1 border-b border-stone-100">
                    <span className="text-xs text-stone-500">최근 검색어</span>
                    <button
                      onClick={clearSearchHistory}
                      className="text-xs text-stone-400 hover:text-red-500 transition-colors"
                    >
                      전체 삭제
                    </button>
                  </div>
                  {searchHistory.map((item, index) => (
                    <button
                      key={index}
                      onClick={() => handleHistoryClick(item.query)}
                      className="w-full px-4 py-2 text-left hover:bg-stone-50 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Clock className="w-3 h-3 text-stone-400 flex-shrink-0" />
                        <span className="text-sm text-stone-700 truncate">{item.query}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-stone-400">{item.resultsCount}건</span>
                        <span className="text-xs text-stone-400">{formatTimeAgo(item.timestamp)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 검색 결과 */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {searchResults.length > 0 ? (
                <div className="space-y-3">
                  {searchResults.map((result, index) => {
                    const isTableChunk = result.metadata?.chunk_type === "table_segment" || result.metadata?.chunk_type === "table_full";
                    const tableId = result.metadata?.table_id as string;
                    const hasReconstructed = tableId && reconstructedTables.has(tableId);
                    const isExpanded = tableId && expandedTables.has(tableId);
                    const isReconstructingThis = !!(tableId && reconstructing.has(tableId));
                    const sourceFile = result.metadata?.source_file as string;
                    const orgName = result.metadata?.org_name as string;
                    const boardName = result.metadata?.board_name as string;
                    const dateFolder = result.metadata?.date_folder as string;

                    return (
                      <div
                        key={result.chunk_id || index}
                        className="p-4 rounded-xl bg-stone-50 hover:bg-stone-100 transition-colors"
                      >
                        {/* 결과 헤더 */}
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-stone-600">#{index + 1}</span>
                            <span className="text-xs text-stone-400">·</span>
                            <span className="text-xs text-stone-500">
                              유사도: {formatSimilarity(result.distance, result.similarity)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => copyChunkId(result.chunk_id)}
                              className="p-1 rounded hover:bg-stone-200 transition-colors"
                              title="청크 ID 복사"
                            >
                              {copiedId === result.chunk_id ? (
                                <Check className="w-3 h-3 text-green-500" />
                              ) : (
                                <Copy className="w-3 h-3 text-stone-400" />
                              )}
                            </button>
                            {sourceFile && orgName && boardName && dateFolder && (
                              <a
                                href={`/processing/extract?org=${encodeURIComponent(orgName)}&board=${encodeURIComponent(boardName)}&date=${encodeURIComponent(dateFolder)}&file=${encodeURIComponent(sourceFile)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded hover:bg-stone-200 transition-colors"
                                title="원본 문서 보기"
                              >
                                <ExternalLink className="w-3 h-3 text-stone-400" />
                              </a>
                            )}
                          </div>
                        </div>
                        
                        {/* 유사도 바 */}
                        <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden mb-3">
                          <div
                            className="h-full bg-gradient-to-r from-primary to-emerald-400 transition-all"
                            style={{ width: `${formatSimilarity(result.distance, result.similarity)}%` }}
                          />
                        </div>
                        
                        {/* 메타데이터 태그 */}
                        <div className="flex gap-2 mb-2 flex-wrap">
                          {!!result.metadata?.published_date && (
                            <span className="text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded">
                              📅 {String(result.metadata.published_date).substring(0, 10)}
                            </span>
                          )}
                          {orgName && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                              {orgName}
                            </span>
                          )}
                          {boardName && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                              {boardName}
                            </span>
                          )}
                          {!!result.metadata?.chunk_type && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                              {result.metadata.chunk_type as string}
                            </span>
                          )}
                          {result.metadata?.chunk_index !== undefined && (
                            <span className="text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded">
                              청크 #{Number(result.metadata.chunk_index)}
                            </span>
                          )}
                        </div>
                        
                        {/* 문서 내용 */}
                        {isTableChunk ? (
                          // 테이블 청크: 시각적 테이블로 렌더링 시도
                          (() => {
                            const parsedTable = parseTableChunk(result.document) || parseSemanticTableChunk(result.document);
                            if (parsedTable) {
                              return <TableRenderer data={parsedTable} />;
                            }
                            // 파싱 실패 시 원본 텍스트 표시
                            return (
                              <div className="mt-2 p-3 bg-white rounded-lg border border-amber-200">
                                <div className="flex items-center gap-2 mb-2">
                                  <Table className="w-4 h-4 text-amber-600" />
                                  <span className="text-xs font-medium text-amber-700">표 데이터</span>
                                </div>
                                <pre className="text-xs text-stone-700 whitespace-pre-wrap overflow-x-auto max-h-40 overflow-y-auto">
                                  {result.document}
                                </pre>
                              </div>
                            );
                          })()
                        ) : (
                          // 일반 텍스트 청크
                          <p className="text-sm text-stone-700 line-clamp-4">
                            {result.document}
                          </p>
                        )}

                        {/* 표 재조합 버튼 (table_id가 있는 경우) */}
                        {isTableChunk && tableId && (
                          <div className="mt-3 pt-3 border-t border-stone-200">
                            <button
                              onClick={() => toggleTableExpand(tableId)}
                              disabled={isReconstructingThis}
                              className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
                            >
                              {isReconstructingThis ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Table className="w-3 h-3" />
                              )}
                              {isExpanded ? "전체 표 숨기기" : "전체 표 보기 (모든 청크 병합)"}
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            
                            {isExpanded && hasReconstructed && (
                              <div className="mt-3 p-3 rounded-lg bg-white border border-stone-200">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-medium text-stone-700">
                                    {reconstructedTables.get(tableId)?.table_title || "표"}
                                  </span>
                                  <span className="text-xs text-stone-500">
                                    {reconstructedTables.get(tableId)?.total_chunks}개 청크 병합
                                  </span>
                                </div>
                                {(() => {
                                  const content = reconstructedTables.get(tableId)?.content || "";
                                  const parsedTable = parseTableChunk(content) || parseSemanticTableChunk(content);
                                  if (parsedTable) {
                                    return <TableRenderer data={parsedTable} />;
                                  }
                                  return (
                                    <pre className="text-xs text-stone-600 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto">
                                      {content}
                                    </pre>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : searching ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-stone-400">
                  <Search className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">검색어를 입력하고 검색하세요</p>
                  {!vectorDBStatus?.success && (
                    <p className="text-xs mt-2 text-red-400">벡터 DB 연결이 필요합니다</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 클릭 외부 영역으로 드롭다운 닫기 */}
      {showHistory && (
        <div 
          className="fixed inset-0 z-0" 
          onClick={() => setShowHistory(false)}
        />
      )}

      {/* API 키 입력 모달 */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <Key className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-stone-800">검색을 위한 API 키</h3>
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
                  className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <p className="mt-2 text-xs text-stone-500">
                  검색 쿼리를 임베딩하기 위해 API 키가 필요합니다
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowApiKeyModal(false)}
                  className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors font-medium"
                >
                  취소
                </button>
                <button
                  onClick={() => executeSearch()}
                  disabled={!apiKey.trim()}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-medium transition-colors",
                    apiKey.trim()
                      ? "bg-primary text-white hover:bg-primary/90"
                      : "bg-stone-200 text-stone-400 cursor-not-allowed"
                  )}
                >
                  검색
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-stone-800 mb-2">데이터 삭제 확인</h3>
            <p className="text-sm text-stone-600 mb-4">
              다음 기관의 모든 벡터를 삭제하시겠습니까?
              <br />
              <span className="font-medium text-red-600">
                {selectedOrgs.map(o => o.org_name).join(", ")}
              </span>
              <br />
              <span className="text-xs text-stone-500">이 작업은 되돌릴 수 없습니다.</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors font-medium"
              >
                취소
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex-1 py-2 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors font-medium flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 전체 초기화 확인 모달 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-stone-800 mb-2">컬렉션 초기화 확인</h3>
            <p className="text-sm text-stone-600 mb-4">
              컬렉션의 <span className="font-medium text-red-600">모든 벡터</span>를 삭제하시겠습니까?
              <br />
              <span className="text-xs text-stone-500">이 작업은 되돌릴 수 없습니다.</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors font-medium"
              >
                취소
              </button>
              <button
                onClick={handleClearCollection}
                disabled={clearing}
                className="flex-1 py-2 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors font-medium flex items-center justify-center gap-2"
              >
                {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                초기화
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
