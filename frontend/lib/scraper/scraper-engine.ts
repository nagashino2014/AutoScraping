/**
 * 범용 스크래핑 엔진
 * 
 * 기능:
 * - 페이지네이션 처리 (page_param, offset_param, next_button)
 * - 중복 제거 (dedup_key 기반)
 * - 수집 범위 필터링 (날짜 기반)
 * - 데이터 저장 (SQLite via sql.js)
 */

import * as cheerio from "cheerio";
import {
  getDbAsync,
  generateDocId,
  documentExists,
  saveDocument,
  saveAttachment,
  generateFileId,
  startScrapeLog,
  finishScrapeLog,
  type ScrapedDocument,
  type ScrapeLog,
  type DedupKeyType,
} from "./scraper-db";
import { readDownloadSettings } from "./download-settings";

// ============================================================
// 타입 정의
// ============================================================

export interface WebConfig {
  rendering?: "static_html" | "dynamic_js";
  list?: {
    container_selector?: string;
    item_selector?: string;
    pagination?: {
      type: "page_param" | "offset_param" | "next_button" | "none";
      param?: string;           // page_param/offset_param용 쿼리 파라미터명
      selector?: string;        // next_button용 선택자
      start?: number;           // 시작 페이지/오프셋 (기본: 1 또는 0)
      step?: number;            // 오프셋 증가량 (offset_param용)
      max_pages?: number;       // 최대 페이지 수 제한
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
  };
  collection_range?: {
    type: "period" | "relative" | "yearly" | "";
    start_date?: string | null;
    end_date?: string | null;
    days_before?: number;
    years?: number[];
  };
  collect_body?: boolean;
}

export interface ScrapingItem {
  title: string;
  link: string;
  date?: string;
  author?: string;
}

export interface ScrapingOptions {
  boardId: string;
  orgId: string;
  listUrl: string;
  webConfig: WebConfig;
  dedupKey?: DedupKeyType;
  scheduleId?: string;
  maxPages?: number;           // 페이지 제한 (테스트용)
  delayMs?: number;            // 요청 간 딜레이 (기본: 500ms)
  onProgress?: (progress: ScrapeProgress) => void;
}

export interface ScrapeProgress {
  phase: "list" | "detail" | "done";
  currentPage: number;
  totalPages: number | null;
  itemsFound: number;
  itemsProcessed: number;
  itemsSkipped: number;
  itemsFailed: number;
  message: string;
}

export interface ScrapeResult {
  success: boolean;
  log: ScrapeLog;
  documents: ScrapedDocument[];
  errors: string[];
}

// ============================================================
// 유틸리티 함수
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHtml(url: string, retries: number = 2): Promise<string> {
  const settings = readDownloadSettings();
  const maxRetries = settings.retry?.maxRetries ?? retries;
  const retryIntervalSec = settings.retry?.retryIntervalSec ?? 1;
  const useExponentialBackoff = settings.retry?.useExponentialBackoff ?? true;
  const timeoutSec = settings.retry?.timeoutSec ?? 30;
  const userAgent = settings.network?.customUserAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EcoMonitorBot/1.0";

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const waitMs = useExponentialBackoff
        ? retryIntervalSec * Math.pow(2, attempt - 1) * 1000
        : retryIntervalSec * 1000;
      await delay(waitMs);
    }
    
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        signal: AbortSignal.timeout(Math.max(1, timeoutSec * 1000)),
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

// ============================================================
// 날짜 파싱 및 필터링
// ============================================================

/**
 * 다양한 날짜 형식 파싱
 * - 2024-01-15
 * - 2024.01.15
 * - 2024/01/15
 * - 24-01-15
 * - 2024년 1월 15일
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const cleaned = dateStr.replace(/\s+/g, " ").trim();
  
  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD
  let match = cleaned.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  
  // YY-MM-DD, YY.MM.DD
  match = cleaned.match(/(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1]) + 2000;
    return new Date(year, parseInt(match[2]) - 1, parseInt(match[3]));
  }
  
  // 2024년 1월 15일
  match = cleaned.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  
  return null;
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 포맷
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 수집 범위 필터 체크
 * 
 * @returns true면 수집 대상, false면 스킵, "stop"이면 수집 중단
 */
export function checkCollectionRange(
  itemDate: Date | null,
  range: WebConfig["collection_range"]
): boolean | "stop" {
  if (!range || !range.type) return true;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  switch (range.type) {
    case "period": {
      if (!itemDate) return true; // 날짜 없으면 일단 수집
      
      const startDate = range.start_date ? new Date(range.start_date) : null;
      const endDate = range.end_date ? new Date(range.end_date) : null;
      
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);
      
      // 종료일 이후 → 스킵 (아직 범위 내 도달 안 함)
      if (endDate && itemDate > endDate) return false;
      
      // 시작일 이전 → 중단 (이미 범위 지남)
      if (startDate && itemDate < startDate) return "stop";
      
      return true;
    }
    
    case "relative": {
      if (!itemDate) return true;
      
      const daysBefore = range.days_before || 30;
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() - daysBefore);
      
      // 기준일 이전 → 중단
      if (itemDate < cutoffDate) return "stop";
      
      return true;
    }
    
