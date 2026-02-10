/**
 * 범용 스크래퍼 데이터 저장소 (SQLite via sql.js)
 * 
 * 역할:
 * - 스크래핑된 문서 저장/조회
 * - 첨부파일 메타데이터 관리
 * - 수집 이력 로깅
 * - 중복 제거 (dedup)
 */

import initSqlJs, { Database } from "sql.js";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// ============================================================
// 타입 정의
// ============================================================

export interface ScrapedDocument {
  doc_id: string;
  board_id: string;
  org_id: string;
  title: string;
  content: string;
  published_date: string | null;
  source_url: string;
  scraped_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface AttachmentRecord {
  file_id: string;
  doc_id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  download_url: string;
  local_path: string | null;
  downloaded_at: string | null;
  status: "pending" | "downloaded" | "failed";
}

export interface ScrapeLog {
  log_id: string;
  board_id: string;
  schedule_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed" | "partial";
  docs_scraped: number;
  docs_skipped: number;
  docs_failed: number;
  pages_processed: number;
  error_message: string | null;
}

export type DedupKeyType = "url" | "id" | "hash";

// ============================================================
// 데이터베이스 초기화
// ============================================================

function getDbPath(): string {
  const cwd = process.cwd();
  const isFrontendCwd = path.basename(cwd).toLowerCase() === "frontend";
  const baseDir = isFrontendCwd ? cwd : path.join(cwd, "frontend");
  const dataDir = path.join(baseDir, "data");
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  return path.join(dataDir, "scraper.db");
}

let dbInstance: Database | null = null;
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function initSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

export async function getDbAsync(): Promise<Database> {
  if (!dbInstance) {
    const SqlJs = await initSQL();
    const dbPath = getDbPath();
    
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      dbInstance = new SqlJs.Database(fileBuffer);
    } else {
      dbInstance = new SqlJs.Database();
    }
    
    initSchema(dbInstance);
  }
  return dbInstance;
}

// 동기 버전 (이미 초기화된 경우에만 사용)
export function getDb(): Database {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call getDbAsync() first.");
  }
  return dbInstance;
}

function saveDbToFile() {
  if (dbInstance) {
    const dbPath = getDbPath();
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function initSchema(db: Database): void {
  // documents 테이블: 스크래핑된 문서
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      published_date TEXT,
      source_url TEXT NOT NULL,
      scraped_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT DEFAULT '{}'
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_board ON documents(board_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(published_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(source_url)`);

  // attachments 테이블: 첨부파일 메타데이터
  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      file_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT DEFAULT '',
      file_size INTEGER,
      download_url TEXT NOT NULL,
      local_path TEXT,
      downloaded_at TEXT,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_doc ON attachments(doc_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status)`);

  // scrape_logs 테이블: 수집 이력
  db.run(`
    CREATE TABLE IF NOT EXISTS scrape_logs (
      log_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      schedule_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      docs_scraped INTEGER DEFAULT 0,
      docs_skipped INTEGER DEFAULT 0,
      docs_failed INTEGER DEFAULT 0,
      pages_processed INTEGER DEFAULT 0,
      error_message TEXT
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_board ON scrape_logs(board_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_status ON scrape_logs(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_started ON scrape_logs(started_at)`);
  
  saveDbToFile();
}

// ============================================================
// 중복 제거 (Deduplication)
// ============================================================

/**
 * 중복 제거용 문서 ID 생성
 */
export function generateDocId(
  item: { title: string; link: string; date?: string; content?: string },
  boardId: string,
  dedupKey: DedupKeyType = "url"
): string {
  let seed: string;

  switch (dedupKey) {
    case "url":
      seed = normalizeUrl(item.link);
      break;
    case "id":
      const extractedId = extractPostId(item.link);
      seed = extractedId ? `${boardId}:${extractedId}` : normalizeUrl(item.link);
      break;
    case "hash":
      const contentPreview = (item.content || "").slice(0, 200);
      seed = `${item.title}|${item.date || ""}|${contentPreview}`;
      break;
    default:
      seed = normalizeUrl(item.link);
  }

  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `doc_${boardId}_${hash}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    
    const params = Array.from(u.searchParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    u.search = "";
    for (const [k, v] of params) {
      u.searchParams.append(k, v);
    }
    
    let result = u.toString();
    if (result.endsWith("/") && u.pathname !== "/") {
      result = result.slice(0, -1);
    }
    
    return result;
  } catch {
    return url;
  }
}

function extractPostId(url: string): string | null {
  try {
    const u = new URL(url);
    const idParams = ["seq", "id", "no", "idx", "num", "sn", "bbsId", "nttId", "articleSeq"];
    for (const param of idParams) {
      const value = u.searchParams.get(param);
      if (value && /^\d+$/.test(value)) {
        return value;
      }
    }
    
    const pathMatch = u.pathname.match(/\/(?:view|board|detail|read|notice)\/(\d+)/i);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    const segments = u.pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && /^\d+$/.test(lastSegment)) {
      return lastSegment;
    }
    
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 문서 CRUD
// ============================================================

export async function saveDocument(doc: Omit<ScrapedDocument, "updated_at">): Promise<ScrapedDocument> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  
  // UPSERT using INSERT OR REPLACE
  db.run(`
    INSERT OR REPLACE INTO documents (doc_id, board_id, org_id, title, content, published_date, source_url, scraped_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    doc.doc_id,
    doc.board_id,
    doc.org_id,
    doc.title,
    doc.content,
    doc.published_date,
    doc.source_url,
    doc.scraped_at,
    now,
    JSON.stringify(doc.metadata || {})
  ]);
  
  saveDbToFile();
  return { ...doc, updated_at: now };
}

export async function documentExists(docId: string): Promise<boolean> {
  const db = await getDbAsync();
  const result = db.exec("SELECT 1 FROM documents WHERE doc_id = ?", [docId]);
  return result.length > 0 && result[0].values.length > 0;
}

export async function getDocument(docId: string): Promise<ScrapedDocument | null> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM documents WHERE doc_id = ?", [docId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const columns = result[0].columns;
  const values = result[0].values[0];
  const row: any = {};
  columns.forEach((col, i) => row[col] = values[i]);
  
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}")
  };
}

