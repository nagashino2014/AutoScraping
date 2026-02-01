/**
 * 즉시 실행 API (SSE 스트리밍 버전)
 * 
 * 실시간 진행 상황을 Server-Sent Events로 전송합니다.
 */

import { NextRequest } from "next/server";
import { readScraperTargets, type CollectionTargets, type SiteSearchConfig, type BrowserConfig as BrowserSettings } from "@/lib/scraper/targets-store";
import { exportToXlsx, type ScrapedArticle } from "@/lib/scraper/xlsx-export";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { promises as fsPromises } from "node:fs";
import {
  fetchRenderedHtml,
  extractAttachmentsWithBrowser,
  extractLawmakingAttachments,
  downloadBatchWithPlaywright,
  BrowserConfig,
  extractAllZipsInDirectory,
} from "@/lib/scraper/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// 다운로드 설정 (테스트 저장 경로)
// ============================================================

interface TestPathSettings {
  documentsPath: string;
  attachmentsPath: string;
}

type FailureAction = "skip" | "log_only" | "stop";
type DuplicateHandling = "skip" | "overwrite" | "version";

interface RetrySettings {
  maxRetries: number;
  retryIntervalSec: number;
  useExponentialBackoff: boolean;
  timeoutSec: number;
  failureAction: FailureAction;
}

interface NetworkSettings {
  customUserAgent: string;
  autoReferer: boolean;
}

interface FileManagementSettings {
  maxFileSizeMb: number;
  duplicateHandling: DuplicateHandling;
  allowedExtensions: string[];
  concurrentDownloads: number;
}

interface StorageSettings {
  warningThresholdGb: number;
  autoCleanupEnabled: boolean;
  autoCleanupDays: number;
  maxStorageGb: number;
}

interface DownloadSettings {
  testPath: TestPathSettings;
  retry?: RetrySettings;
  network?: NetworkSettings;
  fileManagement?: FileManagementSettings;
  storage?: StorageSettings;
}

const DEFAULT_TEST_PATH: TestPathSettings = {
  documentsPath: "./data/test/documents",
  attachmentsPath: "./data/test/attachments",
};

const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  maxRetries: 3,
  retryIntervalSec: 5,
  useExponentialBackoff: true,
  timeoutSec: 60,
  failureAction: "skip",
};

const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  customUserAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EcoMonitorBot/1.0",
  autoReferer: true,
};

const DEFAULT_FILE_MANAGEMENT: FileManagementSettings = {
  maxFileSizeMb: 100,
  duplicateHandling: "skip",
  allowedExtensions: [],  // 빈 배열 = 전체 허용
  concurrentDownloads: 2,
};

const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
  warningThresholdGb: 10,
  autoCleanupEnabled: false,
  autoCleanupDays: 365,
  maxStorageGb: 0,  // 무제한
};

const DOWNLOAD_SETTINGS_FILE = path.join(process.cwd(), "data", "download-settings.json");

// ============================================================
// 저장 공간 관리 유틸리티
// ============================================================

async function getDiskUsage(targetPath: string): Promise<{ total: number; free: number; used: number } | null> {
  try {
    const { execSync } = await import("node:child_process");
    const resolvedPath = path.resolve(targetPath);

    if (process.platform === "win32") {
      const driveLetter = resolvedPath.charAt(0).toUpperCase();
      let output = "";
      try {
        output = execSync(
          `wmic logicaldisk where "DeviceID='${driveLetter}:'" get FreeSpace,Size /format:csv`,
          { encoding: "utf-8" }
        );
      } catch {
        // wmic 미지원 환경에서는 PowerShell CIM 사용
        output = execSync(
          `powershell -NoProfile -Command "$disk = Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID='${driveLetter}:'\\"; \\\"$($disk.FreeSpace),$($disk.Size)\\\""`,
          { encoding: "utf-8" }
        );
        // PowerShell 결과는 "free,total" 형식
        const parts = output.trim().split(",").map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const free = parseInt(parts[0], 10);
          const total = parseInt(parts[1], 10);
          if (!Number.isNaN(free) && !Number.isNaN(total)) {
            return { total, free, used: total - free };
          }
        }
        output = "";
      }

      const lines = output.trim().split("\n").filter(l => l.trim());
      if (lines.length >= 2) {
        const parts = lines[1].split(",");
        if (parts.length >= 3) {
          const free = parseInt(parts[1], 10);
          const total = parseInt(parts[2], 10);
          return { total, free, used: total - free };
        }
      }
    }
  } catch (err) {
    console.error("Failed to get disk usage:", err);
  }
  return null;
}

function getFolderSize(folderPath: string): { totalSize: number; fileCount: number } {
  let totalSize = 0;
  let fileCount = 0;

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          totalSize += stats.size;
          fileCount++;
        } catch { }
      }
    }
  }

  walkDir(folderPath);
  return { totalSize, fileCount };
}

function runAutoCleanup(targetPath: string, daysThreshold: number): { deletedFiles: number; deletedSize: number } {
  let deletedFiles = 0;
  let deletedSize = 0;

  if (!fs.existsSync(targetPath)) return { deletedFiles, deletedSize };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

  function cleanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        cleanDir(fullPath);
        try {
          if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
        } catch { }
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          if (stats.mtime < cutoffDate) {
            deletedSize += stats.size;
            fs.unlinkSync(fullPath);
            deletedFiles++;
          }
        } catch { }
      }
    }
  }

  cleanDir(targetPath);
  return { deletedFiles, deletedSize };
}

/**
 * 확장자 없는 파일 복원
 * 파일명에 확장자가 포함되어 있지만 용량 표시 등이 붙어서 실제 확장자가 없는 파일을 복원
 * 예: "문서.hwp (123KB)" → "문서.hwp"
 * 예: "보고서.pdf[2.5MB]" → "보고서.pdf"
 */
function restoreFileExtensions(
  downloadedFiles: string[],
  send: (data: any) => void
): { restoredCount: number; updatedFiles: string[] } {
  const KNOWN_EXTENSIONS = [
    "hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx",
    "txt", "rtf", "zip", "rar", "7z", "tar", "gz", "jpg", "jpeg", "png", "gif", "bmp"
  ];

  // 용량 표시 패턴 (파일명 끝에 붙는 패턴들)
  const SIZE_PATTERNS = [
    /\s*\([\d,]+\s*Bytes?\)\s*$/i,           // (291,517 Byte), (1234 Bytes)
    /\s*\([^)]*[KMG]B\)\s*$/i,               // (230KB), (2.5 MB), (1.2GB)
    /\s*\[[^\]]*[KMG]B\]\s*$/i,              // [230 KB], [2.5MB]
    /\s*[\[\(][\d.,]+\s*[KMG]?B[\]\)]\s*$/i, // [123.2 KB], (1.2MB)
    /\s*\(\s*[\d.,]+\s*[KMG]?B\s*\)\s*$/i,   // ( 230 KB ), (2.5 MB)
  ];

  // 파일명에서 확장자와 용량을 추출하는 패턴
  // 예: "문서.hwp (123KB)" → ext="hwp"
  const EXT_WITH_SIZE_PATTERN = new RegExp(
    `\\.(${KNOWN_EXTENSIONS.join("|")})\\s*[\\[\\(].*$`,
    "i"
  );

  let restoredCount = 0;
  const updatedFiles: string[] = [];

  for (const filePath of downloadedFiles) {
    if (!fs.existsSync(filePath)) {
      updatedFiles.push(filePath);
      continue;
    }

    const fileName = path.basename(filePath);
    const currentExt = path.extname(fileName).toLowerCase().replace(".", "");
    const dirPath = path.dirname(filePath);

    // 이미 유효한 확장자가 있으면 스킵
    if (KNOWN_EXTENSIONS.includes(currentExt)) {
      updatedFiles.push(filePath);
      continue;
    }

    // 파일명에서 숨겨진 확장자 찾기
    const extMatch = fileName.match(EXT_WITH_SIZE_PATTERN);
    if (extMatch) {
      const hiddenExt = extMatch[1].toLowerCase();
      
      // 용량 표시 제거하여 올바른 파일명 생성
      let cleanedName = fileName;
      for (const pattern of SIZE_PATTERNS) {
        cleanedName = cleanedName.replace(pattern, "");
      }
      cleanedName = cleanedName.trim();

      // 확장자가 제대로 붙어있는지 확인
      if (!cleanedName.toLowerCase().endsWith(`.${hiddenExt}`)) {
        // 확장자 복원
        const extIndex = cleanedName.toLowerCase().lastIndexOf(`.${hiddenExt}`);
        if (extIndex > 0) {
          cleanedName = cleanedName.slice(0, extIndex + hiddenExt.length + 1);
        }
      }

      if (cleanedName !== fileName) {
        const newFilePath = path.join(dirPath, cleanedName);
        
        // 중복 파일 처리
        let finalPath = newFilePath;
        if (fs.existsSync(newFilePath) && newFilePath !== filePath) {
          const ext = path.extname(cleanedName);
          const base = cleanedName.slice(0, -ext.length);
          let version = 2;
          finalPath = path.join(dirPath, `${base}_v${version}${ext}`);
          while (fs.existsSync(finalPath)) {
            version++;
            finalPath = path.join(dirPath, `${base}_v${version}${ext}`);
            if (version > 100) break;
          }
        }

        try {
          fs.renameSync(filePath, finalPath);
          restoredCount++;
          send({ type: "log", message: `   🔧 파일명 복원: ${fileName} → ${path.basename(finalPath)}` });
          updatedFiles.push(finalPath);
        } catch (renameErr) {
          send({ type: "log", message: `   ⚠️ 파일명 복원 실패: ${fileName} - ${renameErr}` });
          updatedFiles.push(filePath);
        }
      } else {
        updatedFiles.push(filePath);
      }
    } else {
      updatedFiles.push(filePath);
    }
  }

  return { restoredCount, updatedFiles };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function isAllowedExtension(fileName: string, allowedExtensions: string[]): boolean {
  if (allowedExtensions.length === 0) return true;
  const ext = path.extname(fileName).toLowerCase().replace(".", "");
  return allowedExtensions.some(allowed => allowed.toLowerCase().replace(".", "") === ext);
}

function resolveAllowedExtensions(
  collectionTargets?: CollectionTargets,
  configFileTypes?: string[]
): string[] {
  const attConfig = collectionTargets?.attachments;
  if (!attConfig) return configFileTypes || [];
  if (attConfig.enabled === false) return [];

  if (attConfig.all) {
    return [];
  }

  const allowedTypes: string[] = [];
  if (attConfig.hwpx) allowedTypes.push("hwpx");
  if (attConfig.pdf) allowedTypes.push("pdf");
  if (attConfig.docx) allowedTypes.push("doc", "docx");
  if (attConfig.xlsx) allowedTypes.push("xls", "xlsx", "csv");

  if (allowedTypes.length === 0 && configFileTypes) {
    return configFileTypes;
  }

  return allowedTypes;
}

function handleDuplicateFile(filePath: string, handling: DuplicateHandling): { shouldDownload: boolean; finalPath: string } {
  if (!fs.existsSync(filePath)) {
    return { shouldDownload: true, finalPath: filePath };
  }

  switch (handling) {
    case "skip":
      return { shouldDownload: false, finalPath: filePath };
    case "overwrite":
      return { shouldDownload: true, finalPath: filePath };
    case "version": {
      const ext = path.extname(filePath);
      const base = filePath.slice(0, -ext.length);
      let version = 2;
      let newPath = `${base}_v${version}${ext}`;
      while (fs.existsSync(newPath)) {
        version++;
        newPath = `${base}_v${version}${ext}`;
        if (version > 100) break;
      }
      return { shouldDownload: true, finalPath: newPath };
    }
    default:
      return { shouldDownload: true, finalPath: filePath };
  }
}

// 동시 다운로드 제어용 Semaphore
class DownloadSemaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) { }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

async function readDownloadSettings(): Promise<DownloadSettings | null> {
  try {
    const raw = await fsPromises.readFile(DOWNLOAD_SETTINGS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 저장 경로 결정
 * @param settings 다운로드 설정
 * @param mode 실행 모드: "test" (즉시 실행 테스트) 또는 "auto" (자동 스크래핑)
 * @param orgName 기관명 (자동 스크래핑 시 사용)
 * @param boardName 보드명 (자동 스크래핑 시 사용)
 */
function resolveSavePath(
  settings: DownloadSettings | null,
  mode: "test" | "auto",
  orgName?: string,
  boardName?: string
): { documentsPath: string; attachmentsPath: string } {
  const cwd = process.cwd();

  // 테스트 모드: testPath 사용
  if (mode === "test") {
    const testPath = settings?.testPath || DEFAULT_TEST_PATH;
    let documentsPath = testPath.documentsPath || DEFAULT_TEST_PATH.documentsPath;
    let attachmentsPath = testPath.attachmentsPath || DEFAULT_TEST_PATH.attachmentsPath;

    if (!path.isAbsolute(documentsPath)) {
      documentsPath = path.join(cwd, documentsPath);
    }
    if (!path.isAbsolute(attachmentsPath)) {
      attachmentsPath = path.join(cwd, attachmentsPath);
    }

    return { documentsPath, attachmentsPath };
  }

  // 자동 스크래핑 모드: basePath + 폴더 구조 규칙 사용
  const pathSettings = (settings as any)?.path || {};
  let basePath = pathSettings.basePath || path.join(cwd, "save", "ScrapingData");
  const folderStructure = pathSettings.folderStructure || "by_org_board_date";

  if (!path.isAbsolute(basePath)) {
    basePath = path.join(cwd, basePath);
  }

  // 폴더 구조에 따라 경로 생성
  let subPath = "";
  const dateStr = new Date().toISOString().slice(0, 7); // YYYY-MM 형식

  switch (folderStructure) {
    case "by_org_board_date":
      // 기관명/보드명/YYYY-MM
      subPath = path.join(orgName || "unknown", boardName || "unknown", dateStr);
      break;
    case "by_date_org":
      // YYYY-MM/기관명/보드명
      subPath = path.join(dateStr, orgName || "unknown", boardName || "unknown");
      break;
    case "flat":
      // 플랫 구조 (기관명_보드명_날짜 형식)
      subPath = "";
      break;
    default:
      subPath = path.join(orgName || "unknown", boardName || "unknown", dateStr);
  }

  const documentsPath = path.join(basePath, subPath);
  const attachmentsPath = path.join(basePath, subPath);

  return { documentsPath, attachmentsPath };
}

// 기존 호환성을 위한 래퍼
function resolveTestPath(settings: DownloadSettings | null): { documentsPath: string; attachmentsPath: string } {
  return resolveSavePath(settings, "test");
}

// ============================================================
// 진행 상태 타입
// ============================================================

interface ProgressEvent {
  type: "progress" | "log" | "complete" | "error";
  phase?: "init" | "list" | "detail" | "attachment" | "save" | "done";
  progress?: number;  // 0-100
  message?: string;
  data?: any;
}

// ============================================================
// 유틸리티 함수
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(
  url: string,
  retries: number = 2,
  renderingMode: string = "static_html",
  browserSettings?: BrowserSettings
): Promise<string> {
  // 동적 JS 렌더링 모드: Playwright 사용
  if (renderingMode === "dynamic_js") {
    const browserConfig: BrowserConfig = {
      browserType: browserSettings?.browser_type || "chromium",
      headless: browserSettings?.headless !== false,
      timeout: 30000,
    };

    return await fetchRenderedHtml(url, browserConfig, {
      waitFor: "networkidle",
      waitForSelector: browserSettings?.wait_for_selector,
      waitTime: browserSettings?.wait_time || 2000,
    });
  }

  // 정적 HTML 모드: 기존 fetch 사용
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await delay(1000 * attempt);
    }

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EcoMonitorBot/1.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return res.text();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error("fetch failed");
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 사이트 내 검색 옵션을 URL에 적용
 * - select, text, date 등의 옵션을 URL 쿼리 파라미터로 추가
 */
function applySiteSearchOptions(baseUrl: string, siteSearchConfig?: SiteSearchConfig): string {
  if (!siteSearchConfig || !siteSearchConfig.options || siteSearchConfig.options.length === 0) {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);

    for (const opt of siteSearchConfig.options) {
      const value = opt.selected_value;

      // 값이 설정된 옵션만 적용
      if (value !== undefined && value !== null && value !== "") {
        // name이 있으면 그것을 파라미터 이름으로 사용
        if (opt.name) {
          url.searchParams.set(opt.name, value);
        }
      }
    }

    return url.toString();
  } catch {
    // URL 파싱 실패 시 원본 반환
    return baseUrl;
  }
}

// ============================================================
// 날짜 파싱 및 필터링
// ============================================================

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/\s+/g, " ").trim();

  // 기간 형식 처리 (국민참여입법센터: "2026. 1. 12.~2026. 2. 23.")
  // 첫 번째 날짜(시작일)만 추출
  let match = cleaned.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*[~\-]/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }

  // 점+공백 형식: "2026. 1. 12." 또는 "2026.1.12"
  match = cleaned.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }

  // 일반 날짜 형식: "2026-01-12", "2026/01/12"
  match = cleaned.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }

  // 2자리 연도: "26-01-12"
  match = cleaned.match(/(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1]) + 2000;
    return new Date(year, parseInt(match[2]) - 1, parseInt(match[3]));
  }

  // 한글 형식: "2026년 1월 12일"
  match = cleaned.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }

  return null;
}

