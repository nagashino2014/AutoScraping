/**
 * 즉시 실행 API
 * 
 * 보드 설정에 따라 즉시 스크래핑을 실행하고 결과를 XLSX 파일로 저장합니다.
 */

import { NextResponse } from "next/server";
import { readScraperTargets, type Board, type CollectionTargets, type SiteSearchConfig, type BrowserConfig as BrowserSettings } from "@/lib/scraper/targets-store";
import { exportToXlsx, cleanupTestFiles, type ScrapedArticle } from "@/lib/scraper/xlsx-export";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { promises as fsPromises } from "node:fs";
import {
  fetchRenderedHtml,
  extractAttachmentsWithBrowser,
  extractLawmakingAttachments,
  BrowserConfig,
} from "@/lib/scraper/browser";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 제한

// ============================================================
// 다운로드 설정 타입 및 함수
// ============================================================

interface TestPathSettings {
  documentsPath: string;
  attachmentsPath: string;
}

type FailureAction = "skip" | "log_only" | "stop";

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
  // (참고) skipSslVerification/proxyUrl 등은 현재 즉시 실행 fetch 기반 다운로드에서는 미적용
}

interface DownloadSettings {
  testPath: TestPathSettings;
  retry?: RetrySettings;
  network?: NetworkSettings;
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

const DOWNLOAD_SETTINGS_FILE = path.join(process.cwd(), "data", "download-settings.json");

async function readDownloadSettings(): Promise<DownloadSettings | null> {
  try {
    const raw = await fsPromises.readFile(DOWNLOAD_SETTINGS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveTestPath(settings: DownloadSettings | null): { documentsPath: string; attachmentsPath: string } {
  const testPath = settings?.testPath || DEFAULT_TEST_PATH;
  
  // 상대 경로를 절대 경로로 변환
  const cwd = process.cwd();
  
  let documentsPath = testPath.documentsPath || DEFAULT_TEST_PATH.documentsPath;
  let attachmentsPath = testPath.attachmentsPath || DEFAULT_TEST_PATH.attachmentsPath;
  
  // 상대 경로인 경우 프로젝트 루트 기준으로 변환
  if (!path.isAbsolute(documentsPath)) {
    documentsPath = path.join(cwd, documentsPath);
  }
  if (!path.isAbsolute(attachmentsPath)) {
    attachmentsPath = path.join(cwd, attachmentsPath);
  }
  
  return { documentsPath, attachmentsPath };
}


// ============================================================
// 유틸리티 함수
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 확장자 없는 파일 복원
 * 파일명에 확장자가 포함되어 있지만 용량 표시 등이 붙어서 실제 확장자가 없는 파일을 복원
 * 예: "문서.hwp (123KB)" → "문서.hwp"
 */
function restoreFileExtensions(
  downloadedFiles: string[],
  logs: string[]
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
          logs.push(`[FIX] 파일명 복원: ${fileName} → ${path.basename(finalPath)}`);
          updatedFiles.push(finalPath);
        } catch (renameErr) {
          logs.push(`[WARN] 파일명 복원 실패: ${fileName} - ${renameErr}`);
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
 */
function applySiteSearchOptions(baseUrl: string, siteSearchConfig?: SiteSearchConfig): string {
  if (!siteSearchConfig || !siteSearchConfig.options || siteSearchConfig.options.length === 0) {
    return baseUrl;
  }
  
  try {
    const url = new URL(baseUrl);
    
    for (const opt of siteSearchConfig.options) {
      const value = opt.selected_value;
      if (value !== undefined && value !== null && value !== "") {
        if (opt.name) {
          url.searchParams.set(opt.name, value);
        }
      }
    }
    
    return url.toString();
  } catch {
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

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 수집 범위 체크
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

      // 종료일 이후 → 스킵
      if (endDate && itemDate > endDate) return false;

      // 시작일 이전 → 중단
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

function tryExtractUrlFromOnclick(onclick: string, downloadUrlPattern?: string): string | null {
  if (!onclick) return null;
  
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
      
      // 패턴이 없으면 기본 패턴 시도
      if (param2) {
        return `/file/download/${param1}/${param2}`;
      } else {
        return `/download?fileId=${param1}`;
      }
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
  const authorSelector = config.parse_rules?.author;

  const $container = containerSelector ? $(containerSelector) : $("body");
  const $items = $container.find(itemSelector);

  $items.each((_, el) => {
    const $item = $(el);

    // 제목 추출
    const $titleEl = $item.find(titleSelector).first();
    const title = cleanText($titleEl.text());

    // 링크 추출
    const $linkEl = $item.find(linkSelector).first();
    let link = $linkEl.attr("href") || "";

    // onclick에서 URL 추출 시도
    if (!link) {
      const onclick = $linkEl.attr("onclick") || $item.attr("onclick") || "";
      const urlMatch = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
      if (urlMatch) link = urlMatch[1];
    }

    if (link) {
      link = resolveUrl(baseUrl, link);
    }

    // 날짜 추출
    let date = "";
    if (dateSelector) {
      const $dateEl = $item.find(dateSelector).first();
      date = cleanText($dateEl.text());
    }

    // 작성자 추출
    let author = "";
    if (authorSelector) {
      const $authorEl = $item.find(authorSelector).first();
      author = cleanText($authorEl.text());
    }

    // 유효한 항목만 추가
    if (title && title.length >= 2 && link) {
      items.push({ title, link, date, author });
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
      timeout: 30000,
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

  // 본문 추출
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

    // fallback
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

  // 첨부파일 추출
  const attachments: AttachmentInfo[] = [];
  const seenUrls = new Set<string>();

  // 첨부파일 수집 여부 확인
  const shouldCollectAttachments = collectionTargets?.attachments?.enabled !== false && 
    config.attachments?.enabled;

  if (shouldCollectAttachments) {
    // 허용된 파일 형식 결정
    let allowedTypes: string[] = [];
    
    if (collectionTargets?.attachments?.all || config.attachments?.collect_all) {
      // 전체 수집
      allowedTypes = ["hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "zip", "rar", "7z"];
    } else {
      // 개별 파일 형식 확인
      const attConfig = collectionTargets?.attachments;
      if (attConfig?.hwpx) allowedTypes.push("hwp", "hwpx");
      if (attConfig?.pdf) allowedTypes.push("pdf");
      if (attConfig?.docx) allowedTypes.push("doc", "docx");
      if (attConfig?.xlsx) allowedTypes.push("xls", "xlsx", "csv");
      
      // 기본값이 없으면 config의 file_types 사용
      if (allowedTypes.length === 0 && config.attachments?.file_types) {
        allowedTypes = config.attachments.file_types;
      }
      
      // 그래도 없으면 전체 허용
      if (allowedTypes.length === 0) {
        allowedTypes = ["hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "zip", "rar", "7z"];
      }
    }

    // 첨부파일 추가 헬퍼 함수
    const pushAttachment = (fileNameRaw: string, urlRaw: string) => {
      if (!urlRaw) return;
      const downloadUrl = resolveUrl(url, urlRaw);
      if (!downloadUrl) return;
      if (seenUrls.has(downloadUrl)) return;
      seenUrls.add(downloadUrl);

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

      // 크기 정보 제거
      fileName = fileName.replace(/\s*\([^)]*[KMG]B\)\s*$/i, "").trim();
      if (!fileName) fileName = "unknown";

      // 파일 형식 체크
      const fileExt = fileName.split(".").pop()?.toLowerCase() || "";
      const urlExt = downloadUrl.split(".").pop()?.split("?")[0]?.toLowerCase() || "";
      
      const hasAllowedExt = allowedTypes.some((ext) => 
        fileExt === ext || urlExt === ext
      );
      const isDownloadUrl = /download|filedown|attach/i.test(downloadUrl);

      if (hasAllowedExt || isDownloadUrl) {
        attachments.push({ fileName, downloadUrl });
      }
    };

    // 전략 1: 파일 확장자 기반 선택자
    const extSelectors = allowedTypes.map((ext) => `a[href*='.${ext}']`);

    // 전략 2: 다운로드 관련 선택자
    const downloadSelectors = [
      // href에 다운로드 관련 URL이 있는 링크 (우선순위 높음)
      "a[href*='readDownloadFile']", "a[href*='downloadFile']",
      "a[href*='download']", "a[href*='fileDown']", "a[href*='file_down']",
      "a[href*='atchFileDown']", "a[href*='AttachDown']", "a[href*='fileId=']",
      // onclick 기반 다운로드 버튼 (범용)
      "a[onclick*='download']", "a[onclick*='fileDown']",
      "button[onclick*='Download']", "button[onclick*='download']",
      "button[onclick*='fileDown']", "button[onclick*='fn_Download']",
      "button.file_link", "button.btn_download",
      // 컨테이너 기반
      ".file_list a", ".attach a", ".file a", ".file_area a",
      ".attachment a", ".attachFile a", ".atch_file a",
      ".fileList a", ".file-list a", ".download-list a",
      "ul.file li a", "div.file a", "table.file a",
      // 첨부파일 영역 내 버튼
      ".file_area button", ".attach button", ".attachment button",
    ];

    // 커스텀 선택자
    if (config.attachments?.selector) {
      downloadSelectors.push(config.attachments.selector);
    }

    const allSelectors = [...extSelectors, ...downloadSelectors].join(", ");
    
    // 다운로드 URL 패턴 가져오기
    const downloadUrlPattern = config.attachments?.download_url_pattern;

    $(allSelectors).each((_, el) => {
      const $el = $(el);
      const tagName = el.tagName?.toLowerCase() || "";
      let href = $el.attr("href") || "";
      const onclick = $el.attr("onclick") || "";

      // button 또는 javascript: href인 경우 onclick에서 URL 추출
      if ((!href || href.startsWith("javascript:") || tagName === "button") && onclick) {
        const extracted = tryExtractUrlFromOnclick(onclick, downloadUrlPattern);
        if (extracted) href = extracted;
      }

      if (!href || href === "#" || href === "javascript:void(0)") return;

      // 파일명 추출 - 숨김 텍스트 제거
      const $clone = $el.clone();
      $clone.find(".a11y_hidden, .blind, .sr-only, .visually-hidden").remove();
      const fileName = $clone.text().replace(/\s+/g, " ").trim();
      
      pushAttachment(fileName, href);
    });

    // 전략 3: '첨부파일' 라벨 주변에서 링크 수집
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
          const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick, downloadUrlPattern) : null;
          let urlRaw = href || urlFromOnclick || "";
          
          // javascript: href인 경우 onclick에서 다시 시도
          if (href.startsWith("javascript:") && onclick && !urlFromOnclick) {
            const extracted = tryExtractUrlFromOnclick(onclick, downloadUrlPattern);
            if (extracted) urlRaw = extracted;
          }

          if (!urlRaw || urlRaw === "#" || urlRaw === "javascript:void(0)") return;
          if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;

          pushAttachment(txt, urlRaw);
        });
      }
    }

    // 전략 4: 최후 fallback
    if (attachments.length === 0) {
      $("a, button").slice(0, 100).each((_, a) => {
        const $a = $(a);
        const $clone = $a.clone();
        $clone.find(".a11y_hidden, .blind, .sr-only").remove();
        const txt = $clone.text().replace(/\s+/g, " ").trim();
        const href = $a.attr("href") || "";
        const onclick = $a.attr("onclick") || "";
        const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick, downloadUrlPattern) : null;
        let urlRaw = href || urlFromOnclick || "";
        
        // javascript: href인 경우 onclick에서 다시 시도
        if (href.startsWith("javascript:") && onclick && !urlFromOnclick) {
          const extracted = tryExtractUrlFromOnclick(onclick, downloadUrlPattern);
          if (extracted) urlRaw = extracted;
        }

        if (!urlRaw || urlRaw === "#" || urlRaw === "javascript:void(0)") return;
        if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;

        pushAttachment(txt, urlRaw);
      });
    }
  }

  // 모든 소스에서 가져온 첨부파일 병합 (중복 제거)
  // 우선순위: 브라우저 추출 > DOM 파싱
  const allAttachments = [...browserAttachments];
  const mergedUrls = new Set(browserAttachments.map(a => a.downloadUrl));
  
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
        const correctUrl = `https://opinion.lawmaking.go.kr/file/download/${atchFileId}/${fileSn}`;
        if (correctUrl !== originalUrl) {
          altUrls.unshift(correctUrl);
        }
      }
    }
    
    if (url.pathname.includes("/cmm/")) {
      const altPath = url.pathname.replace("/cmm/", "/gcom/");
      const altUrl = new URL(url);
      altUrl.pathname = altPath;
      if (altUrl.href !== originalUrl) {
        altUrls.push(altUrl.href);
      }
    }
    
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
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  // 출력 디렉토리 생성
  fs.mkdirSync(outputDir, { recursive: true });

  // 파일명 정리 (특수문자 제거)
  const safeFileName = fileName.replace(/[\\/:*?"<>|]/g, "_");
  const filePath = path.join(outputDir, safeFileName);

  // 다운로드 URL의 origin 추출
  let origin = "";
  try {
    origin = new URL(downloadUrl).origin;
  } catch {
    origin = refererUrl ? new URL(refererUrl).origin : "";
  }

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

      if (!res.ok) {
        const finalUrl = res.url !== downloadUrl ? ` (final: ${res.url})` : "";
        throw new Error(`HTTP ${res.status}${finalUrl}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error("빈 파일 (0 bytes)");
      }

      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return { success: true, filePath };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  return { success: false, error: lastError?.message || "download failed" };
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

  const maxPages = pagination.max_pages || 100;
  if (currentPage >= maxPages) return null;

  try {
    const url = new URL(baseUrl);

    switch (pagination.type) {
      case "page_param": {
        const param = pagination.param || "page";
        const start = pagination.start ?? 1;
        const nextPage = start + currentPage;
        url.searchParams.set(param, String(nextPage));
        return url.toString();
      }

      case "offset_param": {
        const param = pagination.param || "offset";
        const step = pagination.step || 10;
        const start = pagination.start ?? 0;
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
        if (pagination.onclick_pattern) {
          if (/goPage|movePage|fnPage|pageMove/i.test(pagination.onclick_pattern)) {
            const start = pagination.start ?? 1;
            const nextPage = start + currentPage;
            const possibleParams = ["pageIndex", "pageNo", "page", "cPage"];
            for (const param of possibleParams) {
              if (url.searchParams.has(param) || url.toString().includes(`${param}=`)) {
                url.searchParams.set(param, String(nextPage));
                return url.toString();
              }
            }
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
// 메인 핸들러
// ============================================================

export async function POST(req: Request) {
  const logs: string[] = [];
  const articles: ScrapedArticle[] = [];
  const downloadedFiles: string[] = [];
  let xlsxPath = "";

  // 다운로드 설정에서 테스트 저장 경로 읽기
  const downloadSettings = await readDownloadSettings();
  const { documentsPath: SAVE_BASE_DIR, attachmentsPath: ATTACHMENT_DIR } = resolveTestPath(downloadSettings);
  const retrySettings = downloadSettings?.retry ? { ...DEFAULT_RETRY_SETTINGS, ...downloadSettings.retry } : DEFAULT_RETRY_SETTINGS;
  const networkSettings = downloadSettings?.network ? { ...DEFAULT_NETWORK_SETTINGS, ...downloadSettings.network } : DEFAULT_NETWORK_SETTINGS;

  try {
    const body = await req.json();
    const { board_id } = body;

    if (!board_id) {
      return NextResponse.json({ error: "board_id is required" }, { status: 400 });
    }

    logs.push("========================================");
    logs.push("       🚀 즉시 실행 스크래핑 시작");
    logs.push("========================================");
    logs.push(`[INFO] 보드 ID: ${board_id}`);
    logs.push(`[INFO] 제목/본문 저장 경로: ${SAVE_BASE_DIR}`);
    logs.push(`[INFO] 첨부파일 저장 경로: ${ATTACHMENT_DIR}`);

    // 보드 설정 로드
    const targetsData = readScraperTargets();
    const board = targetsData.boards.find((b) => b.board_id === board_id);

    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    logs.push(`[INFO] 보드명: ${board.board_name}`);
    logs.push(`[INFO] 목록 URL: ${board.list_url}`);

    const webConfig = (board.web_config || {}) as WebConfig;
    const collectionRange = board.collection_range;
    const collectionTargets = board.collection_targets;
    const siteSearchConfig = board.site_search_config as SiteSearchConfig | undefined;

    // 수집 범위 로그
    if (collectionRange?.type) {
      logs.push(`[INFO] 수집 범위: ${collectionRange.type}`);
      if (collectionRange.type === "period") {
        logs.push(`       시작일: ${collectionRange.period_start || "미설정"}`);
        logs.push(`       종료일: ${collectionRange.period_end || "미설정"}`);
      } else if (collectionRange.type === "relative") {
        logs.push(`       최근 ${collectionRange.relative_days || 30}일`);
      } else if (collectionRange.type === "yearly") {
        logs.push(`       연도: ${collectionRange.years?.join(", ") || "미설정"}`);
      }
    }

    // 수집 대상 로그
    logs.push(`[INFO] 수집 대상:`);
    logs.push(`       제목/본문: ${collectionTargets?.title_body !== false ? "O" : "X"}`);
    logs.push(`       첨부파일: ${collectionTargets?.attachments?.enabled !== false ? "O" : "X"}`);

    // 사이트 내 검색 옵션 로그
    if (siteSearchConfig && siteSearchConfig.options.some(o => o.selected_value)) {
      logs.push(`[INFO] 사이트 내 검색 옵션:`);
      for (const opt of siteSearchConfig.options) {
        if (opt.selected_value) {
          const displayValue = opt.type === "select" 
            ? (opt.options?.find(o => o.value === opt.selected_value)?.label || opt.selected_value)
            : opt.selected_value;
          logs.push(`       ${opt.label}: ${displayValue}`);
        }
      }
    }

    if (!board.list_url) {
      return NextResponse.json({ error: "Board list_url is not configured" }, { status: 400 });
    }

    logs.push("");
    logs.push("── 📋 목록 페이지 스크래핑 ──");

    // 사이트 내 검색 옵션을 URL에 적용
    const baseUrl = applySiteSearchOptions(board.list_url, siteSearchConfig);

    // web_config에 collection_range 병합
    const effectiveConfig: WebConfig = {
      ...webConfig,
      collection_range: collectionRange as CollectionRange,
      collect_body: collectionTargets?.title_body !== false,
    };

    // 목록 페이지 스크래핑
    let currentUrl: string | null = baseUrl;
    let currentPage = 0;
    let shouldStop = false;
    const maxPages = webConfig.list?.pagination?.max_pages || 10;
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

    while (currentUrl && !shouldStop && currentPage < maxPages) {
      logs.push(`[INFO] 페이지 ${currentPage + 1} 처리 중...`);

      let html: string;
      try {
        html = await fetchHtml(currentUrl);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logs.push(`[ERROR] 페이지 접근 실패: ${errorMsg}`);
        break;
      }

      const { items, $ } = parseListPage(html, currentUrl, effectiveConfig);
      logs.push(`[INFO] 발견된 항목: ${items.length}개`);

      if (items.length === 0) {
        break;
      }
      
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
        if (overlapRatio > 0.8) {
          logs.push(`[INFO] 페이지 내용 중복 감지 (${Math.round(overlapRatio * 100)}%) - 페이지네이션 종료`);
          break;
        }
      }
      prevPageLinks = currentPageLinks;

      // 항목 처리
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

        if (rangeCheck === "stop") {
          consecutiveStopCount++;
          // 연속으로 STOP_THRESHOLD개 이상의 오래된 항목이 나오면 중단
          // (상단 고정 공지글이 1-2개 있는 경우를 허용)
          if (consecutiveStopCount >= STOP_THRESHOLD) {
            logs.push(`[INFO] 수집 범위 종료 - 스크래핑 중단 (연속 ${consecutiveStopCount}개)`);
            shouldStop = true;
            break;
          }
          // 아직 threshold 미만이면 스킵하고 계속 진행
          continue;
        }

        // 범위 내 항목이 나오면 연속 카운트 리셋
        consecutiveStopCount = 0;

        if (rangeCheck === false) {
          logs.push(`[SKIP] ${item.title.slice(0, 30)}... (범위 외)`);
          continue;
        }
        
        newItemsCount++;
        logs.push(`[NEW] ${item.title.slice(0, 40)}...`);

        // 상세 페이지 처리
        let content = "";
        let attachments: AttachmentInfo[] = [];

        try {
          await delay(500); // Rate limiting
          const detail = await parseDetailPage(item.link, effectiveConfig, collectionTargets, board.access_mode, board.browser_config);
          content = detail.content;
          attachments = detail.attachments;

          logs.push(`       본문: ${content.slice(0, 50)}...`);
          logs.push(`       첨부: ${attachments.length}개`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logs.push(`       [ERROR] 상세 페이지 실패: ${errorMsg}`);
        }

        articles.push({
          title: item.title,
          link: item.link,
          date: item.date,
          content,
          attachments,
        });
      }
      
      // 새로운 항목이 없으면 중지 (페이지네이션이 작동하지 않는 경우)
      if (newItemsCount === 0) {
        logs.push(`[INFO] 새로운 항목 없음 - 페이지네이션 종료`);
        break;
      }

      // 다음 페이지
      currentUrl = getNextPageUrl(
        baseUrl,
        currentPage + 1,
        webConfig.list?.pagination,
        $
      );
      currentPage++;

      if (currentUrl) {
        await delay(500);
      }
    }

    logs.push("");
    logs.push(`── ✅ 스크래핑 완료: ${articles.length}건 ──`);

    // XLSX 파일 저장
    if (articles.length > 0) {
      logs.push("");
      logs.push("── 📄 XLSX 파일 저장 ──");
      
      const exportResult = exportToXlsx(articles, board.board_name, SAVE_BASE_DIR);
      
      if (exportResult.success) {
        xlsxPath = exportResult.filePath;
        logs.push(`[SUCCESS] 저장 완료: ${exportResult.filePath}`);
      } else {
        logs.push(`[ERROR] XLSX 저장 실패: ${exportResult.error}`);
      }
    }

    // 첨부파일 다운로드
    const allAttachments = articles.flatMap((a) => a.attachments || []);
    
    if (allAttachments.length > 0) {
      logs.push("");
      logs.push(`── 📎 첨부파일 다운로드 (${allAttachments.length}건) ──`);

      for (const att of allAttachments) {
        logs.push(`[DOWNLOAD] ${att.fileName}`);
        logs.push(`       URL: ${att.downloadUrl}`);
        
        let downloadResult = await downloadAttachment(att.downloadUrl, att.fileName, ATTACHMENT_DIR, baseUrl, retrySettings, networkSettings);
        
        // 404 발생 시 대체 URL 패턴 시도
        if (!downloadResult.success && downloadResult.error?.includes("404")) {
          const altUrls = generateAlternativeUrls(att.downloadUrl, baseUrl);
          for (const altUrl of altUrls) {
            logs.push(`       [RETRY] ${altUrl.slice(0, 80)}...`);
            downloadResult = await downloadAttachment(altUrl, att.fileName, ATTACHMENT_DIR, baseUrl, retrySettings, networkSettings);
            if (downloadResult.success) {
              logs.push(`       [OK] 대체 URL 성공!`);
              break;
            }
          }
        }
        
        if (downloadResult.success && downloadResult.filePath) {
          downloadedFiles.push(downloadResult.filePath);
          logs.push(`       [OK] ${downloadResult.filePath}`);
        } else {
          logs.push(`       [FAIL] ${downloadResult.error}`);
          if (retrySettings.failureAction === "stop") {
            throw new Error(`첨부파일 다운로드 실패로 중단: ${att.fileName} (${downloadResult.error || "unknown"})`);
          }
        }

        await delay(300); // Rate limiting
      }
    }

    // ============================================================
    // 확장자 없는 파일 복원 (용량 표시 제거)
    // ============================================================
    if (downloadedFiles.length > 0) {
      logs.push("");
      logs.push("── 🔧 파일명 정리 ──");
      const { restoredCount, updatedFiles } = restoreFileExtensions(downloadedFiles, logs);
      if (restoredCount > 0) {
        logs.push(`[INFO] ${restoredCount}개 파일 확장자 복원 완료`);
        // downloadedFiles 배열 업데이트
        downloadedFiles.length = 0;
        downloadedFiles.push(...updatedFiles);
      } else {
        logs.push(`[INFO] 복원 필요 파일 없음`);
      }
    }

    logs.push("");
    logs.push("========================================");
    logs.push("       🎉 즉시 실행 완료");
    logs.push("========================================");
    logs.push(`[SUMMARY]`);
    logs.push(`  - 수집 게시글: ${articles.length}건`);
    logs.push(`  - 다운로드 첨부파일: ${downloadedFiles.length}건`);
    logs.push(`  - XLSX 파일: ${xlsxPath || "(없음)"}`);
    logs.push(`  - 첨부파일 경로: ${ATTACHMENT_DIR}`);

    return NextResponse.json({
      success: true,
      boardId: board_id,
      boardName: board.board_name,
      articlesCount: articles.length,
      attachmentsCount: downloadedFiles.length,
      xlsxPath,
      attachmentDir: ATTACHMENT_DIR,
      downloadedFiles,
      logs: logs.join("\n"),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logs.push(`[FATAL ERROR] ${errorMsg}`);

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        logs: logs.join("\n"),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// 테스트 파일 삭제 API
// ============================================================

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { xlsxPath, attachmentDir } = body;

    // 다운로드 설정에서 테스트 저장 경로 읽기
    const downloadSettings = await readDownloadSettings();
    const { documentsPath: DEFAULT_SAVE_DIR, attachmentsPath: DEFAULT_ATTACHMENT_DIR } = resolveTestPath(downloadSettings);

    // xlsxPath가 없으면 설정된 테스트 디렉토리 사용
    const xlsxTarget = xlsxPath || DEFAULT_SAVE_DIR;
    const attachTarget = attachmentDir || DEFAULT_ATTACHMENT_DIR;

    const result = cleanupTestFiles(xlsxTarget, attachTarget);

    return NextResponse.json({
      success: result.success,
      deleted: result.deleted,
      errors: result.errors,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