export async function getDocumentsByBoard(
  boardId: string,
  options?: {
    limit?: number;
    offset?: number;
    orderBy?: "scraped_at" | "published_date";
    order?: "ASC" | "DESC";
  }
): Promise<ScrapedDocument[]> {
  const db = await getDbAsync();
  const { limit = 100, offset = 0, orderBy = "scraped_at", order = "DESC" } = options || {};
  
  const result = db.exec(
    `SELECT * FROM documents WHERE board_id = ? ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`,
    [boardId, limit, offset]
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return {
      ...row,
      metadata: JSON.parse(row.metadata || "{}")
    };
  });
}

export async function countDocumentsByBoard(boardId: string): Promise<number> {
  const db = await getDbAsync();
  const result = db.exec("SELECT COUNT(*) as count FROM documents WHERE board_id = ?", [boardId]);
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return Number(result[0].values[0][0]);
}

// ============================================================
// 첨부파일 CRUD
// ============================================================

export async function saveAttachment(attachment: AttachmentRecord): Promise<void> {
  const db = await getDbAsync();
  
  db.run(`
    INSERT OR REPLACE INTO attachments (file_id, doc_id, file_name, file_type, file_size, download_url, local_path, downloaded_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    attachment.file_id,
    attachment.doc_id,
    attachment.file_name,
    attachment.file_type,
    attachment.file_size,
    attachment.download_url,
    attachment.local_path,
    attachment.downloaded_at,
    attachment.status
  ]);
  
  saveDbToFile();
}

export function generateFileId(downloadUrl: string, docId: string): string {
  const hash = crypto.createHash("sha256").update(downloadUrl).digest("hex").slice(0, 12);
  return `file_${docId.replace("doc_", "")}_${hash}`;
}

export async function getAttachmentsByDoc(docId: string): Promise<AttachmentRecord[]> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM attachments WHERE doc_id = ?", [docId]);
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as AttachmentRecord;
  });
}

export async function getPendingAttachments(limit: number = 100): Promise<AttachmentRecord[]> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM attachments WHERE status = 'pending' LIMIT ?", [limit]);
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as AttachmentRecord;
  });
}

export async function updateAttachmentStatus(
  fileId: string,
  status: AttachmentRecord["status"],
  localPath?: string
): Promise<void> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  
  if (localPath) {
    db.run("UPDATE attachments SET status = ?, local_path = ?, downloaded_at = ? WHERE file_id = ?",
      [status, localPath, now, fileId]);
  } else {
    db.run("UPDATE attachments SET status = ? WHERE file_id = ?", [status, fileId]);
  }
  
  saveDbToFile();
}

// ============================================================
// 스크래핑 로그
// ============================================================

export async function startScrapeLog(boardId: string, scheduleId?: string): Promise<ScrapeLog> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const log: ScrapeLog = {
    log_id: logId,
    board_id: boardId,
    schedule_id: scheduleId || null,
    started_at: now,
    finished_at: null,
    status: "running",
    docs_scraped: 0,
    docs_skipped: 0,
    docs_failed: 0,
    pages_processed: 0,
    error_message: null,
  };
  
  db.run(`
    INSERT INTO scrape_logs (log_id, board_id, schedule_id, started_at, status)
    VALUES (?, ?, ?, ?, ?)
  `, [logId, boardId, scheduleId || null, now, "running"]);
  
  saveDbToFile();
  return log;
}

export async function updateScrapeLog(
  logId: string,
  updates: Partial<Omit<ScrapeLog, "log_id" | "board_id" | "schedule_id" | "started_at">>
): Promise<void> {
  const db = await getDbAsync();
  
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.finished_at !== undefined) {
    fields.push("finished_at = ?");
    values.push(updates.finished_at);
  }
  if (updates.docs_scraped !== undefined) {
    fields.push("docs_scraped = ?");
    values.push(updates.docs_scraped);
  }
  if (updates.docs_skipped !== undefined) {
    fields.push("docs_skipped = ?");
    values.push(updates.docs_skipped);
  }
  if (updates.docs_failed !== undefined) {
    fields.push("docs_failed = ?");
    values.push(updates.docs_failed);
  }
  if (updates.pages_processed !== undefined) {
    fields.push("pages_processed = ?");
    values.push(updates.pages_processed);
  }
  if (updates.error_message !== undefined) {
    fields.push("error_message = ?");
    values.push(updates.error_message);
  }
  
  if (fields.length === 0) return;
  
  values.push(logId);
  db.run(`UPDATE scrape_logs SET ${fields.join(", ")} WHERE log_id = ?`, values);
  saveDbToFile();
}

export async function finishScrapeLog(
  logId: string,
  status: "success" | "failed" | "partial",
  stats: { docs_scraped: number; docs_skipped: number; docs_failed: number; pages_processed: number },
  errorMessage?: string
): Promise<void> {
  await updateScrapeLog(logId, {
    finished_at: new Date().toISOString(),
    status,
    ...stats,
    error_message: errorMessage || null,
  });
}

export async function getRecentScrapeLogs(boardId: string, limit: number = 10): Promise<ScrapeLog[]> {
  const db = await getDbAsync();
  const result = db.exec(
    "SELECT * FROM scrape_logs WHERE board_id = ? ORDER BY started_at DESC LIMIT ?",
    [boardId, limit]
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as ScrapeLog;
  });
}

// ============================================================
// 통계 및 유틸리티
// ============================================================

export async function getStats(): Promise<{
  total_documents: number;
  total_attachments: number;
  pending_attachments: number;
  boards_with_data: number;
}> {
  const db = await getDbAsync();
  
  const docResult = db.exec("SELECT COUNT(*) FROM documents");
  const docCount = docResult.length > 0 ? Number(docResult[0].values[0][0]) : 0;
  
  const attachResult = db.exec("SELECT COUNT(*) FROM attachments");
  const attachCount = attachResult.length > 0 ? Number(attachResult[0].values[0][0]) : 0;
  
  const pendingResult = db.exec("SELECT COUNT(*) FROM attachments WHERE status = 'pending'");
  const pendingCount = pendingResult.length > 0 ? Number(pendingResult[0].values[0][0]) : 0;
  
  const boardResult = db.exec("SELECT COUNT(DISTINCT board_id) FROM documents");
  const boardCount = boardResult.length > 0 ? Number(boardResult[0].values[0][0]) : 0;
  
  return {
    total_documents: docCount,
    total_attachments: attachCount,
    pending_attachments: pendingCount,
    boards_with_data: boardCount,
  };
}

// ============================================================
// 수집 현황 통계 (Status Dashboard용)
// ============================================================

/**
 * 요약 통계: 대시보드 상단 카드용
 */
export async function getStatusSummary(): Promise<{
  total_documents: number;
  total_attachments: number;
  today_documents: number;
  today_attachments: number;
  running_jobs: number;
  error_rate_24h: number;
  total_size_bytes: number;
}> {
  const db = await getDbAsync();
  
  // 총 문서 수
  const docResult = db.exec("SELECT COUNT(*) FROM documents");
  const totalDocs = docResult.length > 0 ? Number(docResult[0].values[0][0]) : 0;
  
  // 총 첨부파일 수
  const attachResult = db.exec("SELECT COUNT(*) FROM attachments");
  const totalAttach = attachResult.length > 0 ? Number(attachResult[0].values[0][0]) : 0;
  
  // 금일 수집 문서 (UTC 기준 오늘)
  const today = new Date().toISOString().split("T")[0];
  const todayDocResult = db.exec(
    "SELECT COUNT(*) FROM documents WHERE scraped_at >= ?",
    [`${today}T00:00:00.000Z`]
  );
  const todayDocs = todayDocResult.length > 0 ? Number(todayDocResult[0].values[0][0]) : 0;
  
  // 금일 수집 첨부파일
  const todayAttachResult = db.exec(
    "SELECT COUNT(*) FROM attachments WHERE downloaded_at >= ?",
    [`${today}T00:00:00.000Z`]
  );
  const todayAttach = todayAttachResult.length > 0 ? Number(todayAttachResult[0].values[0][0]) : 0;
  
  // 실행 중인 작업 수
  const runningResult = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE status = 'running'"
  );
  const runningJobs = runningResult.length > 0 ? Number(runningResult[0].values[0][0]) : 0;
  
  // 24시간 에러율
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const totalLogsResult = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE started_at >= ?",
    [yesterday]
  );
  const totalLogs = totalLogsResult.length > 0 ? Number(totalLogsResult[0].values[0][0]) : 0;
  
  const failedLogsResult = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE started_at >= ? AND status = 'failed'",
    [yesterday]
  );
  const failedLogs = failedLogsResult.length > 0 ? Number(failedLogsResult[0].values[0][0]) : 0;
  
  const errorRate = totalLogs > 0 ? (failedLogs / totalLogs) * 100 : 0;
  
  // 총 파일 용량
  const sizeResult = db.exec(
    "SELECT COALESCE(SUM(file_size), 0) FROM attachments WHERE file_size IS NOT NULL"
  );
  const totalSize = sizeResult.length > 0 ? Number(sizeResult[0].values[0][0]) : 0;
  
  return {
    total_documents: totalDocs,
    total_attachments: totalAttach,
    today_documents: todayDocs,
    today_attachments: todayAttach,
    running_jobs: runningJobs,
    error_rate_24h: Math.round(errorRate * 10) / 10,
    total_size_bytes: totalSize,
  };
}

/**
 * 기간별 수집 추이 통계
 */
export async function getCollectionTimeline(
  startDate: string,
  endDate: string,
  groupBy: "day" | "week" | "month" = "day"
): Promise<{ date: string; documents: number; attachments: number }[]> {
  const db = await getDbAsync();
  
  // SQLite date grouping
  let dateFormat: string;
  switch (groupBy) {
    case "week":
      dateFormat = "%Y-W%W";
      break;
    case "month":
      dateFormat = "%Y-%m";
      break;
    default:
      dateFormat = "%Y-%m-%d";
  }
  
  // 문서 수집 통계
  const docResult = db.exec(`
    SELECT strftime('${dateFormat}', scraped_at) as period, COUNT(*) as count
    FROM documents
    WHERE scraped_at >= ? AND scraped_at <= ?
    GROUP BY period
    ORDER BY period ASC
  `, [startDate, endDate]);
  
  const docMap = new Map<string, number>();
  if (docResult.length > 0) {
    docResult[0].values.forEach((row) => {
      docMap.set(row[0] as string, Number(row[1]));
    });
  }
  
  // 첨부파일 수집 통계
  const attachResult = db.exec(`
    SELECT strftime('${dateFormat}', downloaded_at) as period, COUNT(*) as count
    FROM attachments
    WHERE downloaded_at IS NOT NULL AND downloaded_at >= ? AND downloaded_at <= ?
    GROUP BY period
    ORDER BY period ASC
  `, [startDate, endDate]);
  
  const attachMap = new Map<string, number>();
  if (attachResult.length > 0) {
    attachResult[0].values.forEach((row) => {
      attachMap.set(row[0] as string, Number(row[1]));
    });
  }
  
  // 기간 내 모든 날짜 생성
  const result: { date: string; documents: number; attachments: number }[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (groupBy === "day") {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      result.push({
        date: dateStr,
        documents: docMap.get(dateStr) || 0,
        attachments: attachMap.get(dateStr) || 0,
      });
    }
  } else if (groupBy === "month") {
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result.push({
        date: dateStr,
        documents: docMap.get(dateStr) || 0,
        attachments: attachMap.get(dateStr) || 0,
      });
    }
  } else {
    // week 그룹은 Map에 있는 데이터만 반환
    const allPeriods = new Set([...docMap.keys(), ...attachMap.keys()]);
    Array.from(allPeriods).sort().forEach((period) => {
      result.push({
        date: period,
        documents: docMap.get(period) || 0,
        attachments: attachMap.get(period) || 0,
      });
    });
  }
  
  return result;
}

/**
 * 파일 형식별 통계
 */
export async function getFileTypeStats(): Promise<{
  type: string;
  count: number;
  size_bytes: number;
  percentage: number;
}[]> {
  const db = await getDbAsync();
  
  const result = db.exec(`
    SELECT 
      LOWER(file_type) as type,
      COUNT(*) as count,
      COALESCE(SUM(file_size), 0) as total_size
    FROM attachments
    GROUP BY LOWER(file_type)
    ORDER BY count DESC
  `);
  
  if (result.length === 0) return [];
  
  const data = result[0].values.map((row) => ({
    type: (row[0] as string) || "unknown",
    count: Number(row[1]),
    size_bytes: Number(row[2]),
    percentage: 0,
  }));
  
  const totalCount = data.reduce((sum, item) => sum + item.count, 0);
  data.forEach((item) => {
    item.percentage = totalCount > 0 ? Math.round((item.count / totalCount) * 1000) / 10 : 0;
  });
  
  return data;
}

/**
 * 보드별 상세 통계
 */
export async function getBoardStats(): Promise<{
  board_id: string;
  org_id: string;
  document_count: number;
  attachment_count: number;
  total_size_bytes: number;
  last_scraped_at: string | null;
  last_7d_documents: number;
}[]> {
  const db = await getDbAsync();
  
  // 보드별 문서 통계
  const docResult = db.exec(`
    SELECT 
      board_id,
      org_id,
      COUNT(*) as doc_count,
      MAX(scraped_at) as last_scraped
    FROM documents
    GROUP BY board_id, org_id
  `);
  
  const boardMap = new Map<string, {
    board_id: string;
    org_id: string;
    document_count: number;
    attachment_count: number;
    total_size_bytes: number;
    last_scraped_at: string | null;
    last_7d_documents: number;
  }>();
  
  if (docResult.length > 0) {
    docResult[0].values.forEach((row) => {
      const boardId = row[0] as string;
      boardMap.set(boardId, {
        board_id: boardId,
        org_id: row[1] as string,
        document_count: Number(row[2]),
        attachment_count: 0,
        total_size_bytes: 0,
        last_scraped_at: row[3] as string | null,
        last_7d_documents: 0,
      });
    });
  }
  
  // 보드별 첨부파일 통계 (documents 조인)
  const attachResult = db.exec(`
    SELECT 
      d.board_id,
      COUNT(a.file_id) as attach_count,
      COALESCE(SUM(a.file_size), 0) as total_size
    FROM documents d
    LEFT JOIN attachments a ON d.doc_id = a.doc_id
    GROUP BY d.board_id
  `);
  
  if (attachResult.length > 0) {
    attachResult[0].values.forEach((row) => {
      const boardId = row[0] as string;
      const existing = boardMap.get(boardId);
      if (existing) {
        existing.attachment_count = Number(row[1]);
        existing.total_size_bytes = Number(row[2]);
      }
    });
  }
  
  // 최근 7일 문서 수
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentResult = db.exec(`
    SELECT board_id, COUNT(*) as count
    FROM documents
    WHERE scraped_at >= ?
    GROUP BY board_id
  `, [sevenDaysAgo]);
  
  if (recentResult.length > 0) {
    recentResult[0].values.forEach((row) => {
      const boardId = row[0] as string;
      const existing = boardMap.get(boardId);
      if (existing) {
        existing.last_7d_documents = Number(row[1]);
      }
    });
  }
  
  return Array.from(boardMap.values());
}

/**
 * 보드별 최근 실행 상태
 */
export async function getBoardLatestStatus(): Promise<{
  board_id: string;
  last_run_at: string | null;
  status: "success" | "failed" | "running" | "partial" | "never";
  docs_scraped: number;
  docs_failed: number;
  error_message: string | null;
}[]> {
  const db = await getDbAsync();
  
  // 각 보드의 가장 최근 로그
  const result = db.exec(`
    SELECT 
      l1.board_id,
      l1.started_at,
      l1.status,
      l1.docs_scraped,
      l1.docs_failed,
      l1.error_message
    FROM scrape_logs l1
    INNER JOIN (
      SELECT board_id, MAX(started_at) as max_started
      FROM scrape_logs
      GROUP BY board_id
    ) l2 ON l1.board_id = l2.board_id AND l1.started_at = l2.max_started
  `);
  
  if (result.length === 0) return [];
  
  return result[0].values.map((row) => ({
    board_id: row[0] as string,
    last_run_at: row[1] as string | null,
    status: row[2] as "success" | "failed" | "running" | "partial",
    docs_scraped: Number(row[3]),
    docs_failed: Number(row[4]),
    error_message: row[5] as string | null,
  }));
}

/**
 * 실행 중인 작업 목록
 */
export async function getRunningJobs(): Promise<ScrapeLog[]> {
  const db = await getDbAsync();
  const result = db.exec(
    "SELECT * FROM scrape_logs WHERE status = 'running' ORDER BY started_at DESC"
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as ScrapeLog;
  });
}

/**
 * 최근 스크래핑 로그 (전체 보드)
 */
export async function getAllRecentLogs(limit: number = 50): Promise<ScrapeLog[]> {
  const db = await getDbAsync();
  const result = db.exec(
    "SELECT * FROM scrape_logs ORDER BY started_at DESC LIMIT ?",
    [limit]
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as ScrapeLog;
  });
}

// ============================================================
// 에러 통계 및 분석
// ============================================================

export type ErrorType = "timeout" | "http_error" | "parsing" | "network" | "dom_change" | "unknown";

/**
 * 에러 메시지에서 에러 유형 분류
 */
export function classifyErrorType(errorMessage: string | null): ErrorType {
  if (!errorMessage) return "unknown";
  const msg = errorMessage.toLowerCase();
  
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("시간 초과")) {
    return "timeout";
  }
  // HTTP 오류: 명시적 status code / 키워드 기반
  if (
    msg.includes("http") ||
    msg.includes("status") ||
    /\b(4\d{2}|5\d{2})\b/.test(msg) ||
    msg.includes("forbidden") ||
    msg.includes("not found")
  ) {
    return "http_error";
  }
  if (msg.includes("parse") || msg.includes("json") || msg.includes("selector") || msg.includes("invalid") || msg.includes("파싱")) {
    return "parsing";
  }
  if (msg.includes("network") || msg.includes("connection") || msg.includes("dns") || msg.includes("socket") || msg.includes("econnrefused") || msg.includes("네트워크")) {
    return "network";
  }
  if (msg.includes("dom") || msg.includes("element") || msg.includes("변경") || msg.includes("구조")) {
    return "dom_change";
  }
  return "unknown";
}

export const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  timeout: "타임아웃",
  http_error: "HTTP 오류",
  parsing: "파싱 실패",
  network: "네트워크 오류",
  dom_change: "DOM 구조 변경",
  unknown: "기타",
};

/**
 * 에러 통계 조회
 */
export async function getErrorStats(): Promise<{
  last_24h: number;
  last_7d: number;
  pending: number;
  by_type: Record<ErrorType, number>;
}> {
  const db = await getDbAsync();
  
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  // 24시간 내 에러
  const result24h = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE status IN ('failed', 'partial') AND started_at >= ?",
    [yesterday]
  );
  const last24h = result24h.length > 0 ? Number(result24h[0].values[0][0]) : 0;
  
  // 7일 내 에러
  const result7d = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE status IN ('failed', 'partial') AND started_at >= ?",
    [sevenDaysAgo]
  );
  const last7d = result7d.length > 0 ? Number(result7d[0].values[0][0]) : 0;
  
  // 대기 중 (에러 발생 후 재시도 대기 = 가장 최근이 에러인 보드)
  const pendingResult = db.exec(`
    SELECT COUNT(DISTINCT l1.board_id) FROM scrape_logs l1
    INNER JOIN (
      SELECT board_id, MAX(started_at) as max_started
      FROM scrape_logs
      GROUP BY board_id
    ) l2 ON l1.board_id = l2.board_id AND l1.started_at = l2.max_started
    WHERE l1.status = 'failed'
  `);
  const pending = pendingResult.length > 0 ? Number(pendingResult[0].values[0][0]) : 0;
  
  // 유형별 분류 (7일)
  const errorsResult = db.exec(
    "SELECT error_message FROM scrape_logs WHERE status IN ('failed', 'partial') AND started_at >= ? AND error_message IS NOT NULL",
    [sevenDaysAgo]
  );
  
  const byType: Record<ErrorType, number> = {
    timeout: 0,
    http_error: 0,
    parsing: 0,
    network: 0,
    dom_change: 0,
    unknown: 0,
  };
  
  if (errorsResult.length > 0) {
    errorsResult[0].values.forEach((row) => {
      const errorMsg = row[0] as string;
      const type = classifyErrorType(errorMsg);
      byType[type]++;
    });
  }
  
  return {
    last_24h: last24h,
    last_7d: last7d,
    pending,
    by_type: byType,
  };
}

/**
 * 에러 목록 조회 (페이징)
 */
export async function getErrorList(options?: {
  limit?: number;
  offset?: number;
  errorType?: ErrorType;
  boardId?: string;
}): Promise<{
  items: Array<ScrapeLog & { error_type: ErrorType }>;
  total: number;
}> {
  const db = await getDbAsync();
  const { limit = 50, offset = 0, errorType, boardId } = options || {};
  
  let whereClause = "WHERE status IN ('failed', 'partial')";
  const params: unknown[] = [];
  
  if (boardId) {
    whereClause += " AND board_id = ?";
    params.push(boardId);
  }

  // errorType 필터가 들어오면: 전체를 분류한 뒤 필터링/페이징 (total 정합성 확보)
  if (errorType) {
    const allResult = db.exec(
      `SELECT * FROM scrape_logs ${whereClause} ORDER BY started_at DESC`,
      params
    );
    if (allResult.length === 0) return { items: [], total: 0 };

    const columns = allResult[0].columns;
    const allItems = allResult[0].values.map((values) => {
      const row: Record<string, unknown> = {};
      columns.forEach((col, i) => (row[col] = values[i]));
      const t = classifyErrorType(row.error_message as string | null);
      return { ...row, error_type: t } as ScrapeLog & { error_type: ErrorType };
    });

    const filtered = allItems.filter((i) => i.error_type === errorType);
    return {
      total: filtered.length,
      items: filtered.slice(offset, offset + limit),
    };
  }

  // 총 개수 (필터 없음)
  const countResult = db.exec(`SELECT COUNT(*) FROM scrape_logs ${whereClause}`, params);
  const total = countResult.length > 0 ? Number(countResult[0].values[0][0]) : 0;

  // 목록 조회
  const result = db.exec(
    `SELECT * FROM scrape_logs ${whereClause} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  if (result.length === 0) return { items: [], total };

  const columns = result[0].columns;
  const items = result[0].values.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => (row[col] = values[i]));
    const t = classifyErrorType(row.error_message as string | null);
    return { ...row, error_type: t } as ScrapeLog & { error_type: ErrorType };
  });

  return { items, total };
}