interface CollectionRange {
  type: "period" | "relative" | "yearly" | "";
  period_start?: string;
  period_end?: string;
  relative_days?: number;
  years?: number[];
}

function checkCollectionRange(
  itemDate: Date | null,
  range?: CollectionRange
): boolean | "stop" {
  if (!range || !range.type) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (range.type) {
    case "period": {
      if (!itemDate) return true;
      const startDate = range.period_start ? new Date(range.period_start) : null;
      const endDate = range.period_end ? new Date(range.period_end) : null;
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);
      if (endDate && itemDate > endDate) return false;
      if (startDate && itemDate < startDate) return "stop";
      return true;
    }
    case "relative": {
      if (!itemDate) return true;
      const daysBefore = range.relative_days || 30;
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() - daysBefore);
      if (itemDate < cutoffDate) return "stop";
      return true;
    }
    case "yearly": {
      if (!itemDate || !range.years || range.years.length === 0) return true;
      const itemYear = itemDate.getFullYear();
      if (range.years.includes(itemYear)) return true;
      const minYear = Math.min(...range.years);
      if (itemYear < minYear) return "stop";
      return false;
    }
    default:
      return true;
  }
}

// ============================================================
// onclick에서 URL 추출
// ============================================================

function tryExtractUrlFromOnclick(onclick: string, downloadUrlPattern?: string, pageUrl?: string): string | null {
  if (!onclick) return null;

  // ============================================================
  // 한국전력공사(KEPCO) 전용 패턴
  // G_FILE.downloadFile(atchFileId, fileSn, 'fileName')
  // G_FILE.downloadFilePath('path', 'fileName')
  // ============================================================
  const kepcoDownloadMatch = onclick.match(/G_FILE\.downloadFile\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?/i);
  if (kepcoDownloadMatch) {
    const atchFileId = kepcoDownloadMatch[1];
    const fileSn = kepcoDownloadMatch[2];
    // KEPCO 전용 다운로드 URL 패턴: kepco: 접두사로 KEPCO POST 요청임을 표시
    return `kepco:/portal/fileDown/download.do|atchFileId=${atchFileId}&fileSn=${fileSn}`;
  }

  const kepcoFilePathMatch = onclick.match(/G_FILE\.downloadFilePath\s*\(\s*['"]([^'"]+)['"]/i);
  if (kepcoFilePathMatch) {
    const filePath = kepcoFilePathMatch[1];
    // 파일 경로를 직접 반환
    return filePath.startsWith("/") ? filePath : `/${filePath}`;
  }

  // ============================================================
  // 한강유역환경청(mcee.go.kr) 패턴: fileDownload('fileId', 'fileSeq')
  // 실제 URL: POST /hg/file/readDownloadFile.do, body: fileId=xxx&fileSeq=xxx&siteId=25
  // ============================================================
  const mceeFileDownloadMatch = onclick.match(/fileDownload\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/i);
  if (mceeFileDownloadMatch) {
    const fileId = mceeFileDownloadMatch[1];
    const fileSeq = mceeFileDownloadMatch[2];
    // mcee.go.kr 사이트이거나 전자정부 표준 패턴인 경우 POST 방식 사용
    if (pageUrl?.includes("mcee.go.kr") || pageUrl?.includes("/hg/")) {
      // post: 접두사로 POST 요청임을 표시, | 뒤에 body 데이터
      return `post:/hg/file/readDownloadFile.do|fileId=${fileId}&fileSeq=${fileSeq}&siteId=25`;
    }
    // 기타 사이트는 전자정부프레임워크 표준 패턴
    return `/cmm/fms/FileDown.do?atchFileId=${fileId}&fileSn=${fileSeq}`;
  }

  // 국립환경과학원 패턴: fnZipFileDownload('fileNo', '파일명') → /common/kor/board/comBbsFileDownLoad.do?fileNo=xxx
  const zipDownloadMatch = onclick.match(/fnZipFileDownload\s*\(\s*['"](\d+)['"]/i);
  if (zipDownloadMatch) {
    const fileNo = zipDownloadMatch[1];
    return `/common/kor/board/comBbsFileDownLoad.do?fileNo=${fileNo}`;
  }

  // fnFileDownload, fnBbsFileDownload 등 유사 패턴
  const bbsFileDownMatch = onclick.match(/fn(?:Bbs)?FileDownload\s*\(\s*['"](\d+)['"]/i);
  if (bbsFileDownMatch) {
    const fileNo = bbsFileDownMatch[1];
    return `/common/kor/board/comBbsFileDownLoad.do?fileNo=${fileNo}`;
  }

  // ajaxDownload 패턴: ajaxDownload('url', 'fileName') 또는 ajaxDownload('fileId')
  const ajaxDownloadMatch = onclick.match(/ajaxDownload\s*\(\s*['"]([^'"]+)['"]/i);
  if (ajaxDownloadMatch) {
    const param = ajaxDownloadMatch[1];
    // URL 형태인지 ID 형태인지 확인
    if (param.startsWith("/") || param.startsWith("http")) {
      return param;
    }
    // 숫자만 있으면 fileId로 간주
    if (/^\d+$/.test(param)) {
      return `/download?fileId=${param}`;
    }
    return param;
  }

  // 산업통상부 패턴 (3개 해시): fn_fileDown('hash1', 'hash2', 'hash3') → /attach/down/hash1/hash2/hash3
  // 또는 기타 함수명: download('h1','h2','h3'), fileDownload('h1','h2','h3') 등
  const motirPattern = onclick.match(
    /(?:fn_)?(?:file)?[Dd]own(?:load)?\s*\(\s*['"]([a-f0-9]{20,})['"][\s,]+['"]([a-f0-9]{20,})['"][\s,]+['"]([a-f0-9]{20,})['"]\s*\)/i
  );
  if (motirPattern) {
    const [, hash1, hash2, hash3] = motirPattern;
    return `/attach/down/${hash1}/${hash2}/${hash3}`;
  }

  // 일반 URL 패턴
  const m1 = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
  if (m1?.[1] && !m1[1].includes("void")) return m1[1];

  const m2 = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m2?.[1]) return m2[1];

  const m3 = onclick.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
  if (m3?.[1]) return m3[1];

  // 범용 다운로드 함수 패턴: fnDownload('param1','param2'), fileDown('param1'), download('id') 등
  const downloadFuncPatterns = [
    /fnDownload\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i,
    /fn_?[Dd]ownload\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)/i,
    /file[Dd]own(?:load)?\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)/i,
    /[Dd]ownload\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)/i,
    /getFile\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)/i,
  ];

  for (const pattern of downloadFuncPatterns) {
    const match = onclick.match(pattern);
    if (match) {
      const param1 = match[1];
      const param2 = match[2];

      // downloadUrlPattern이 제공되면 해당 패턴 사용
      if (downloadUrlPattern) {
        let url = downloadUrlPattern;
        url = url.replace(/\{param1\}|\{fileId\}|\{atchFileId\}/gi, param1);
        if (param2) {
          url = url.replace(/\{param2\}|\{fileKey\}|\{fileSn\}|\{fileSeq\}/gi, param2);
        }
        return url;
      }

      // 패턴이 없으면 기본 패턴 시도 - 한국 정부 사이트 표준 패턴 사용
      if (param2) {
        // 두 파라미터: 전자정부프레임워크 표준 패턴
        return `/cmm/fms/FileDown.do?atchFileId=${param1}&fileSn=${param2}`;
      } else {
        return `/download?fileId=${param1}`;
      }
    }
  }

  // fileDownload('atchFileId', 'fileSn') 패턴 - 전자정부프레임워크 표준
  const fileDownloadMatch = onclick.match(/fileDownload\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/i);
  if (fileDownloadMatch) {
    const atchFileId = fileDownloadMatch[1];
    const fileSn = fileDownloadMatch[2];
    return `/cmm/fms/FileDown.do?atchFileId=${atchFileId}&fileSn=${fileSn}`;
  }

  // 기타 다운로드 함수 패턴
  const funcPatterns = [
    /fn_fileDown\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
    /FileDown\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
  ];

  for (const pattern of funcPatterns) {
    const match = onclick.match(pattern);
    if (match?.[1]) {
      const fileId = match[1];
      const fileName = match[2] || "";
      if (/^\d+$/.test(fileId)) {
        return `/cmm/fms/FileDown.do?atchFileId=${fileId}${fileName ? `&fileSn=${fileName}` : ""}`;
      }
      return fileId;
    }
  }

  return null;
}

function looksLikeAttachmentName(text: string): boolean {
  const t = (text || "").toLowerCase();
  const exts = [
    ".hwp", ".hwpx", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv",
    ".ppt", ".pptx", ".zip", ".rar", ".7z"
  ];
  if (exts.some((e) => t.includes(e))) return true;
  return /\(\s*[\d.]+\s*[kmg]b\s*\)\s*$/i.test(text || "");
}

// ============================================================
// 웹 설정 타입
// ============================================================

interface WebConfig {
  rendering?: "static_html" | "dynamic_js";
  list?: {
    container_selector?: string;
    item_selector?: string;
    pagination?: {
      type: "page_param" | "offset_param" | "next_button" | "javascript" | "none";
      param?: string;
      selector?: string;
      start?: number;
      step?: number;
      max_pages?: number;
      onclick_pattern?: string;
    };
  };
  parse_rules?: {
    title?: string;
    date?: string;
    link?: string;
    author?: string;
  };
  detail?: {
    content_selector?: string;
    title_selector?: string;
    attachments_selector?: string;
  };
  attachments?: {
    enabled?: boolean;
    collect_all?: boolean;
    file_types?: string[];
    selector?: string;
    download_url_pattern?: string;  // 다운로드 URL 패턴 (예: /file/download/{fileId}/{fileKey})
  };
  collection_range?: CollectionRange;
  collect_body?: boolean;
}

// ============================================================
// 날짜 패턴 감지 유틸리티
// ============================================================

// 날짜로 인식할 수 있는 다양한 패턴들
const DATE_PATTERNS: RegExp[] = [
  // YYYY-MM-DD 또는 YYYY.MM.DD 또는 YYYY/MM/DD
  /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/,
  // YYYY-MM-DD ~ YYYY-MM-DD (기간, 하이픈/슬래시)
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*~\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
  // YYYY.MM.DD ~ YYYY.MM.DD (기간, 점)
  /^\d{4}\.\d{1,2}\.\d{1,2}\s*~\s*\d{4}\.\d{1,2}\.\d{1,2}$/,
  // YYYY. MM. DD ~ YYYY. MM. DD (기간, 공백 포함)
  /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*~\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?$/,
  // YYYY. MM. DD (공백 포함)
  /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?$/,
  // YYYY년 MM월 DD일
  /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일$/,
  // YYYY년 MM월 DD일 ~ YYYY년 MM월 DD일 (기간)
  /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*~\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일$/,
  // MM-DD 또는 MM.DD 또는 MM/DD (년도 생략)
  /^\d{1,2}[-./]\d{1,2}$/,
  // YYYYMMDD (연속 숫자)
  /^\d{8}$/,
  // DD.MM.YYYY 또는 DD-MM-YYYY (유럽식)
  /^\d{1,2}[-./]\d{1,2}[-./]\d{4}$/,
];

/**
 * 텍스트가 날짜 패턴과 일치하는지 확인
 */
function isDatePattern(text: string): boolean {
  const cleaned = text.trim();
  // 너무 짧거나 긴 텍스트는 날짜가 아님
  if (cleaned.length < 5 || cleaned.length > 30) return false;
  // 숫자가 전혀 없으면 날짜가 아님
  if (!/\d/.test(cleaned)) return false;

  return DATE_PATTERNS.some(pattern => pattern.test(cleaned));
}

/**
 * 행(tr/ul)의 모든 셀/요소에서 날짜 패턴을 찾아 반환
 * 날짜 선택자가 없거나 선택자로 날짜를 찾지 못한 경우 사용
 */
function findDateInRow($: cheerio.CheerioAPI, $row: cheerio.Cheerio<cheerio.Element>): string {
  let foundDate = "";

  // 1. 한강유역환경청 등 정부 사이트 패턴: li.size10p (날짜 열)
  $row.find("li.size10p, li.date, li[class*='date']").each((_, el) => {
    if (foundDate) return;
    const text = cleanText($(el).text());
    if (isDatePattern(text)) {
      foundDate = text;
      return false;
    }
  });
  if (foundDate) return foundDate;

  // 2. 모든 td 셀을 순회
  $row.find("td").each((_, cell) => {
    if (foundDate) return; // 이미 찾았으면 중단

    const text = cleanText($(cell).text());
    if (isDatePattern(text)) {
      foundDate = text;
      return false; // each 루프 중단
    }
  });
  if (foundDate) return foundDate;

  // 3. li 요소에서 날짜 패턴 찾기 (ul 기반 게시판)
  $row.find("li").each((_, el) => {
    if (foundDate) return;
    const text = cleanText($(el).text());
    // li 텍스트가 날짜 패턴만 포함하는 경우 (제목 등과 구분)
    if (isDatePattern(text) && text.length < 20) {
      foundDate = text;
      return false;
    }
  });
  if (foundDate) return foundDate;

  // 4. span, div, time 등에서 시도
  $row.find("span, div, time").each((_, el) => {
    if (foundDate) return;

    const text = cleanText($(el).text());
    if (isDatePattern(text)) {
      foundDate = text;
      return false;
    }
  });

  return foundDate;
}

// ============================================================
// 페이지네이션 파라미터 자동 감지
// ============================================================

// 일반적인 페이지네이션 파라미터 목록 (우선순위 순)
const COMMON_PAGE_PARAMS = [
  "cpage", "pageIndex", "page", "pageNo", "pn", "p", "pg",
  "pageNum", "currentPage", "npage", "pageno", "Page"
];

/**
 * URL에서 페이지네이션 파라미터를 감지
 */
function detectPaginationParam(url: string, html?: string): string | null {
  try {
    const urlObj = new URL(url);

    // 1. URL에서 직접 파라미터 찾기
    for (const param of COMMON_PAGE_PARAMS) {
      if (urlObj.searchParams.has(param)) {
        return param;
      }
    }

    // 2. HTML의 onclick에서 파라미터 찾기
    if (html) {
      // onclick 속성에서 페이지 파라미터 추출
      const onclickMatches = html.match(/onclick\s*=\s*["'][^"']*(?:cpage|pageIndex|page|pageNo)=(\d+)[^"']*/gi);
      if (onclickMatches) {
        for (const param of COMMON_PAGE_PARAMS) {
          if (new RegExp(`${param}=\\d+`, "i").test(onclickMatches[0])) {
            return param;
          }
        }
      }

      // location.href에서 페이지 파라미터 추출
      const hrefMatches = html.match(/location\.href\s*=\s*['"][^'"]*(?:cpage|pageIndex|page|pageNo)=\d+/gi);
      if (hrefMatches) {
        for (const param of COMMON_PAGE_PARAMS) {
          if (new RegExp(`${param}=\\d+`, "i").test(hrefMatches[0])) {
            return param;
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 목록 페이지 파싱
// ============================================================

interface ScrapingItem {
  title: string;
  link: string;
  date?: string;
  author?: string;
}

function parseListPage(
  html: string,
  baseUrl: string,
  config: WebConfig
): { items: ScrapingItem[]; $: cheerio.CheerioAPI } {
  const $ = cheerio.load(html);
  const items: ScrapingItem[] = [];

  const containerSelector = config.list?.container_selector;
  const itemSelector = config.list?.item_selector || "tr";
  const titleSelector = config.parse_rules?.title || "a";
  const dateSelector = config.parse_rules?.date;
  const linkSelector = config.parse_rules?.link || "a";

  const $container = containerSelector ? $(containerSelector) : $("body");
  const $items = $container.find(itemSelector);

  // 기본 URL 파싱 (onclick에서 URL 구성용)
  let baseUrlObj: URL | null = null;
  try {
    baseUrlObj = new URL(baseUrl);
  } catch { /* ignore */ }

  // 디버그: 찾은 항목 수 로깅
  console.log(`[parseListPage] container="${containerSelector}", items="${itemSelector}", found=${$items.length}`);

  $items.each((idx, el) => {
    const $item = $(el);
    const $titleEl = $item.find(titleSelector).first();
    const title = cleanText($titleEl.text());

    const $linkEl = $item.find(linkSelector).first();
    let link = $linkEl.attr("href") || "";
    const onclick = $linkEl.attr("onclick") || $item.attr("onclick") || "";

    // 디버그: 처음 3개 항목의 onclick 속성 로깅
    if (idx < 3) {
      console.log(`[parseListPage] item[${idx}] title="${title.slice(0, 30)}", href="${link}", onclick="${onclick.slice(0, 100)}"`);
    }

    // href가 없거나 #으로 시작하는 경우 onclick에서 URL 추출
    if (!link || link.startsWith("#") || link === "javascript:void(0)" || link.startsWith("javascript:")) {
      // 1. 직접 URL이 있는 패턴: location.href='...', window.open('...')
      const urlMatch = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
      if (urlMatch) {
        link = urlMatch[1];
      }

      // 2. 산업통상부 패턴: article.view('articleId')
      if (!link || link.startsWith("#")) {
        const articleViewMatch = onclick.match(/article\.view\s*\(\s*['"](\d+)['"]\s*\)/i);
        if (articleViewMatch && baseUrlObj) {
          // /kor/article/ATCL3f49a5a8c → /kor/article/ATCL3f49a5a8c/171444/view
          const articleId = articleViewMatch[1];
          link = `${baseUrlObj.pathname}/${articleId}/view`;
        }
      }

      // 3. 정부 BBS 패턴: fn_egov_inqire_notice('nttSn'), goView('id')
      if (!link || link.startsWith("#")) {
        const egovMatch = onclick.match(/fn_egov_inqire_notice\s*\(\s*(?:this\s*,\s*)?['"]?(\d+)['"]?/i);
        if (egovMatch && baseUrlObj) {
          const nttSn = egovMatch[1];
          const bbsId = baseUrlObj.searchParams.get("bbsId") || "";
          const menuNo = baseUrlObj.searchParams.get("menuNo");
          const basePath = baseUrlObj.pathname.replace(/\.do.*$/, "View.do");
          link = `${basePath}?bbsId=${bbsId}&nttSn=${nttSn}${menuNo ? `&menuNo=${menuNo}` : ""}`;
        }
      }

      // 4. 일반 goView, fnView 패턴
      if (!link || link.startsWith("#")) {
        const viewMatch = onclick.match(/(?:goView|fnView|goDetail|viewDetail)\s*\(\s*['"]?(\d+)['"]?/i);
        if (viewMatch && baseUrlObj) {
          const id = viewMatch[1];
          const basePath = baseUrlObj.pathname.replace(/\.do.*$/, "View.do");
          link = `${basePath}?nttSn=${id}`;
        }
      }

      // 5. 중소벤처기업부 등 전자정부프레임워크 패턴: doBbsFView('cbIdx', 'bcIdx', ...)
      if (!link || link.startsWith("#")) {
        const bbsFViewMatch = onclick.match(/doBbsFView\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/i);
        if (bbsFViewMatch && baseUrlObj) {
          const cbIdx = bbsFViewMatch[1];
          const bcIdx = bbsFViewMatch[2];
          // /site/smba/ex/bbs/List.do → /site/smba/ex/bbs/View.do
          let basePath = baseUrlObj.pathname;
          if (basePath.includes("List.do")) {
            basePath = basePath.replace("List.do", "View.do");
          } else if (basePath.includes("list.do")) {
            basePath = basePath.replace("list.do", "View.do");
          }
          link = `${basePath}?cbIdx=${cbIdx}&bcIdx=${bcIdx}`;
        }
      }

      // 6. KEPCO 패턴: fn_Detail('boardMngNo', 'boardNo')
      if (!link || link.startsWith("#") || link.startsWith("javascript:")) {
        const kepcoMatch = onclick.match(/fn_Detail\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/i);
        if (kepcoMatch && baseUrlObj) {
          const boardMngNo = kepcoMatch[1];
          const boardNo = kepcoMatch[2];
          // boardList.do → boardView.do
          let basePath = baseUrlObj.pathname;
          if (basePath.includes("List.do")) {
            basePath = basePath.replace("List.do", "View.do");
          } else if (basePath.includes("list.do")) {
            basePath = basePath.replace("list.do", "View.do");
          }
          link = `${basePath}?boardMngNo=${boardMngNo}&boardNo=${boardNo}`;
        }
      }

      // 7. 국립환경과학원 패턴: fnMoveDetail('id', this)
      if (!link || link.startsWith("#") || link.startsWith("javascript:")) {
        const moveDetailMatch = onclick.match(/fnMoveDetail\s*\(\s*['"](\d+)['"]/i);
        if (moveDetailMatch && baseUrlObj) {
          const pstNo = moveDetailMatch[1];
          const bbsNo = baseUrlObj.searchParams.get("bbsNo") || "";
          const menuNo = baseUrlObj.searchParams.get("menuNo") || "";
          // comBbsList.do → comBbsDetail.do (NIER 전용)
          let basePath = baseUrlObj.pathname;
          if (basePath.includes("List.do")) {
            basePath = basePath.replace("List.do", "Detail.do");
          } else if (basePath.includes("list.do")) {
            basePath = basePath.replace("list.do", "Detail.do");
          }
          link = `${basePath}?bbsNo=${bbsNo}&pstNo=${pstNo}${menuNo ? `&menuNo=${menuNo}` : ""}`;
        }
      }

      // 8. 일반 fnDetail, goToDetail 패턴
      if (!link || link.startsWith("#") || link.startsWith("javascript:")) {
        const detailFnMatch = onclick.match(/(?:goTo|fn)(?:Detail|View)\s*\(\s*['"]?(\d+)['"]?/i);
        if (detailFnMatch && baseUrlObj) {
          const id = detailFnMatch[1];
          let basePath = baseUrlObj.pathname;
          if (basePath.includes("List.do")) {
            basePath = basePath.replace("List.do", "View.do");
          } else if (basePath.includes("list.do")) {
            basePath = basePath.replace("list.do", "View.do");
          }
          link = `${basePath}?seq=${id}`;
        }
      }
    }

    // ============================================================
    // 국립환경과학원(NIER) 목록 특이 케이스 보정
    // - 목록에서 "파일 다운로드" 링크를 상세 링크로 오인하는 경우
    // - comBbsFileDownLoad.do → comBbsDetail.do?pstNo=...
    // ============================================================
    const isNierDownloadLink = link.includes("comBbsFileDownLoad.do");
    if ((isNierDownloadLink || title === "파일 다운로드") && baseUrlObj) {
      let detailLink = "";

      // 1) 상세 링크가 별도 href로 존재하는 경우
      const $detailAnchor = $item.find("a[href*='comBbsDetail.do'], a[href*='comBbsView.do']").first();
      detailLink = $detailAnchor.attr("href") || "";

      // 2) onclick fnMoveDetail('pstNo') 패턴
      if (!detailLink) {
        const $onclickAnchor = $item.find("a[onclick*='fnMoveDetail'], a[onclick*='fnDetail']").first();
        const detailOnclick = $onclickAnchor.attr("onclick") || "";
        const moveDetailMatch = detailOnclick.match(/fnMoveDetail\s*\(\s*['"](\d+)['"]/i)
          || detailOnclick.match(/fnDetail\s*\(\s*['"](\d+)['"]/i);
        if (moveDetailMatch?.[1]) {
          const pstNo = moveDetailMatch[1];
          const bbsNo = baseUrlObj.searchParams.get("bbsNo") || "";
          const menuNo = baseUrlObj.searchParams.get("menuNo");
          let basePath = baseUrlObj.pathname;
          if (basePath.includes("List.do")) {
            basePath = basePath.replace("List.do", "Detail.do");
          } else if (basePath.includes("list.do")) {
            basePath = basePath.replace("list.do", "Detail.do");
          }
          detailLink = `${basePath}?bbsNo=${bbsNo}&pstNo=${pstNo}${menuNo ? `&menuNo=${menuNo}` : ""}`;
        }
      }

      if (detailLink) {
        link = detailLink;
      }
    }

    // href가 javascript:fn_Detail 형태인 경우도 처리
    if (link.startsWith("javascript:fn_Detail")) {
      const kepcoHrefMatch = link.match(/fn_Detail\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/i);
      if (kepcoHrefMatch && baseUrlObj) {
        const boardMngNo = kepcoHrefMatch[1];
        const boardNo = kepcoHrefMatch[2];
        let basePath = baseUrlObj.pathname;
        if (basePath.includes("List.do")) {
          basePath = basePath.replace("List.do", "View.do");
        } else if (basePath.includes("list.do")) {
          basePath = basePath.replace("list.do", "View.do");
        }
        link = `${basePath}?boardMngNo=${boardMngNo}&boardNo=${boardNo}`;
      }
    }

    if (link && !link.startsWith("#")) {
      link = resolveUrl(baseUrl, link);
    }

    let date = "";

    // 1. 선택자가 있으면 먼저 시도
    if (dateSelector) {
      const $dateEl = $item.find(dateSelector).first();
      const selectorDate = cleanText($dateEl.text());
      // 선택자로 찾은 값이 날짜 패턴인지 검증
      if (isDatePattern(selectorDate)) {
        date = selectorDate;
      }
    }

    // 2. 선택자로 유효한 날짜를 못 찾으면 패턴 기반 자동 감지
    if (!date) {
      date = findDateInRow($, $item);
    }

    // 디버그: 첫 3개 항목에 대해 날짜 정보 출력
    if (items.length < 3) {
      console.log(`[parseListPage] item[${items.length}] title="${title.slice(0, 40)}...", date="${date}", href="${link?.slice(0, 30) || '#'}..."`);
    }

    if (title && title.length >= 2 && link && !link.startsWith("#")) {
      items.push({ title, link, date });
    }
  });

  return { items, $ };
}

// ============================================================
// 상세 페이지 파싱 및 첨부파일 추출
// ============================================================

interface AttachmentInfo {
  fileName: string;
  downloadUrl: string;
}

interface DetailPageResult {
  content: string;
  attachments: AttachmentInfo[];
}

async function parseDetailPage(
  url: string,
  config: WebConfig,
  collectionTargets?: CollectionTargets,
  accessMode?: string,
  browserSettings?: BrowserSettings
): Promise<DetailPageResult> {
  let html: string;
  let browserAttachments: AttachmentInfo[] = [];

  // 동적 JS 렌더링 모드: Playwright 사용
  if (accessMode === "dynamic_js") {
    const browserConfig: BrowserConfig = {
      browserType: browserSettings?.browser_type || "chromium",
      headless: browserSettings?.headless !== false,
      timeout: 60000, // NIER 등 불안정한 서버 대비 60초
    };

    // 국민참여입법센터 전용 처리
    if (url.includes("opinion.lawmaking.go.kr")) {
      const result = await extractLawmakingAttachments(url, browserConfig);
      html = result.html;
      browserAttachments = result.attachments;
    } else {
      // 일반 사이트
      const result = await extractAttachmentsWithBrowser(url, browserConfig);
      html = result.html;
      browserAttachments = result.attachments;
    }
  } else {
    // 정적 HTML 또는 다른 모드
    html = await fetchHtml(url, 2, accessMode || "static_html", browserSettings);
  }

  const $ = cheerio.load(html);

  let content = "";
  const shouldCollectBody = collectionTargets?.title_body !== false && config.collect_body;

  if (shouldCollectBody) {
    const contentSelectors = [
      config.detail?.content_selector,
      ".view_con", ".view_cont", ".view_content", ".viewContent",
      ".board_view_content", ".bbs_content", ".bbsContent",
      ".article_content", ".article_body", ".articleBody",
      ".post_content", ".post_body",
      "article .content", "article .body",
      ".content_area", "#content .text",
      "article", ".content", "#content",
    ].filter(Boolean);

    for (const selector of contentSelectors) {
      const $content = $(selector as string).first();
      if ($content.length > 0) {
        $content.find("script, style, nav, header, footer, .skip, .blind").remove();
        const text = cleanText($content.text());
        if (text.length > 50 && !text.startsWith("주메뉴") && !text.startsWith("바로가기")) {
          content = text;
          break;
        }
      }
    }

    if (!content) {
      $("script, style, nav, header, footer, .gnb, .lnb, .skip, .blind, #header, #footer").remove();
      let bodyText = cleanText($("body").text());
      const mainIdx = bodyText.indexOf("본문내용");
      if (mainIdx > 0 && mainIdx < 200) {
        bodyText = bodyText.slice(mainIdx + 4).trim();
      }
      content = bodyText.slice(0, 5000);
    }
  }

  const attachments: AttachmentInfo[] = [];
  const seenUrls = new Set<string>();

  const shouldCollectAttachments = collectionTargets?.attachments?.enabled !== false &&
    config.attachments?.enabled;

  // allowedTypes와 isAllowedAttachment를 블록 바깥에서 정의 (나중에 browserAttachments 필터링에 사용)
  let allowedTypes: string[] = [];

  if (collectionTargets?.attachments?.all || config.attachments?.collect_all) {
    allowedTypes = ["hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "zip", "rar", "7z"];
  } else if (shouldCollectAttachments) {
    const attConfig = collectionTargets?.attachments;
    if (attConfig?.hwpx) allowedTypes.push("hwp", "hwpx");
    if (attConfig?.pdf) allowedTypes.push("pdf");
    if (attConfig?.docx) allowedTypes.push("doc", "docx");
    if (attConfig?.xlsx) allowedTypes.push("xls", "xlsx", "csv");

    if (allowedTypes.length === 0 && config.attachments?.file_types) {
      allowedTypes = config.attachments.file_types;
    }

    if (allowedTypes.length === 0) {
      allowedTypes = ["hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "zip", "rar", "7z"];
    }
  }

  const isAllowedAttachment = (fileNameRaw: string, downloadUrl: string): boolean => {
    if (allowedTypes.length === 0) return true;

    const fileExt = fileNameRaw.split(".").pop()?.toLowerCase() || "";
    const urlExt = downloadUrl.split(".").pop()?.split("?")[0]?.toLowerCase() || "";

    // 동적 다운로드 URL 패턴 허용 (.do, .aspx, .php 등 서버측 경로)
    // 이런 URL은 실제 파일을 다운로드하므로 확장자 체크 건너뜀
    const dynamicExtensions = ["do", "aspx", "php", "asp", "jsp", "action"];
    const urlLower = downloadUrl.toLowerCase();
    const isDynamicDownloadUrl =
      dynamicExtensions.includes(urlExt) ||
      urlLower.includes("download") ||
      urlLower.includes("filedown") ||
      urlLower.includes("attach") ||
      urlLower.includes("/file/");

    if (isDynamicDownloadUrl) {
      // 파일명에 확장자가 있으면 체크, 없으면 허용
      if (fileExt && allowedTypes.includes(fileExt)) {
        return true;
      }
      // 파일명에 확장자 없거나 알 수 없는 경우 - 다운로드 허용 (Content-Disposition에서 확인 가능)
      if (!fileExt || fileExt.length > 5 || !fileExt.match(/^[a-z0-9]+$/)) {
        return true;
      }
    }

    return allowedTypes.some((ext) => fileExt === ext || urlExt === ext);
  };

  if (shouldCollectAttachments) {

    const pushAttachment = (fileNameRaw: string, urlRaw: string, source?: string) => {
      if (!urlRaw) return;

      // javascript: URL 필터링 (바로보기 버튼 등)
      if (urlRaw.startsWith("javascript:")) {
        return;
      }

      // 바로보기 버튼 및 뷰어 URL 필터링 (실제 다운로드가 아님)
      const rawLower = urlRaw.toLowerCase();
      const nameLower = (fileNameRaw || "").toLowerCase();
      if (nameLower.includes("바로보기") || nameLower === "바로보기" ||
        rawLower.includes("/attach/viewer/") ||  // 산업통상부 뷰어 URL 명시적 제외
        rawLower.includes("viewer.") ||
        rawLower.includes("preview")) {
        return;
      }

      const downloadUrl = resolveUrl(url, urlRaw);
      if (!downloadUrl) return;
      if (seenUrls.has(downloadUrl)) return;

      // 뷰어 URL 재확인 (/attach/viewer/ 명시적 제외)
      if (downloadUrl.includes("/attach/viewer/") ||
        downloadUrl.includes("viewer.aspx") ||
        downloadUrl.includes("preview")) {
        return;
      }

      seenUrls.add(downloadUrl);

      // 디버그 로그 (첨부파일 추출 시점)
      console.log(`[ATTACH] source=${source || "unknown"}, raw=${urlRaw.slice(0, 100)}, resolved=${downloadUrl.slice(0, 150)}`);

      let fileName = cleanText(fileNameRaw);
      if (!fileName || fileName.length < 3) {
        try {
          const u = new URL(downloadUrl);
          const last = u.pathname.split("/").pop() || "";
          fileName = decodeURIComponent(last);
          if (!fileName || fileName.length < 3) {
            const qp =
              u.searchParams.get("fileName") ||
              u.searchParams.get("file_name") ||
              u.searchParams.get("filename") ||
              u.searchParams.get("name");
            if (qp) fileName = decodeURIComponent(qp);
          }
        } catch {
          fileName = urlRaw.split("/").pop()?.split("?")[0] || "unknown";
        }
      }

      // 파일명에서 용량 표시 제거: (230KB), [230 KB], (1.2MB), (291,517 Byte) 등
      fileName = fileName
        .replace(/\s*\([\d,]+\s*Bytes?\)\s*$/i, "")  // (291,517 Byte), (1024 Bytes)
        .replace(/\s*\([^)]*[KMG]B\)\s*$/i, "")  // 소괄호: (230KB), (2.5 MB)
        .replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "") // 대괄호: [230 KB]
        .replace(/\s*[\[\(][\d.,]+\s*[KMG]?B[\]\)]\s*$/i, "") // 숫자+단위: [230 KB], (1.2MB)
        .trim();
      if (!fileName) fileName = "unknown";

      if (isAllowedAttachment(fileName, downloadUrl)) {
        attachments.push({ fileName, downloadUrl });
      }
    };

    const extSelectors = allowedTypes.map((ext) => `a[href*='.${ext}']`);
    const downloadSelectors = [
      // ============================================================
      // 국립환경과학원(NIER) 전용 패턴 - 최우선
      // a.fileDownload[data-no][data-seq] 형식
      // ============================================================
      "a.fileDownload[data-no][data-seq]",
      // ============================================================
      // 한국전력공사(KEPCO) 전용 패턴
      // h4.detail-file-title 아래의 G_FILE.downloadFile 링크
      // ============================================================
      "a[href*='G_FILE.downloadFile']",
      "a[href*='G_FILE.downloadFilePath']",
      ".detail-file-wrap a[href*='javascript:G_FILE']",
      // 산업통상부 다운로드 버튼 (onclick에 /attach/down/ URL 포함) - 최우선
      "a[onclick*='/attach/down/']",
      "a[onclick*='location.href'][onclick*='/attach/']",
      // 국립환경과학원 패턴: fnZipFileDownload, ajaxDownload
      "a[onclick*='fnZipFileDownload']",
      "a[onclick*='fnFileDownload']",
      "a[onclick*='fnBbsFileDownload']",
      "a[onclick*='ajaxDownload']",
      // href에 다운로드 관련 URL이 있는 링크 (대소문자 모두 포함)
      "a[href*='readDownloadFile']", "a[href*='downloadFile']",
      "a[href*='download']", "a[href*='Download']",
      "a[href*='fileDown']", "a[href*='filedown']", "a[href*='file_down']",
      "a[href*='atchFileDown']", "a[href*='AttachDown']", "a[href*='fileId=']",
      // 전자정부 프레임워크 .do 패턴 (국립공원공단 등)
      "a[href*='filedown.do']", "a[href*='fileDown.do']",
      "a[href*='download.do']", "a[href*='Download.do']",
      // /attach/down/ 직접 href (바로보기 viewer 제외)
      "a[href*='/attach/down/']",
      ".fileAttach a[href]", ".file_info a[href]",
      // onclick 기반 다운로드 버튼 (범용)
      "a[onclick*='download']", "a[onclick*='fileDown']",
      "button[onclick*='Download']", "button[onclick*='download']",
      "button[onclick*='fileDown']", "button[onclick*='fn_Download']",
      "input[onclick*='fileDownload']", "input[onclick*='Download']",
      "button.file_link", "button.btn_download",
      // 파일 타입별 클래스 (한국에너지공단 등: hwp_file, pdf_file, doc_file)
      "a[class*='_file']", "a[class*='file_']",
      "a.hwp_file", "a.pdf_file", "a.doc_file", "a.xls_file", "a.ppt_file",
      // 컨테이너 기반
      ".file_list a", ".attach a", ".file a", ".file_area a",
      ".attachment a", ".attachFile a", ".atch_file a",
      ".fileList a", ".file-list a", ".download-list a",
      "ul.file li a", "div.file a", "table.file a",
      // 첨부파일 영역 내 버튼
      ".file_area button", ".attach button", ".attachment button",
      // onclick 기반 (바로보기 제외)
      "a[onclick*='Down']:not([class*='magnifier']):not([class*='Refer'])",
      "button[onclick*='Down']:not([class*='magnifier']):not([class*='Refer'])",
    ];

    if (config.attachments?.selector) {
      downloadSelectors.push(config.attachments.selector);
    }

    // ============================================================
    // 국립환경과학원(NIER) 전용 처리: a.fileDownload[data-no][data-seq]만 사용
    // 일반 다운로드 선택자 사용 시 페이지 공통 영역의 불필요한 파일이 잡힘
    // ============================================================
    const isNierSite = url.includes('nier.go.kr');
    let allSelectors: string;

    if (isNierSite) {
      // NIER: 전용 선택자만 사용 (공통 영역 파일 제외)
      allSelectors = "a.fileDownload[data-no][data-seq]";
      console.log(`[ATTACH-DEBUG] NIER 전용 선택자 사용: ${allSelectors}`);
    } else {
      allSelectors = [...extSelectors, ...downloadSelectors].join(", ");
    }

    // 다운로드 URL 패턴 가져오기
    const downloadUrlPattern = config.attachments?.download_url_pattern;

    // 디버그: 선택자로 찾은 요소 수
    const foundElements = $(allSelectors);
    console.log(`[ATTACH-DEBUG] 선택자로 찾은 요소: ${foundElements.length}개`);

    $(allSelectors).each((idx, el) => {
      const $el = $(el);
      const tagName = el.tagName?.toLowerCase() || "";
      let href = $el.attr("href") || "";
      const onclick = $el.attr("onclick") || "";
      const elClass = $el.attr("class") || "";
      const elText = $el.text().trim().slice(0, 50);
      // NIER 전용 data 속성
      const dataNo = $el.attr("data-no") || "";
      const dataSeq = $el.attr("data-seq") || "";

      // 디버그: 처음 5개 요소의 속성 로깅
      if (idx < 5) {
        console.log(`[ATTACH-DEBUG] [${idx}] tag=${tagName}, class="${elClass}", href="${href.slice(0, 80)}", onclick="${onclick.slice(0, 100)}", text="${elText}", data-no="${dataNo}", data-seq="${dataSeq}"`);
      }

      // ============================================================
      // 국립환경과학원(NIER) 패턴: a.fileDownload[data-no][data-seq]
      // POST /common/comDownloadFile.do, atchFileNo=xxx&fileSn=xxx
      // ============================================================
      if (dataNo && dataSeq) {
        try {
          // NIER POST 방식 다운로드: atchFileNo, atchFileSeq 파라미터 사용
          href = `post:/common/comDownloadFile.do|atchFileNo=${dataNo}&atchFileSeq=${dataSeq}`;
          if (idx < 5) {
            console.log(`[ATTACH-DEBUG] [${idx}] NIER POST 추출 결과: ${href}`);
          }
        } catch (e) {
          console.log(`[ATTACH-DEBUG] [${idx}] NIER URL 생성 실패: ${e}`);
        }
      }
      // KEPCO 패턴: href에 G_FILE.downloadFile이 직접 포함된 경우
      else if (href.includes("G_FILE.downloadFile") || href.includes("G_FILE.downloadFilePath")) {
        // javascript:G_FILE.downloadFile(123, 1, 'filename') 형태에서 URL 추출
        const extracted = tryExtractUrlFromOnclick(href, downloadUrlPattern, url);
        if (idx < 5) {
          console.log(`[ATTACH-DEBUG] [${idx}] KEPCO href 추출 결과: ${extracted || "null"}`);
        }
        if (extracted) href = extracted;
      }
      // button 또는 javascript: href인 경우 onclick에서 URL 추출
      else if ((!href || href.startsWith("javascript:") || href === "#" || tagName === "button") && onclick) {
        const extracted = tryExtractUrlFromOnclick(onclick, downloadUrlPattern, url);
        if (idx < 5) {
          console.log(`[ATTACH-DEBUG] [${idx}] onclick 추출 결과: ${extracted || "null"}`);
        }
        if (extracted) href = extracted;
      }

      if (!href || href === "#" || href === "javascript:void(0)") return;

      // 파일명 추출 - 다양한 소스에서 시도
      const $clone = $el.clone();
      $clone.find(".a11y_hidden, .blind, .sr-only, .visually-hidden").remove();
      let fileName = $clone.text().replace(/\s+/g, " ").trim();

      // 텍스트가 "내려받기", "다운로드" 등인 경우 형제/부모 요소에서 파일명 찾기
      if (!fileName || fileName === "내려받기" || fileName === "다운로드" || fileName === "Download" || fileName.length < 5) {
        // 중소벤처기업부 패턴: li > div.info > .name에서 파일명
        let $parent = $el.closest("li");
        if ($parent.length === 0) $parent = $el.closest("tr");
        if ($parent.length === 0) $parent = $el.closest("div").parent();

        const $nameEl = $parent.find(".name, .file_name, .fileName, .file-name");
        if ($nameEl.length > 0) {
          fileName = $nameEl.first().text().replace(/\s+/g, " ").trim();
          // 크기 정보 제거 (예: "[112.05 KB]")
          fileName = fileName.replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "").trim();
        }

        // 중소벤처기업부 패턴: 형제 요소의 openpage onclick에서 파일명 추출
        // openpage("bcIdx","cbIdx","streFileNm","원본파일명") 형식
        if (!fileName || fileName.length < 5) {
          const $siblings = $parent.find("a[onclick*='openpage']");
          $siblings.each((_, sibling) => {
            const siblingOnclick = $(sibling).attr("onclick") || "";
            // openpage("1064898","86","d083fa17-...","260120_2023년_창업기업실태조사") 패턴
            const openpageMatch = siblingOnclick.match(/openpage\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
            if (openpageMatch && openpageMatch[4]) {
              const extractedName = openpageMatch[4].trim();
              // UUID가 아닌 실제 파일명인 경우
              if (extractedName.length > 5 && !/^[a-f0-9-]{36}$/i.test(extractedName)) {
                // 확장자 추가 (streFileNm에서 추출)
                const streFileNm = openpageMatch[3];
                const extMatch = streFileNm.match(/\.([a-zA-Z0-9]+)$/);
                if (extMatch && !extractedName.toLowerCase().endsWith(`.${extMatch[1].toLowerCase()}`)) {
                  fileName = extractedName + "." + extMatch[1];
                } else {
                  fileName = extractedName;
                }
              }
            }
          });
        }

        // title 속성에서 파일명 (새 창 열림 등 제거)
        if (!fileName || fileName.length < 5) {
          const title = $el.attr("title") || "";
          if (title && !title.includes("내려받기") && !title.includes("다운로드")) {
            fileName = title.replace(/\s*새\s*창\s*열림\s*/i, "").trim();
          }
        }

        // URL에서 파일명 추출 (UUID가 아닌 경우만)
        if (!fileName || fileName.length < 5) {
          try {
            const urlObj = new URL(href, url);
            const streFileNm = urlObj.searchParams.get("streFileNm");
            if (streFileNm && !/^[a-f0-9-]{36}\./i.test(streFileNm)) {
              // UUID 형식이 아닌 경우만 사용
              fileName = decodeURIComponent(streFileNm);
            }
          } catch { }
        }
      }

      pushAttachment(fileName, href);
    });

    if (attachments.length === 0) {
      const labelEls = $("th, dt, strong, span, p")
        .toArray()
        .filter((el) => $(el).text().replace(/\s+/g, "").includes("첨부파일"));

      for (const el of labelEls.slice(0, 5)) {
        const $lab = $(el);
        const $cand = $lab
          .closest("tr")
          .find("td")
          .add($lab.closest("dl").find("dd"))
          .add($lab.closest("div").find("a, button"))
          .add($lab.parent());

        $cand.find("a, button").each((_, a) => {
          const $a = $(a);
          const $clone = $a.clone();
          $clone.find(".a11y_hidden, .blind, .sr-only").remove();
          const txt = $clone.text().replace(/\s+/g, " ").trim();
          const href = $a.attr("href") || "";
          const onclick = $a.attr("onclick") || "";
          const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick, downloadUrlPattern, url) : null;
          let urlRaw = href || urlFromOnclick || "";

          // javascript: href인 경우 onclick에서 다시 시도
          if (href.startsWith("javascript:") && onclick && !urlFromOnclick) {
            const extracted = tryExtractUrlFromOnclick(onclick, downloadUrlPattern, url);
            if (extracted) urlRaw = extracted;
          }

          if (!urlRaw || urlRaw === "#" || urlRaw === "javascript:void(0)") return;
          if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;

          pushAttachment(txt, urlRaw);
        });
      }
    }

    if (attachments.length === 0) {
      $("a, button").slice(0, 100).each((_, a) => {
        const $a = $(a);
        const $clone = $a.clone();
        $clone.find(".a11y_hidden, .blind, .sr-only").remove();
        const txt = $clone.text().replace(/\s+/g, " ").trim();
        const href = $a.attr("href") || "";
        const onclick = $a.attr("onclick") || "";
        const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick, downloadUrlPattern, url) : null;
        let urlRaw = href || urlFromOnclick || "";

        // javascript: href인 경우 onclick에서 다시 시도
        if (href.startsWith("javascript:") && onclick && !urlFromOnclick) {
          const extracted = tryExtractUrlFromOnclick(onclick, downloadUrlPattern, url);
          if (extracted) urlRaw = extracted;
        }

        if (!urlRaw || urlRaw === "#" || urlRaw === "javascript:void(0)") return;
        if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;

        pushAttachment(txt, urlRaw);
      });
    }
  }

  if (!shouldCollectAttachments) {
    return { content, attachments: [] };
  }

  // 모든 소스에서 가져온 첨부파일 병합 (중복 제거)
  // 우선순위: 브라우저 추출 > DOM 파싱
  const filteredBrowserAttachments =
    allowedTypes.length === 0
      ? browserAttachments
      : browserAttachments.filter((att) => isAllowedAttachment(att.fileName, att.downloadUrl));
  const allAttachments = [...filteredBrowserAttachments];
  const mergedUrls = new Set(filteredBrowserAttachments.map(a => a.downloadUrl));

  // DOM 파싱 첨부파일 추가
  for (const att of attachments) {
    if (!mergedUrls.has(att.downloadUrl)) {
      allAttachments.push(att);
      mergedUrls.add(att.downloadUrl);
    }
  }

  return { content, attachments: allAttachments };
}

// ============================================================
// 대체 URL 패턴 생성 (404 발생 시)
// ============================================================

function generateAlternativeUrls(originalUrl: string, baseUrl: string): string[] {
  const altUrls: string[] = [];

  try {
    const url = new URL(originalUrl);
    const base = new URL(baseUrl);

    // 국민참여입법센터 패턴
    if (base.hostname.includes("opinion.lawmaking.go.kr") || url.hostname.includes("lawmaking.go.kr")) {
      // URL 경로에서 fileId, fileKey 추출 시도 (/file/download/{fileId}/{fileKey})
      const pathMatch = url.pathname.match(/\/file\/download\/([^\/]+)\/([^\/]+)/);
      if (pathMatch) {
        const fileId = pathMatch[1];
        const fileKey = pathMatch[2];
        // 올바른 패턴이 이미 사용되고 있으므로 대체 패턴 불필요
        // 하지만 혹시 모르니 다른 경로도 시도
        const patterns = [
          `https://opinion.lawmaking.go.kr/file/download/${fileId}/${fileKey}`,
          `https://opinion.lawmaking.go.kr/files/download/${fileId}/${fileKey}`,
        ];
        for (const pattern of patterns) {
          if (pattern !== originalUrl) {
            altUrls.push(pattern);
          }
        }
      }

      // 쿼리 파라미터 기반 URL인 경우 (이전 잘못된 패턴)
      const atchFileId = url.searchParams.get("atchFileId") || url.searchParams.get("fileId");
      const fileSn = url.searchParams.get("fileSn") || url.searchParams.get("fileKey");

      if (atchFileId && fileSn) {
        // 올바른 URL 패턴으로 변환
        const correctUrl = `https://opinion.lawmaking.go.kr/file/download/${atchFileId}/${fileSn}`;
        if (correctUrl !== originalUrl) {
          altUrls.unshift(correctUrl); // 올바른 패턴을 맨 앞에 추가
        }
      }
    }

    // 일반적인 대체 패턴
    // 1. 경로의 /cmm/을 /gcom/으로 변경
    if (url.pathname.includes("/cmm/")) {
      const altPath = url.pathname.replace("/cmm/", "/gcom/");
      const altUrl = new URL(url);
      altUrl.pathname = altPath;
      if (altUrl.href !== originalUrl) {
        altUrls.push(altUrl.href);
      }
    }

    // 2. 경로의 /gcom/을 /cmm/으로 변경
    if (url.pathname.includes("/gcom/")) {
      const altPath = url.pathname.replace("/gcom/", "/cmm/");
      const altUrl = new URL(url);
      altUrl.pathname = altPath;
      if (altUrl.href !== originalUrl) {
        altUrls.push(altUrl.href);
      }
    }

  } catch {
    // URL 파싱 실패 시 빈 배열 반환
  }

  return altUrls;
}

// ============================================================
// 첨부파일 다운로드
// ============================================================

async function downloadAttachment(
  downloadUrl: string,
  fileName: string,
  outputDir: string,
  refererUrl: string | undefined,
  retry: RetrySettings,
  network: NetworkSettings
): Promise<{ success: boolean; filePath?: string; error?: string; actualUrl?: string }> {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeFileName = fileName.replace(/[\\/:*?"<>|]/g, "_");
  const filePath = path.join(outputDir, safeFileName);

  // file:// URL 처리 (Playwright에서 미리 다운로드한 파일)
  if (downloadUrl.startsWith("file://")) {
    try {
      const tempPath = downloadUrl.replace("file://", "");
      if (fs.existsSync(tempPath)) {
        // 임시 파일을 최종 경로로 이동
        fs.copyFileSync(tempPath, filePath);
        fs.unlinkSync(tempPath); // 임시 파일 삭제
        console.log(`[DOWNLOAD] 로컬 파일 복사 완료: ${fileName}`);
        return { success: true, filePath, actualUrl: downloadUrl };
      } else {
        return { success: false, error: "임시 파일을 찾을 수 없음", actualUrl: downloadUrl };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `로컬 파일 복사 실패: ${errMsg}`, actualUrl: downloadUrl };
    }
  }

  // post: URL 처리 (POST 방식 다운로드, 형식: post:/path|body)
  if (downloadUrl.startsWith("post:")) {
    const postData = downloadUrl.slice(5); // "post:" 제거
    const [urlPath, body] = postData.split("|");

    // 다운로드 URL의 origin 추출
    let origin = "";
    try {
      origin = refererUrl ? new URL(refererUrl).origin : "";
    } catch {
      origin = "";
    }

    const fullUrl = origin + urlPath;
    // NIER 대용량 파일(12MB+) 대비 타임아웃 180초로 증가
    const timeoutMs = Math.max(1, (retry.timeoutSec || 180) * 1000);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= (retry.maxRetries ?? 0); attempt++) {
      if (attempt > 0) {
        const waitMs = retry.useExponentialBackoff
          ? (retry.retryIntervalSec || 1) * Math.pow(2, attempt - 1) * 1000
          : (retry.retryIntervalSec || 1) * 1000;
        await delay(waitMs);
      }

      try {
        console.log(`[DOWNLOAD] POST 요청: ${fullUrl}`);
        console.log(`[DOWNLOAD] Body: ${body}`);

        const res = await fetch(fullUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": network.customUserAgent || DEFAULT_NETWORK_SETTINGS.customUserAgent,
            Accept: "*/*",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            Origin: origin,
            Referer: refererUrl || origin,
          },
          body: body || "",
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
          throw new Error("빈 파일 (0 bytes)");
        }

        // HTML 응답인지 확인
        const firstBytes = Buffer.from(arrayBuffer.slice(0, 50)).toString("utf-8").toLowerCase();
        if (firstBytes.includes("<!doctype") || firstBytes.includes("<html")) {
          throw new Error("HTML 응답 (로그인 필요하거나 세션 만료)");
        }

        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
        console.log(`[DOWNLOAD] POST 다운로드 성공: ${fileName}`);
        return { success: true, filePath, actualUrl: fullUrl };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.log(`[DOWNLOAD] POST 다운로드 실패 (시도 ${attempt + 1}): ${lastError.message}`);
      }
    }

    return { success: false, error: lastError?.message || "POST download failed", actualUrl: fullUrl };
  }

  // KEPCO 전용 다운로드 처리 (kepco:/path|body)
  if (downloadUrl.startsWith("kepco:")) {
    const kepcoData = downloadUrl.slice(6); // "kepco:" 제거
    const [urlPath, body] = kepcoData.split("|");

    // KEPCO 도메인
    const kepcoOrigin = "https://home.kepco.co.kr";
    const fullUrl = kepcoOrigin + urlPath;
    const timeoutMs = Math.max(1, (retry.timeoutSec || 60) * 1000);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= (retry.maxRetries ?? 0); attempt++) {
      if (attempt > 0) {
        const waitMs = retry.useExponentialBackoff
          ? (retry.retryIntervalSec || 1) * Math.pow(2, attempt - 1) * 1000
          : (retry.retryIntervalSec || 1) * 1000;
        await delay(waitMs);
      }

      try {
        console.log(`[DOWNLOAD] KEPCO 다운로드 요청: ${fullUrl}`);
        console.log(`[DOWNLOAD] Body: ${body}`);

        const res = await fetch(fullUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": network.customUserAgent || DEFAULT_NETWORK_SETTINGS.customUserAgent,
            Accept: "application/octet-stream, */*",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            Origin: kepcoOrigin,
            Referer: refererUrl || kepcoOrigin,
          },
          body: body || "",
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
          throw new Error("빈 파일 (0 bytes)");
        }

        // HTML 응답인지 확인
        const firstBytes = Buffer.from(arrayBuffer.slice(0, 50)).toString("utf-8").toLowerCase();
        if (firstBytes.includes("<!doctype") || firstBytes.includes("<html")) {
          throw new Error("HTML 응답 (로그인 필요하거나 세션 만료)");
        }

        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
        console.log(`[DOWNLOAD] KEPCO 다운로드 성공: ${fileName}`);
        return { success: true, filePath, actualUrl: fullUrl };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.log(`[DOWNLOAD] KEPCO 다운로드 실패 (시도 ${attempt + 1}): ${lastError.message}`);
      }
    }

    return { success: false, error: lastError?.message || "KEPCO download failed", actualUrl: fullUrl };
  }

  // 다운로드 URL의 origin 추출
  let origin = "";
  try {
    origin = new URL(downloadUrl).origin;
  } catch {
    origin = refererUrl ? new URL(refererUrl).origin : "";
  }

  const timeoutMs = Math.max(1, (retry.timeoutSec || 60) * 1000);
  let lastError: Error | null = null;
  let lastActualUrl = downloadUrl;

  for (let attempt = 0; attempt <= (retry.maxRetries ?? 0); attempt++) {
    if (attempt > 0) {
      const waitMs = retry.useExponentialBackoff
        ? (retry.retryIntervalSec || 1) * Math.pow(2, attempt - 1) * 1000
        : (retry.retryIntervalSec || 1) * 1000;
      await delay(waitMs);
    }

    try {
      const res = await fetch(downloadUrl, {
        headers: {
          "User-Agent": network.customUserAgent || DEFAULT_NETWORK_SETTINGS.customUserAgent,
          Accept: "*/*",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          ...(network.autoReferer ? { Referer: refererUrl || origin } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      lastActualUrl = res.url || downloadUrl;

      if (!res.ok) {
        const finalUrl = res.url !== downloadUrl ? ` (final: ${res.url})` : "";
        throw new Error(`HTTP ${res.status}${finalUrl}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error("빈 파일 (0 bytes)");
      }

      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return { success: true, filePath, actualUrl: lastActualUrl };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  return { success: false, error: lastError?.message || "download failed", actualUrl: lastActualUrl };
}

// ============================================================
// 다음 페이지 URL 생성
// ============================================================

function getNextPageUrl(
  baseUrl: string,
  currentPage: number,
  pagination?: NonNullable<WebConfig["list"]>["pagination"],
  $?: cheerio.CheerioAPI
): string | null {
  if (!pagination || pagination.type === "none") return null;

  const maxPages = Math.ceil(pagination.max_pages || 100);
  if (currentPage >= maxPages) return null;

  try {
    const url = new URL(baseUrl);

    // HTML에서 페이지네이션 링크 분석하여 offset 파라미터 감지
    if ($ && (pagination.type === "page_param" || !pagination.type)) {
      const pageLinks = $("a[href*='pagerOffset'], a[href*='offset=']").toArray();
      if (pageLinks.length > 0) {
        // pagerOffset 파라미터가 발견되면 offset 방식으로 처리
        const href = $(pageLinks[0]).attr("href") || "";
        const offsetMatch = href.match(/pagerOffset=(\d+)/i) || href.match(/offset=(\d+)/i);
        if (offsetMatch) {
          const paramName = href.includes("pagerOffset") ? "pagerOffset" : "offset";
          const step = parseInt(offsetMatch[1], 10) || 10;
          const nextOffset = currentPage * step;
          url.searchParams.set(paramName, String(nextOffset));
          console.log(`[Pagination] pagerOffset 자동 감지: step=${step}, nextOffset=${nextOffset}`);
          return url.toString();
        }
      }
    }

    switch (pagination.type) {
      case "page_param": {
        // 페이지네이션 파라미터 결정 (우선순위: 설정값 > URL에서 감지 > 기본값)
        let param = pagination.param;

        if (!param || param === "page") {
          // 설정값이 없거나 기본값인 경우 URL에서 자동 감지 시도
          const detectedParam = detectPaginationParam(baseUrl);
          if (detectedParam) {
            param = detectedParam;
            console.log(`[Pagination] 자동 감지된 파라미터: ${param}`);
          } else {
            param = pagination.param || "page";
          }
        }

        const start = pagination.start ?? 1;
        const nextPage = start + currentPage;
        url.searchParams.set(param, String(nextPage));
        return url.toString();
      }

      case "offset_param": {
        const param = pagination.param || "offset";
        const step = pagination.step || 10;
        const start = pagination.start ?? 0;

        // pageIndex는 보통 페이지 번호로 사용됨 (offset로 잘못 감지된 경우 보정)
        if (/pageindex/i.test(param) && step > 1) {
          const nextPage = (pagination.start ?? 1) + currentPage;
          url.searchParams.set(param, String(nextPage));
          return url.toString();
        }

        const nextOffset = start + currentPage * step;
        url.searchParams.set(param, String(nextOffset));
        return url.toString();
      }

      case "next_button": {
        if (!$ || !pagination.selector) return null;
        const $next = $(pagination.selector);
        const href = $next.attr("href");
        if (href) {
          return resolveUrl(baseUrl, href);
        }
        return null;
      }

      case "javascript": {
        // JavaScript 기반 페이지네이션은 헤드리스 브라우저가 필요함
        // 정적 HTML 모드에서는 지원되지 않으므로 null 반환
        // 사이트별로 onclick 패턴을 분석하여 URL 파라미터로 변환 시도
        if (pagination.onclick_pattern) {
          // KEPCO 패턴: G_MovePagingAjax(pageNum)
          if (/G_MovePagingAjax/i.test(pagination.onclick_pattern)) {
            const start = pagination.start ?? 1;
            const nextPage = start + currentPage;
            url.searchParams.set("page", String(nextPage));
            return url.toString();
          }

          // goPage(n), doBbsFPag(n) 등 페이지네이션 함수 패턴
          if (/goPage|movePage|fnPage|pageMove|doBbsFPag|doBbsPag|fnPaging|goPageNo/i.test(pagination.onclick_pattern)) {
            const start = pagination.start ?? 1;
            const nextPage = start + currentPage;
            // 일반적인 페이지 파라미터들 시도
            const possibleParams = ["pageIndex", "pageNo", "page", "cPage", "pn"];
            for (const param of possibleParams) {
              // URL에 해당 파라미터가 이미 있으면 사용
              if (url.searchParams.has(param) || url.toString().includes(`${param}=`)) {
                url.searchParams.set(param, String(nextPage));
                return url.toString();
              }
            }
            // 기본 pageIndex 사용 (전자정부프레임워크 표준)
            url.searchParams.set("pageIndex", String(nextPage));
            return url.toString();
          }
        }
        return null;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ============================================================
// SSE 핸들러
// ============================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const boardId = searchParams.get("board_id");
  const mode = (searchParams.get("mode") || "test") as "test" | "auto";

  if (!boardId) {
    return new Response("board_id is required", { status: 400 });
  }

  // 다운로드 관리 옵션 로드
  const downloadSettings = await readDownloadSettings();
  const retrySettings = downloadSettings?.retry ? { ...DEFAULT_RETRY_SETTINGS, ...downloadSettings.retry } : DEFAULT_RETRY_SETTINGS;
  const networkSettings = downloadSettings?.network ? { ...DEFAULT_NETWORK_SETTINGS, ...downloadSettings.network } : DEFAULT_NETWORK_SETTINGS;
  const fileManagement = downloadSettings?.fileManagement ? { ...DEFAULT_FILE_MANAGEMENT, ...downloadSettings.fileManagement } : DEFAULT_FILE_MANAGEMENT;
  const storageSettings = downloadSettings?.storage ? { ...DEFAULT_STORAGE_SETTINGS, ...downloadSettings.storage } : DEFAULT_STORAGE_SETTINGS;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const articles: ScrapedArticle[] = [];
      const downloadedFiles: string[] = [];
      let xlsxPath = "";

      try {
        // 보드 설정 먼저 로드 (저장 경로 결정에 필요)
        const targetsData = readScraperTargets();
        const board = targetsData.boards.find((b) => b.board_id === boardId);

        if (!board) {
          send({ type: "error", message: "보드를 찾을 수 없습니다." });
          controller.close();
          return;
        }

        // 기관명 조회
        const org = targetsData.orgs.find((o) => o.org_id === board.org_id);
        const orgName = org?.org_name || board.org_id;

        // 저장 경로 결정 (mode에 따라)
        const { documentsPath: SAVE_BASE_DIR, attachmentsPath: ATTACHMENT_DIR } = resolveSavePath(
          downloadSettings,
          mode,
          orgName,
          board.board_name
        );

        // 초기화
        send({ type: "progress", phase: "init", progress: 0, message: "스크래핑 준비 중..." });
        send({ type: "log", message: `🔧 실행 모드: ${mode === "auto" ? "자동 스크래핑" : "즉시 실행 테스트"}` });
        send({ type: "log", message: `💾 제목/본문 저장 경로: ${SAVE_BASE_DIR}` });
        send({ type: "log", message: `📎 첨부파일 저장 경로: ${ATTACHMENT_DIR}` });

        // 저장 공간 체크
        const attachmentDir = ATTACHMENT_DIR;
        fs.mkdirSync(attachmentDir, { recursive: true });
        fs.mkdirSync(SAVE_BASE_DIR, { recursive: true });

        const diskUsage = await getDiskUsage(attachmentDir);
        if (diskUsage) {
          const freeGb = diskUsage.free / (1024 * 1024 * 1024);
          send({ type: "log", message: `💿 디스크 여유 공간: ${freeGb.toFixed(1)}GB` });

          // 경고 임계값 체크
          if (storageSettings.warningThresholdGb > 0 && freeGb < storageSettings.warningThresholdGb) {
            send({ type: "log", message: `⚠️ 저장 공간 부족 경고: 남은 용량 ${freeGb.toFixed(1)}GB < 임계값 ${storageSettings.warningThresholdGb}GB` });
          }
        }

        // 폴더 용량 체크 및 자동 정리
        const folderInfo = getFolderSize(attachmentDir);
        const folderSizeGb = folderInfo.totalSize / (1024 * 1024 * 1024);
        send({ type: "log", message: `📁 첨부파일 폴더: ${formatBytes(folderInfo.totalSize)} (${folderInfo.fileCount}개 파일)` });

        // 최대 저장 용량 체크
        if (storageSettings.maxStorageGb > 0 && folderSizeGb >= storageSettings.maxStorageGb) {
          // 자동 정리 시도
          if (storageSettings.autoCleanupEnabled && storageSettings.autoCleanupDays > 0) {
            send({ type: "log", message: `🧹 저장 공간 제한 초과 - 자동 정리 실행 중 (${storageSettings.autoCleanupDays}일 이전 파일)...` });
            const cleanupResult = runAutoCleanup(attachmentDir, storageSettings.autoCleanupDays);

            if (cleanupResult.deletedFiles > 0) {
              send({ type: "log", message: `   ✓ ${cleanupResult.deletedFiles}개 파일 삭제 (${formatBytes(cleanupResult.deletedSize)} 확보)` });
            } else {
              send({ type: "log", message: `   ⚠️ 삭제할 파일 없음` });
            }

            // 다시 체크
            const newFolderInfo = getFolderSize(attachmentDir);
            const newFolderSizeGb = newFolderInfo.totalSize / (1024 * 1024 * 1024);

            if (newFolderSizeGb >= storageSettings.maxStorageGb) {
              send({ type: "error", message: `🚫 저장 용량 제한 초과: 현재 ${newFolderSizeGb.toFixed(2)}GB >= 제한 ${storageSettings.maxStorageGb}GB` });
              controller.close();
              return;
            }
          } else {
            send({ type: "error", message: `🚫 저장 용량 제한 초과: 현재 ${folderSizeGb.toFixed(2)}GB >= 제한 ${storageSettings.maxStorageGb}GB` });
            controller.close();
            return;
          }
        }

        send({ type: "log", message: `📋 보드: ${board.board_name}` });
        send({ type: "log", message: `🔗 URL: ${board.list_url}` });

        const webConfig = (board.web_config || {}) as WebConfig;
        const collectionRange = board.collection_range;
        const collectionTargets = board.collection_targets;
        const siteSearchConfig = board.site_search_config as SiteSearchConfig | undefined;

        if (!board.list_url) {
          send({ type: "error", message: "목록 URL이 설정되지 않았습니다." });
          controller.close();
          return;
        }

        const effectiveConfig: WebConfig = {
          ...webConfig,
          collection_range: collectionRange as CollectionRange,
          collect_body: collectionTargets?.title_body !== false,
        };

        const effectiveAllowedExtensions = resolveAllowedExtensions(
          collectionTargets,
          webConfig.attachments?.file_types
        );
        const effectiveFileManagement: FileManagementSettings = {
          ...fileManagement,
          allowedExtensions: effectiveAllowedExtensions.length > 0 ? effectiveAllowedExtensions : fileManagement.allowedExtensions,
        };

        // 수집 범위 설정 로그
        if (collectionRange && collectionRange.type) {
          send({ type: "log", message: `📅 수집 범위: ${collectionRange.type}` });
          if (collectionRange.type === "relative") {
            const days = collectionRange.relative_days || 30;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            send({ type: "log", message: `   → ${days}일 전까지 (${cutoffDate.toISOString().slice(0, 10)} 이후)` });
          } else if (collectionRange.type === "period") {
            send({ type: "log", message: `   → ${collectionRange.period_start || '시작 없음'} ~ ${collectionRange.period_end || '종료 없음'}` });
          }
        } else {
          send({ type: "log", message: `📅 수집 범위: 설정 없음 (전체 수집)` });
        }

        // 사이트 내 검색 옵션 적용
        const baseUrl = applySiteSearchOptions(board.list_url, siteSearchConfig);

        // AJAX/POST 기반 페이지네이션 사이트 여부 확인
        // dynamic_js 모드도 Playwright 기반 페이지네이션 사용
        const boardAccessMode = (board as Record<string, unknown>).access_mode as string | undefined;
        const isAjaxPagination = (board as Record<string, unknown>).post_based_navigation === true ||
          webConfig.list?.pagination?.type === "javascript" ||
          boardAccessMode === "dynamic_js";

        // 검색 옵션 로그
        if (siteSearchConfig && siteSearchConfig.options.some(o => o.selected_value)) {
          send({ type: "log", message: "🔍 사이트 내 검색 옵션 적용됨:" });
          for (const opt of siteSearchConfig.options) {
            if (opt.selected_value) {
              const displayValue = opt.type === "select"
                ? (opt.options?.find(o => o.value === opt.selected_value)?.label || opt.selected_value)
                : opt.selected_value;
              send({ type: "log", message: `   - ${opt.label}: ${displayValue}` });
            }
          }
        }

        // 목록 페이지 스크래핑
        send({ type: "progress", phase: "list", progress: 5, message: "게시글 목록 수집 중..." });
        send({ type: "log", message: "📄 게시글 목록 페이지 접근 중..." });

        let currentUrl: string | null = baseUrl;
        let currentPage = 0;
        let shouldStop = false;
        const maxPages = webConfig.list?.pagination?.max_pages || 10;
        let allItems: ScrapingItem[] = [];
        let prevPageLinks = new Set<string>();  // 이전 페이지의 링크들 (중복 페이지 감지용)
        const seenLinks = new Set<string>();  // 이미 수집된 링크 추적

        // 중복 감지를 위한 URL 정규화 함수
        const normalizeUrl = (url: string): string => {
          try {
            const u = new URL(url);
            // 핵심 ID 파라미터들 포함하여 비교 (게시글 구분에 필요한 파라미터)
            // 전자정부프레임워크: cbIdx(게시판ID), bcIdx(게시글ID), nttSn, nttId
            // KECO: article_seq
            const idParams = [
              "boardId", "seq", "idx", "no", "bbs_id", "ntt_id", "page_id",
              "article_id", "post_id", "contentId", "id",
              "cbIdx", "bcIdx", "nttSn", "nttId", "bbsId", "articleId", "boardNo", "boardMngNo",
              "pstNo", "ntIdx",  // NIER 전용 파라미터
              "article_seq", "articleSeq", "articleNo", "article_no"  // KECO 등 article 기반 파라미터
            ];
            const importantParams: string[] = [];
            for (const param of idParams) {
              const value = u.searchParams.get(param);
              if (value) {
                importantParams.push(`${param}=${value}`);
              }
            }
            // pathname + 중요 파라미터로 고유 식별
            return importantParams.length > 0
              ? `${u.pathname}?${importantParams.join("&")}`
              : u.pathname;
          } catch {
            return url;
          }
        };

        // ============================================================
        // AJAX/POST 기반 페이지네이션 처리 (Playwright 사용)
        // ============================================================
        console.log(`[PAGINATION-DEBUG] isAjaxPagination=${isAjaxPagination}, access_mode=${boardAccessMode}, pagination.type=${webConfig.list?.pagination?.type}`);
        if (isAjaxPagination) {
          console.log(`[PAGINATION-DEBUG] AJAX 페이지네이션 분기 진입`);
          send({ type: "log", message: "🔄 AJAX 기반 페이지네이션 감지 - Playwright 사용" });

          const { chromium } = await import("playwright");
          const browser = await chromium.launch({ headless: true });
          const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          });
          const page = await context.newPage();

          try {
            await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
            await page.waitForTimeout(2000);

            console.log(`[PAGINATION-DEBUG] 동적 페이지네이션 시작 (maxPages=${maxPages})`);
            while (!shouldStop && currentPage < maxPages) {
              console.log(`[PAGINATION-DEBUG] === 페이지 ${currentPage + 1} 처리 시작 ===`);
              send({ type: "log", message: `   페이지 ${currentPage + 1} 처리 중...` });

              const html = await page.content();
              const { items } = parseListPage(html, baseUrl, effectiveConfig);

              // 현재 페이지의 모든 링크 수집 (정규화됨)
              const currentPageLinks = new Set(items.map(i => normalizeUrl(i.link)));

              // 중복 페이지 감지
              if (currentPage > 0 && prevPageLinks.size > 0 && currentPageLinks.size > 0) {
                let overlapCount = 0;
                for (const link of currentPageLinks) {
                  if (prevPageLinks.has(link)) overlapCount++;
                }
                const overlapRatio = overlapCount / currentPageLinks.size;
                console.log(`[PAGINATION-DEBUG] 중복 비율: ${Math.round(overlapRatio * 100)}% (${overlapCount}/${currentPageLinks.size})`);
                if (overlapRatio > 0.8) {
                  console.log(`[PAGINATION-DEBUG] 중복 감지로 페이지네이션 종료`);
                  send({ type: "log", message: `   ℹ️ 페이지 내용 중복 감지 (${Math.round(overlapRatio * 100)}%) - 페이지네이션 종료` });
                  break;
                }
              }
              prevPageLinks = currentPageLinks;

              // 수집 범위 필터링 및 중복 제거
              let newItemsCount = 0;
              for (const item of items) {
                const normalizedLink = normalizeUrl(item.link);
                if (seenLinks.has(normalizedLink)) continue;
                seenLinks.add(normalizedLink);

                const itemDate = parseDate(item.date || "");
                const rangeCheck = checkCollectionRange(itemDate, collectionRange as CollectionRange);

                if (rangeCheck === "stop") {
                  console.log(`[PAGINATION-DEBUG] 수집 범위 종료 날짜 도달: ${item.date}`);
                  send({ type: "log", message: `   ℹ️ 수집 범위 종료 날짜 도달: ${item.date}` });
                  shouldStop = true;
                  break;
                }

                if (rangeCheck === true) {
                  allItems.push(item);
                  newItemsCount++;
                }
              }

              console.log(`[PAGINATION-DEBUG] 페이지 ${currentPage + 1}: 신규 ${newItemsCount}개, 전체 ${items.length}개`);
              if (newItemsCount === 0 && items.length > 0) {
                console.log(`[PAGINATION-DEBUG] 새로운 항목 없음 - 페이지네이션 종료`);
                send({ type: "log", message: `   ℹ️ 새로운 항목 없음 - 페이지네이션 종료` });
                break;
              }

              if (items.length === 0) {
                console.log(`[PAGINATION-DEBUG] 항목 없음 - 페이지네이션 종료`);
                break;
              }

              // 다음 페이지로 이동 시도
              currentPage++;
              if (currentPage >= maxPages) break;

              const nextPageNum = currentPage + 1;
              const paginationPattern = webConfig.list?.pagination?.onclick_pattern || "";

              // KEPCO: G_MovePagingAjax 패턴
              if (/G_MovePagingAjax/i.test(paginationPattern)) {
                const nextBtn = await page.$(`a[onclick*="G_MovePagingAjax(${nextPageNum})"], a[onclick*="G_MovePagingAjax('${nextPageNum}')"]`);
                if (nextBtn) {
                  await nextBtn.click();
                  await page.waitForTimeout(2000);
                  continue;
                }
              }

              // 일반적인 페이지 번호 클릭 시도
              const pageSelectors = [
                `.pagination a:has-text("${nextPageNum}")`,
                `.paging a:has-text("${nextPageNum}")`,
                `a.page-link:has-text("${nextPageNum}")`,
                `a[onclick*="(${nextPageNum})"]`,
                `a[onclick*="('${nextPageNum}')"]`,
                // 정부 사이트 전용 선택자
                `ul.page_wrap li a:text-is("${nextPageNum}")`,
                `div.board_paging a:text-is("${nextPageNum}")`,
                `.paginate a:text-is("${nextPageNum}")`,
                `.paging_wrap a:text-is("${nextPageNum}")`,
                `nav[aria-label*="pagination"] a:text-is("${nextPageNum}")`,
                // NIER/일반 정부사이트: 단순 텍스트 매칭
                `a[href="javascript:void(0);"]:text-is("${nextPageNum}")`,
                `a[href="javascript:;"]:text-is("${nextPageNum}")`,
              ];

              console.log(`[PAGINATION-DEBUG] 페이지 ${nextPageNum} 버튼 검색 중...`);
              let clicked = false;
              for (const selector of pageSelectors) {
                try {
                  const btn = await page.$(selector);
                  if (btn) {
                    console.log(`[PAGINATION-DEBUG] 선택자 매칭: ${selector}`);
                    await btn.click();
                    await page.waitForTimeout(3000); // 대기 시간 증가
                    clicked = true;
                    break;
                  }
                } catch (e) {
                  // 선택자 오류 무시
                }
              }

              if (!clicked) {
                console.log(`[PAGINATION-DEBUG] 다음 페이지 버튼을 찾을 수 없음`);
                send({ type: "log", message: `   ℹ️ 다음 페이지 버튼을 찾을 수 없음 - 페이지네이션 종료` });
                break;
              }
            }
          } finally {
            await browser.close();
          }
        }
        // ============================================================
        // 일반 정적 HTML 페이지네이션 처리
        // ============================================================
        else while (currentUrl && !shouldStop && currentPage < maxPages) {
          send({ type: "log", message: `   페이지 ${currentPage + 1} 처리 중...` });

          let html: string;
          try {
            html = await fetchHtml(currentUrl);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            send({ type: "log", message: `   ⚠️ 페이지 접근 실패: ${errorMsg}` });
            break;
          }

          const { items, $ } = parseListPage(html, currentUrl, effectiveConfig);

          // 현재 페이지의 모든 링크 수집 (정규화됨)
          const currentPageLinks = new Set(items.map(i => normalizeUrl(i.link)));

          // 중복 페이지 감지: 현재 페이지의 대부분의 링크가 이전 페이지와 동일하면 중지
          if (currentPage > 0 && prevPageLinks.size > 0 && currentPageLinks.size > 0) {
            let overlapCount = 0;
            for (const link of currentPageLinks) {
              if (prevPageLinks.has(link)) {
                overlapCount++;
              }
            }
            const overlapRatio = overlapCount / currentPageLinks.size;
            if (overlapRatio > 0.8) {  // 80% 이상 중복이면 페이지네이션 실패로 판단
              send({ type: "log", message: `   ℹ️ 페이지 내용 중복 감지 (${Math.round(overlapRatio * 100)}%) - 페이지네이션 종료` });
              break;
            }
          }
          prevPageLinks = currentPageLinks;

          // 수집 범위 필터링 및 중복 제거
          let newItemsCount = 0;
          let consecutiveStopCount = 0; // 연속 "stop" 횟수 (상단 고정 공지글 처리용)
          const STOP_THRESHOLD = 3; // 연속 3개 이상 오래된 항목이면 중단
          
          for (const item of items) {
            // 이미 수집된 링크는 건너뛰기 (정규화된 URL로 비교)
            const normalizedLink = normalizeUrl(item.link);
            if (seenLinks.has(normalizedLink)) {
              continue;
            }
            seenLinks.add(normalizedLink);

            const itemDate = parseDate(item.date || "");
            const rangeCheck = checkCollectionRange(itemDate, collectionRange as CollectionRange);

            // 디버그: 첫 3개 항목의 날짜 체크 결과
            if (currentPage === 0 && newItemsCount < 3) {
              console.log(`[RangeCheck] date="${item.date}", parsed=${itemDate?.toISOString().slice(0, 10) || 'null'}, result=${rangeCheck}`);
            }

            if (rangeCheck === "stop") {
              consecutiveStopCount++;
              // 연속으로 STOP_THRESHOLD개 이상의 오래된 항목이 나오면 중단
              // (상단 고정 공지글이 1-2개 있는 경우를 허용)
              if (consecutiveStopCount >= STOP_THRESHOLD) {
                send({ type: "log", message: `   ℹ️ 수집 범위 종료 날짜 도달: ${item.date} (연속 ${consecutiveStopCount}개)` });
                shouldStop = true;
                break;
              }
              // 아직 threshold 미만이면 스킵하고 계속 진행
              continue;
            }

            // 범위 내 항목이 나오면 연속 카운트 리셋
            consecutiveStopCount = 0;

            if (rangeCheck === true) {
              allItems.push(item);
              newItemsCount++;
            }
          }

          // 새로운 항목이 없으면 중지 (페이지네이션이 작동하지 않는 경우)
          if (newItemsCount === 0 && items.length > 0) {
            send({ type: "log", message: `   ℹ️ 새로운 항목 없음 - 페이지네이션 종료` });
            break;
          }

          if (items.length === 0) break;

          currentUrl = getNextPageUrl(baseUrl, currentPage + 1, webConfig.list?.pagination, $);
          currentPage++;

          if (currentUrl) {
            await delay(300);
          }
        }

        send({ type: "log", message: `✅ 수집 대상 게시글: ${allItems.length}개` });
        send({ type: "progress", phase: "list", progress: 15, message: `${allItems.length}개 게시글 발견` });

        // 상세 페이지 처리
        const totalItems = allItems.length;
        let processedItems = 0;

        for (const item of allItems) {
          processedItems++;
          const detailProgress = 15 + Math.round((processedItems / totalItems) * 50);

          send({
            type: "progress",
            phase: "detail",
            progress: detailProgress,
            message: `게시글 처리 중 (${processedItems}/${totalItems})`
          });
          send({ type: "log", message: `📰 [${processedItems}/${totalItems}] ${item.title.slice(0, 40)}...` });
          // 디버그: 상세 페이지 URL 출력
          send({ type: "log", message: `   🔗 URL: ${item.link}` });

          let content = "";
          let attachments: AttachmentInfo[] = [];

          try {
            await delay(500);
            const detail = await parseDetailPage(item.link, effectiveConfig, collectionTargets, board.access_mode, board.browser_config);
            content = detail.content;
            attachments = detail.attachments;

            if (content) {
              send({ type: "log", message: `   ✓ 본문 추출 완료 (${content.length}자)` });
            }
            if (attachments.length > 0) {
              send({ type: "log", message: `   ✓ 첨부파일 ${attachments.length}개 발견` });
              // 디버그: 첨부파일 URL 표시
              for (const att of attachments.slice(0, 3)) {
                send({ type: "log", message: `      → ${att.fileName}: ${att.downloadUrl.slice(0, 80)}...` });
              }
              if (attachments.length > 3) {
                send({ type: "log", message: `      (외 ${attachments.length - 3}개...)` });
              }
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            send({ type: "log", message: `   ⚠️ 상세 페이지 실패: ${errorMsg}` });
          }

          articles.push({
            title: item.title,
            link: item.link,
            date: item.date,
            content,
            attachments,
          });
        }

        send({ type: "progress", phase: "detail", progress: 65, message: "게시글 처리 완료" });

        // XLSX 저장
        if (articles.length > 0) {
          send({ type: "progress", phase: "save", progress: 70, message: "XLSX 파일 저장 중..." });
          send({ type: "log", message: "💾 XLSX 파일 저장 중..." });

          const exportResult = exportToXlsx(articles, board.board_name, SAVE_BASE_DIR);

          if (exportResult.success) {
            xlsxPath = exportResult.filePath;
            send({ type: "log", message: `   ✅ 저장 완료: ${path.basename(exportResult.filePath)}` });
          } else {
            send({ type: "log", message: `   ⚠️ 저장 실패: ${exportResult.error}` });
          }
        }

        // 첨부파일 다운로드
        // 각 게시글의 첨부파일에 referer URL(상세 페이지) 추가
        const allAttachmentsWithReferer = articles.flatMap((a) =>
          (a.attachments || []).map(att => ({ ...att, refererUrl: a.link }))
        );

        if (allAttachmentsWithReferer.length > 0) {
          send({ type: "progress", phase: "attachment", progress: 75, message: `첨부파일 다운로드 중 (0/${allAttachmentsWithReferer.length})` });
          send({ type: "log", message: `📎 첨부파일 다운로드 시작 (${allAttachmentsWithReferer.length}개)` });

          // 파일 관리 설정 로그
          send({ type: "log", message: `   ⚙️ 최대 파일 크기: ${effectiveFileManagement.maxFileSizeMb}MB, 동시 다운로드: ${effectiveFileManagement.concurrentDownloads}개` });
          if (effectiveFileManagement.allowedExtensions.length > 0) {
            send({ type: "log", message: `   ⚙️ 허용 확장자: ${effectiveFileManagement.allowedExtensions.join(", ")}` });
          }
          send({ type: "log", message: `   ⚙️ 중복 처리: ${effectiveFileManagement.duplicateHandling === "skip" ? "건너뛰기" : effectiveFileManagement.duplicateHandling === "overwrite" ? "덮어쓰기" : "버전 추가"}` });

          let downloadedCount = 0;
          let skippedCount = 0;
          let failedCount = 0;

          // 산업통상부, NIER, KECO 등 세션 기반 다운로드 필요 여부 감지
          // NIER: post:/common/comDownloadFile.do 형식 또는 refererUrl에 nier.go.kr 포함
          // KECO(한국환경공단): /download.do?uuid= 패턴, 세션 없이 접근 시 리다이렉트/HTML 응답
          const needsSessionDownload = allAttachmentsWithReferer.some(att =>
            att.downloadUrl.includes('/attach/down/') ||
            att.downloadUrl.includes('motir.go.kr') ||
            att.downloadUrl.includes('motie.go.kr') ||
            att.downloadUrl.includes('nier.go.kr') ||
            att.downloadUrl.includes('keco.or.kr') || // 한국환경공단 추가
            att.downloadUrl.includes('comBbsFileDownLoad.do') ||
            att.downloadUrl.startsWith('post:/common/comDownloadFile.do') || // NIER POST 패턴
            (att.refererUrl && att.refererUrl.includes('nier.go.kr')) || // NIER referer 확인
            (att.refererUrl && att.refererUrl.includes('keco.or.kr')) // KECO referer 확인
          );

          // 디버그: 세션 다운로드 조건 확인
          console.log(`[DOWNLOAD-DEBUG] allAttachmentsWithReferer.length=${allAttachmentsWithReferer.length}`);
          if (allAttachmentsWithReferer.length > 0) {
            console.log(`[DOWNLOAD-DEBUG] 첫 번째 첨부파일 URL: ${allAttachmentsWithReferer[0].downloadUrl}`);
            console.log(`[DOWNLOAD-DEBUG] 첫 번째 refererUrl: ${allAttachmentsWithReferer[0].refererUrl}`);
          }
          console.log(`[DOWNLOAD-DEBUG] needsSessionDownload=${needsSessionDownload}`);

          if (needsSessionDownload) {
            // Playwright 세션 기반 일괄 다운로드 (산업통상부 등)
            send({ type: "log", message: `   🔐 세션 기반 다운로드 모드 (Playwright 사용)` });
            console.log(`[PW-DOWNLOAD-DEBUG] 세션 다운로드 분기 진입, 첨부파일 ${allAttachmentsWithReferer.length}개`);
            console.log(`[PW-DOWNLOAD-DEBUG] ATTACHMENT_DIR: ${ATTACHMENT_DIR}`);

            // 확장자/중복 필터링 및 파일명 정리
            const filteredAttachments: Array<{ downloadUrl: string; fileName: string; refererUrl: string }> = [];
            let extSkipCount = 0;
            let dupSkipCount = 0;
            for (const att of allAttachmentsWithReferer) {
              // 파일명에서 용량 표시 제거
              let cleanFileName = att.fileName
                .replace(/\s*\([\d,]+\s*Bytes?\)\s*$/i, "")  // (291,517 Byte)
                .replace(/\s*\([^)]*[KMG]B\)\s*$/i, "")
                .replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "")
                .replace(/\s*[\[\(][\d.,]+\s*[KMG]?B[\]\)]\s*$/i, "")
                .trim();
              if (!cleanFileName) cleanFileName = att.fileName;

              // [미리보기], 바로보기 등 뷰어 링크 필터링
              const lowerName = cleanFileName.toLowerCase();
              if (lowerName === "[미리보기]" || lowerName === "미리보기" || 
                  lowerName === "바로보기" || lowerName === "[바로보기]" ||
                  lowerName.includes("preview") || lowerName.includes("viewer")) {
                console.log(`[DUP-CHECK] 뷰어 링크 스킵: ${cleanFileName}`);
                skippedCount++;
                continue;
              }

              // 확장자 없는 파일 필터링 (뷰어 링크 등)
              const fileExt = path.extname(cleanFileName);
              if (!fileExt || fileExt === ".") {
                console.log(`[DUP-CHECK] 확장자 없는 파일 스킵: ${cleanFileName}`);
                skippedCount++;
                continue;
              }

              if (!isAllowedExtension(cleanFileName, effectiveFileManagement.allowedExtensions)) {
                extSkipCount++;
                skippedCount++;
                continue;
              }
              const safeFileName = cleanFileName.replace(/[\\/:*?"<>|]/g, "_");
              const targetFilePath = path.join(ATTACHMENT_DIR, safeFileName);
              const fileExists = fs.existsSync(targetFilePath);
              console.log(`[DUP-CHECK] 파일: ${safeFileName}, 경로: ${targetFilePath}, 존재: ${fileExists}`);
              const { shouldDownload, finalPath } = handleDuplicateFile(targetFilePath, effectiveFileManagement.duplicateHandling);
              if (!shouldDownload) {
                dupSkipCount++;
                skippedCount++;
                console.log(`[DUP-CHECK] 스킵됨 (중복처리모드: ${effectiveFileManagement.duplicateHandling})`);
                continue;
              }
              filteredAttachments.push({
                downloadUrl: att.downloadUrl,
                fileName: path.basename(finalPath),
                refererUrl: att.refererUrl,
              });
            }

            console.log(`[PW-DOWNLOAD-DEBUG] 필터링 결과: 대상=${filteredAttachments.length}, 확장자스킵=${extSkipCount}, 중복스킵=${dupSkipCount}`);
            console.log(`[PW-DOWNLOAD-DEBUG] 허용확장자: [${effectiveFileManagement.allowedExtensions.join(', ')}]`);

            if (filteredAttachments.length > 0) {
              send({ type: "log", message: `   📋 다운로드 대상: ${filteredAttachments.length}개 파일` });

              try {
                const batchResult = await downloadBatchWithPlaywright(
                  filteredAttachments,
                  ATTACHMENT_DIR,
                  { headless: true, browserType: "chromium" },
                  (index, total, fileName, success, error) => {
                    downloadedCount = index;
                    const attachProgress = 75 + Math.round((index / total) * 20);
                    send({
                      type: "progress",
                      phase: "attachment",
                      progress: attachProgress,
                      message: `첨부파일 다운로드 중 (${index}/${total})`
                    });
                    if (success) {
                      send({ type: "log", message: `   📥 ${fileName} ✅` });
                      downloadedFiles.push(path.join(ATTACHMENT_DIR, fileName));
                    } else {
                      send({ type: "log", message: `   📥 ${fileName} ❌ ${error || ''}` });
                    }
                  }
                );

                downloadedCount = batchResult.success;
                failedCount = batchResult.failed;
                send({ type: "log", message: `   ✅ Playwright 다운로드 완료: 성공 ${batchResult.success}, 실패 ${batchResult.failed}` });
              } catch (pwError) {
                send({ type: "log", message: `   ⚠️ Playwright 다운로드 에러: ${pwError}` });
                send({ type: "log", message: `   🔄 기존 방식으로 폴백 시도...` });

                // Playwright 실패 시 기존 fetch 방식으로 폴백
                for (const att of filteredAttachments) {
                  try {
                    const result = await downloadAttachment(
                      att.downloadUrl,
                      att.fileName,
                      ATTACHMENT_DIR,
                      att.refererUrl,
                      retrySettings,
                      networkSettings
                    );
                    if (result.success) {
                      downloadedFiles.push(result.filePath || "");
                      send({ type: "log", message: `   📥 ${att.fileName} ✅ (폴백)` });
                    } else {
                      failedCount++;
                      send({ type: "log", message: `   📥 ${att.fileName} ❌ ${result.error || ''}` });
                    }
                  } catch {
                    failedCount++;
                  }
                }
              }
            }

          } else {
            // 기존 fetch 기반 다운로드

            // 동시 다운로드 제어
            const semaphore = new DownloadSemaphore(effectiveFileManagement.concurrentDownloads);

            // 순차 처리 (로그 순서 유지를 위해)
            for (const att of allAttachmentsWithReferer) {
              await semaphore.acquire();

              try {
                downloadedCount++;
                const attachProgress = 75 + Math.round((downloadedCount / allAttachmentsWithReferer.length) * 20);

                send({
                  type: "progress",
                  phase: "attachment",
                  progress: attachProgress,
                  message: `첨부파일 다운로드 중 (${downloadedCount}/${allAttachmentsWithReferer.length})`
                });
                send({ type: "log", message: `   📥 ${att.fileName}` });

                // 1. 확장자 체크
                if (!isAllowedExtension(att.fileName, effectiveFileManagement.allowedExtensions)) {
                  const ext = path.extname(att.fileName).replace(".", "") || "unknown";
                  send({ type: "log", message: `      ⏭️ 스킵 (허용되지 않은 확장자: .${ext})` });
                  skippedCount++;
                  continue;
                }

                // 2. 파일명 정리 및 중복 체크
                // 용량 표시 제거 (예: "파일명.hwpx (291,517 Byte)" → "파일명.hwpx")
                let cleanedFileName = att.fileName
                  .replace(/\s*\([\d,]+\s*(?:KB|MB|GB|Byte)?\)\s*$/i, "")
                  .trim();
                const safeFileName = cleanedFileName.replace(/[\\/:*?"<>|]/g, "_");
                const targetFilePath = path.join(ATTACHMENT_DIR, safeFileName);
                const { shouldDownload, finalPath } = handleDuplicateFile(targetFilePath, effectiveFileManagement.duplicateHandling);

                if (!shouldDownload) {
                  send({ type: "log", message: `      ⏭️ 스킵 (이미 존재)` });
                  skippedCount++;
                  continue;
                }

                send({ type: "log", message: `      URL: ${att.downloadUrl}` });

                // 첫 번째 시도
                let downloadResult = await downloadAttachment(
                  att.downloadUrl,
                  path.basename(finalPath),  // 중복 처리된 파일명 사용
                  ATTACHMENT_DIR,
                  att.refererUrl || baseUrl,  // 상세 페이지 URL을 Referer로 사용
                  retrySettings,
                  networkSettings
                );

                // 404 발생 시 대체 URL 패턴 시도 (국민참여입법센터 등)
                if (!downloadResult.success && downloadResult.error?.includes("404")) {
                  const altUrls = generateAlternativeUrls(att.downloadUrl, baseUrl);
                  for (const altUrl of altUrls) {
                    send({ type: "log", message: `      [RETRY] 대체 URL 시도: ${altUrl.slice(0, 80)}...` });
                    downloadResult = await downloadAttachment(
                      altUrl,
                      path.basename(finalPath),
                      ATTACHMENT_DIR,
                      att.refererUrl || baseUrl,
                      retrySettings,
                      networkSettings
                    );
                    if (downloadResult.success) {
                      send({ type: "log", message: `      [OK] 대체 URL 성공!` });
                      break;
                    }
                  }
                }

                if (downloadResult.success && downloadResult.filePath) {
                  // 3. 파일 크기 체크 (다운로드 후)
                  try {
                    const stats = fs.statSync(downloadResult.filePath);
                    const fileSizeMb = stats.size / (1024 * 1024);

                    if (effectiveFileManagement.maxFileSizeMb > 0 && fileSizeMb > effectiveFileManagement.maxFileSizeMb) {
                      // 파일 크기 초과 - 삭제
                      fs.unlinkSync(downloadResult.filePath);
                      send({ type: "log", message: `      ⏭️ 삭제 (파일 크기 초과: ${fileSizeMb.toFixed(1)}MB > ${effectiveFileManagement.maxFileSizeMb}MB)` });
                      skippedCount++;
                      continue;
                    }

                    downloadedFiles.push(downloadResult.filePath);
                    send({ type: "log", message: `      ✓ 완료 (${formatBytes(stats.size)})` });
                  } catch {
                    downloadedFiles.push(downloadResult.filePath);
                    send({ type: "log", message: `      ✓ 완료` });
                  }
                } else {
                  failedCount++;
                  send({ type: "log", message: `      ✗ 실패: ${downloadResult.error}` });
                  // 404 오류 시 추가 디버그 정보 표시
                  if (downloadResult.error?.includes("404")) {
                    send({ type: "log", message: `      [DEBUG] 모든 URL 패턴 시도 실패` });
                  }
                  if (retrySettings.failureAction === "stop") {
                    throw new Error(`첨부파일 다운로드 실패로 중단: ${att.fileName} (${downloadResult.error || "unknown"})`);
                  }
                }

                await delay(300);
              } finally {
                semaphore.release();
              }
            }

          } // else (기존 fetch 다운로드) 끝

          // ZIP 파일 자동 압축 해제
          if (downloadedFiles.length > 0) {
            const zipExtractResult = extractAllZipsInDirectory(ATTACHMENT_DIR, true);
            if (zipExtractResult.totalZips > 0) {
              send({ type: "log", message: `   📦 ZIP 압축 해제: ${zipExtractResult.successCount}/${zipExtractResult.totalZips}개 완료` });
              // 압축 해제된 파일 목록 추가
              downloadedFiles.push(...zipExtractResult.extractedFiles);
            }
          }

          // 다운로드 요약
          send({ type: "log", message: `   📊 결과: 완료 ${downloadedFiles.length}, 스킵 ${skippedCount}, 실패 ${failedCount}` });
        }

        // ============================================================
        // 확장자 없는 파일 복원 (용량 표시 제거)
        // ============================================================
        if (downloadedFiles.length > 0) {
          send({ type: "log", message: "" });
          send({ type: "log", message: "🔧 파일명 정리 중..." });
          const { restoredCount, updatedFiles } = restoreFileExtensions(downloadedFiles, send);
          if (restoredCount > 0) {
            send({ type: "log", message: `   ✅ ${restoredCount}개 파일 확장자 복원 완료` });
            // downloadedFiles 배열 업데이트
            downloadedFiles.length = 0;
            downloadedFiles.push(...updatedFiles);
          } else {
            send({ type: "log", message: `   ✅ 복원 필요 파일 없음` });
          }
        }

        // 완료
        send({ type: "progress", phase: "done", progress: 100, message: "스크래핑 완료!" });
        send({ type: "log", message: "" });
        send({ type: "log", message: "═══════════════════════════════════════" });
        send({ type: "log", message: "🎉 스크래핑 완료!" });
        send({ type: "log", message: `   📰 수집 게시글: ${articles.length}개` });
        send({ type: "log", message: `   📎 다운로드 첨부파일: ${downloadedFiles.length}개` });
        send({ type: "log", message: "═══════════════════════════════════════" });

        send({
          type: "complete",
          data: {
            success: true,
            boardId,
            boardName: board.board_name,
            articlesCount: articles.length,
            attachmentsCount: downloadedFiles.length,
            xlsxPath,
            attachmentDir: ATTACHMENT_DIR,
            downloadedFiles,
          },
        });

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        send({ type: "error", message: errorMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
