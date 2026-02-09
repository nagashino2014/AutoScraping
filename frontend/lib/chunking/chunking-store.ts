import fs from "node:fs";
import path from "node:path";
import { storage, downloadJson } from "@/lib/storage";

// ============================================================================
// 타입 정의
// ============================================================================

export type ChunkingStrategy = "recursive" | "sentence" | "semantic" | "markdown";

export interface ChunkingSettings {
  strategy: ChunkingStrategy;
  chunkSize: number;          // 기본 500-1000 토큰
  chunkOverlap: number;       // 기본 100-200 토큰
  separators: string[];       // ["\n\n", "\n", ". ", " "]
  minChunkSize: number;       // 최소 청크 크기
  maxChunkSize: number;       // 최대 청크 크기
  tableChunking: {
    enabled: boolean;         // 표 데이터 자동 감지
    maxRowsPerChunk: number;  // 청크당 최대 행 수
  };
}

export type ChunkType = "text" | "table_full" | "table_segment";

export interface ChunkMetadata {
  chunk_type: ChunkType;
  chunk_index: number;
  total_chunks: number;
  // 표 관련 메타데이터
  table_id?: string;
  table_title?: string;
  total_rows?: number;
  total_cols?: number;
  headers?: string[];
  row_start?: number;
  row_end?: number;
  is_first_chunk?: boolean;
  is_last_chunk?: boolean;
  // Cross-page 표 병합 메타데이터
  is_merged_table?: boolean;           // 병합된 표 여부
  merge_source_pages?: number[];       // 원본 페이지 목록 (예: [1, 2, 3, 4, 5])
  merge_source_count?: number;         // 병합된 원본 표 개수
  merge_confidence?: number;           // 병합 신뢰도 (0.0~1.0)
  original_table_indices?: string;     // 원본 표 인덱스 (JSON 문자열)
  header_signature?: string;           // 헤더 시그니처 해시
  // 문서 메타데이터
  doc_id: string;
  org_id: string;
  org_name: string;
  board_id: string;
  board_name: string;
  date_folder: string;
  source_file: string;
  published_date?: string;
}

export interface Chunk {
  chunk_id: string;
  content: string;
  raw_content: string;
  token_count: number;
  metadata: ChunkMetadata;
  embedding?: number[];
  embedding_model?: string;
  created_at: string;
}

export type DocumentStatus = "pending" | "chunking" | "chunked" | "embedding" | "completed" | "failed";

export interface ChunkedDocument {
  doc_id: string;
  org_id: string;
  board_id: string;
  org_name: string;
  board_name: string;
  date_folder: string;
  source_file: string;
  file_path: string;
  chunk_file_path: string;  // 청크 파일 경로
  status: DocumentStatus;
  total_chunks: number;
  text_chunks: number;
  table_chunks: number;
  total_tokens: number;
  embedded_chunks: number;
  created_at: string;
  updated_at: string;
  error_message?: string;
}

// 문서 인덱스 (청크 데이터 없이 메타데이터만)
export interface ChunkingIndex {
  settings: ChunkingSettings;
  documents: ChunkedDocument[];
  lastUpdated: string;
}

