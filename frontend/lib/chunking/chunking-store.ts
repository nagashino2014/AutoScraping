import fs from "node:fs";
import path from "node:path";

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
// 파일 경로
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
 * 청크 폴더 경로 생성
 * chunk/{기관명}/{보드명}/{연도월}
 */
function getChunkFolderPath(orgName: string, boardName: string, dateFolder: string): string {
  return path.join(CHUNK_DATA_PATH, orgName, boardName, dateFolder);
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
 * 청크 파일 경로 생성
 * chunk/{기관명}/{보드명}/{연도월}/{기관명}_{보드명}_{연도월}_chunks.json
 */
export function getChunkFilePath(orgName: string, boardName: string, dateFolder: string): string {
  return path.join(
    getChunkFolderPath(orgName, boardName, dateFolder),
    getChunkFileName(orgName, boardName, dateFolder)
  );
}

// ============================================================================
// 인덱스 로드/저장
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
// 청크 파일 로드/저장
// ============================================================================

export function loadChunkFile(orgName: string, boardName: string, dateFolder: string): ChunkFile | null {
  const filePath = getChunkFilePath(orgName, boardName, dateFolder);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as ChunkFile;
  } catch {
    return null;
  }
}

export function saveChunkFile(orgName: string, boardName: string, dateFolder: string, chunks: Chunk[]): void {
  const folderPath = getChunkFolderPath(orgName, boardName, dateFolder);
  ensureDir(folderPath);
  
  const chunkFile: ChunkFile = {
    org_name: orgName,
    board_name: boardName,
    date_folder: dateFolder,
    chunks,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  const filePath = getChunkFilePath(orgName, boardName, dateFolder);
  fs.writeFileSync(filePath, JSON.stringify(chunkFile, null, 2), "utf-8");
}

export function deleteChunkFile(orgName: string, boardName: string, dateFolder: string): void {
  const filePath = getChunkFilePath(orgName, boardName, dateFolder);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// ============================================================================
// 설정 관리
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
// 문서 관리
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

export function deleteDocument(docId: string): void {
  const index = loadChunkingIndex();
  const doc = index.documents.find(d => d.doc_id === docId);
  
  if (doc) {
    // 해당 문서의 청크도 삭제
    deleteChunksForDocument(doc);
    index.documents = index.documents.filter(d => d.doc_id !== docId);
    saveChunkingIndex(index);
  }
}

function deleteChunksForDocument(doc: ChunkedDocument): void {
  const chunkFile = loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
  if (chunkFile) {
    const remainingChunks = chunkFile.chunks.filter(c => c.metadata.doc_id !== doc.doc_id);
    if (remainingChunks.length > 0) {
      saveChunkFile(doc.org_name, doc.board_name, doc.date_folder, remainingChunks);
    } else {
      deleteChunkFile(doc.org_name, doc.board_name, doc.date_folder);
    }
  }
}

// ============================================================================
// 청크 관리
// ============================================================================

/**
 * 특정 문서의 청크 조회
 */
export function getChunksForDocument(docId: string): Chunk[] {
  const doc = getDocumentById(docId);
  if (!doc) return [];
  
  const chunkFile = loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
  if (!chunkFile) return [];
  
  return chunkFile.chunks.filter(c => c.metadata.doc_id === docId);
}

/**
 * 특정 폴더의 모든 청크 조회
 */
export function getChunksForFolder(orgName: string, boardName: string, dateFolder: string): Chunk[] {
  const chunkFile = loadChunkFile(orgName, boardName, dateFolder);
  return chunkFile?.chunks || [];
}

/**
 * 전체 청크 조회 (모든 폴더 순회)
 */
export function getChunks(docId?: string): Chunk[] {
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
    const chunks = getChunksForFolder(orgName, boardName, dateFolder);
    allChunks.push(...chunks);
  }
  
  return allChunks;
}

export function getChunkById(chunkId: string): Chunk | undefined {
  // chunk_id 형식: {org}_{board}_{date}_{docId}_{index}
  // 효율적인 검색을 위해 인덱스에서 문서를 먼저 찾음
  const index = loadChunkingIndex();
  
  for (const doc of index.documents) {
    const chunkFile = loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
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
export function addChunksForDocument(
  doc: ChunkedDocument,
  chunks: Chunk[]
): void {
  // 기존 청크 파일 로드
  const existingChunkFile = loadChunkFile(doc.org_name, doc.board_name, doc.date_folder);
  
  let allChunks: Chunk[];
  if (existingChunkFile) {
    // 해당 문서의 기존 청크 제거 후 새 청크 추가
    const otherChunks = existingChunkFile.chunks.filter(c => c.metadata.doc_id !== doc.doc_id);
    allChunks = [...otherChunks, ...chunks];
  } else {
    allChunks = chunks;
  }
  
  // 청크 파일 저장
  saveChunkFile(doc.org_name, doc.board_name, doc.date_folder, allChunks);
  
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
export function addChunks(chunks: Chunk[]): void {
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
      addChunksForDocument(doc, docChunks);
    }
  }
}

export function updateChunk(chunkId: string, updates: Partial<Chunk>): void {
  const chunk = getChunkById(chunkId);
  if (!chunk) return;
  
  const { org_name, board_name, date_folder } = chunk.metadata;
  const chunkFile = loadChunkFile(org_name, board_name, date_folder);
  
  if (chunkFile) {
    const index = chunkFile.chunks.findIndex(c => c.chunk_id === chunkId);
    if (index >= 0) {
      chunkFile.chunks[index] = { ...chunkFile.chunks[index], ...updates };
      saveChunkFile(org_name, board_name, date_folder, chunkFile.chunks);
    }
  }
}

export function deleteChunksByDocId(docId: string): void {
  const doc = getDocumentById(docId);
  if (doc) {
    deleteChunksForDocument(doc);
  }
}

// ============================================================================
// 통계
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
  // 임베딩 통계 파일에서 실패 정보를 가져와야 하지만, 여기서는 간단히 계산
  // embedded_chunks가 0이면 아직 시도하지 않은 것으로 0% 표시
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
// 추출된 문서 스캔 (ExtractedData 폴더)
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
 * 경로: save/ExtractedData/{기관}/{보드}/{연도-월}/*.json
 */
export function scanExtractedDataFolder(): OrgFolderInfo[] {
  const result: OrgFolderInfo[] = [];
  
  if (!fs.existsSync(EXTRACTED_TEXT_PATH)) {
    fs.mkdirSync(EXTRACTED_TEXT_PATH, { recursive: true });
    return result;
  }
  
  try {
    const orgFolders = fs.readdirSync(EXTRACTED_TEXT_PATH);
    
    for (const orgFolder of orgFolders) {
      const orgPath = path.join(EXTRACTED_TEXT_PATH, orgFolder);
      if (!fs.statSync(orgPath).isDirectory()) continue;
      
      const orgInfo: OrgFolderInfo = {
        org_id: orgFolder,
        org_name: orgFolder,
        total_files: 0,
        total_size: 0,
        boards: [],
      };
      
      const boardFolders = fs.readdirSync(orgPath);
      
      for (const boardFolder of boardFolders) {
        const boardPath = path.join(orgPath, boardFolder);
        if (!fs.statSync(boardPath).isDirectory()) continue;
        
        const boardInfo: BoardFolderInfo = {
          board_id: boardFolder,
          board_name: boardFolder,
          total_files: 0,
          total_size: 0,
          date_folders: [],
        };
        
        const dateFolders = fs.readdirSync(boardPath);
        
        for (const dateFolder of dateFolders) {
          const datePath = path.join(boardPath, dateFolder);
          if (!fs.statSync(datePath).isDirectory()) continue;
          
          const files = fs.readdirSync(datePath);
          const jsonFiles = files.filter(f => f.endsWith(".json"));
          
          let folderSize = 0;
          for (const file of jsonFiles) {
            const filePath = path.join(datePath, file);
            try {
              const stats = fs.statSync(filePath);
              folderSize += stats.size;
            } catch {
              // 무시
            }
          }
          
          const dateInfo: DateFolderInfo = {
            folder_name: dateFolder,
            folder_path: datePath,
            total_files: jsonFiles.length,
            total_size: folderSize,
          };
          
          boardInfo.date_folders.push(dateInfo);
          boardInfo.total_files += jsonFiles.length;
          boardInfo.total_size += folderSize;
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
 * 특정 경로의 추출된 문서 목록 반환
 */
export function getExtractedDocumentsFromPath(folderPath: string): ExtractedDocument[] {
  const documents: ExtractedDocument[] = [];
  
  if (!fs.existsSync(folderPath)) {
    return documents;
  }
  
  try {
    const files = fs.readdirSync(folderPath);
    
    // 경로에서 기관/보드/날짜 정보 추출
    const pathParts = folderPath.split(path.sep);
    const extractedDataIdx = pathParts.findIndex(p => p === "ExtractedData" || p === "ExtractedText");
    const orgName = pathParts[extractedDataIdx + 1] || "";
    const boardName = pathParts[extractedDataIdx + 2] || "";
    const dateFolder = pathParts[extractedDataIdx + 3] || "";
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      
      // JSON 파일 내용에서 메타데이터 읽기
      let metadata: Record<string, unknown> = {};
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        metadata = JSON.parse(content);
      } catch {
        // 무시
      }
      
      const fileBaseName = file.replace(".json", "");
      
      documents.push({
        doc_id: `${orgName}_${boardName}_${dateFolder}_${fileBaseName}`,
        org_id: orgName,
        board_id: boardName,
        org_name: (metadata.org_name as string) || orgName,
        board_name: (metadata.board_name as string) || boardName,
        source_file: file,
        file_path: filePath,
        file_size: stats.size,
        date_folder: dateFolder,
        extracted_at: (metadata.extracted_at as string) || stats.mtime.toISOString(),
        token_count: (metadata.token_count as number) || 0,
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
export function getExtractedDocumentsFromPaths(folderPaths: string[]): ExtractedDocument[] {
  const documents: ExtractedDocument[] = [];
  
  for (const folderPath of folderPaths) {
    documents.push(...getExtractedDocumentsFromPath(folderPath));
  }
  
  return documents;
}

// Legacy function for backward compatibility
export function scanExtractedDocuments(): ExtractedDocument[] {
  const documents: ExtractedDocument[] = [];
  const orgInfos = scanExtractedDataFolder();
  
  for (const org of orgInfos) {
    for (const board of org.boards) {
      for (const dateFolder of board.date_folders) {
        documents.push(...getExtractedDocumentsFromPath(dateFolder.folder_path));
      }
    }
  }
  
  return documents;
}

// ============================================================================
// 청크 폴더 스캔
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
export function scanChunkDataFolder(): ChunkFolderInfo[] {
  const result: ChunkFolderInfo[] = [];
  
  if (!fs.existsSync(CHUNK_DATA_PATH)) {
    fs.mkdirSync(CHUNK_DATA_PATH, { recursive: true });
    return result;
  }
  
  try {
    const orgFolders = fs.readdirSync(CHUNK_DATA_PATH);
    
    for (const orgFolder of orgFolders) {
      const orgPath = path.join(CHUNK_DATA_PATH, orgFolder);
      if (!fs.statSync(orgPath).isDirectory()) continue;
      
      const boardFolders = fs.readdirSync(orgPath);
      
      for (const boardFolder of boardFolders) {
        const boardPath = path.join(orgPath, boardFolder);
        if (!fs.statSync(boardPath).isDirectory()) continue;
        
        const dateFolders = fs.readdirSync(boardPath);
        
        for (const dateFolder of dateFolders) {
          const datePath = path.join(boardPath, dateFolder);
          if (!fs.statSync(datePath).isDirectory()) continue;
          
          // *_chunks.json 패턴 파일 찾기
          const files = fs.readdirSync(datePath);
          const chunkFile = files.find(f => f.endsWith("_chunks.json"));
          
          if (chunkFile) {
            const chunkFilePath = path.join(datePath, chunkFile);
            try {
              const stats = fs.statSync(chunkFilePath);
              const content = fs.readFileSync(chunkFilePath, "utf-8");
              const chunkData = JSON.parse(content) as ChunkFile;
              
              result.push({
                org_name: orgFolder,
                board_name: boardFolder,
                date_folder: dateFolder,
                folder_path: datePath,
                chunk_count: chunkData.chunks.length,
                file_size: stats.size,
              });
            } catch {
              // 무시
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Error scanning chunk folder:", error);
  }
  
  return result;
}

// ============================================================================
// Export paths
// ============================================================================

export { SCRAPING_DATA_PATH, EXTRACTED_TEXT_PATH, CHUNK_DATA_PATH };
