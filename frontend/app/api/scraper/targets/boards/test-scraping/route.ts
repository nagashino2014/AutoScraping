import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import {
  fetchRenderedHtml,
  extractAttachmentsWithBrowser,
  extractLawmakingAttachments,
  BrowserConfig,
  BrowserType,
} from "@/lib/scraper/browser";

// 사이트 내 검색 옵션 타입
interface SiteSearchOption {
  type: "select" | "text" | "date" | "radio" | "checkbox";
  name: string;
  label: string;
  selector: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  default_value?: string;
  selected_value?: string;
}

interface SiteSearchConfig {
  form_selector?: string;
  submit_selector?: string;
  submit_type: "form" | "url_param" | "ajax";
  options: SiteSearchOption[];
}

interface WebConfig {
  rendering?: string;
  list?: {
    container_selector?: string;
    item_selector?: string;
    pagination?: Record<string, unknown>;
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
    selector?: string;
  };
}

// 첨부파일 감지 패턴 설정
interface AttachmentConfig {
  pattern_type: "standard_href" | "onclick_fndownload" | "onclick_javascript" | "file_area_button" | "auto";
  container_selector?: string;
  link_selector?: string;
  filename_selector?: string;
  onclick_function?: string;
  download_url_pattern?: string;
}

interface AttachmentInfo {
  fileName: string;
  downloadUrl: string;
}

interface ScrapingResult {
  title: string;
  link: string;
  date?: string;
  body_summary?: string;
  attachments?: AttachmentInfo[];
}

// 딜레이 함수
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 브라우저 설정 인터페이스
interface BrowserSettings {
  browser_type?: BrowserType;
  headless?: boolean;
  wait_time?: number;
  wait_for_selector?: string;
}

// 재시도 로직이 포함된 fetch
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
    try {
      // 재시도 시 딜레이
      if (attempt > 0) {
        await delay(1000 * attempt); // 1초, 2초 대기
      }
      
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EcoMonitorBot/1.0",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "Connection": "keep-alive",
        },
        signal: AbortSignal.timeout(25000), // 타임아웃 증가
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      return res.text();
    } catch (err: any) {
      lastError = err;
      if (attempt < retries) {
        // 재시도 가능하면 계속
        continue;
      }
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

function truncateText(text: string, maxLength: number = 30): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength) + "...";
}