// 폴더별 청크 파일 구조
export interface ChunkFile {
  org_name: string;
  board_name: string;
  date_folder: string;
  chunks: Chunk[];
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 기본값
// ============================================================================

const DEFAULT_SETTINGS: ChunkingSettings = {
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

const DEFAULT_INDEX: ChunkingIndex = {
  settings: DEFAULT_SETTINGS,
  documents: [],
  lastUpdated: new Date().toISOString(),
};

// ============================================================================
// 파일 경로 (로컬 전용 - 인덱스, 설정)
// ============================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const CHUNKING_INDEX_FILE = path.join(DATA_DIR, "chunking-index.json");
const CHUNK_DATA_PATH = path.join(process.cwd(), "chunk");
const SCRAPING_DATA_PATH = path.join(process.cwd(), "save", "ScrapingData");
const EXTRACTED_TEXT_PATH = path.join(process.cwd(), "save", "ExtractedData");

// ============================================================================
// 유틸리티 함수
// ============================================================================

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 청크 파일명 생성
 * {기관명}_{보드명}_{연도월}_chunks.json
 */
function getChunkFileName(orgName: string, boardName: string, dateFolder: string): string {
  // 파일명에 사용할 수 없는 문자 치환 (Windows 호환)
  const safeOrgName = orgName.replace(/[<>:"/\\|?*]/g, "_");
  const safeBoardName = boardName.replace(/[<>:"/\\|?*]/g, "_");
  const safeDateFolder = dateFolder.replace(/[<>:"/\\|?*]/g, "_");
  return `${safeOrgName}_${safeBoardName}_${safeDateFolder}_chunks.json`;
}

/**
 * 청크 폴더 경로 생성 (로컬 전용)
 * chunk/{기관명}/{보드명}/{연도월}
 */
function getChunkFolderPath(orgName: string, boardName: string, dateFolder: string): string {
  return path.join(CHUNK_DATA_PATH, orgName, boardName, dateFolder);
}

/**
 * 청크 파일의 스토리지 키 생성 (R2 / 로컬 공통)
 * chunk/{기관명}/{보드명}/{연도월}/{파일명}
 */
function getChunkStorageKey(orgName: string, boardName: string, dateFolder: string): string {
  return `chunk/${orgName}/${boardName}/${dateFolder}/${getChunkFileName(orgName, boardName, dateFolder)}`;
}

/**
 * 추출 데이터의 스토리지 키 prefix 생성
 * ExtractedData/{기관명}/{보드명}/{연도월}/
 */
function getExtractedDataPrefix(orgName?: string, boardName?: string, dateFolder?: string): string {
  let prefix = "ExtractedData/";
  if (orgName) prefix += `${orgName}/`;
  if (boardName) prefix += `${boardName}/`;
  if (dateFolder) prefix += `${dateFolder}/`;
  return prefix;
}

/**
 * 청크 파일 경로 생성 (로컬 파일 시스템)
 * chunk/{기관명}/{보드명}/{연도월}/{기관명}_{보드명}_{연도월}_chunks.json
 */
export function getChunkFilePath(orgName: string, boardName: string, dateFolder: string): string {
  return path.join(
    getChunkFolderPath(orgName, boardName, dateFolder),
    getChunkFileName(orgName, boardName, dateFolder)
  );
}

// ============================================================================
// 인덱스 로드/저장 (로컬 - Railway 볼륨)
// ============================================================================

export function loadChunkingIndex(): ChunkingIndex {
  ensureDir(DATA_DIR);
  
  if (!fs.existsSync(CHUNKING_INDEX_FILE)) {
    saveChunkingIndex(DEFAULT_INDEX);
    return DEFAULT_INDEX;
  }
  
  try {
    const content = fs.readFileSync(CHUNKING_INDEX_FILE, "utf-8");
    const data = JSON.parse(content) as ChunkingIndex;
    return {
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
      documents: data.documents || [],
      lastUpdated: data.lastUpdated || new Date().toISOString(),
    };
  } catch {
    return DEFAULT_INDEX;
  }
}

export function saveChunkingIndex(index: ChunkingIndex): void {
  ensureDir(DATA_DIR);
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CHUNKING_INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

// ============================================================================
// 청크 파일 로드/저장 (스토리지 추상화 - R2 또는 로컬)
// ============================================================================

export async function loadChunkFile(orgName: string, boardName: string, dateFolder: string): Promise<ChunkFile | null> {
  const key = getChunkStorageKey(orgName, boardName, dateFolder);
  
  try {
    const exists = await storage.exists(key);
    if (!exists) return null;
    
    const data = await downloadJson<ChunkFile>(key);
    return data;
  } catch {
    return null;
  }
}

export async function saveChunkFile(orgName: string, boardName: string, dateFolder: string, chunks: Chunk[]): Promise<void> {
  const key = getChunkStorageKey(orgName, boardName, dateFolder);
  
  const chunkFile: ChunkFile = {
    org_name: orgName,
    board_name: boardName,
    date_folder: dateFolder,
    chunks,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  await storage.upload(key, JSON.stringify(chunkFile, null, 2), "application/json");
}

export async function deleteChunkFile(orgName: string, boardName: string, dateFolder: string): Promise<void> {
  const key = getChunkStorageKey(orgName, boardName, dateFolder);
  
  try {
    await storage.delete(key);
  } catch {
    // 파일이 없어도 무시
  }
}

// ============================================================================
// 설정 관리 (동기 - 로컬)
// ============================================================================

export function getChunkingSettings(): ChunkingSettings {
  const index = loadChunkingIndex();
  return index.settings;
}

export function updateChunkingSettings(settings: Partial<ChunkingSettings>): ChunkingSettings {
  const index = loadChunkingIndex();
  index.settings = { ...index.settings, ...settings };
  saveChunkingIndex(index);
  return index.settings;
}

// ============================================================================
// 문서 관리 (동기 - 인덱스 조작만)
// ============================================================================

export function getChunkedDocuments(): ChunkedDocument[] {
  const index = loadChunkingIndex();
  return index.documents;
}

export function getDocumentById(docId: string): ChunkedDocument | undefined {
  const index = loadChunkingIndex();
  return index.documents.find(d => d.doc_id === docId);
}

export function addOrUpdateDocument(doc: ChunkedDocument): void {
  const index = loadChunkingIndex();
  const existingIndex = index.documents.findIndex(d => d.doc_id === doc.doc_id);
  
  if (existingIndex >= 0) {
    index.documents[existingIndex] = doc;
  } else {
    index.documents.push(doc);
  }
  
  saveChunkingIndex(index);
}

export async function deleteDocument(docId: string): Promise<void> {
  const index = loadChunkingIndex();
  const doc = index.documents.find(d => d.doc_id === docId);
  
  if (doc) {
    // 해당 문서의 청크도 삭제
    await deleteChunksForDocument(doc);
    index.documents = index.documents.filter(d => d.doc_id !== docId);
    saveChunkingIndex(index);
  }
}

async function deleteChunksForDocument(doc: ChunkedDocument): Promise<void> {
  const chunkFile = await loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
  if (chunkFile) {
    const remainingChunks = chunkFile.chunks.filter(c => c.metadata.doc_id !== doc.doc_id);
    if (remainingChunks.length > 0) {
      await saveChunkFile(doc.org_name, doc.board_name, doc.date_folder, remainingChunks);
    } else {
      await deleteChunkFile(doc.org_name, doc.board_name, doc.date_folder);
    }
  }
}

// ============================================================================
// 청크 관리 (비동기 - 스토리지 추상화)
// ============================================================================

/**
 * 특정 문서의 청크 조회
 */
export async function getChunksForDocument(docId: string): Promise<Chunk[]> {
  const doc = getDocumentById(docId);
  if (!doc) return [];
  
  const chunkFile = await loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
  if (!chunkFile) return [];
  
  return chunkFile.chunks.filter(c => c.metadata.doc_id === docId);
}

/**
 * 특정 폴더의 모든 청크 조회
 */
export async function getChunksForFolder(orgName: string, boardName: string, dateFolder: string): Promise<Chunk[]> {
  const chunkFile = await loadChunkFile(orgName, boardName, dateFolder);
  return chunkFile?.chunks || [];
}

/**
 * 전체 청크 조회 (모든 폴더 순회)
 */
export async function getChunks(docId?: string): Promise<Chunk[]> {
  if (docId) {
    return getChunksForDocument(docId);
  }
  
  const allChunks: Chunk[] = [];
  const index = loadChunkingIndex();
  
  // 문서별로 고유한 폴더 경로 수집
  const folderPaths = new Set<string>();
  for (const doc of index.documents) {
    folderPaths.add(`${doc.org_name}|${doc.board_name}|${doc.date_folder}`);
  }
  
  // 각 폴더의 청크 로드
  for (const folderKey of folderPaths) {
    const [orgName, boardName, dateFolder] = folderKey.split("|");
    const chunks = await getChunksForFolder(orgName, boardName, dateFolder);
    allChunks.push(...chunks);
  }
  
  return allChunks;
}

export async function getChunkById(chunkId: string): Promise<Chunk | undefined> {
  // chunk_id 형식: {org}_{board}_{date}_{docId}_{index}
  // 효율적인 검색을 위해 인덱스에서 문서를 먼저 찾음
  const index = loadChunkingIndex();
  
  for (const doc of index.documents) {
    const chunkFile = await loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
    if (chunkFile) {
      const chunk = chunkFile.chunks.find(c => c.chunk_id === chunkId);
      if (chunk) return chunk;
    }
  }
  
  return undefined;
}

/**
 * 문서에 청크 추가 (분리 저장)
 */
export async function addChunksForDocument(
  doc: ChunkedDocument,
  chunks: Chunk[]
): Promise<void> {
  // 기존 청크 파일 로드
  const existingChunkFile = await loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
  
  let allChunks: Chunk[];
  if (existingChunkFile) {
    // 해당 문서의 기존 청크 제거 후 새 청크 추가
    const otherChunks = existingChunkFile.chunks.filter(c => c.metadata.doc_id !== doc.doc_id);
    allChunks = [...otherChunks, ...chunks];
  } else {
    allChunks = chunks;
  }
  
  // 청크 파일 저장
  await saveChunkFile(doc.org_name, doc.board_name, doc.date_folder, allChunks);
  
  // 문서 정보 업데이트
  doc.chunk_file_path = getChunkFilePath(doc.org_name, doc.board_name, doc.date_folder);
  doc.total_chunks = chunks.length;
  doc.text_chunks = chunks.filter(c => c.metadata.chunk_type === "text").length;
  doc.table_chunks = chunks.filter(c => 
    c.metadata.chunk_type === "table_full" || c.metadata.chunk_type === "table_segment"
  ).length;
  doc.total_tokens = chunks.reduce((sum, c) => sum + (c.token_count || 0), 0);
  doc.updated_at = new Date().toISOString();
  
  addOrUpdateDocument(doc);
}

// Legacy compatibility
export async function addChunks(chunks: Chunk[]): Promise<void> {
  // 청크를 문서별로 그룹화
  const chunksByDoc = new Map<string, Chunk[]>();
  
  for (const chunk of chunks) {
    const key = chunk.metadata.doc_id;
    if (!chunksByDoc.has(key)) {
      chunksByDoc.set(key, []);
    }
    chunksByDoc.get(key)!.push(chunk);
  }
  
  // 각 문서별로 청크 저장
  for (const [docId, docChunks] of chunksByDoc) {
    const doc = getDocumentById(docId);
    if (doc) {
      await addChunksForDocument(doc, docChunks);
    }
  }
}

export async function updateChunk(chunkId: string, updates: Partial<Chunk>): Promise<void> {
  const chunk = await getChunkById(chunkId);
  if (!chunk) return;
  
  const { org_name, board_name, date_folder } = chunk.metadata;
  const chunkFile = await loadChunkFile(org_name, board_name, date_folder);
  
  if (chunkFile) {
    const index = chunkFile.chunks.findIndex(c => c.chunk_id === chunkId);
    if (index >= 0) {
      chunkFile.chunks[index] = { ...chunkFile.chunks[index], ...updates };
      await saveChunkFile(org_name, board_name, date_folder, chunkFile.chunks);
    }
  }
}

export async function deleteChunksByDocId(docId: string): Promise<void> {
  const doc = getDocumentById(docId);
  if (doc) {
    await deleteChunksForDocument(doc);
  }
}

// ============================================================================
// 통계 (동기 - 인덱스 기반)
// ============================================================================

export interface ChunkingStats {
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
  // 성공률 (이전 작업 기록 기반)
  chunkingSuccessRate: number;
  embeddingSuccessRate: number;
  // 추가 통계
  currentEmbeddingBatch: number;
  totalEmbeddedTokens: number;
  embeddingFailedChunks: number;
  estimatedCost: number;
}

export function getChunkingStats(): ChunkingStats {
  const index = loadChunkingIndex();
  
  const chunkedDocs = index.documents.filter(d => 
    d.status === "chunked" || d.status === "embedding" || d.status === "completed"
  );
  const pendingDocs = index.documents.filter(d => d.status === "pending");
  const failedDocs = index.documents.filter(d => d.status === "failed");
  
  // 청킹 시도된 문서 (성공 + 실패)
  const attemptedChunkingDocs = index.documents.filter(d => 
    d.status !== "pending" && d.status !== "chunking"
  );
  
  // 문서 인덱스에서 통계 집계 (전체 청크 로드 없이)
  let totalChunks = 0;
  let textChunks = 0;
  let tableChunks = 0;
  let totalTokens = 0;
  let embeddedChunks = 0;
  
  for (const doc of index.documents) {
    totalChunks += doc.total_chunks;
    textChunks += doc.text_chunks;
    tableChunks += doc.table_chunks;
    totalTokens += doc.total_tokens;
    embeddedChunks += doc.embedded_chunks;
  }
  
  // 청킹 성공률: 이전 청킹 시도가 있을 때만 계산, 없으면 0%
  // (성공한 문서 / 시도한 문서) * 100
  const chunkingSuccessRate = attemptedChunkingDocs.length > 0
    ? Math.round((chunkedDocs.length / attemptedChunkingDocs.length) * 100)
    : 0;
  
  // 임베딩 성공률: 임베딩된 청크가 있을 때만 계산, 없으면 0%
  let embeddingSuccessRate = 0;
  let embeddingFailedChunks = 0;
  
  // 임베딩 통계 파일 읽기 시도
  try {
    const statsFilePath = path.join(DATA_DIR, "embedding-stats.json");
    if (fs.existsSync(statsFilePath)) {
      const statsContent = fs.readFileSync(statsFilePath, "utf-8");
      const embeddingStatsData = JSON.parse(statsContent);
      
      const totalEmbeddingAttempts = (embeddingStatsData.total_embeddings || 0) + (embeddingStatsData.total_failed || 0);
      if (totalEmbeddingAttempts > 0) {
        embeddingSuccessRate = Math.round(
          ((embeddingStatsData.total_embeddings || 0) / totalEmbeddingAttempts) * 100
        );
        embeddingFailedChunks = embeddingStatsData.total_failed || 0;
      }
    }
  } catch {
    // 파일이 없거나 읽기 실패 시 0% 유지
  }
  
  return {
    totalDocuments: index.documents.length,
    chunkedDocuments: chunkedDocs.length,
    pendingDocuments: pendingDocs.length,
    failedDocuments: failedDocs.length,
    totalChunks,
    textChunks,
    tableChunks,
    totalTokens,
    embeddedChunks,
    chunkingRate: index.documents.length > 0 
      ? Math.round((chunkedDocs.length / index.documents.length) * 100) 
      : 0,
    embeddingRate: totalChunks > 0 
      ? Math.round((embeddedChunks / totalChunks) * 100) 
      : 0,
    // 성공률 (이전 작업 기록 기반, 기록 없으면 0%)
    chunkingSuccessRate,
    embeddingSuccessRate,
    // 추가 통계
    currentEmbeddingBatch: 0,  // 현재 세션에서 업데이트됨
    totalEmbeddedTokens: 0,     // 현재 세션에서 업데이트됨
    embeddingFailedChunks,
    estimatedCost: 0,           // 현재 세션에서 업데이트됨
  };
}

// ============================================================================
// 추출된 문서 스캔 (ExtractedData - 스토리지 추상화)
// ============================================================================

export interface ExtractedDocument {
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

export interface DateFolderInfo {
  folder_name: string;
  folder_path: string;
  total_files: number;
  total_size: number;
}

export interface BoardFolderInfo {
  board_id: string;
  board_name: string;
  total_files: number;
  total_size: number;
  date_folders: DateFolderInfo[];
}

export interface OrgFolderInfo {
  org_id: string;
  org_name: string;
  total_files: number;
  total_size: number;
  boards: BoardFolderInfo[];
}

/**
 * ExtractedData 폴더 구조 스캔
 * R2 모드: storage.list("ExtractedData/") 로 키를 조회하여 구조 재구성
 * 로컬 모드: 기존 디렉토리 워킹
 */
export async function scanExtractedDataFolder(): Promise<OrgFolderInfo[]> {
  const result: OrgFolderInfo[] = [];

  try {
    const objects = await storage.list("ExtractedData/");

    // 오브젝트 키에서 폴더 구조 재구성
    // 키 형식: ExtractedData/{기관}/{보드}/{연도-월}/{파일}.json
    const orgMap = new Map<string, Map<string, Map<string, { files: string[]; totalSize: number }>>>();

    for (const obj of objects) {
      if (!obj.Key || !obj.Key.endsWith(".json")) continue;
      const parts = obj.Key.split("/");
      // parts: ["ExtractedData", orgName, boardName, dateFolder, "file.json"]
      if (parts.length < 5) continue;

      const orgName = parts[1];
      const boardName = parts[2];
      const dateFolder = parts[3];
      const fileName = parts[4];

      if (!orgMap.has(orgName)) orgMap.set(orgName, new Map());
      const boardMap = orgMap.get(orgName)!;
      if (!boardMap.has(boardName)) boardMap.set(boardName, new Map());
      const dateMap = boardMap.get(boardName)!;
      if (!dateMap.has(dateFolder)) dateMap.set(dateFolder, { files: [], totalSize: 0 });
      const entry = dateMap.get(dateFolder)!;
      entry.files.push(fileName);
      entry.totalSize += obj.Size || 0;
    }

    // Map → OrgFolderInfo 변환
    for (const [orgName, boardMap] of orgMap) {
      const orgInfo: OrgFolderInfo = {
        org_id: orgName,
        org_name: orgName,
        total_files: 0,
        total_size: 0,
        boards: [],
      };

      for (const [boardName, dateMap] of boardMap) {
        const boardInfo: BoardFolderInfo = {
          board_id: boardName,
          board_name: boardName,
          total_files: 0,
          total_size: 0,
          date_folders: [],
        };

        for (const [dateFolder, entry] of dateMap) {
          const dateInfo: DateFolderInfo = {
            folder_name: dateFolder,
            // R2 모드: prefix 키, 로컬 모드: 절대 경로
            folder_path: storage.backend === "r2"
              ? `ExtractedData/${orgName}/${boardName}/${dateFolder}`
              : path.join(EXTRACTED_TEXT_PATH, orgName, boardName, dateFolder),
            total_files: entry.files.length,
            total_size: entry.totalSize,
          };

          boardInfo.date_folders.push(dateInfo);
          boardInfo.total_files += entry.files.length;
          boardInfo.total_size += entry.totalSize;
        }

        if (boardInfo.total_files > 0) {
          orgInfo.boards.push(boardInfo);
          orgInfo.total_files += boardInfo.total_files;
          orgInfo.total_size += boardInfo.total_size;
        }
      }

      if (orgInfo.total_files > 0) {
        result.push(orgInfo);
      }
    }
  } catch (error) {
    console.error("Error scanning ExtractedData folder:", error);
  }

  return result;
}

/**
 * 특정 경로(또는 prefix)의 추출된 문서 목록 반환
 *
 * R2 모드: folderPath를 prefix로 사용하여 오브젝트 목록 조회
 * 로컬 모드: folderPath 디렉토리의 JSON 파일 목록 조회
 */
export async function getExtractedDocumentsFromPath(folderPath: string): Promise<ExtractedDocument[]> {
  const documents: ExtractedDocument[] = [];

  try {
    // folderPath에서 기관/보드/날짜 정보 추출
    let orgName = "";
    let boardName = "";
    let dateFolder = "";

    if (storage.backend === "r2") {
      // R2: prefix 형식 "ExtractedData/org/board/date"
      const parts = folderPath.replace(/\/$/, "").split("/");
      const idx = parts.indexOf("ExtractedData");
      if (idx >= 0) {
        orgName = parts[idx + 1] || "";
        boardName = parts[idx + 2] || "";
        dateFolder = parts[idx + 3] || "";
      }
    } else {
      // 로컬: 절대 경로
      const pathParts = folderPath.split(path.sep);
      const idx = pathParts.findIndex(p => p === "ExtractedData" || p === "ExtractedText");
      orgName = pathParts[idx + 1] || "";
      boardName = pathParts[idx + 2] || "";
      dateFolder = pathParts[idx + 3] || "";
    }

    // prefix 보정 (끝에 / 붙이기)
    const prefix = storage.backend === "r2"
      ? (folderPath.endsWith("/") ? folderPath : folderPath + "/")
      : `ExtractedData/${orgName}/${boardName}/${dateFolder}/`;

    const objects = await storage.list(prefix);

    for (const obj of objects) {
      if (!obj.Key || !obj.Key.endsWith(".json")) continue;

      const fileName = obj.Key.split("/").pop() || "";
      const fileBaseName = fileName.replace(".json", "");

      documents.push({
        doc_id: `${orgName}_${boardName}_${dateFolder}_${fileBaseName}`,
        org_id: orgName,
        board_id: boardName,
        org_name: orgName,
        board_name: boardName,
        source_file: fileName,
        file_path: storage.backend === "r2" ? obj.Key : path.join(folderPath, fileName),
        file_size: obj.Size || 0,
        date_folder: dateFolder,
        extracted_at: obj.LastModified?.toISOString(),
        token_count: 0,
      });
    }
  } catch (error) {
    console.error("Error getting documents from path:", error);
  }

  return documents;
}

/**
 * 여러 경로의 추출된 문서 목록 반환
 */
export async function getExtractedDocumentsFromPaths(folderPaths: string[]): Promise<ExtractedDocument[]> {
  const documents: ExtractedDocument[] = [];
  
  for (const folderPath of folderPaths) {
    documents.push(...(await getExtractedDocumentsFromPath(folderPath)));
  }
  
  return documents;
}

// Legacy function for backward compatibility
export async function scanExtractedDocuments(): Promise<ExtractedDocument[]> {
  const documents: ExtractedDocument[] = [];
  const orgInfos = await scanExtractedDataFolder();
  
  for (const org of orgInfos) {
    for (const board of org.boards) {
      for (const dateFolder of board.date_folders) {
        documents.push(...(await getExtractedDocumentsFromPath(dateFolder.folder_path)));
      }
    }
  }
  
  return documents;
}

// ============================================================================
// 청크 폴더 스캔 (스토리지 추상화)
// ============================================================================

export interface ChunkFolderInfo {
  org_name: string;
  board_name: string;
  date_folder: string;
  folder_path: string;
  chunk_count: number;
  file_size: number;
}

/**
 * chunk 폴더 구조 스캔
 */
export async function scanChunkDataFolder(): Promise<ChunkFolderInfo[]> {
  const result: ChunkFolderInfo[] = [];

  try {
    const objects = await storage.list("chunk/");

    for (const obj of objects) {
      if (!obj.Key || !obj.Key.endsWith("_chunks.json")) continue;
      const parts = obj.Key.split("/");
      // parts: ["chunk", orgName, boardName, dateFolder, "file_chunks.json"]
      if (parts.length < 5) continue;

      const orgName = parts[1];
      const boardName = parts[2];
      const dateFolder = parts[3];

      // 청크 수를 확인하기 위해 파일 다운로드
      let chunkCount = 0;
      try {
        const data = await downloadJson<ChunkFile>(obj.Key);
        chunkCount = data.chunks?.length || 0;
      } catch {
        // 다운로드 실패 시 0으로 유지
      }

      result.push({
        org_name: orgName,
        board_name: boardName,
        date_folder: dateFolder,
        folder_path: storage.backend === "r2"
          ? `chunk/${orgName}/${boardName}/${dateFolder}`
          : path.join(CHUNK_DATA_PATH, orgName, boardName, dateFolder),
        chunk_count: chunkCount,
        file_size: obj.Size || 0,
      });
    }
  } catch (error) {
    console.error("Error scanning chunk folder:", error);
  }

  return result;
}

/**
 * 추출된 문서의 텍스트 내용 읽기 (스토리지 추상화)
 *
 * R2 모드: storage.download(key) 로 파일 다운로드
 * 로컬 모드: fs.readFileSync(path) 와 동일
 */
export async function readExtractedDocumentContent(filePath: string): Promise<string> {
  if (storage.backend === "r2") {
    // R2: filePath가 R2 key (예: "ExtractedData/org/board/date/file.json")
    const buf = await storage.download(filePath);
    return buf.toString("utf-8");
  } else {
    // 로컬: 절대 경로에서 직접 읽기
    if (!fs.existsSync(filePath)) {
      throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf-8");
  }
}

// ============================================================================
// Export paths
// ============================================================================

export { SCRAPING_DATA_PATH, EXTRACTED_TEXT_PATH, CHUNK_DATA_PATH };