    case "yearly": {
      if (!itemDate || !range.years || range.years.length === 0) return true;
      
      const itemYear = itemDate.getFullYear();
      
      // 대상 연도 목록에 포함되어 있으면 수집
      if (range.years.includes(itemYear)) return true;
      
      // 대상 연도 중 가장 오래된 연도보다 이전이면 중단
      const minYear = Math.min(...range.years);
      if (itemYear < minYear) return "stop";
      
      return false;
    }
    
    default:
      return true;
  }
}

// ============================================================
// 페이지네이션 처리
// ============================================================

export interface PaginationState {
  currentPage: number;
  hasMore: boolean;
  nextUrl: string | null;
}

/**
 * 다음 페이지 URL 생성
 */
export function getNextPageUrl(
  baseUrl: string,
  currentPage: number,
  pagination: WebConfig["list"]["pagination"],
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
        const nextOffset = start + (currentPage * step);
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
      
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * 페이지에 더 많은 항목이 있는지 확인
 */
export function hasMoreItems(
  items: ScrapingItem[],
  pagination: WebConfig["list"]["pagination"],
  $?: cheerio.CheerioAPI
): boolean {
  if (!pagination || pagination.type === "none") return false;
  
  // 항목이 없으면 더 이상 없음
  if (items.length === 0) return false;
  
  // next_button의 경우 버튼 존재 여부로 판단
  if (pagination.type === "next_button" && $ && pagination.selector) {
    return $(pagination.selector).length > 0;
  }
  
  // page_param, offset_param의 경우 항목이 있으면 다음 페이지 시도
  return true;
}

// ============================================================
// 목록 페이지 파싱
// ============================================================

/**
 * 목록 페이지에서 항목 추출
 */
export function parseListPage(
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
    if (!link || link === "#" || link.startsWith("javascript:")) {
      const onclick = $linkEl.attr("onclick") || $item.attr("onclick") || "";
      
      // 1) article.view('id') 패턴 (산업통상자원부)
      const articleViewMatch = onclick.match(/article\.view\s*\(\s*['"]?(\d+)['"]?\s*\)/i);
      if (articleViewMatch) {
        try {
          const urlObj = new URL(baseUrl);
          link = `${urlObj.pathname}/${articleViewMatch[1]}/view`;
        } catch {
          link = `${baseUrl}/${articleViewMatch[1]}/view`;
        }
      }
      
      // 2) doBbsFView 패턴 (중소벤처기업부)
      if (!link || link === "#" || link.startsWith("javascript:")) {
        const bbsFViewMatch = onclick.match(/doBbsFView\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/i);
        if (bbsFViewMatch) {
          try {
            const urlObj = new URL(baseUrl);
            let basePath = urlObj.pathname.replace(/List\.do$/i, "View.do").replace(/list\.do$/i, "View.do");
            urlObj.pathname = basePath;
            urlObj.searchParams.set("cbIdx", bbsFViewMatch[1]);
            urlObj.searchParams.set("bcIdx", bbsFViewMatch[2]);
            link = urlObj.pathname + urlObj.search;
          } catch {}
        }
      }
      
      // 3) 일반 URL 패턴
      if (!link || link === "#" || link.startsWith("javascript:")) {
        const urlMatch = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
        if (urlMatch) link = urlMatch[1];
      }
    }
    
    if (link && !link.startsWith("http")) {
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
// 상세 페이지 파싱
// ============================================================

export interface DetailPageResult {
  content: string;
  attachments: { fileName: string; downloadUrl: string }[];
}

/**
 * onclick 속성에서 URL 추출
 */
function tryExtractUrlFromOnclick(onclick: string): string | null {
  if (!onclick) return null;
  // 1) quoted URL-ish string
  const m1 = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
  if (m1?.[1]) return m1[1];
  // 2) javascript:location.href='...'
  const m2 = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m2?.[1]) return m2[1];
  // 3) window.open('...')
  const m3 = onclick.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
  if (m3?.[1]) return m3[1];
  return null;
}

/**
 * 텍스트가 첨부파일명처럼 보이는지 확인
 */
function looksLikeAttachmentName(text: string): boolean {
  const t = (text || "").toLowerCase();
  const exts = [
    ".hwp", ".hwpx", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv",
    ".ppt", ".pptx", ".zip", ".rar", ".7z"
  ];
  if (exts.some((e) => t.includes(e))) return true;
  return /\(\s*[\d.]+\s*[kmg]b\s*\)\s*$/i.test(text || "");
}

/**
 * 상세 페이지에서 본문 및 첨부파일 추출
 */
export async function parseDetailPage(
  url: string,
  config: WebConfig
): Promise<DetailPageResult> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  // 본문 추출
  let content = "";
  if (config.collect_body) {
    const contentSelectors = [
      config.detail?.content_selector,
      ".view_con", ".view_cont", ".view_content", ".viewContent",
      ".board_view_content", ".bbs_content", ".bbsContent",
      ".article_content", ".article_body", ".articleBody",
      ".post_content", ".post_body",
      "article .content", "article .body",
      ".content_area", "#content .text",
      "article", ".content", "#content"
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
      // 앞부분 메뉴 텍스트 제거
      const mainIdx = bodyText.indexOf("본문내용");
      if (mainIdx > 0 && mainIdx < 200) {
        bodyText = bodyText.slice(mainIdx + 4).trim();
      }
      content = bodyText.slice(0, 5000);
    }
  }
  
  // ============================================================
  // 첨부파일 추출 (다양한 패턴 지원)
  // ============================================================
  const attachments: DetailPageResult["attachments"] = [];
  const seenUrls = new Set<string>();
  
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
    
    // 크기 정보 제거 (예: "(858.3 KB)", "[123.2 KB]")
    fileName = fileName
      .replace(/\s*\([^)]*[KMG]B\)\s*$/i, "")  // (123.2 KB) 형태
      .replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "") // [123.2 KB] 형태
      .trim();
    if (!fileName) fileName = "unknown";
    
    attachments.push({ fileName, downloadUrl });
  };
  
  if (config.attachments?.enabled) {
    // ── 전략 1: 파일 확장자 기반 선택자 ──
    const extSelectors = [
      "a[href*='.hwp']", "a[href*='.hwpx']", "a[href*='.pdf']",
      "a[href*='.doc']", "a[href*='.docx']", "a[href*='.xls']",
      "a[href*='.xlsx']", "a[href*='.csv']", "a[href*='.zip']",
      "a[href*='.ppt']", "a[href*='.pptx']",
    ];
    
    // ── 전략 2: 다운로드 관련 선택자 ──
    const downloadSelectors = [
      "a[href*='download']", "a[href*='fileDown']", "a[href*='file_down']",
      "a[href*='atchFileDown']", "a[href*='AttachDown']",
      "a[onclick*='download']", "a[onclick*='fileDown']",
      ".file_list a", ".attach a", ".file a", ".file_area a",
      ".attachment a", ".attachFile a", ".atch_file a",
      "ul.file li a", "div.file a", "table.file a",
    ];
    
    // 커스텀 선택자
    if (config.attachments.selector) {
      downloadSelectors.push(config.attachments.selector);
    }
    
    const allSelectors = [...extSelectors, ...downloadSelectors].join(", ");
    
    $(allSelectors).each((_, el) => {
      const $a = $(el);
      let href = $a.attr("href") || "";
      const onclick = $a.attr("onclick") || "";
      
      // onclick에서 URL 추출 시도
      if (!href && onclick) {
        const extracted = tryExtractUrlFromOnclick(onclick);
        if (extracted) href = extracted;
      }
      
      if (!href) return;
      
      const downloadUrl = resolveUrl(url, href);
      if (seenUrls.has(downloadUrl)) return;
      
      // 파일명 추출
      const fileName = $a.text().replace(/\s+/g, " ").trim();
      
      // 파일 유형 체크
      const validExts = config.attachments?.file_types || 
        ["hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "zip", "rar", "7z"];
      
      const hasValidExt = validExts.some(ext => 
        fileName.toLowerCase().includes(`.${ext}`) || downloadUrl.toLowerCase().includes(`.${ext}`)
      );
      const isDownloadUrl = /download|filedown|attach/i.test(downloadUrl);
      
      if (config.attachments?.collect_all || hasValidExt || isDownloadUrl) {
        pushAttachment(fileName, href);
      }
    });
    
    // ── 전략 3: '첨부파일' 라벨 주변에서 링크 수집 ──
    if (attachments.length === 0) {
      const labelEls = $("th, dt, strong, span, p")
        .toArray()
        .filter((el) => $(el).text().replace(/\s+/g, "").includes("첨부파일"));
      
      for (const el of labelEls.slice(0, 5)) {
        const $lab = $(el);
        const $cand = $lab.closest("tr").find("td")
          .add($lab.closest("dl").find("dd"))
          .add($lab.parent());
        
        $cand.find("a").each((_, a) => {
          const $a = $(a);
          const txt = $a.text().replace(/\s+/g, " ").trim();
          const href = $a.attr("href") || "";
          const onclick = $a.attr("onclick") || "";
          const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick) : null;
          const urlRaw = href || urlFromOnclick || "";
          
          if (!urlRaw) return;
          if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;
          
          pushAttachment(txt, urlRaw);
        });
      }
    }
    
    // ── 전략 4: 최후 fallback - 전체 a 중 파일패턴 검색 ──
    if (attachments.length === 0) {
      $("a").each((_, a) => {
        const $a = $(a);
        const txt = $a.text().replace(/\s+/g, " ").trim();
        const href = $a.attr("href") || "";
        const onclick = $a.attr("onclick") || "";
        const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick) : null;
        const urlRaw = href || urlFromOnclick || "";
        
        if (!urlRaw) return;
        if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;
        
        pushAttachment(txt, urlRaw);
      });
    }
  }
  
  return { content, attachments };
}

