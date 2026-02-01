/**
 * RAG 분석용 벡터 DB 클라이언트
 * 
 * 백엔드 ChromaDB와 통신하여 필터링, 검색, 통계를 수행
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// ============================================================
// 타입 정의
// ============================================================

export interface VectorDBStatus {
  success: boolean;
  total_embeddings: number;
  collection_name: string;
  storage_path: string;
  org_distribution: Record<string, number>;
  model_distribution: Record<string, number>;
  chromadb_available: boolean;
  error?: string;
}

export interface FilterOptions {
  dateRange?: {
    start: string;  // YYYY-MM-DD
    end: string;    // YYYY-MM-DD
  };
  orgs?: string[];
  boards?: string[];
  chunkTypes?: string[];
}

export interface MetadataStats {
  success: boolean;
  totalChunks: number;
  organizations: {
    id: string;
    name: string;
    count: number;
  }[];
  boards: {
    id: string;
    name: string;
    orgName: string;
    count: number;
  }[];
  dateRange: {
    earliest: string;
    latest: string;
  };
  chunkTypes: {
    type: string;
    count: number;
  }[];
  error?: string;
}

export interface SearchResult {
  chunk_id: string;
  document: string;
  metadata: Record<string, any>;
  distance: number;
  similarity: number;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  count: number;
  error?: string;
}

// ============================================================
// 벡터 DB 상태 조회
// ============================================================

export async function getVectorDBStatus(): Promise<VectorDBStatus> {
  try {
    const res = await fetch(`${BACKEND_URL}/vectordb/status`);
    
    if (!res.ok) {
      return {
        success: false,
        total_embeddings: 0,
        collection_name: "",
        storage_path: "",
        org_distribution: {},
        model_distribution: {},
        chromadb_available: false,
        error: `Backend error: ${res.status}`,
      };
    }
    
    return await res.json();
  } catch (error: any) {
    return {
      success: false,
      total_embeddings: 0,
      collection_name: "",
      storage_path: "",
      org_distribution: {},
      model_distribution: {},
      chromadb_available: false,
      error: error.message || "백엔드 서버에 연결할 수 없습니다.",
    };
  }
}

// ============================================================
// 메타데이터 통계 조회 (기관, 보드, 날짜 범위)
// ============================================================

export async function getMetadataStats(): Promise<MetadataStats> {
  try {
    const res = await fetch(`${BACKEND_URL}/vectordb/metadata-stats`);
    
    if (!res.ok) {
      // 백엔드에 엔드포인트가 없으면 대체 로직 사용
      const statusRes = await fetch(`${BACKEND_URL}/vectordb/status`);
      if (!statusRes.ok) {
        throw new Error(`Backend error: ${statusRes.status}`);
      }
      
      const status = await statusRes.json();
      
      // 기본 통계 생성
      return {
        success: true,
        totalChunks: status.total_embeddings || 0,
        organizations: Object.entries(status.org_distribution || {}).map(([name, count]) => ({
          id: name.toLowerCase().replace(/\s+/g, "_"),
          name,
          count: count as number,
        })),
        boards: [],
        dateRange: {
          earliest: "",
          latest: "",
        },
        chunkTypes: [],
      };
    }
    
    return await res.json();
  } catch (error: any) {
    return {
      success: false,
      totalChunks: 0,
      organizations: [],
      boards: [],
      dateRange: { earliest: "", latest: "" },
      chunkTypes: [],
      error: error.message || "메타데이터 통계 조회 실패",
    };
  }
}

// ============================================================
// 필터 조건으로 ChromaDB where 절 생성
// ============================================================

export function buildWhereClause(filter: FilterOptions): Record<string, any> | undefined {
  const conditions: Record<string, any>[] = [];
  
  // 기관 필터
  if (filter.orgs && filter.orgs.length > 0) {
    if (filter.orgs.length === 1) {
      conditions.push({ org_name: filter.orgs[0] });
    } else {
      conditions.push({ org_name: { "$in": filter.orgs } });
    }
  }
  
  // 보드 필터
  if (filter.boards && filter.boards.length > 0) {
    if (filter.boards.length === 1) {
      conditions.push({ board_name: filter.boards[0] });
    } else {
      conditions.push({ board_name: { "$in": filter.boards } });
    }
  }
  
  // 청크 유형 필터
  if (filter.chunkTypes && filter.chunkTypes.length > 0) {
    if (filter.chunkTypes.length === 1) {
      conditions.push({ chunk_type: filter.chunkTypes[0] });
    } else {
      conditions.push({ chunk_type: { "$in": filter.chunkTypes } });
    }
  }
  
  // 날짜 필터 (date_folder 메타데이터 사용)
  if (filter.dateRange) {
    // date_folder는 "YYYY-MM" 형식이므로 범위 비교
    if (filter.dateRange.start) {
      const startMonth = filter.dateRange.start.slice(0, 7);
      conditions.push({ date_folder: { "$gte": startMonth } });
    }
    if (filter.dateRange.end) {
      const endMonth = filter.dateRange.end.slice(0, 7);
      conditions.push({ date_folder: { "$lte": endMonth } });
    }
  }
  
  // 조건이 없으면 undefined 반환
  if (conditions.length === 0) {
    return undefined;
  }
  
  // 단일 조건이면 그대로, 여러 조건이면 $and로 결합
  if (conditions.length === 1) {
    return conditions[0];
  }
  
  return { "$and": conditions };
}

// ============================================================
// 필터링된 청크 개수 조회
// ============================================================

export async function getFilteredCount(filter: FilterOptions): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const whereClause = buildWhereClause(filter);
    
    const res = await fetch(`${BACKEND_URL}/vectordb/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where: whereClause }),
    });
    
    if (!res.ok) {
      // 백엔드에 count 엔드포인트가 없으면 전체 개수 반환
      const status = await getVectorDBStatus();
      return {
        success: true,
        count: status.total_embeddings,
      };
    }
    
    const data = await res.json();
    return {
      success: true,
      count: data.count || 0,
    };
  } catch (error: any) {
    return {
      success: false,
      count: 0,
      error: error.message,
    };
  }
}

// ============================================================
// 필터링된 청크 샘플 조회
// ============================================================

export async function getFilteredSample(
  filter: FilterOptions,
  limit: number = 100
): Promise<{ success: boolean; chunks: any[]; error?: string }> {
  try {
    const whereClause = buildWhereClause(filter);
    
    const res = await fetch(`${BACKEND_URL}/vectordb/sample`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where: whereClause, limit }),
    });
    
    if (!res.ok) {
      throw new Error(`Backend error: ${res.status}`);
    }
    
    const data = await res.json();
    return {
      success: true,
      chunks: data.chunks || [],
    };
  } catch (error: any) {
    return {
      success: false,
      chunks: [],
      error: error.message,
    };
  }
}

// ============================================================
// 유사도 검색 (RAG 쿼리용)
// ============================================================

export async function searchSimilar(
  queryEmbedding: number[],
  filter?: FilterOptions,
  nResults: number = 10
): Promise<SearchResponse> {
  try {
    const whereClause = filter ? buildWhereClause(filter) : undefined;
    
    const res = await fetch(`${BACKEND_URL}/vectordb/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        n_results: nResults,
        where: whereClause,
      }),
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Search error: ${res.status}`);
    }
    
    return await res.json();
  } catch (error: any) {
    return {
      success: false,
      results: [],
      count: 0,
      error: error.message,
    };
  }
}

// ============================================================
// 쿼리 임베딩 생성
// ============================================================

export async function generateQueryEmbedding(
  query: string,
  model: string,
  apiKey?: string
): Promise<{ success: boolean; embedding?: number[]; error?: string }> {
  try {
    const isOpenAI = model.startsWith("openai");
    
    if (isOpenAI) {
      if (!apiKey) {
        return { success: false, error: "OpenAI API 키가 필요합니다." };
      }
      
      const modelName = model === "openai-large"
        ? "text-embedding-3-large"
        : "text-embedding-3-small";
      
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: query,
          model: modelName,
        }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        return { success: false, error: errorData.error?.message || `OpenAI error: ${res.status}` };
      }
      
      const data = await res.json();
      return { success: true, embedding: data.data[0].embedding };
    } else {
      // HuggingFace 모델 - 백엔드 사용
      const res = await fetch(`${BACKEND_URL}/embedding/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [query], model }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        return { success: false, error: errorData.detail || `Backend error: ${res.status}` };
      }
      
      const data = await res.json();
      return { success: true, embedding: data.embeddings[0] };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
