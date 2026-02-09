/**
 * GitHub Actions용 스크래핑 실행 모듈
 * 
 * 기존 API route의 스크래핑 로직을 CLI에서 실행 가능하도록 분리한 모듈입니다.
 * Next.js 의존성 없이 독립적으로 실행됩니다.
 */

import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";
import fs from "node:fs";
import path from "node:path";
import { chromium, Browser, Page } from "playwright";
import { syncInstantScrapeToDB } from "../lib/scraper/scraper-db";

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

  // 외부 상세 링크 추적
  external_detail?: {
    enabled: boolean;
    url_selector?: string;
    url_pattern?: string;
    label_selector?: string;
    mode: "html" | "api_xml";
    content_selector?: string;
    attachments_selector?: string;
    api_xml?: {
      type_param?: string;
      content_fields?: string[];
      attachment_fields?: { url_field: string; name_field: string }[];
    };
    url_transform?: {
      extract_param: string;
      template: string;
    };
    metadata_selectors?: { [key: string]: string };
  };
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
  metadata?: { [key: string]: string };
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
      
      const minYear = Math.min(...range.years);
      if (itemYear < minYear) return "stop";
      
      if (!range.years.includes(itemYear)) return false;

      return true;
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
 * 첨부파일 추출 (scraper-engine.ts와 동일한 4가지 전략 사용)
 */
function extractAttachmentsFromHtml(
  html: string,
  baseUrl: string,
  config: WebConfig
): AttachmentInfo[] {
  const $ = cheerio.load(html);
  const attachments: AttachmentInfo[] = [];
  const seenUrls = new Set<string>();
  
  // 첨부파일 추가 헬퍼 함수
  const pushAttachment = (fileNameRaw: string, urlRaw: string) => {
    if (!urlRaw) return;
    const downloadUrl = resolveUrl(baseUrl, urlRaw);
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
  if (config.attachments?.selector) {
    downloadSelectors.push(config.attachments.selector);
  }
  if (config.detail?.attachments_selector) {
    downloadSelectors.push(config.detail.attachments_selector);
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
    
    const downloadUrl = resolveUrl(baseUrl, href);
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
  
  return attachments;
}

// ============================================================
// 외부 상세 링크 추적 함수 (CLI용)
// ============================================================

function stripJsessionId(url: string): string {
  return url.replace(/;jsessionid=[^?&]*/gi, "");
}

function extractExternalDetailUrl(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  config: NonNullable<WebConfig["external_detail"]>
): string | null {
  // 방법 1: CSS 선택자로 직접 추출
  if (config.url_selector) {
    const href = $(config.url_selector).first().attr("href");
    if (href) {
      console.log(`[extractExternalDetailUrl] url_selector 매칭: ${href.slice(0, 80)}...`);
      return stripJsessionId(resolveUrl(baseUrl, href));
    }
  }
  // 방법 2: 라벨 주변에서 링크 추출 (<dt>/<dd> 및 <th>/<td> 구조)
  if (config.label_selector) {
    const $label = $(config.label_selector).first();
    if ($label.length > 0) {
      const $link = $label.next("dd").find("a[href]")
        .add($label.closest("tr").find("td a[href]"))
        .add($label.parent().find("a[href]"));
      const href = $link.first().attr("href");
      if (href) {
        console.log(`[extractExternalDetailUrl] label_selector 매칭: ${href.slice(0, 80)}...`);
        return stripJsessionId(resolveUrl(baseUrl, href));
      }
    }
  }
  // 방법 3: URL 패턴 매칭
  if (config.url_pattern) {
    const re = new RegExp(config.url_pattern);
    let found: string | null = null;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (re.test(href)) {
        console.log(`[extractExternalDetailUrl] url_pattern 매칭: ${href.slice(0, 80)}...`);
        found = stripJsessionId(resolveUrl(baseUrl, href));
        return false;
      }
    });
    if (found) return found;
  }
  return null;
}