// ============================================================
// 메인 스크래핑 엔진
// ============================================================

/**
 * 범용 스크래핑 실행
 */
export async function runScraper(options: ScrapingOptions): Promise<ScrapeResult> {
  const {
    boardId,
    orgId,
    listUrl,
    webConfig,
    dedupKey = "url",
    scheduleId,
    maxPages,
    delayMs = 500,
    onProgress,
  } = options;
  
  console.log(`[runScraper] ▶ 시작: boardId=${boardId}, listUrl=${listUrl?.slice(0, 60)}...`);
  
  const errors: string[] = [];
  const documents: ScrapedDocument[] = [];
  
  // DB 초기화
  console.log(`[runScraper]   1. DB 초기화 중...`);
  try {
    await getDbAsync();
    console.log(`[runScraper]   ✓ DB 초기화 완료`);
  } catch (dbErr: any) {
    console.error(`[runScraper]   ✗ DB 초기화 실패:`, dbErr.message);
    throw dbErr;
  }
  
  // 스크래핑 로그 시작
  console.log(`[runScraper]   2. 스크래핑 로그 시작...`);
  let log;
  try {
    log = await startScrapeLog(boardId, scheduleId);
    console.log(`[runScraper]   ✓ 스크래핑 로그 시작 완료 (log_id: ${log.log_id})`);
  } catch (logErr: any) {
    console.error(`[runScraper]   ✗ 스크래핑 로그 시작 실패:`, logErr.message);
    throw logErr;
  }
  
  let stats = {
    docs_scraped: 0,
    docs_skipped: 0,
    docs_failed: 0,
    pages_processed: 0,
  };
  
  const reportProgress = (phase: ScrapeProgress["phase"], message: string) => {
    if (onProgress) {
      onProgress({
        phase,
        currentPage: stats.pages_processed,
        totalPages: maxPages || null,
        itemsFound: stats.docs_scraped + stats.docs_skipped + stats.docs_failed,
        itemsProcessed: stats.docs_scraped,
        itemsSkipped: stats.docs_skipped,
        itemsFailed: stats.docs_failed,
        message,
      });
    }
  };
  
  try {
    let currentUrl: string | null = listUrl;
    let currentPage = 0;
    let shouldStop = false;
    
    console.log(`[runScraper]   3. 페이지 순회 시작...`);
    
    // ============ 페이지 순회 ============
    while (currentUrl && !shouldStop) {
      if (maxPages && currentPage >= maxPages) {
        console.log(`[runScraper]      최대 페이지 도달 (${maxPages}), 종료`);
        break;
      }
      
      console.log(`[runScraper]      페이지 ${currentPage + 1} 처리 중... URL: ${currentUrl.slice(0, 80)}...`);
      reportProgress("list", `페이지 ${currentPage + 1} 처리 중...`);
      
      // 목록 페이지 fetch
      let html: string;
      try {
        console.log(`[runScraper]      fetchHtml 호출...`);
        html = await fetchHtml(currentUrl);
        console.log(`[runScraper]      ✓ HTML 가져옴 (${html.length} bytes)`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[runScraper]      ✗ fetchHtml 실패:`, errorMessage);
        errors.push(`페이지 ${currentPage + 1} 접근 실패: ${errorMessage}`);
        break;
      }
      
      // 목록 파싱
      console.log(`[runScraper]      parseListPage 호출...`);
      const { items, $ } = parseListPage(html, currentUrl, webConfig);
      console.log(`[runScraper]      ✓ 파싱 완료, 발견된 항목: ${items.length}개`);
      
      if (items.length === 0) {
        // 항목이 없으면 종료
        console.log(`[runScraper]      항목 없음, 페이지 순회 종료`);
        break;
      }
      
      stats.pages_processed++;
      
      // ============ 항목 처리 ============
      console.log(`[runScraper]      항목 처리 시작 (${items.length}개)...`);
      let itemIndex = 0;
      let consecutiveStopCount = 0; // 연속 "stop" 횟수 (상단 고정 공지글 처리용)
      const STOP_THRESHOLD = 3; // 연속 3개 이상 오래된 항목이면 중단
      
      for (const item of items) {
        itemIndex++;
        
        // 날짜 파싱 및 범위 체크
        const itemDate = parseDate(item.date || "");
        const rangeCheck = checkCollectionRange(itemDate, webConfig.collection_range);
        
        if (rangeCheck === "stop") {
          consecutiveStopCount++;
          console.log(`[runScraper]         [${itemIndex}] 날짜 범위 밖 (연속 ${consecutiveStopCount}개): ${item.title?.slice(0, 30)}...`);
          console.log(`[runScraper]            날짜: ${item.date} → 파싱결과: ${itemDate}`);
          // 연속으로 STOP_THRESHOLD개 이상의 오래된 항목이 나오면 중단
          // (상단 고정 공지글이 1-2개 있는 경우를 허용)
          if (consecutiveStopCount >= STOP_THRESHOLD) {
            console.log(`[runScraper]         [${itemIndex}] 연속 ${consecutiveStopCount}개 - 페이지 순회 중단`);
            shouldStop = true;
            break;
          }
          stats.docs_skipped++;
          continue;
        }
        
        // 범위 내 항목이 나오면 연속 카운트 리셋
        consecutiveStopCount = 0;
        
        if (rangeCheck === false) {
          console.log(`[runScraper]         [${itemIndex}] 날짜 범위 밖, 스킵: ${item.title?.slice(0, 30)}...`);
          stats.docs_skipped++;
          continue;
        }
        
        // 문서 ID 생성
        const docId = generateDocId(item, boardId, dedupKey);
        
        // 중복 체크
        if (await documentExists(docId)) {
          console.log(`[runScraper]         [${itemIndex}] 중복, 스킵: ${item.title?.slice(0, 30)}...`);
          stats.docs_skipped++;
          continue;
        }
        
        console.log(`[runScraper]         [${itemIndex}] 새 문서 처리: ${item.title?.slice(0, 40)}...`);
        
        // 상세 페이지 처리
        let content = "";
        let attachments: DetailPageResult["attachments"] = [];
        
        if (webConfig.collect_body || webConfig.attachments?.enabled) {
          try {
            console.log(`[runScraper]            상세 페이지 처리 중... (딜레이: ${delayMs}ms)`);
            await delay(delayMs); // Rate limiting
            const detail = await parseDetailPage(item.link, webConfig);
            content = detail.content;
            attachments = detail.attachments;
            console.log(`[runScraper]            ✓ 상세 완료: 본문 ${content.length}자, 첨부 ${attachments.length}개`);
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.log(`[runScraper]            ✗ 상세 실패: ${errorMessage}`);
            errors.push(`상세 페이지 실패 (${item.title}): ${errorMessage}`);
            stats.docs_failed++;
            continue;
          }
        }
        
        // 문서 저장
        console.log(`[runScraper]            문서 저장 중...`);
        const now = new Date().toISOString();
        const doc: Omit<ScrapedDocument, "updated_at"> = {
          doc_id: docId,
          board_id: boardId,
          org_id: orgId,
          title: item.title,
          content,
          published_date: itemDate ? formatDate(itemDate) : null,
          source_url: item.link,
          scraped_at: now,
          metadata: {
            author: item.author,
            raw_date: item.date,
          },
        };
        
        const savedDoc = await saveDocument(doc);
        documents.push(savedDoc);
        console.log(`[runScraper]            ✓ 문서 저장 완료 (doc_id: ${docId.slice(0, 20)}...)`);
        
        // 첨부파일 저장
        if (attachments.length > 0) {
          console.log(`[runScraper]            첨부파일 ${attachments.length}개 DB 저장 중...`);
        }
        for (const att of attachments) {
          const fileId = generateFileId(att.downloadUrl, docId);
          const fileType = att.fileName.split(".").pop()?.toLowerCase() || "";
          
          await saveAttachment({
            file_id: fileId,
            doc_id: docId,
            file_name: att.fileName,
            file_type: fileType,
            file_size: null,
            download_url: att.downloadUrl,
            local_path: null,
            downloaded_at: null,
            status: "pending",
          });
        }
        
        stats.docs_scraped++;
        
        reportProgress("detail", `${item.title} 저장 완료`);
      }
      
      console.log(`[runScraper]      항목 처리 완료: scraped=${stats.docs_scraped}, skipped=${stats.docs_skipped}, failed=${stats.docs_failed}`);
      console.log(`[runScraper]      shouldStop=${shouldStop}`);
      
      if (shouldStop) {
        console.log(`[runScraper]      날짜 범위 종료 조건 발생, 페이지 순회 중단`);
        break;
      }
      
      // 다음 페이지 URL
      if (!shouldStop && hasMoreItems(items, webConfig.list?.pagination, $)) {
        currentUrl = getNextPageUrl(
          listUrl,
          currentPage + 1,
          webConfig.list?.pagination,
          $
        );
        currentPage++;
        
        if (currentUrl) {
          await delay(delayMs);
        }
      } else {
        currentUrl = null;
      }
    }
    
    // 완료
    const finalStatus = stats.docs_failed > 0 
      ? (stats.docs_scraped > 0 ? "partial" : "failed")
      : "success";
    
    await finishScrapeLog(log.log_id, finalStatus, stats);
    
    reportProgress("done", `완료: ${stats.docs_scraped}건 수집, ${stats.docs_skipped}건 스킵`);
    
    return {
      success: finalStatus !== "failed",
      log: { ...log, ...stats, status: finalStatus, finished_at: new Date().toISOString() },
      documents,
      errors,
    };
    
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    errors.push(`치명적 오류: ${errorMessage}`);
    await finishScrapeLog(log.log_id, "failed", stats, errorMessage);
    
    return {
      success: false,
      log: { ...log, ...stats, status: "failed", finished_at: new Date().toISOString(), error_message: errorMessage },
      documents,
      errors,
    };
  }
}

// ============================================================
// 테스트용 간단 실행 함수
// ============================================================

/**
 * 단일 보드 스크래핑 테스트 (최대 2페이지, 10건)
 */
export async function testScraper(
  boardId: string,
  orgId: string,
  listUrl: string,
  webConfig: WebConfig,
  dedupKey: DedupKeyType = "url"
): Promise<{
  success: boolean;
  items: Array<{
    title: string;
    link: string;
    date?: string;
    content_preview?: string;
    attachments_count: number;
    is_duplicate: boolean;
  }>;
  logs: string[];
}> {
  const logs: string[] = [];
  const items: Array<{
    title: string;
    link: string;
    date?: string;
    content_preview?: string;
    attachments_count: number;
    is_duplicate: boolean;
  }> = [];
  
  try {
    // DB 초기화
    await getDbAsync();
    
    logs.push("========================================");
    logs.push("       🔍 스크래핑 테스트 시작");
    logs.push("========================================");
    logs.push(`[INFO] URL: ${listUrl}`);
    logs.push(`[INFO] 중복 제거: ${dedupKey}`);
    logs.push("");
    
    // 목록 페이지
    logs.push("── 📋 목록 페이지 ──");
    const html = await fetchHtml(listUrl);
    const { items: listItems } = parseListPage(html, listUrl, webConfig);
    logs.push(`[INFO] 발견된 항목: ${listItems.length}개`);
    
    // 최대 5개만 테스트
    const testItems = listItems.slice(0, 5);
    logs.push("");
    logs.push("── 📄 상세 페이지 테스트 ──");
    
    for (const item of testItems) {
      const docId = generateDocId(item, boardId, dedupKey);
      const isDuplicate = await documentExists(docId);
      
      logs.push(`[${isDuplicate ? "SKIP" : "NEW"}] ${item.title.slice(0, 40)}...`);
      
      let contentPreview = "";
      let attachmentsCount = 0;
      
      if (!isDuplicate && (webConfig.collect_body || webConfig.attachments?.enabled)) {
        try {
          await delay(300);
          const detail = await parseDetailPage(item.link, webConfig);
          contentPreview = detail.content.slice(0, 100);
          attachmentsCount = detail.attachments.length;
          logs.push(`       본문: ${contentPreview.slice(0, 50)}...`);
          logs.push(`       첨부: ${attachmentsCount}개`);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logs.push(`       [ERROR] ${errorMessage}`);
        }
      }
      
      items.push({
        title: item.title,
        link: item.link,
        date: item.date,
        content_preview: contentPreview,
        attachments_count: attachmentsCount,
        is_duplicate: isDuplicate,
      });
    }
    
    logs.push("");
    logs.push("========================================");
    logs.push("       ✅ 테스트 완료");
    logs.push("========================================");
    
    return { success: true, items, logs };
    
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logs.push(`[ERROR] ${errorMessage}`);
    return { success: false, items, logs };
  }
}
