/**
 * GitHub Actions용 스크래핑 실행 모듈
 * 
 * 기존 API route의 스크래핑 로직을 CLI에서 실행 가능하도록 분리한 모듈입니다.
 * Next.js 의존성 없이 독립적으로 실행됩니다.
 */

import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { chromium, Browser, Page } from "playwright";

// ============================================================
// 타입 정의
// ============================================================

export interface WebConfig {
  rendering?: "static_html" | "dynamic_js";
  list?: {
    container_selector?: string;
    item_selector?: string;
    pagination?: {
      type: "page_param" | "offset_param" | "next_button" | "none" | "javascript";
      param?: string;
      selector?: string;
      start?: number;
      step?: number;
      max_pages?: number;
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

export interface Board {
  board_id: string;
  org_id: string;
  board_name: string;
  access_mode: string;
  list_url?: string;
  enabled: boolean;
  web_config?: WebConfig;
  collection_range?: {
    type: string;
    period_start?: string;
    period_end?: string;
    relative_days?: number;
    years?: number[];
  };
  collection_targets?: {
    title_body?: boolean;
    attachments?: {
      enabled?: boolean;
      all?: boolean;
    };
  };
  browser_config?: {
    browser_type?: string;
    headless?: boolean;
    wait_time?: number;
    wait_for_selector?: string;
  };
}

export interface Organization {
  org_id: string;
  org_name: string;
  base_url: string;
}

export interface ScrapedArticle {
  title: string;
  date: string;
  link: string;
  content?: string;
  attachments: Array<{
    fileName: string;
    downloadUrl: string;
    localPath?: string;
  }>;
}

export interface ScrapingResult {
  success: boolean;
  boardId: string;
  boardName: string;
  orgId: string;
  orgName: string;
  articlesCount: number;
  attachmentsCount: number;
  articles: ScrapedArticle[];
  errors: string[];
  executedAt: string;
  durationMs: number;
}

// ============================================================
// 유틸리티 함수
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

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

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function checkCollectionRange(
  itemDate: Date | null,
  range: WebConfig["collection_range"]
): boolean | "stop" {
  if (!range || !range.type) return true;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  switch (range.type) {
    case "period": {
      if (!itemDate) return true;
      
      const startDate = range.start_date ? new Date(range.start_date) : null;
      const endDate = range.end_date ? new Date(range.end_date) : null;
      
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);
      
      if (endDate && itemDate > endDate) return false;
      if (startDate && itemDate < startDate) return "stop";
      
      return true;
    }
    
    case "relative": {
      if (!itemDate) return true;
      
      const daysBefore = range.days_before || 30;
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
// HTML 파싱
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
  
  console.log(`[parseListPage] container="${containerSelector}", items="${itemSelector}", found=${$items.length}`);
  
  $items.each((idx, el) => {
    const $item = $(el);
    
    const $titleEl = $item.find(titleSelector).first();
    const title = cleanText($titleEl.text());
    
    const $linkEl = $item.find(linkSelector).first();
    let link = $linkEl.attr("href") || "";
    
    // onclick에서 URL 추출 시도
    if (!link || link === "#" || link.startsWith("javascript:")) {
      const onclick = $linkEl.attr("onclick") || $item.attr("onclick") || "";
      
      const articleViewMatch = onclick.match(/article\.view\s*\(\s*['"]?(\d+)['"]?\s*\)/i);
      if (articleViewMatch) {
        try {
          const urlObj = new URL(baseUrl);
          link = `${urlObj.pathname}/${articleViewMatch[1]}/view`;
        } catch {
          link = `${baseUrl}/${articleViewMatch[1]}/view`;
        }
      }
      
      if (!link || link === "#" || link.startsWith("javascript:")) {
        const urlMatch = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
        if (urlMatch) link = urlMatch[1];
      }
    }
    
    if (link && !link.startsWith("http")) {
      link = resolveUrl(baseUrl, link);
    }
    
    let date = "";
    if (dateSelector) {
      const $dateEl = $item.find(dateSelector).first();
      date = cleanText($dateEl.text());
    }
    
    let author = "";
    if (authorSelector) {
      const $authorEl = $item.find(authorSelector).first();
      author = cleanText($authorEl.text());
    }
    
    if (title && title.length >= 2 && link) {
      items.push({ title, link, date, author });
      if (idx < 3) {
        console.log(`[parseListPage] item[${idx}] title="${title.slice(0, 50)}...", date="${date}"`);
      }
    }
  });
  
  return { items, $ };
}

// ============================================================
// 브라우저 관리
// ============================================================

let globalBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  
  globalBrowser = await chromium.launch({
    headless: true,
    timeout: 60000,
  });
  
  return globalBrowser;
}

async function closeBrowser(): Promise<void> {
  if (globalBrowser) {
    await globalBrowser.close().catch(() => {});
    globalBrowser = null;
  }
}

async function fetchRenderedHtml(url: string, waitTime: number = 2000): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "ko-KR",
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    
    await page.waitForTimeout(waitTime);
    
    return await page.content();
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function fetchStaticHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  
  return res.text();
}

// ============================================================
// 첨부파일 추출
// ============================================================

interface AttachmentInfo {
  fileName: string;
  downloadUrl: string;
}

function extractAttachmentsFromHtml(
  html: string,
  baseUrl: string,
  selector?: string
): AttachmentInfo[] {
  const $ = cheerio.load(html);
  const attachments: AttachmentInfo[] = [];
  const seenUrls = new Set<string>();
  
  // 파일 확장자 기반 선택자
  const extSelectors = [
    "a[href*='.hwp']", "a[href*='.hwpx']", "a[href*='.pdf']",
    "a[href*='.doc']", "a[href*='.docx']", "a[href*='.xls']",
    "a[href*='.xlsx']", "a[href*='.csv']", "a[href*='.zip']",
    "a[href*='.ppt']", "a[href*='.pptx']",
  ];
  
  // 다운로드 관련 선택자
  const downloadSelectors = [
    "a[href*='download']", "a[href*='fileDown']",
    ".file_list a", ".attach a", ".file a",
    ".attachment a", ".atch_file a",
  ];
  
  if (selector) {
    downloadSelectors.push(selector);
  }
  
  const allSelectors = [...extSelectors, ...downloadSelectors].join(", ");
  
  $(allSelectors).each((_, el) => {
    const $a = $(el);
    let href = $a.attr("href") || "";
    
    if (!href) return;
    
    const downloadUrl = resolveUrl(baseUrl, href);
    if (seenUrls.has(downloadUrl)) return;
    seenUrls.add(downloadUrl);
    
    let fileName = $a.text().replace(/\s+/g, " ").trim();
    
    // 크기 정보 제거
    fileName = fileName
      .replace(/\s*\([^)]*[KMG]B\)\s*$/i, "")
      .replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "")
      .trim();
    
    if (!fileName || fileName.length < 3) {
      try {
        const u = new URL(downloadUrl);
        fileName = decodeURIComponent(u.pathname.split("/").pop() || "unknown");
      } catch {
        fileName = "unknown";
      }
    }
    
    const validExts = ["hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "zip"];
    const hasValidExt = validExts.some(ext => 
      fileName.toLowerCase().includes(`.${ext}`) || 
      downloadUrl.toLowerCase().includes(`.${ext}`)
    );
    const isDownloadUrl = /download|filedown|attach/i.test(downloadUrl);
    
    if (hasValidExt || isDownloadUrl) {
      attachments.push({ fileName, downloadUrl });
    }
  });
  
  return attachments;
}

// ============================================================
// 상세 페이지 처리
// ============================================================

async function parseDetailPage(
  url: string,
  config: WebConfig,
  useBrowser: boolean = false
): Promise<{ content: string; attachments: AttachmentInfo[] }> {
  let html: string;
  
  if (useBrowser) {
    html = await fetchRenderedHtml(url);
  } else {
    html = await fetchStaticHtml(url);
  }
  
  const $ = cheerio.load(html);
  
  // 본문 추출
  let content = "";
  if (config.collect_body) {
    const contentSelectors = [
      config.detail?.content_selector,
      ".view_con", ".view_cont", ".view_content",
      ".board_view_content", ".bbs_content",
      ".article_content", ".article_body",
      ".post_content", ".post_body",
      "article .content", "article .body",
      ".content_area", "#content .text",
      "article", ".content", "#content"
    ].filter(Boolean);
    
    for (const selector of contentSelectors) {
      const $content = $(selector as string).first();
      if ($content.length > 0) {
        $content.find("script, style, nav, header, footer").remove();
        const text = cleanText($content.text());
        if (text.length > 50) {
          content = text;
          break;
        }
      }
    }
  }
  
  // 첨부파일 추출
  const attachments = extractAttachmentsFromHtml(
    html, 
    url, 
    config.attachments?.selector || config.detail?.attachments_selector
  );
  
  return { content, attachments };
}

// ============================================================
// 파일 다운로드
// ============================================================

async function downloadFile(
  url: string,
  outputPath: string,
  referer?: string
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(referer ? { "Referer": referer } : {}),
      },
      signal: AbortSignal.timeout(60000),
    });
    
    if (!res.ok) {
      console.error(`[DOWNLOAD] HTTP ${res.status}: ${url}`);
      return false;
    }
    
    const buffer = await res.arrayBuffer();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    
    console.log(`[DOWNLOAD] 저장: ${path.basename(outputPath)} (${buffer.byteLength} bytes)`);
    return true;
  } catch (err: any) {
    console.error(`[DOWNLOAD] 실패: ${url} - ${err.message}`);
    return false;
  }
}