function tryExtractUrlFromOnclick(onclick: string, baseUrl?: string): string | null {
  if (!onclick) return null;
  
  // ============================================================
  // 한국전력공사(KEPCO) 전용 패턴 - 최우선
  // G_FILE.downloadFile(atchFileId, fileSn, 'fileName')
  // G_FILE.downloadFilePath('path', 'fileName')
  // ============================================================
  const kepcoDownloadMatch = onclick.match(/G_FILE\.downloadFile\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?/i);
  if (kepcoDownloadMatch) {
    const atchFileId = kepcoDownloadMatch[1];
    const fileSn = kepcoDownloadMatch[2];
    return `kepco:/portal/fileDown/download.do|atchFileId=${atchFileId}&fileSn=${fileSn}`;
  }
  
  const kepcoFilePathMatch = onclick.match(/G_FILE\.downloadFilePath\s*\(\s*['"]([^'"]+)['"]/i);
  if (kepcoFilePathMatch) {
    const filePath = kepcoFilePathMatch[1];
    return filePath.startsWith("/") ? filePath : `/${filePath}`;
  }
  
  // 한국전력공사(KEPCO) 게시글 링크 패턴: fn_Detail('boardMngNo', 'boardNo')
  // URL: /home/media/newsroom/pr/boardView.do?boardMngNo=15&boardNo=3014
  const kepcoDetailMatch = onclick.match(/fn_Detail\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/i);
  if (kepcoDetailMatch && baseUrl) {
    const boardMngNo = kepcoDetailMatch[1];
    const boardNo = kepcoDetailMatch[2];
    try {
      const urlObj = new URL(baseUrl);
      let basePath = urlObj.pathname;
      if (basePath.includes("List.do") || basePath.includes("list.do")) {
        basePath = basePath.replace(/[Ll]ist\.do/, "View.do");
      } else {
        basePath = basePath.replace(/\/?$/, "/boardView.do");
      }
      return `${urlObj.origin}${basePath}?boardMngNo=${boardMngNo}&boardNo=${boardNo}`;
    } catch {
      return `/boardView.do?boardMngNo=${boardMngNo}&boardNo=${boardNo}`;
    }
  }
  
  // 0) doBbsFView 패턴 - 중소벤처기업부 등 전자정부프레임워크 (가장 먼저!)
  const bbsFViewMatch = onclick.match(/doBbsFView\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/i);
  if (bbsFViewMatch && baseUrl) {
    const cbIdx = bbsFViewMatch[1];
    const bcIdx = bbsFViewMatch[2];
    try {
      const urlObj = new URL(baseUrl);
      let basePath = urlObj.pathname;
      if (basePath.includes("List.do")) {
        basePath = basePath.replace("List.do", "View.do");
      } else if (basePath.includes("list.do")) {
        basePath = basePath.replace("list.do", "View.do");
      }
      return `${urlObj.origin}${basePath}?cbIdx=${cbIdx}&bcIdx=${bcIdx}`;
    } catch {
      // baseUrl 파싱 실패 시 상대 경로 반환
      return `/View.do?cbIdx=${cbIdx}&bcIdx=${bcIdx}`;
    }
  }
  
  // 0-1) 국립환경과학원 패턴: fnZipFileDownload('fileNo', '파일명')
  const zipDownloadMatch = onclick.match(/fnZipFileDownload\s*\(\s*['"](\d+)['"]/i);
  if (zipDownloadMatch) {
    const fileNo = zipDownloadMatch[1];
    return `/common/kor/board/comBbsFileDownLoad.do?fileNo=${fileNo}`;
  }
  
  // 0-2) fnFileDownload, fnBbsFileDownload 패턴
  const bbsFileDownMatch = onclick.match(/fn(?:Bbs)?FileDownload\s*\(\s*['"](\d+)['"]/i);
  if (bbsFileDownMatch) {
    const fileNo = bbsFileDownMatch[1];
    return `/common/kor/board/comBbsFileDownLoad.do?fileNo=${fileNo}`;
  }
  
  // 0-3) ajaxDownload 패턴: ajaxDownload('url', 'fileName') 또는 ajaxDownload('fileId')
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
  
  // 0-4) fnMoveDetail, fnDetail 패턴 (게시글 링크용)
  const fnDetailMatch = onclick.match(/fn(?:Move)?Detail\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]?[^'"]*['"]?)?\s*\)/i);
  if (fnDetailMatch && baseUrl) {
    const articleId = fnDetailMatch[1];
    try {
      const urlObj = new URL(baseUrl);
      // List.do → View.do 변환
      let basePath = urlObj.pathname;
      if (basePath.includes("List.do") || basePath.includes("list.do")) {
        basePath = basePath.replace(/[Ll]ist\.do/, "View.do");
      }
      urlObj.pathname = basePath;
      urlObj.searchParams.set("articleId", articleId);
      return urlObj.href;
    } catch {
      return `/View.do?articleId=${articleId}`;
    }
  }
  
  // 1) 일반적인 URL 패턴 (quoted string containing URL-like path)
  const m1 = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
  if (m1?.[1] && !m1[1].includes("void")) return m1[1];
  
  // 2) javascript:location.href='...'
  const m2 = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m2?.[1]) return m2[1];
  
  // 3) window.open('...')
  const m3 = onclick.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
  if (m3?.[1]) return m3[1];
  
  // 4) fileDownload('atchFileId', 'fileSn') 패턴 - 한강유역환경청 등 전자정부프레임워크 표준
  const fileDownloadMatch = onclick.match(/fileDownload\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/i);
  if (fileDownloadMatch) {
    const atchFileId = fileDownloadMatch[1];
    const fileSn = fileDownloadMatch[2];
    return `/cmm/fms/FileDown.do?atchFileId=${atchFileId}&fileSn=${fileSn}`;
  }
  
  // 5) 한국 정부 사이트에서 흔한 함수 패턴
  // fn_fileDown('123', 'fileName.hwp')
  // fn_download('12345')
  const funcPatterns = [
    /fn_fileDown\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
    /fn_download\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
    /FileDown\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
    /downFile\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
    /getFile\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
    /openFile\s*\(\s*['"]?([^'")\s,]+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/i,
  ];
  
  for (const pattern of funcPatterns) {
    const match = onclick.match(pattern);
    if (match?.[1]) {
      // ID가 숫자인 경우 전자정부프레임워크 표준 URL 패턴 생성
      const fileId = match[1];
      const fileSn = match[2] || "";
      if (/^\d+$/.test(fileId)) {
        // 전자정부프레임워크 표준 다운로드 URL 패턴
        return `/cmm/fms/FileDown.do?atchFileId=${fileId}${fileSn ? `&fileSn=${fileSn}` : ""}`;
      }
      return fileId;
    }
  }
  
  // 5) 국민참여입법센터 패턴: fnDownload('10568532','VULPRZ16RYSO7IWUPRK2')
  const fnDownloadMatch = onclick.match(/fnDownload\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
  if (fnDownloadMatch) {
    const fileId = fnDownloadMatch[1];
    const fileKey = fnDownloadMatch[2];
    // 국민참여입법센터 실제 다운로드 URL 패턴
    // 국민참여입법센터 실제 다운로드 URL 패턴: /file/download/{fileId}/{fileKey}
    return `/file/download/${fileId}/${fileKey}`;
  }
  
  // 6) 산업통상자원부 패턴: article.view('171445') → 게시글 상세 페이지
  const articleViewMatch = onclick.match(/article\.view\s*\(\s*['"]?(\d+)['"]?\s*\)/i);
  if (articleViewMatch && baseUrl) {
    const articleId = articleViewMatch[1];
    try {
      const urlObj = new URL(baseUrl);
      // /kor/article/ATCL3f49a5a8c → /kor/article/ATCL3f49a5a8c/{id}/view
      return `${urlObj.pathname}/${articleId}/view`;
    } catch {
      return `${baseUrl}/${articleId}/view`;
    }
  }
  
  // 7) 숫자 파라미터만 있는 간단한 함수 호출 (파일 다운로드용만)
  // article, view, goView 등 게시글 조회 함수는 제외
  const simpleFunc = onclick.match(/(\w+)\s*\(\s*['"]?(\d+)['"]?\s*(?:,\s*['"]?([^'")\s]+)['"]?)?\s*\)/);
  if (simpleFunc?.[2]) {
    const funcName = simpleFunc[1].toLowerCase();
    const id1 = simpleFunc[2];
    const id2 = simpleFunc[3] || "";
    
    // 게시글 조회 함수는 파일 다운로드 URL로 변환하지 않음
    const viewFunctions = ["article", "view", "goview", "fnview", "boardview", "detailview", "fndetail"];
    if (viewFunctions.some(vf => funcName.includes(vf))) {
      return null; // 게시글 상세 페이지는 별도 처리 필요
    }
    
    // 다운로드 URL 패턴 생성 (파일 다운로드 함수만)
    if (id2) {
      return `/file/download/${id1}?key=${id2}`;
    }
    return `/fileDown?fileId=${id1}`;
  }
  
  return null;
}

function looksLikeAttachmentName(text: string): boolean {
  const t = (text || "").toLowerCase();
  const exts = [
    ".hwp", ".hwpx", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv",
    ".ppt", ".pptx", ".zip", ".rar", ".7z", ".txt", ".rtf"
  ];
  // 1. 파일 확장자 체크
  if (exts.some((e) => t.includes(e))) return true;
  // 2. 파일 크기 패턴 (예: "(858.3 KB)", "100MB")
  if (/\(\s*[\d.,]+\s*[kmg]b\s*\)/i.test(text || "")) return true;
  if (/[\d.,]+\s*[kmg]b\s*$/i.test(text || "")) return true;
  // 3. 다운로드/첨부 키워드
  if (/다운로드|download|첨부|attachment/i.test(t)) return true;
  // 4. 파일 관련 URL 패턴
  if (/filedown|download|attach|file_?id/i.test(t)) return true;
  return false;
}

async function scrapeListPage(
  listUrl: string,
  config: WebConfig,
  logs: string[],
  browserSettings?: BrowserSettings
): Promise<ScrapingResult[]> {
  logs.push(`[INFO] 목록 페이지 접속: ${listUrl}`);
  
  const renderingMode = config.rendering || "static_html";
  const html = await fetchHtml(listUrl, 2, renderingMode, browserSettings);
  const $ = cheerio.load(html);
  
  const containerSelector = config.list?.container_selector;
  const itemSelector = config.list?.item_selector || "tr";
  const titleSelector = config.parse_rules?.title || "a";
  const dateSelector = config.parse_rules?.date;
  const linkSelector = config.parse_rules?.link || "a";
  
  logs.push(`[INFO] 선택자 - container: ${containerSelector || "(전체)"}, item: ${itemSelector}`);
  
  const $container = containerSelector ? $(containerSelector) : $("body");
  const $items = $container.find(itemSelector);
  
  logs.push(`[INFO] 발견된 항목 수: ${$items.length}개`);
  
  if ($items.length === 0) {
    logs.push(`[ERROR] 목록 항목을 찾을 수 없습니다. item_selector를 확인하세요.`);
    return [];
  }
  
  const results: ScrapingResult[] = [];
  const maxItems = Math.min($items.length, 10); // 최대 10개만
  let baseUrlObj: URL | null = null;
  try {
    baseUrlObj = new URL(listUrl);
  } catch {}
  
  for (let i = 0; i < maxItems; i++) {
    const $item = $items.eq(i);
    
    // 제목 추출
    const $titleEl = $item.find(titleSelector).first();
    const title = $titleEl.text().replace(/\s+/g, " ").trim();
    
    // 링크 추출 - href와 onclick 모두 확인
    const $linkEl = $item.find(linkSelector).first();
    let link = $linkEl.attr("href") || "";
    const onclick = $linkEl.attr("onclick") || $item.attr("onclick") || "";
    
    // KEPCO 패턴: href 자체가 javascript:fn_Detail('15','3014') 형식인 경우
    if (link && link.includes("fn_Detail")) {
      const extractedUrl = tryExtractUrlFromOnclick(link, listUrl);
      if (extractedUrl) {
        link = extractedUrl;
      }
    }
    // href가 없거나 # 또는 javascript:인 경우 onclick에서 URL 추출
    else if (!link || link === "#" || link === "#view" || link.startsWith("javascript:")) {
      const extractedUrl = tryExtractUrlFromOnclick(onclick, listUrl);
      if (extractedUrl) {
        link = extractedUrl;
      }
    }
    
    // ============================================================
    // 국립환경과학원(NIER) 목록 특이 케이스 보정
    // - 목록에서 "파일 다운로드" 링크를 상세 링크로 오인하는 경우
    // ============================================================
    const isNierDownloadLink = link.includes("comBbsFileDownLoad.do");
    if ((isNierDownloadLink || title === "파일 다운로드") && baseUrlObj) {
      let detailLink = "";
      
      const $detailAnchor = $item.find("a[href*='comBbsDetail.do'], a[href*='comBbsView.do']").first();
      detailLink = $detailAnchor.attr("href") || "";
      
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
    
    // 상대 URL을 절대 URL로 변환
    if (link && !link.startsWith("http")) {
      link = resolveUrl(listUrl, link);
    }
    
    // 날짜 추출
    let date = "";
    if (dateSelector) {
      const $dateEl = $item.find(dateSelector).first();
      date = $dateEl.text().replace(/\s+/g, " ").trim();
    }
    
    // 빈 제목은 건너뛰기
    if (!title || title.length < 2) continue;
    
    results.push({ title, link, date });
    logs.push(`[LIST] ${i + 1}. ${truncateText(title, 50)}`);
    if (date) logs.push(`       날짜: ${date}`);
  }
  
  logs.push(`[INFO] 추출된 유효 항목: ${results.length}개`);
  return results;
}

async function scrapeDetailPage(
  item: ScrapingResult,
  config: WebConfig,
  baseUrl: string,
  logs: string[],
  attachConfig?: AttachmentConfig,
  renderingMode?: string,
  browserSettings?: BrowserSettings
): Promise<{ body_summary: string; attachments: AttachmentInfo[] }> {
  if (!item.link) {
    return { body_summary: "(링크 없음)", attachments: [] };
  }
  
  try {
    const effectiveRenderingMode = renderingMode || config.rendering || "static_html";
    let html: string;
    let browserAttachments: AttachmentInfo[] = [];
    
    // 동적 JS 렌더링 모드: Playwright 사용
    if (effectiveRenderingMode === "dynamic_js") {
      const browserConfig: BrowserConfig = {
        browserType: browserSettings?.browser_type || "chromium",
        headless: browserSettings?.headless !== false,
        timeout: 30000,
      };
      
      // 국민참여입법센터 전용 처리
      if (item.link.includes("opinion.lawmaking.go.kr")) {
        logs.push(`[BROWSER] 국민참여입법센터 전용 Playwright 추출`);
        const result = await extractLawmakingAttachments(item.link, browserConfig);
        html = result.html;
        browserAttachments = result.attachments;
        logs.push(`[BROWSER] 첨부파일 ${browserAttachments.length}개 발견`);
      } else {
        // 일반 사이트
        logs.push(`[BROWSER] Playwright로 동적 페이지 렌더링`);
        const result = await extractAttachmentsWithBrowser(item.link, browserConfig);
        html = result.html;
        browserAttachments = result.attachments;
        if (browserAttachments.length > 0) {
          logs.push(`[BROWSER] 첨부파일 ${browserAttachments.length}개 발견`);
        }
      }
    } else {
      // 정적 HTML 모드
      html = await fetchHtml(item.link, 2, effectiveRenderingMode, browserSettings);
      logs.push(`[HTML] 정적 HTML 수신: ${html.length} bytes`);
    }
    
    const $ = cheerio.load(html);
    
    // HTML 구조 분석 로그
    const htmlTitle = $("title").text().trim().substring(0, 50);
    logs.push(`[HTML] 페이지 타이틀: ${htmlTitle || "(없음)"}`);
    
    // NIER 전용 디버그 로그
    if (item.link.includes("nier.go.kr")) {
      logs.push(`[HTML] NIER 요소 확인:`);
      const fileDownload = $("a.fileDownload");
      logs.push(`       a.fileDownload: ${fileDownload.length}개`);
      fileDownload.each((i, el) => {
        logs.push(`       [${i}] data-no: ${$(el).attr("data-no")}, data-seq: ${$(el).attr("data-seq")}`);
      });
      const fileAtchList = $(".file-atch-list, #file-atch-list, ul[class*='file']");
      logs.push(`       file list: ${fileAtchList.length}개`);
    }

    // 국민참여입법센터 특화 로그: 첨부파일 관련 주요 요소 존재 여부
    if (item.link.includes("opinion.lawmaking.go.kr")) {
      const detailAttach = $(".detailAttach");
      const formAlign = $(".formAlign");
      const fileArea = $(".file_area, .attach_area");
      logs.push(`[HTML] 국민참여입법센터 요소 확인:`);
      logs.push(`       .detailAttach: ${detailAttach.length}개 (HTML: ${detailAttach.html()?.substring(0, 100) || "없음"})`);
      logs.push(`       .formAlign: ${formAlign.length}개`);
      logs.push(`       .file_area/.attach_area: ${fileArea.length}개`);
      
      // onclick 속성 가진 버튼/링크 모두 검색
      const onclickElements = $("[onclick]");
      logs.push(`       onclick 속성 요소: ${onclickElements.length}개`);
      onclickElements.slice(0, 5).each((i, el) => {
        const onclick = $(el).attr("onclick") || "";
        if (onclick.includes("fn") || onclick.includes("download") || onclick.includes("file")) {
          logs.push(`       onclick[${i}]: ${onclick.substring(0, 80)}`);
        }
      });
    }
    
    // 본문 추출 - 더 구체적인 선택자 사용
    const contentSelectors = [
      // 정부/공공기관 사이트 패턴
      ".view_con", ".view_cont", ".view_content", ".viewContent",
      ".board_view_content", ".bbs_content", ".bbsContent",
      ".article_content", ".article_body", ".articleBody",
      ".post_content", ".post_body", ".postBody",
      // 일반 패턴
      "article .content", "article .body",
      ".content_area", ".contentArea",
      "#content .text", "#content .body",
      // fallback
      "article", ".content", "#content"
    ];
    
    let bodyText = "";
    for (const selector of contentSelectors) {
      const $content = $(selector).first();
      if ($content.length > 0) {
        // script, style, nav 등 제거
        $content.find("script, style, nav, header, footer, .skip, .blind").remove();
        const text = $content.text().replace(/\s+/g, " ").trim();
        // 의미있는 텍스트인지 확인 (메뉴 텍스트가 아닌지)
        if (text.length > 30 && !text.startsWith("주메뉴") && !text.startsWith("바로가기")) {
          bodyText = text;
          break;
        }
      }
    }
    
    // 여전히 없으면 body에서 주요 영역 추출
    if (!bodyText) {
      $("script, style, nav, header, footer, .gnb, .lnb, .skip, .blind, #header, #footer").remove();
      bodyText = $("body").text().replace(/\s+/g, " ").trim();
      // 앞부분 메뉴 텍스트 제거
      const mainIdx = bodyText.indexOf("본문내용");
      if (mainIdx > 0 && mainIdx < 200) {
        bodyText = bodyText.slice(mainIdx + 4).trim();
      }
    }
    
    const body_summary = truncateText(bodyText, 50);
    
    // 첨부파일 추출 - 패턴별 감지
    const attachments: AttachmentInfo[] = [];
    const seenUrls = new Set<string>();
    const patternType = attachConfig?.pattern_type || "auto";

    const pushAttachment = (fileNameRaw: string, urlRaw: string) => {
      if (!urlRaw) return;
      const url = resolveUrl(item.link || baseUrl, urlRaw);
      if (!url) return;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      let fileName = (fileNameRaw || "").replace(/\s+/g, " ").trim();
      if (!fileName || fileName.length < 3) {
        try {
          const u = new URL(url);
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

      // 크기 정보 제거 (예: "(858.3 KB)")
      fileName = fileName.replace(/\s*\([^)]*[KMG]B\)\s*$/i, "").trim();
      if (!fileName) fileName = "unknown";

      attachments.push({ fileName, downloadUrl: url });
    };
    
    // === 패턴별 첨부파일 감지 ===
    logs.push(`[DOM] 첨부파일 패턴 타입: ${patternType}`);
    
    // HTML 내 첨부파일 관련 요소 탐색 로그
    const fnDownloadCount = $("button[onclick*='fnDownload'], a[onclick*='fnDownload']").length;
    const detailAttachCount = $(".detailAttach, .formAlign").length;
    const fileAreaCount = $(".file_area, .attach, .file_list, .attachment").length;
    const downloadLinkCount = $("a[href*='download'], a[href*='file']").length;
    
    logs.push(`[DOM] fnDownload 요소: ${fnDownloadCount}개`);
    logs.push(`[DOM] detailAttach/formAlign: ${detailAttachCount}개`);
    logs.push(`[DOM] 파일 영역 클래스: ${fileAreaCount}개`);
    logs.push(`[DOM] 다운로드 링크: ${downloadLinkCount}개`);
    
    // fnDownload 요소가 있으면 상세 정보 출력
    if (fnDownloadCount > 0) {
      $("button[onclick*='fnDownload'], a[onclick*='fnDownload']").slice(0, 3).each((idx, el) => {
        const $el = $(el);
        const onclick = $el.attr("onclick") || "";
        const text = $el.text().replace(/\s+/g, " ").trim().substring(0, 50);
        logs.push(`[DOM] fnDownload[${idx}]: onclick="${onclick.substring(0, 80)}" text="${text}"`);
      });
    }
    
    // fnDownload 요소 처리 헬퍼 함수
    const processFnDownloadElements = () => {
      const selector = attachConfig?.link_selector || "button[onclick*='fnDownload'], a[onclick*='fnDownload']";
      logs.push(`[DOM] fnDownload 선택자: ${selector}`);
      const elements = $(selector);
      logs.push(`[DOM] 매칭된 요소 수: ${elements.length}`);
      
      elements.each((_, el) => {
        const $el = $(el);
        const onclick = $el.attr("onclick") || "";
        const $clone = $el.clone();
        $clone.find(".a11y_hidden, .blind, .sr-only").remove();
        const fileName = $clone.text().replace(/\s+/g, " ").trim();
        
        logs.push(`[DOM] 처리 중: onclick="${onclick.substring(0, 60)}" fileName="${fileName.substring(0, 30)}"`);
        
        const extracted = tryExtractUrlFromOnclick(onclick);
        if (extracted && fileName) {
          logs.push(`[DOM] URL 추출 성공: ${extracted.substring(0, 80)}`);
          pushAttachment(fileName, extracted);
        } else {
          logs.push(`[DOM] URL 추출 실패 또는 파일명 없음`);
        }
      });
    };
    
    // 특정 패턴이 지정된 경우 해당 패턴만 사용 (성능 및 정확도 향상)
    if (patternType === "onclick_fndownload") {
      // 국민참여입법센터 패턴: fnDownload('id', 'key')
      processFnDownloadElements();
    } else if (patternType === "onclick_javascript") {
      // 일반 onclick javascript 패턴
      const funcName = attachConfig?.onclick_function || "fileDown";
      const selector = attachConfig?.link_selector || `button[onclick*='${funcName}'], a[onclick*='${funcName}']`;
      $(selector).each((_, el) => {
        const $el = $(el);
        const onclick = $el.attr("onclick") || "";
        const fileName = $el.text().replace(/\s+/g, " ").trim();
        
        const extracted = tryExtractUrlFromOnclick(onclick);
        if (extracted) {
          pushAttachment(fileName, extracted);
        }
      });
    } else if (patternType === "standard_href") {
      // 표준 href 기반 패턴
      const selector = attachConfig?.link_selector || "a[href*='.hwp'], a[href*='.pdf'], a[href*='download']";
      $(selector).each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href") || "";
        const fileName = $el.text().replace(/\s+/g, " ").trim();
        
        if (href && href !== "#" && !href.startsWith("javascript:")) {
          pushAttachment(fileName, href);
        }
      });
    } else if (patternType === "file_area_button") {
      // 파일 영역 내 버튼 패턴
      const containerSelector = attachConfig?.container_selector || ".file_area, .attach, .file_list";
      const linkSelector = attachConfig?.link_selector || "button, a";
      $(`${containerSelector} ${linkSelector}`).each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href") || "";
        const onclick = $el.attr("onclick") || "";
        const fileName = $el.text().replace(/\s+/g, " ").trim();
        
        let url = href;
        if (!href || href.startsWith("javascript:")) {
          url = tryExtractUrlFromOnclick(onclick) || "";
        }
        
        if (url && looksLikeAttachmentName(fileName)) {
          pushAttachment(fileName, url);
        }
      });
    }
    
    // "auto" 모드이거나 특정 패턴으로 첨부파일을 찾지 못한 경우 일반 감지
    if (patternType === "auto" || attachments.length === 0) {
      logs.push(`[DOM] auto/fallback 모드 실행 (현재 첨부파일: ${attachments.length}개)`);
      
      // 1. 중소벤처기업부 등 file_list 구조 처리
      const $fileListItems = $(".file_list li");
      if ($fileListItems.length > 0) {
        $fileListItems.each((_, li) => {
          const $li = $(li);
          const nameText = $li.find(".name").first().text().replace(/\s+/g, " ").trim();
          const cleanedName = nameText
            .replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "")
            .replace(/\s*\([^)]*[KMG]B\)\s*$/i, "")
            .trim();
          const $downLink = $li.find("a.type_down, a[title='내려받기'], a[href*='Download.do'], a[href*='download.do']").first();
          const href = $downLink.attr("href") || "";
          if (href) {
            pushAttachment(cleanedName, href);
          }
        });
      }
      
      // 2. 한국환경공단 등 .file li a 구조 처리 (미리보기 링크 제외)
      const $fileItems = $(".file li a, div.file li a, .attach li a, .attachment li a");
      if ($fileItems.length > 0 && attachments.length === 0) {
        logs.push(`[DOM] .file li a 구조 발견: ${$fileItems.length}개`);
        $fileItems.each((_, el) => {
          const $el = $(el);
          const href = $el.attr("href") || "";
          const text = $el.text().trim();
          // 미리보기 링크 제외
          if (text.includes("미리보기") || href.includes("preview") || href.includes("docview")) {
            return;
          }
          if (href && !href.startsWith("javascript:") && href !== "#") {
            pushAttachment(text, href);
          }
        });
      }
      
      // 3. 한국환경산업기술원 등 a.attachment 구조 처리 (a 태그 자체가 attachment 클래스)
      const $attachmentLinks = $("a.attachment, a.attach, a.file_down, a[class*='attach'][href]");
      if ($attachmentLinks.length > 0 && attachments.length === 0) {
        logs.push(`[DOM] a.attachment 구조 발견: ${$attachmentLinks.length}개`);
        $attachmentLinks.each((_, el) => {
          const $el = $(el);
          const href = $el.attr("href") || "";
          const text = $el.text().trim();
          // 미리보기 링크 제외
          if (text.includes("미리보기") || href.includes("preview") || href.includes("docview")) {
            return;
          }
          if (href && !href.startsWith("javascript:") && href !== "#") {
            pushAttachment(text, href);
          }
        });
      }

      // 1. 파일 확장자 기반 선택자
      const extSelectors = [
        "a[href*='.hwp']", "a[href*='.hwpx']",
        "a[href*='.pdf']",
        "a[href*='.doc']", "a[href*='.docx']",
        "a[href*='.xls']", "a[href*='.xlsx']", "a[href*='.csv']",
        "a[href*='.zip']", "a[href*='.ppt']", "a[href*='.pptx']",
      ];
      
      // 2. 다운로드 관련 선택자 (정부/공공기관 사이트 패턴)
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
        // 중소벤처기업부 등 전자정부프레임워크 패턴 (높은 우선순위)
        "a.btn.type_down", "a.type_down",
        "a[title='내려받기']",
        "a[href*='Download.do']", "a[href*='download.do']",
        "a[href*='bcIdx'][href*='cbIdx']",
        // 일반 다운로드 패턴
        "a[href*='download']", "a[href*='fileDown']", "a[href*='file_down']",
        "a[href*='filedown.do']", "a[href*='fileDown.do']",
        "a[href*='readDownloadFile']", "a[href*='downloadFile']",
        "a[href*='atchFileDown']", "a[href*='AttachDown']", "a[href*='fileId=']",
        // onclick 패턴 (정부 사이트에서 흔함)
        "a[onclick*='download']", "a[onclick*='fileDown']",
        "button[onclick*='download']", "button[onclick*='fileDown']",
        "button[onclick*='fnDownload']",
        // 국립환경과학원 패턴: fnZipFileDownload, fnFileDownload, ajaxDownload
        "a[onclick*='fnZipFileDownload']",
        "a[onclick*='fnFileDownload']",
        "a[onclick*='fnBbsFileDownload']",
        "a[onclick*='ajaxDownload']",
        "input[onclick*='fileDownload']",
        // 파일 타입 클래스 기반 (예: hwp_file, pdf_file)
        "a[class*='_file']",
        "a.hwp_file", "a.pdf_file", "a.doc_file", "a.xls_file", "a.zip_file",
        // 클래스 기반 컨테이너
        ".file_list a", ".attach a", ".file a", ".file_area a",
        ".attachment a", ".attachFile a",
        // 국민참여입법센터 및 법제처 패턴
        ".detailAttach button", ".formAlign button",
      ];
      
      const allSelectors = [...extSelectors, ...downloadSelectors].join(", ");
      const matchedElements = $(allSelectors).slice(0, 50);
      logs.push(`[DOM] auto 모드 선택자 매칭: ${matchedElements.length}개`);
      
      $(allSelectors).slice(0, 50).each((_, el) => {  // 성능을 위해 최대 50개
      const $el = $(el);
      const tagName = el.tagName?.toLowerCase() || "";
      let href = $el.attr("href") || "";
      const onclick = $el.attr("onclick") || "";
      // NIER 전용 data 속성
      const dataNo = $el.attr("data-no") || "";
      const dataSeq = $el.attr("data-seq") || "";
      
      // ============================================================
      // 국립환경과학원(NIER) 패턴: a.fileDownload[data-no][data-seq]
      // POST /common/comDownloadFile.do, atchFileNo=xxx&fileSn=xxx
      // ============================================================
      if (dataNo && dataSeq) {
        try {
          // NIER POST 방식 다운로드: atchFileNo, atchFileSeq 파라미터 사용
          href = `post:/common/comDownloadFile.do|atchFileNo=${dataNo}&atchFileSeq=${dataSeq}`;
        } catch (e) {
          // URL 생성 실패 시 무시
        }
      }
      // KEPCO 패턴: href에 G_FILE.downloadFile이 직접 포함된 경우
      else if (href.includes("G_FILE.downloadFile") || href.includes("G_FILE.downloadFilePath")) {
        const extracted = tryExtractUrlFromOnclick(href);
        if (extracted) href = extracted;
      }
      // onclick에서 URL 추출 시도 (button 및 javascript: href 포함)
      else if ((!href || href.startsWith("javascript:") || tagName === "button") && onclick) {
        const extracted = tryExtractUrlFromOnclick(onclick);
        if (extracted) href = extracted;
      }
      
      if (!href || href === "#" || href === "javascript:void(0)") return;
      
      // 절대 URL로 변환
      const downloadUrl = resolveUrl(item.link, href);
      
      // 중복 체크
      if (seenUrls.has(downloadUrl)) return;
      seenUrls.add(downloadUrl);
      
      // 파일명 추출 - 다양한 소스에서 시도
      let fileName = "";
      
      // 1. 링크 텍스트에서 추출 (숨김 텍스트 제거)
      const $clone = $el.clone();
      $clone.find(".a11y_hidden, .blind, .sr-only, .visually-hidden").remove();
      const linkText = $clone.text().replace(/\s+/g, " ").trim();
      
      // 2. 텍스트가 "내려받기", "다운로드" 등인 경우 형제/부모 요소에서 파일명 찾기
      if (!linkText || linkText === "내려받기" || linkText === "다운로드" || linkText === "Download" || linkText.length < 5) {
        // 중소벤처기업부 패턴: .info .name에서 파일명
        // 1. li나 tr을 먼저 찾음 (가장 일반적인 리스트/테이블 아이템 컨테이너)
        let $parent = $el.closest("li");
        if ($parent.length === 0) $parent = $el.closest("tr");
        
        // 2. 그래도 없으면 div를 찾되, 바로 위의 감싸는 div일 수 있으므로 
        // name 요소가 없으면 부모로 더 올라가봄
        if ($parent.length === 0) {
           $parent = $el.closest("div");
        }

        let $nameEl = $parent.find(".name, .file_name, .fileName, .file-name");
        
        // 부모(div)에서 못 찾았으면 한 단계 더 올라가서 찾기 (div.link -> li -> div.info 구조 대응)
        if ($nameEl.length === 0) {
           $parent = $parent.parent();
           $nameEl = $parent.find(".name, .file_name, .fileName, .file-name");
        }
        
        if ($nameEl.length > 0) {
          fileName = $nameEl.first().text().replace(/\s+/g, " ").trim();
          // 크기 정보 제거 (예: "[112.05 KB]")
          fileName = fileName.replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "").trim();
        }
        
        // title 속성에서 파일명 (새 창 열림 등 제거)
        if (!fileName) {
          const title = $el.attr("title") || "";
          if (title && !title.includes("내려받기") && !title.includes("다운로드")) {
            fileName = title.replace(/\s*새\s*창\s*열림\s*/i, "").trim();
          }
        }
      } else {
        fileName = linkText;
      }
      
      // 3. 여전히 없으면 URL에서 추출
      if (!fileName || fileName.length < 3) {
        try {
          const urlObj = new URL(downloadUrl);
          // streFileNm 파라미터 (중소벤처기업부)
          const streFileNm = urlObj.searchParams.get("streFileNm");
          if (streFileNm) {
            fileName = decodeURIComponent(streFileNm);
          } else {
            const pathParts = urlObj.pathname.split("/");
            fileName = decodeURIComponent(pathParts[pathParts.length - 1]);
          }
          if (!fileName || fileName.length < 3) {
            const fileParam = urlObj.searchParams.get("fileName") || 
                              urlObj.searchParams.get("file_name") ||
                              urlObj.searchParams.get("name");
            if (fileParam) fileName = decodeURIComponent(fileParam);
          }
        } catch {
          fileName = href.split("/").pop()?.split("?")[0] || "unknown";
        }
      }
      
      // 파일 확장자 확인 (유효한 첨부파일인지)
      const validExts = [".hwp", ".hwpx", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".ppt", ".pptx", ".zip", ".rar", ".7z"];
      const hasValidExt = validExts.some(ext => 
        fileName.toLowerCase().includes(ext) || downloadUrl.toLowerCase().includes(ext)
      );
      const isDownloadUrl = /download|filedown|attach|fndownload/i.test(downloadUrl) || /download|filedown/i.test(onclick);
      
      if (hasValidExt || isDownloadUrl) {
        pushAttachment(fileName, downloadUrl);
      }
    });
    }  // end of auto mode / fallback

    // 3) '첨부파일' 라벨 주변에서 링크 수집 (가장 흔한 구조)
    if (attachments.length === 0) {
      logs.push(`[DOM] 첨부파일 라벨 주변 탐색 시작 (현재: ${attachments.length}개)`);
      
      // 3-1) dt/dd 구조 먼저 처리 (한강유역환경청 등 정부 사이트)
      // dt:contains('첨부') 다음 형제 dd 내의 a 태그에서 fileDownload 등 onclick 패턴 탐색
      $("dt").each((_, dt) => {
        const $dt = $(dt);
        const dtText = $dt.text().trim();
        if (!dtText.includes("첨부") && !dtText.includes("파일") && !dtText.includes("다운로드")) return;
        
        // dt 다음 dd 요소 찾기
        const $dd = $dt.next("dd");
        if ($dd.length === 0) return;
        
        // dd 내의 모든 a 태그 탐색
        $dd.find("a").each((_, a) => {
          const $a = $(a);
          const txt = $a.text().replace(/\s+/g, " ").trim();
          const href = $a.attr("href") || "";
          const onclick = $a.attr("onclick") || "";
          
          // 파일명/확장자 패턴 확인
          if (!looksLikeAttachmentName(txt)) return;
          
          let urlRaw = href;
          
          // javascript: href인 경우 onclick에서 추출
          if (!href || href.startsWith("javascript:") || href === "#") {
            if (onclick) {
              // tryExtractUrlFromOnclick이 fileDownload, fnDownload 등 모든 패턴 처리
              const extracted = tryExtractUrlFromOnclick(onclick);
              if (extracted) {
                urlRaw = extracted;
                logs.push(`[DOM] onclick에서 URL 추출: ${txt.slice(0, 30)}...`);
              }
            }
          }
          
          if (!urlRaw || urlRaw === "#" || urlRaw === "javascript:void(0);") return;
          pushAttachment(txt, urlRaw);
        });
      });
      
      if (attachments.length > 0) {
        logs.push(`[DOM] dt/dd 구조에서 ${attachments.length}개 첨부파일 발견`);
      }
      
      // 3-2) 일반 첨부파일 영역 선택자
      if (attachments.length === 0) {
        const attachAreaSelectors = [
          "th:contains('첨부파일')", "th:contains('첨부')", "th:contains('다운로드')",
          ".file_area", ".attach_area", ".attachFile", ".file_list",
          "[class*='attach']", "[class*='file']"
        ];
        
        // 첨부파일 영역 찾기 (최대 5개 영역만)
        let $attachAreas = $();
        for (const selector of attachAreaSelectors) {
          try {
            const $found = $(selector);
            if ($found.length > 0) {
              logs.push(`[DOM] 영역 선택자 "${selector}": ${$found.length}개 매칭`);
              $attachAreas = $attachAreas.add($found.slice(0, 3));
              if ($attachAreas.length >= 5) break;
            }
          } catch {
            // 선택자 오류 무시
          }
        }
        logs.push(`[DOM] 총 첨부파일 영역: ${$attachAreas.length}개`);

        $attachAreas.each((_, el) => {
          const $area = $(el);
          // 해당 영역과 인접 영역에서 링크 찾기
          const $searchArea = $area.closest("tr").add($area.closest("dl")).add($area.parent()).add($area.next());
          
          $searchArea.find("a, button").slice(0, 20).each((_, a) => {
            const $a = $(a);
            const txt = $a.text().replace(/\s+/g, " ").trim();
            const href = $a.attr("href") || "";
            const onclick = $a.attr("onclick") || "";
            
            let urlRaw = href;
            if (!href || href.startsWith("javascript:") || href === "#") {
              if (onclick) {
                // fileDownload 패턴 처리
                if (/fileDownload|fn_fileDown|fn_download/i.test(onclick)) {
                  urlRaw = `onclick:${onclick}`;
                } else {
                  const extracted = tryExtractUrlFromOnclick(onclick);
                  if (extracted) urlRaw = extracted;
                }
              }
            }
            
            if (!urlRaw || urlRaw === "#" || urlRaw === "javascript:void(0)") return;
            if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;
            pushAttachment(txt, urlRaw);
          });
        });
      }
    }

    // 4) 최후 fallback: 전체 a 중 파일명/용량 패턴 가진 링크 (제한: 최대 100개)
    if (attachments.length === 0) {
      const allLinks = $("a, button").toArray().slice(0, 100);  // 성능을 위해 제한
      
      for (const a of allLinks) {
        const $a = $(a);
        const txt = $a.text().replace(/\s+/g, " ").trim();
        const href = $a.attr("href") || "";
        const onclick = $a.attr("onclick") || "";
        
        // 파일 확장자나 다운로드 관련 패턴이 있는 경우만 처리
        if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(href) && !looksLikeAttachmentName(onclick)) {
          continue;
        }
        
        let urlRaw = href;
        
        // javascript: href인 경우 onclick에서 추출 시도
        if (!href || href.startsWith("javascript:") || href === "#") {
          if (onclick) {
            const extracted = tryExtractUrlFromOnclick(onclick);
            if (extracted) urlRaw = extracted;
          }
        }
        
        if (!urlRaw || urlRaw === "#" || urlRaw === "javascript:void(0)") continue;
        
        pushAttachment(txt, urlRaw);
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
    
    return { body_summary, attachments: allAttachments };
  } catch (err: any) {
    logs.push(`[WARN] 상세 페이지 접근 실패: ${err.message}`);
    return { body_summary: "(접근 실패)", attachments: [] };
  }
}

export async function POST(req: Request) {
  const logs: string[] = [];
  
  try {
    const body = await req.json().catch(() => null);
    if (!body?.list_url || !body?.web_config) {
      return NextResponse.json({ error: "list_url과 web_config가 필요합니다." }, { status: 400 });
    }
    
    const { list_url, web_config, site_search_config, attachment_config, browser_config } = body;
    let config: WebConfig;
    let searchConfig: SiteSearchConfig | undefined;
    let attachConfig: AttachmentConfig | undefined;
    let browserSettings: BrowserSettings | undefined;
    
    try {
      config = typeof web_config === "string" ? JSON.parse(web_config) : web_config;
    } catch {
      return NextResponse.json({ error: "web_config가 유효한 JSON이 아닙니다." }, { status: 400 });
    }
    
    // site_search_config 파싱
    if (site_search_config) {
      try {
        searchConfig = typeof site_search_config === "string" ? JSON.parse(site_search_config) : site_search_config;
      } catch {
        // 파싱 실패시 무시
      }
    }
    
    // attachment_config 파싱
    if (attachment_config) {
      try {
        attachConfig = typeof attachment_config === "string" ? JSON.parse(attachment_config) : attachment_config;
      } catch {
        // 파싱 실패시 무시
      }
    }
    
    // browser_config 파싱
    if (browser_config) {
      try {
        browserSettings = typeof browser_config === "string" ? JSON.parse(browser_config) : browser_config;
      } catch {
        // 파싱 실패시 무시
      }
    }
    
    // 사이트 내 검색 옵션을 URL에 적용
    const effectiveUrl = applySiteSearchOptions(list_url, searchConfig);
    
    logs.push("========================================");
    logs.push("       🔍 스크래핑 테스트 시작");
    logs.push("========================================");
    logs.push(`[INFO] URL: ${effectiveUrl}`);
    
    const renderingMode = config.rendering || "static_html";
    logs.push(`[INFO] 렌더링: ${renderingMode}`);
    
    // 브라우저 설정 로그
    if (renderingMode === "dynamic_js") {
      const browserType = browserSettings?.browser_type || "chromium";
      logs.push(`[INFO] 브라우저: ${browserType} (Playwright)`);
    }
    
    // 사이트 내 검색 옵션 로그
    if (searchConfig && searchConfig.options.some(o => o.selected_value)) {
      logs.push("");
      logs.push("── 🔍 사이트 내 검색 옵션 ──");
      for (const opt of searchConfig.options) {
        if (opt.selected_value) {
          const displayValue = opt.type === "select" 
            ? (opt.options?.find(o => o.value === opt.selected_value)?.label || opt.selected_value)
            : opt.selected_value;
          logs.push(`[FILTER] ${opt.label}: ${displayValue}`);
        }
      }
    }
    
    // 첨부파일 패턴 로그
    if (attachConfig && attachConfig.pattern_type !== "auto") {
      logs.push(`[INFO] 첨부파일 패턴: ${attachConfig.pattern_type}`);
    }
    
    logs.push("");
    
    // 1. 목록 페이지 스크래핑
    logs.push("── 📋 목록 페이지 스크래핑 ──");
    const listItems = await scrapeListPage(effectiveUrl, config, logs, browserSettings);
    
    if (listItems.length === 0) {
      logs.push("");
      logs.push("========================================");
      logs.push("       ❌ 테스트 실패");
      logs.push("========================================");
      logs.push("[ERROR] 목록에서 항목을 추출하지 못했습니다.");
      logs.push("[HINT] web_config의 list.item_selector와");
      logs.push("       parse_rules를 확인해주세요.");
      
      return NextResponse.json({
        success: false,
        logs: logs.join("\n"),
        items: [],
      });
    }
    
    // 2. 상세 페이지 스크래핑 (목록 첫 페이지 최대 10개까지)
    logs.push("");
    logs.push("── 📄 상세 페이지 스크래핑 ──");
    
    const detailCount = Math.min(listItems.length, 10);
    logs.push(`[INFO] 상세 페이지 테스트: ${detailCount}개`);
    logs.push("");
    
    for (let i = 0; i < detailCount; i++) {
      // Rate limiting 방지: 요청 사이에 500ms 딜레이
      if (i > 0) {
        await delay(500);
      }
      
      const item = listItems[i];
      logs.push(`[DETAIL ${i + 1}] ${truncateText(item.title, 40)}`);
      logs.push(`         URL: ${item.link || "(없음)"}`);
      
      const detailRenderingMode = config.rendering || "static_html";
      const detail = await scrapeDetailPage(item, config, list_url, logs, attachConfig, detailRenderingMode, browserSettings);
      item.body_summary = detail.body_summary;
      item.attachments = detail.attachments;
      
      logs.push(`         본문: ${detail.body_summary}`);
      if (detail.attachments.length > 0) {
        logs.push(`         📎 첨부파일 (${detail.attachments.length}개):`);
        detail.attachments.forEach((f, idx) => {
          logs.push(`           ${idx + 1}. ${f.fileName}`);
          logs.push(`              └─ ${f.downloadUrl}`);
        });
      } else {
        logs.push(`         첨부파일: 없음`);
      }
      logs.push("");
    }
    
    // 결과 요약
    logs.push("========================================");
    logs.push("       ✅ 테스트 완료");
    logs.push("========================================");
    logs.push(`[RESULT] 목록 항목: ${listItems.length}개 추출 성공`);
    
    const tested = listItems.slice(0, detailCount);
    const withBody = tested.filter(i => i.body_summary && i.body_summary !== "(접근 실패)").length;
    const withAttach = tested.filter(i => i.attachments && i.attachments.length > 0).length;
    
    logs.push(`[RESULT] 본문 추출: ${withBody}/${detailCount}개 성공`);
    logs.push(`[RESULT] 첨부파일 발견: ${withAttach}/${detailCount}개`);
    logs.push("");
    logs.push("[INFO] 실제 스크래핑 시 collection_range에");
    logs.push("       따라 더 많은 페이지가 수집됩니다.");
    
    return NextResponse.json({
      success: true,
      logs: logs.join("\n"),
      items: listItems.slice(0, detailCount),
    });
  } catch (err: any) {
    logs.push("");
    logs.push("========================================");
    logs.push("       ❌ 테스트 오류");
    logs.push("========================================");
    logs.push(`[ERROR] ${err.message}`);
    
    return NextResponse.json({
      success: false,
      logs: logs.join("\n"),
      error: err.message,
    }, { status: 500 });
  }
}