async function fetchExternalDetailAsXml(
  url: string,
  config: NonNullable<WebConfig["external_detail"]>
): Promise<{ content: string; attachments: AttachmentInfo[] }> {
  let xmlUrl = url;
  if (config.api_xml?.type_param) {
    xmlUrl = url.replace(/([?&])type=[^&]*/i, `$1type=${config.api_xml.type_param}`);
    if (xmlUrl === url && !url.includes("type=")) {
      xmlUrl += (url.includes("?") ? "&" : "?") + `type=${config.api_xml.type_param}`;
    }
  }
  console.log(`[fetchExternalDetailAsXml] XML 요청: ${xmlUrl.slice(0, 100)}...`);
  const xmlText = await fetchStaticHtml(xmlUrl);

  let parsed: Record<string, unknown>;
  try {
    parsed = await parseStringPromise(xmlText, {
      explicitArray: false, ignoreAttrs: false, mergeAttrs: true,
      trim: true, normalize: true, normalizeTags: false,
    });
  } catch (err) {
    console.log(`[fetchExternalDetailAsXml] XML 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
    return { content: "", attachments: [] };
  }

  const rootCandidates = ["행정규칙", "법령", "자치법규", "판례", "헌재결정례"];
  let root: Record<string, unknown> | null = null;
  for (const key of rootCandidates) {
    if (parsed[key] && typeof parsed[key] === "object") {
      root = parsed[key] as Record<string, unknown>;
      break;
    }
  }
  if (!root) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && typeof parsed[keys[0]] === "object") {
      root = parsed[keys[0]] as Record<string, unknown>;
    }
  }
  if (!root) return { content: "", attachments: [] };

  const contentFields = config.api_xml?.content_fields || ["조문내용"];
  let content = "";
  for (const field of contentFields) {
    const value = root[field];
    if (value && typeof value === "string") content += value + "\n";
    else if (value && typeof value === "object") content += JSON.stringify(value, null, 2) + "\n";
  }
  content = content.trim();

  const attachments: AttachmentInfo[] = [];
  for (const mapping of config.api_xml?.attachment_fields || []) {
    const fileUrl = root[mapping.url_field];
    const fileName = root[mapping.name_field];
    if (fileUrl && typeof fileUrl === "string" && fileUrl.trim()) {
      const urls = fileUrl.split(/[,;|\n]/).map(u => u.trim()).filter(Boolean);
      const names = (typeof fileName === "string" ? fileName : "").split(/[,;|\n]/).map(n => n.trim()).filter(Boolean);
      for (let i = 0; i < urls.length; i++) {
        attachments.push({ fileName: names[i] || `attachment_${i + 1}`, downloadUrl: urls[i] });
      }
    }
  }
  console.log(`[fetchExternalDetailAsXml] 본문 ${content.length}자, 첨부 ${attachments.length}개`);
  return { content, attachments };
}

async function fetchExternalDetailAsHtml(
  url: string,
  config: NonNullable<WebConfig["external_detail"]>
): Promise<{ content: string; attachments: AttachmentInfo[] }> {
  console.log(`[fetchExternalDetailAsHtml] HTML 요청: ${url.slice(0, 100)}...`);
  const html = await fetchStaticHtml(url);
  const $ = cheerio.load(html);

  let content = "";
  if (config.content_selector) {
    const $content = $(config.content_selector).first();
    if ($content.length > 0) {
      $content.find("script, style, nav, header, footer").remove();
      content = cleanText($content.text());
    }
  }
  if (!content) {
    $("script, style, nav, header, footer").remove();
    content = cleanText($("body").text()).slice(0, 10000);
  }

  const attachments: AttachmentInfo[] = [];
  const seenUrls = new Set<string>();
  const attachSelector = config.attachments_selector ||
    "a[href*='.hwp'], a[href*='.pdf'], a[href*='.doc'], a[href*='.docx'], a[href*='.xls'], a[href*='.xlsx'], a[href*='download'], a[href*='fileDown']";
  $(attachSelector).each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    if (!href) return;
    const downloadUrl = resolveUrl(url, href);
    if (seenUrls.has(downloadUrl)) return;
    seenUrls.add(downloadUrl);
    let fileName = cleanText($a.text());
    if (!fileName) {
      const imgAlt = $a.find("img").first().attr("alt") || "";
      try {
        const urlParams = new URLSearchParams(href.split("?")[1] || "");
        const flNm = urlParams.get("flNm");
        if (flNm) {
          const ext = imgAlt.match(/HWP/i) ? ".hwp" : imgAlt.match(/PDF/i) ? ".pdf" : imgAlt.match(/DOC/i) ? ".doc" : "";
          fileName = flNm + ext;
        } else {
          fileName = imgAlt || href.split("/").pop()?.split("?")[0] || "unknown";
        }
      } catch {
        fileName = imgAlt || href.split("/").pop()?.split("?")[0] || "unknown";
      }
    }
    attachments.push({ fileName, downloadUrl });
  });

  return { content, attachments };
}

function extractMetadataFromDetailPage(
  $: cheerio.CheerioAPI,
  selectors: { [key: string]: string }
): { [key: string]: string } {
  const metadata: { [key: string]: string } = {};
  for (const [key, selector] of Object.entries(selectors)) {
    const text = cleanText($(selector).first().text());
    if (text) metadata[key] = text;
  }
  return metadata;
}

// ============================================================
// 상세 페이지 처리
// ============================================================

async function parseDetailPage(
  url: string,
  config: WebConfig,
  useBrowser: boolean = false
): Promise<{ content: string; attachments: AttachmentInfo[]; metadata?: { [key: string]: string } }> {
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
    
    // fallback: 본문을 찾지 못한 경우 body에서 추출
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
  
  // 첨부파일 추출 (개선된 4가지 전략 사용)
  const attachments = extractAttachmentsFromHtml(html, url, config);
  
  // 외부 상세 링크 추적
  let metadata: { [key: string]: string } | undefined;
  
  if (config.external_detail?.enabled) {
    console.log(`[parseDetailPage] 외부 상세 링크 추적 활성화됨 (mode: ${config.external_detail.mode})`);
    
    if (config.external_detail.metadata_selectors) {
      metadata = extractMetadataFromDetailPage($, config.external_detail.metadata_selectors);
      if (Object.keys(metadata).length > 0) {
        console.log(`[parseDetailPage] 메타데이터 추출: ${JSON.stringify(metadata)}`);
      }
    }
    
    let externalUrl = extractExternalDetailUrl($, url, config.external_detail);
    
    // URL 변환 (DRF API URL → 공개 페이지 URL 등)
    if (externalUrl && config.external_detail.url_transform) {
      try {
        const urlObj = new URL(externalUrl);
        const paramValue = urlObj.searchParams.get(config.external_detail.url_transform.extract_param);
        if (paramValue) {
          externalUrl = config.external_detail.url_transform.template.replace(
            `{${config.external_detail.url_transform.extract_param}}`, paramValue
          );
          console.log(`[parseDetailPage] URL 변환됨: ${externalUrl.slice(0, 120)}...`);
        }
      } catch (e) {
        console.log(`[parseDetailPage] URL 변환 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    if (externalUrl) {
      try {
        if (config.external_detail.mode === "api_xml") {
          const xmlResult = await fetchExternalDetailAsXml(externalUrl, config.external_detail);
          if (xmlResult.content) content = xmlResult.content;
          if (xmlResult.attachments.length > 0) attachments.push(...xmlResult.attachments);
        } else {
          const htmlResult = await fetchExternalDetailAsHtml(externalUrl, config.external_detail);
          if (htmlResult.content) content = htmlResult.content;
          if (htmlResult.attachments.length > 0) attachments.push(...htmlResult.attachments);
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.log(`[parseDetailPage] 외부 상세 링크 처리 실패: ${errorMessage}`);
      }
    }
  }
  
  return { content, attachments, metadata };
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
    let nextPageUrl: string | null = listUrl;  // next_button용 URL 추적
    
    // 출력 디렉토리 생성
    const boardOutputDir = path.join(outputDir, board.board_id);
    const attachmentsDir = path.join(boardOutputDir, "attachments");
    fs.mkdirSync(attachmentsDir, { recursive: true });
    
    while (!shouldStop && currentPage < maxPages && nextPageUrl) {
      currentPage++;
      console.log(`\n--- 페이지 ${currentPage} 처리 중 ---`);
      
      // 페이지 URL 구성
      let pageUrl = nextPageUrl;
      const pagination = webConfig.list?.pagination;
      
      // page_param과 offset_param은 URL 파라미터로 계산
      if (pagination && currentPage > 1 && pagination.type !== "next_button") {
        if (pagination.type === "page_param") {
          const param = pagination.param || "page";
          const start = pagination.start ?? 1;
          const urlObj = new URL(listUrl);
          urlObj.searchParams.set(param, String(start + currentPage - 1));
          pageUrl = urlObj.toString();
        } else if (pagination.type === "offset_param") {
          const param = pagination.param || "offset";
          const step = pagination.step || 10;
          const start = pagination.start ?? 0;
          const urlObj = new URL(listUrl);
          urlObj.searchParams.set(param, String(start + (currentPage - 1) * step));
          pageUrl = urlObj.toString();
        }
      }
      
      console.log(`[URL] ${pageUrl}`);
      
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
      
      // 목록 파싱 ($ 객체도 함께 받아서 next_button 처리에 사용)
      const { items, $ } = parseListPage(html, pageUrl, webConfig);
      
      // next_button 타입: 다음 페이지 URL 추출
      if (pagination?.type === "next_button" && pagination.selector) {
        const $next = $(pagination.selector);
        const nextHref = $next.attr("href");
        if (nextHref && nextHref !== "#" && !nextHref.startsWith("javascript:")) {
          nextPageUrl = resolveUrl(pageUrl, nextHref);
          console.log(`[NEXT] 다음 페이지 URL 발견: ${nextPageUrl}`);
        } else {
          nextPageUrl = null;
          console.log(`[NEXT] 다음 페이지 없음`);
        }
      } else if (pagination?.type === "page_param" || pagination?.type === "offset_param") {
        // page_param/offset_param은 항목이 있으면 계속 진행
        nextPageUrl = items.length > 0 ? listUrl : null;
      } else {
        // pagination 없거나 none이면 첫 페이지만
        nextPageUrl = null;
      }
      
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
        let detailMetadata: { [key: string]: string } | undefined;
        
        if (webConfig.collect_body || webConfig.attachments?.enabled) {
          try {
            await delay(500);
            const detail = await parseDetailPage(item.link, webConfig, useBrowser);
            content = detail.content;
            attachments = detail.attachments;
            detailMetadata = detail.metadata;
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
          ...(detailMetadata ? { metadata: detailMetadata } : {}),
        });
        
        result.articlesCount++;
      }
      
      // 페이지네이션 체크 (next_button이 아닌 경우 항목 없으면 종료)
      if (!pagination || pagination.type === "none") {
        break;
      }
      
      // 다음 페이지가 없으면 종료 (next_button에서 URL이 없을 때)
      if (!nextPageUrl) {
        console.log("다음 페이지 없음, 종료");
        break;
      }
      
      // 다음 페이지 요청 전 딜레이
      await delay(500);
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
  
  // 수집 현황 DB 동기화 (SQLite)
  if (result.articles.length > 0) {
    try {
      const downloadedFiles = result.articles
        .flatMap(a => a.attachments)
        .map(att => att.localPath)
        .filter((p): p is string => !!p);

      const dbSyncResult = await syncInstantScrapeToDB({
        boardId: result.boardId,
        orgId: result.orgId,
        articles: result.articles.map(a => ({
          title: a.title,
          link: a.link,
          date: a.date,
          content: a.content || "",
          attachments: a.attachments?.map(att => ({
            fileName: att.fileName,
            downloadUrl: att.downloadUrl,
          })),
        })),
        downloadedFiles,
        dedupKey: "url",
      });
      console.log(`[DB-SYNC] 수집 현황 DB 동기화 완료: ${dbSyncResult.docsAdded}건 추가, ${dbSyncResult.attachmentsAdded}건 첨부`);
    } catch (dbError) {
      console.error("[DB-SYNC] 수집 현황 DB 동기화 실패:", dbError);
      // DB 동기화 실패해도 스크래핑 결과에는 영향 없음
    }
  }

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