// ============================================================
// 메인 스크래핑 함수
// ============================================================

export interface ScraperOptions {
  board: Board;
  org: Organization;
  outputDir: string;
  maxPages?: number;
  downloadAttachments?: boolean;
}

export async function runScraper(options: ScraperOptions): Promise<ScrapingResult> {
  const { board, org, outputDir, maxPages = 10, downloadAttachments = true } = options;
  const startTime = Date.now();
  
  const result: ScrapingResult = {
    success: false,
    boardId: board.board_id,
    boardName: board.board_name,
    orgId: org.org_id,
    orgName: org.org_name,
    articlesCount: 0,
    attachmentsCount: 0,
    articles: [],
    errors: [],
    executedAt: new Date().toISOString(),
    durationMs: 0,
  };
  
  console.log(`\n========================================`);
  console.log(`스크래핑 시작: ${org.org_name} - ${board.board_name}`);
  console.log(`========================================\n`);
  
  try {
    const listUrl = board.list_url;
    if (!listUrl) {
      throw new Error("list_url이 설정되지 않았습니다");
    }
    
    // web_config 구성
    const webConfig: WebConfig = {
      ...(board.web_config as WebConfig || {}),
      collect_body: board.collection_targets?.title_body ?? true,
      attachments: {
        enabled: board.collection_targets?.attachments?.enabled ?? true,
        collect_all: board.collection_targets?.attachments?.all ?? false,
      },
      collection_range: board.collection_range ? {
        type: board.collection_range.type as any,
        start_date: board.collection_range.period_start,
        end_date: board.collection_range.period_end,
        days_before: board.collection_range.relative_days,
        years: board.collection_range.years,
      } : undefined,
    };
    
    const useBrowser = board.access_mode === "dynamic_js";
    let currentPage = 0;
    let shouldStop = false;
    const seenUrls = new Set<string>();
    
    // 출력 디렉토리 생성
    const boardOutputDir = path.join(outputDir, board.board_id);
    const attachmentsDir = path.join(boardOutputDir, "attachments");
    fs.mkdirSync(attachmentsDir, { recursive: true });
    
    while (!shouldStop && currentPage < maxPages) {
      currentPage++;
      console.log(`\n--- 페이지 ${currentPage} 처리 중 ---`);
      
      // 페이지 URL 구성
      let pageUrl = listUrl;
      const pagination = webConfig.list?.pagination;
      if (pagination && currentPage > 1) {
        if (pagination.type === "page_param") {
          const param = pagination.param || "page";
          const urlObj = new URL(listUrl);
          urlObj.searchParams.set(param, String(currentPage));
          pageUrl = urlObj.toString();
        } else if (pagination.type === "offset_param") {
          const param = pagination.param || "offset";
          const step = pagination.step || 10;
          const urlObj = new URL(listUrl);
          urlObj.searchParams.set(param, String((currentPage - 1) * step));
          pageUrl = urlObj.toString();
        }
      }
      
      // 목록 페이지 가져오기
      let html: string;
      try {
        if (useBrowser) {
          html = await fetchRenderedHtml(pageUrl, board.browser_config?.wait_time || 2000);
        } else {
          html = await fetchStaticHtml(pageUrl);
        }
      } catch (err: any) {
        result.errors.push(`페이지 ${currentPage} 로드 실패: ${err.message}`);
        break;
      }
      
      // 목록 파싱
      const { items } = parseListPage(html, pageUrl, webConfig);
      
      if (items.length === 0) {
        console.log("항목 없음, 종료");
        break;
      }
      
      console.log(`${items.length}개 항목 발견`);
      
      // 각 항목 처리
      let consecutiveStopCount = 0;
      const STOP_THRESHOLD = 3;
      
      for (const item of items) {
        // 중복 체크
        if (seenUrls.has(item.link)) {
          continue;
        }
        seenUrls.add(item.link);
        
        // 날짜 범위 체크
        const itemDate = parseDate(item.date || "");
        const rangeCheck = checkCollectionRange(itemDate, webConfig.collection_range);
        
        if (rangeCheck === "stop") {
          consecutiveStopCount++;
          if (consecutiveStopCount >= STOP_THRESHOLD) {
            console.log(`날짜 범위 종료 (연속 ${STOP_THRESHOLD}개)`);
            shouldStop = true;
            break;
          }
          continue;
        }
        
        consecutiveStopCount = 0;
        
        if (rangeCheck === false) {
          continue;
        }
        
        console.log(`[NEW] ${item.title.slice(0, 50)}...`);
        
        // 상세 페이지 처리
        let content = "";
        let attachments: AttachmentInfo[] = [];
        
        if (webConfig.collect_body || webConfig.attachments?.enabled) {
          try {
            await delay(500);
            const detail = await parseDetailPage(item.link, webConfig, useBrowser);
            content = detail.content;
            attachments = detail.attachments;
            console.log(`  본문: ${content.length}자, 첨부: ${attachments.length}개`);
          } catch (err: any) {
            result.errors.push(`상세 페이지 실패 (${item.title}): ${err.message}`);
            continue;
          }
        }
        
        // 첨부파일 다운로드
        const downloadedAttachments: ScrapedArticle["attachments"] = [];
        
        if (downloadAttachments && attachments.length > 0) {
          for (const att of attachments) {
            const safeFileName = att.fileName.replace(/[<>:"/\\|?*]/g, "_");
            const localPath = path.join(attachmentsDir, safeFileName);
            
            const success = await downloadFile(att.downloadUrl, localPath, item.link);
            
            downloadedAttachments.push({
              fileName: att.fileName,
              downloadUrl: att.downloadUrl,
              localPath: success ? localPath : undefined,
            });
            
            if (success) {
              result.attachmentsCount++;
            }
          }
        }
        
        result.articles.push({
          title: item.title,
          date: item.date || "",
          link: item.link,
          content,
          attachments: downloadedAttachments,
        });
        
        result.articlesCount++;
      }
      
      // 페이지네이션 체크
      if (!pagination || pagination.type === "none") {
        break;
      }
    }
    
    result.success = true;
    
  } catch (err: any) {
    result.errors.push(`치명적 오류: ${err.message}`);
    console.error("스크래핑 오류:", err);
  } finally {
    await closeBrowser();
    result.durationMs = Date.now() - startTime;
  }
  
  // 결과 저장
  const boardOutputDir = path.join(outputDir, board.board_id);
  fs.mkdirSync(boardOutputDir, { recursive: true });
  
  // documents.json
  const documentsPath = path.join(boardOutputDir, "documents.json");
  fs.writeFileSync(documentsPath, JSON.stringify(result.articles, null, 2), "utf8");
  
  // report.json
  const reportPath = path.join(boardOutputDir, "report.json");
  const report = {
    success: result.success,
    boardId: result.boardId,
    boardName: result.boardName,
    orgId: result.orgId,
    orgName: result.orgName,
    articlesCount: result.articlesCount,
    attachmentsCount: result.attachmentsCount,
    errors: result.errors,
    executedAt: result.executedAt,
    durationMs: result.durationMs,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  
  console.log(`\n========================================`);
  console.log(`스크래핑 완료: ${result.articlesCount}건, 첨부파일 ${result.attachmentsCount}개`);
  console.log(`소요 시간: ${(result.durationMs / 1000).toFixed(1)}초`);
  console.log(`========================================\n`);
  
  return result;
}

// ============================================================
// 타겟 데이터 로드
// ============================================================

export interface ScraperTargets {
  orgs: Organization[];
  boards: Board[];
}

export function loadTargets(dataPath: string): ScraperTargets {
  const filePath = path.join(dataPath, "scraper-targets.json");
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`타겟 파일을 찾을 수 없습니다: ${filePath}`);
  }
  
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  
  return {
    orgs: data.orgs || [],
    boards: data.boards || [],
  };
}

export function findBoard(targets: ScraperTargets, boardId: string): Board | undefined {
  return targets.boards.find(b => b.board_id === boardId);
}

export function findOrg(targets: ScraperTargets, orgId: string): Organization | undefined {
  return targets.orgs.find(o => o.org_id === orgId);
}