/**
 * 특정 로그 상세 조회
 */
export async function getScrapeLogDetail(logId: string): Promise<ScrapeLog | null> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM scrape_logs WHERE log_id = ?", [logId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const columns = result[0].columns;
  const values = result[0].values[0];
  const row: Record<string, unknown> = {};
  columns.forEach((col, i) => row[col] = values[i]);
  
  return row as ScrapeLog;
}

/**
 * 즉시 실행(instant) 스크래핑 결과를 DB에 동기화
 * - 즉시 실행/스트리밍 라우트에서 JSON 저장 후 호출
 * - 수집 현황 대시보드의 통계 데이터를 갱신
 */
export async function syncInstantScrapeToDB(params: {
  boardId: string;
  orgId: string;
  articles: Array<{
    title: string;
    link: string;
    date?: string;
    content: string;
    attachments?: Array<{ fileName: string; downloadUrl: string }>;
  }>;
  downloadedFiles?: string[];
  dedupKey?: DedupKeyType;
}): Promise<{ logId: string; docsAdded: number; attachmentsAdded: number }> {
  const { boardId, orgId, articles, downloadedFiles = [], dedupKey = "url" } = params;
  
  let docsAdded = 0;
  let attachmentsAdded = 0;
  let docsSkipped = 0;
  
  // 로그 생성
  const log = await startScrapeLog(boardId);
  
  try {
    const now = new Date().toISOString();
    
    for (const article of articles) {
      // 문서 ID 생성
      const docId = generateDocId(
        { title: article.title, link: article.link, date: article.date, content: article.content },
        boardId,
        dedupKey
      );
      
      // 중복 체크
      if (await documentExists(docId)) {
        docsSkipped++;
        continue;
      }
      
      // 날짜 파싱
      let publishedDate: string | null = null;
      if (article.date) {
        const dateMatch = article.date.match(/(\d{4})[-./\s]*(\d{1,2})[-./\s]*(\d{1,2})/);
        if (dateMatch) {
          publishedDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
        }
      }
      
      // 문서 저장
      await saveDocument({
        doc_id: docId,
        board_id: boardId,
        org_id: orgId,
        title: article.title,
        content: article.content || "",
        published_date: publishedDate,
        source_url: article.link,
        scraped_at: now,
        metadata: {},
      });
      docsAdded++;
      
      // 첨부파일 메타데이터 저장
      if (article.attachments && article.attachments.length > 0) {
        for (const att of article.attachments) {
          const fileId = generateFileId(att.downloadUrl, docId);
          const fileType = att.fileName.split(".").pop()?.toLowerCase() || "";
          
          // 다운로드 파일 목록에서 해당 파일 찾기 (매칭)
          const downloadedPath = downloadedFiles.find((fp) => {
            const fn = fp.split(/[/\\]/).pop() || "";
            return fn.includes(att.fileName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30));
          });
          
          // 파일 크기 조회
          let fileSize: number | null = null;
          if (downloadedPath) {
            try {
              const fs = require("node:fs");
              const stat = fs.statSync(downloadedPath);
              fileSize = stat.size;
            } catch {
              // 파일 크기 조회 실패 무시
            }
          }
          
          await saveAttachment({
            file_id: fileId,
            doc_id: docId,
            file_name: att.fileName,
            file_type: fileType,
            file_size: fileSize,
            download_url: att.downloadUrl,
            local_path: downloadedPath || null,
            downloaded_at: downloadedPath ? now : null,
            status: downloadedPath ? "downloaded" : "pending",
          });
          attachmentsAdded++;
        }
      }
    }
    
    // 로그 완료
    const finalStatus = docsAdded > 0 ? "success" : (articles.length > 0 ? "success" : "partial");
    await finishScrapeLog(log.log_id, finalStatus as "success" | "partial" | "failed", {
      docs_scraped: docsAdded,
      docs_skipped: docsSkipped,
      docs_failed: 0,
      pages_processed: 1,
    });
    
    return { logId: log.log_id, docsAdded, attachmentsAdded };
  } catch (err) {
    // 에러 시에도 로그 기록
    const errorMessage = err instanceof Error ? err.message : String(err);
    await finishScrapeLog(log.log_id, "failed", {
      docs_scraped: docsAdded,
      docs_skipped: docsSkipped,
      docs_failed: articles.length - docsAdded - docsSkipped,
      pages_processed: 1,
    }, errorMessage);
    
    throw err;
  }
}

export function closeDb(): void {
  if (dbInstance) {
    saveDbToFile();
    dbInstance.close();
    dbInstance = null;
  }
}
